/* Verify the full directory in the actual paginated preview, including Batang
 * when an optional local test font is supplied as the third argument. */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), output = path.join(root, 'build/verification');
fs.mkdirSync(output, {recursive:true});

(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    for (const environment of process.argv[3] ? ['default', 'Batang'] : ['default']) {
      const context = await browser.newContext({bypassCSP:true}), errors = [], requests = [];
      await context.route(/^https?:/, r => {requests.push(r.request().url()); return r.abort();});
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
      if (environment === 'Batang') {
        await page.evaluate(async bytes => {
          const font = new FontFace('바탕', new Uint8Array(bytes).buffer);
          document.fonts.add(await font.load());
        }, [...fs.readFileSync(process.argv[3])]);
      }
      const count = await page.evaluate(() => window.Gongmun.lawyerDefaults.length);
      for (const width of [1440,1060,390]) {
        await page.setViewportSize({width,height:1080});
        for (const kind of ['reply','additional','custom']) {
          const label = `${environment}-${kind}-${width}`;
          const payload = await page.evaluate(({kind,label}) => {
            const G = window.Gongmun, c = G.sample(kind === 'additional' ? 'additional' : 'reply');
            c.docType = kind; c.caseLabel = label; c.lawyers = G.clone(G.lawyerDefaults);
            return JSON.stringify(G.caseFile(c));
          }, {kind,label});
          await page.locator('#case-file-input').setInputFiles({name:'preview-check.json',mimeType:'application/json',buffer:Buffer.from(payload)});
          await page.waitForFunction(({label,kind,count}) => {
            const rows = [...document.querySelectorAll('#pages .doc-lawyer-contact')];
            const paper = document.querySelector('#pages .paper');
            return document.getElementById('caseLabel').value === label && rows.length === count &&
              paper.classList.contains('additional-paper') === (kind === 'additional') && rows.every(e => e.clientHeight > 0);
          }, {label,kind,count});
          await page.evaluate(() => document.fonts.ready);
          // The preview may redraw while it is measured; rows from a page that was just replaced read as NaN, so measure again.
          let rows;
          for (let attempt = 0; attempt < 5; attempt++) {
            rows = await page.locator('#pages .doc-lawyer-contact').evaluateAll(es => es.map(e => ({
              name:e.dataset.lawyer,
              lines:e.isConnected ? e.clientHeight / parseFloat(getComputedStyle(e).lineHeight) : null,
              clipped:e.scrollWidth-e.clientWidth,
              outsidePaper:e.getBoundingClientRect().right-e.closest('.paper').getBoundingClientRect().right
            })));
            if (rows.every(r => r.lines !== null && !Number.isNaN(r.lines))) break;
            await page.waitForTimeout(200);
          }
          assert.equal(rows.length,count);
          // Print the offending rows: one full run on 2026-10-23 failed here once (additional-1440) and passed on rerun.
          const bad = rows.filter(r => r.lines !== 1 || r.clipped > 1 || r.outsidePaper > 1);
          assert.deepEqual(bad,[],label + ' ' + JSON.stringify(bad));
          assert.ok(await page.locator('#export-docx').isEnabled(),label + ': Word export disabled');
          console.log(`PASS ${label}: ${count} contacts on one line; no clipping or paper overflow`);
        }
      }
      assert.deepEqual(errors,[]); assert.deepEqual(requests,[]);
      await context.close();
    }
    // A cover that fills page 1 exactly in Word (3 long contacts, cover only) stays on one preview page, too.
    const page = await (await browser.newContext({bypassCSP:true})).newPage();
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await page.setViewportSize({width:1440,height:1080});
    const payload = await page.evaluate(() => {
      const G = window.Gongmun, c = G.sample('reply');
      c.caseLabel = 'full-cover'; c.includeBody = false;
      c.lawyers = G.clone(G.lawyerDefaults.filter(l => ['고지하','곽희율','길성영'].includes(l.name)));
      return JSON.stringify(G.caseFile(c));
    });
    await page.locator('#case-file-input').setInputFiles({name:'full-cover.json',mimeType:'application/json',buffer:Buffer.from(payload)});
    await page.waitForFunction(() => document.getElementById('caseLabel').value === 'full-cover');
    await page.waitForTimeout(500);
    const pages = await page.locator('#pages .paper').evaluateAll(ps => ps.map(p => p.querySelectorAll('.doc-lawyer-name').length));
    assert.deepEqual(pages, [3], 'Word puts all three lawyers on page 1 (verified 2026-10-23)');
    console.log('PASS full cover (3 long contacts) stays on one preview page, as in Word');
  } finally {await browser.close();}
})().catch(e => {console.error(e);process.exitCode=1;});
