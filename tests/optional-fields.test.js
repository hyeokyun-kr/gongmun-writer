const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname,'..');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  try {
    const context = await browser.newContext({acceptDownloads:true, bypassCSP:true}), errors = [], requests = [];
    await context.route(/^https?:/, r => {requests.push(r.request().url());return r.abort();});
    const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    for (const kind of ['reply','additional','custom']) {
      const payload = await page.evaluate(kind=>{
        const G=window.Gongmun, c=G.sample(kind==='additional'?'additional':'reply');
        c.docType=kind;c.caseLabel='optional-'+kind;c.requestDocNo='';c.attachments=[];
        return JSON.stringify(G.caseFile(c));
      },kind);
      await page.locator('#case-file-input').setInputFiles({name:'optional.json',mimeType:'application/json',buffer:Buffer.from(payload)});
      await page.waitForFunction(label=>document.getElementById('caseLabel').value===label,'optional-'+kind);
      assert.equal(await page.locator('#requestDocNo').inputValue(),'');
      assert.equal(await page.locator('#attachments .ordered-item').count(),0);
      assert.equal(await page.locator('#export-docx').isEnabled(),true);
      assert.doesNotMatch(await page.locator('#pages .para-text').allTextContents().then(a=>a.join('\n')),/문서번호|첨부와 같이/);
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-docx').click()]);
      await download.saveAs(path.join(root,'build/verification','browser-optional-'+kind+'.docx'));
      console.log('PASS automatic '+kind+': empty request number and no attachments; Word download enabled');
    }
    await page.locator('#requestDocNo').fill('테스트-1');
    await page.locator('#attachment-name').fill('검증 자료');await page.locator('#add-attachment').click();
    await page.waitForFunction(()=>document.getElementById('pages').textContent.includes('첨부와 같이'));
    assert.match(await page.locator('#pages').innerText(),/테스트-1/);
    await page.locator('#requestDocNo').fill('');
    await page.locator('#attachments').getByLabel('1번째 항목 삭제').click();
    await page.waitForFunction(()=>!document.getElementById('pages').textContent.includes('첨부와 같이'));
    assert.equal(await page.locator('#export-docx').isEnabled(),true);
    assert.doesNotMatch(await page.locator('#pages .para-text').allTextContents().then(a=>a.join('\n')),/문서번호/);
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    await context.close();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
