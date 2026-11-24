/* The existing-Word lawyer amendment must work on full replies (cover + 첨부 body):
   v3 outputs and the example final replies (tests/fixtures). The body after the cover must stay byte-identical.
   Usage: node tests/v3-word-amend.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const examples = path.join(root, 'tests', 'fixtures', 'requests');
const out = path.join(root, 'build', 'verification', 'v3', 'amend');
fs.mkdirSync(out, {recursive: true});
function documentXml(file) {
  const b = fs.readFileSync(file);
  let at = b.length - 22; while (b.readUInt32LE(at) !== 0x06054b50) at--;
  let p = b.readUInt32LE(at + 16);
  for (let i = 0; i < b.readUInt16LE(at + 10); i++) {
    const nameLen = b.readUInt16LE(p + 28), name = b.toString('utf8', p + 46, p + 46 + nameLen), off = b.readUInt32LE(p + 42);
    if (name === 'word/document.xml') {
      const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28), data = b.subarray(start, start + b.readUInt32LE(p + 20));
      return (b.readUInt16LE(p + 10) === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nameLen + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
}
// Everything from the first paragraph-level section break onward is the 첨부 body.
// (The amendment may move a break that sat on the last contact, as before, so compare after it.)
// New rows go after bookmark ends that close on the cover (existing behaviour), so skip those too.
const bodyPart = xml => xml.slice(xml.indexOf('</w:p>', xml.indexOf('</w:sectPr>')) + 6).replace(/^(?:<w:bookmarkEnd\b[^>]*\/>)+/, '');
const opinions = path.join(root, 'tests', 'fixtures', 'opinion');
const sources = [
  ['v3-rmb', path.join(root, 'build', 'verification', 'v3', 'rmb.docx')],
  ...fs.readdirSync(examples).filter(n => /\.docx$/i.test(n)).sort().map(n => ['final-' + n.slice(0, 1), path.join(examples, n)]),
  // 심사보고서 의견서: the generated one (4 sections, ‘주식회사 사아자 대리인’) and the example drafts.
  ['opinion-engine', path.join(root, 'build', 'verification', 'opinion', 'engine-gammyeon.docx')],
  ...fs.readdirSync(opinions).filter(n => /\.docx$/i.test(n)).sort().map((n, i) => ['opinion-sample-' + (i + 1), path.join(opinions, n)])
];
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
  const errors = [], requests = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    await context.route(/^https?:/, r => {requests.push(r.request().url()); return r.abort();});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    for (const [key, file] of sources) {
      await page.locator('#existing-word-open').click();
      await page.locator('#existing-word-file').setInputFiles(file);
      await page.waitForSelector('#existing-word-selection:not([hidden]), #existing-word-status.error', {timeout: 20000});
      const status = await page.locator('#existing-word-status').innerText();
      if (await page.locator('#existing-word-status.error').count()) {console.log(`INFO ${key}: not supported → ${status}`); await page.locator('[data-close="existing-word-dialog"]').first().click(); continue;}
      const before = await page.locator('#existing-word-count').innerText();
      await page.locator('#existing-word-search').fill('나태진');
      await page.locator('#existing-word-results .lawyer-result:not([disabled])').first().click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
      const target = path.join(out, `${key}.docx`); await download.saveAs(target);
      const a = documentXml(file), b = documentXml(target), sections = a.split('<w:sectPr').length - 1;
      // A cover-only document (one section) has no body after the cover to compare.
      if (sections > 1) assert.equal(bodyPart(b), bodyPart(a), `${key}: 첨부 body must be unchanged`);
      const coverEnd = sections > 1 ? b.indexOf('</w:p>', b.indexOf('</w:sectPr>')) : b.length;  // the cover's last paragraph may carry the break
      assert.ok(b.indexOf('taejin.na@example.com') > 0 && b.indexOf('taejin.na@example.com') < coverEnd, `${key}: new lawyer on the cover`);
      console.log(`PASS ${key}: ${before} + 나태진 → body after the cover unchanged · ${(await page.locator('#existing-word-warnings').innerText()).replace(/\n/g, ' / ')}`);
      await page.locator('[data-close="existing-word-dialog"]').first().click();
    }
  } finally {await browser.close();}
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('PASS existing-Word amendment on full replies; no page errors or network requests');
})().catch(e => {console.error(e); process.exit(1);});
