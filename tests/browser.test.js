/* Development verification only. The distributed HTML needs no Playwright/install. */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), artifacts = path.join(root, 'build/verification');
fs.mkdirSync(artifacts, {recursive: true});

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
    args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check']});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1080}, acceptDownloads:true});
    const requests = [], errors = [];
    await context.route(/^https?:/, route => {requests.push(route.request().url()); return route.abort();});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    // Optional local Batang fixture reproduces Windows font selection on macOS.
    if (process.argv[3]) {
      await page.evaluate(async bytes => {
        const font = new FontFace('바탕', new Uint8Array(bytes).buffer);
        document.fonts.add(await font.load());
      }, [...fs.readFileSync(process.argv[3])]);
    }
    await page.waitForTimeout(350);
    assert.ok(await page.locator('#export-docx').isDisabled());
    await page.locator('#lawyer-search').fill('ㄱㅈㅇ');
    assert.match(await page.locator('#lawyer-results').innerText(), /곽지율/);
    await page.locator('#lawyer-search').fill('taejin.na@example.com');
    assert.match(await page.locator('#lawyer-results').innerText(), /나태진/);
    await page.locator('#lawyer-search').fill('');
    console.log('PASS PDF roster additions can be found by initials and email');
    await page.evaluate(() => {document.querySelector('.more-tools').open = true;});
    await page.locator('#sample-reply').click();
    await page.waitForTimeout(350);
    assert.ok(await page.locator('#export-docx').isEnabled());
    assert.equal(await page.locator('#requestDate').inputValue(), '2026-01-05');
    assert.equal(await page.locator('#selected-lawyers .ordered-item').count(), 4);
    assert.equal(await page.locator('input.invalid').count(), 0, 'sample fields should not be marked invalid');
    const contactLines = () => page.locator('#pages .doc-lawyer-contact').evaluateAll(es => es.map(e => ({
      lines:Math.round(e.clientHeight / parseFloat(getComputedStyle(e).lineHeight)),
      font:getComputedStyle(e).fontFamily, text:e.textContent
    })));
    if (process.argv[3]) {
      const oldStyle = await page.addStyleTag({content:'.doc-lawyer-contact{font-family:inherit}'});
      const before = await contactLines();
      assert.ok(before.some(e => e.lines > 1), 'Batang fixture must reproduce the original Windows wrapping');
      await oldStyle.evaluate(e => e.remove());
      console.log('PASS reproduced original email wrapping with Windows Batang font');
    }
    const contacts = await contactLines();
    assert.equal(contacts.length, 4);
    assert.ok(contacts.every(e => e.lines === 1), 'standard lawyer contacts must fit on one line: ' + JSON.stringify(contacts));
    assert.ok(contacts.every(e => e.font.startsWith('"Times New Roman"')), 'contact Latin font must match the DOCX');
    console.log('PASS preview contact font matches Word and all standard emails stay on one line');
    if (process.argv[3]) {
      const firstLawyer = page.locator('#pages .doc-lawyer-name').first();
      await firstLawyer.scrollIntoViewIfNeeded();
      await page.evaluate(() => {document.getElementById('toast').hidden = true;});
      await firstLawyer.screenshot({path:path.join(artifacts, 'windows-font-preview.png')});
      // The remaining checks use the existing macOS font environment; attachment
      // prefix alignment has its own platform-dependent glyph measurements.
      await page.evaluate(() => {
        for (const font of document.fonts) if (font.family === '바탕') document.fonts.delete(font);
      });
      await page.locator('#zoom-fit').click();
    }
    const attachmentAlignment = await page.locator('#pages .doc-attachments').evaluateAll(es => {
      // The index-th character of the element's text, across the text nodes the preview splits it into (wide spaces).
      const numberRect = (e, index) => {
        const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), range = document.createRange();
        while (walker.nextNode() && index >= walker.currentNode.length) index -= walker.currentNode.length;
        range.setStart(walker.currentNode, index); range.setEnd(walker.currentNode, index + 1);
        return range.getBoundingClientRect();
      };
      return {first:numberRect(es[0], 3).left, second:numberRect(es[1], 0).left,
        indent:getComputedStyle(es[1]).paddingLeft, text:es[1].textContent};
    });
    assert.equal(attachmentAlignment.indent, '36px');
    assert.equal(attachmentAlignment.text, '2. 요구자료 내용. 끝.');
    assert.ok(Math.abs(attachmentAlignment.first - attachmentAlignment.second) <= 1,
      'attachment numbers must align: ' + JSON.stringify(attachmentAlignment));
    console.log('PASS attachment two uses paragraph indentation and aligns with attachment one');
    const screenshot = path.join(artifacts, 'app-desktop.png');
    await page.screenshot({path:screenshot, fullPage:true});
    console.log('PASS sample reply: enabled Word export, original data and four lawyers');
    let [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
    await download.saveAs(path.join(artifacts, 'browser-reply.docx'));
    assert.equal(fs.readFileSync(await download.path()).subarray(0,4).toString('hex'), '504b0304');
    console.log('PASS actual browser DOCX download');

    // Editing the final body is preserved when other fields change.
    await page.locator('#pages [data-preview-edit="body"]').first().click();
    await page.locator('#body-editor').fill('브라우저에서 직접 수정한 본문입니다.\n두 번째 문단을 추가했습니다.');
    await page.locator('#apply-body').click();
    await page.locator('#submitter').fill('변경된 제출 주체 주식회사');
    await page.waitForTimeout(300);
    assert.match(await page.locator('#pages').innerText(), /브라우저에서 직접 수정한 본문/);
    assert.match(await page.locator('#body-mode').innerText(), /직접 수정/);
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#save-case').click()]);
    const saved = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(saved.data.bodyOverride, '브라우저에서 직접 수정한 본문입니다.\n두 번째 문단을 추가했습니다.');
    assert.equal(saved.data.lawyers[0].name, '한라다');
    await download.saveAs(path.join(artifacts, 'browser-case.json'));
    console.log('PASS body editing and case save snapshot');
    await page.locator('#new-case').click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#submitter').inputValue(), '');
    await page.locator('#case-file-input').setInputFiles(path.join(artifacts, 'browser-case.json'));
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#submitter').inputValue(), '변경된 제출 주체 주식회사');
    assert.match(await page.locator('#pages').innerText(), /두 번째 문단/);
    assert.ok(await page.locator('#export-docx').isEnabled());
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
    await download.saveAs(path.join(artifacts, 'browser-manual.docx'));
    console.log('PASS case restore and edited DOCX download');

    // A placeholder blocks output; regeneration explicitly asks before replacing edits.
    await page.locator('#edit-body').click(); await page.locator('#body-editor').fill('2026. [*].까지 제출하겠습니다.'); await page.locator('#apply-body').click();
    await page.waitForTimeout(200); assert.ok(await page.locator('#export-docx').isDisabled());
    await page.locator('#reset-body').click(); assert.ok(await page.locator('#confirm-dialog').isVisible());
    await page.locator('#confirm-no').click(); assert.ok(await page.locator('#export-docx').isDisabled());
    await page.locator('#reset-body').click(); await page.locator('#confirm-yes').click();
    await page.waitForTimeout(250); assert.ok(await page.locator('#export-docx').isEnabled());
    console.log('PASS placeholder protection and non-destructive reset confirmation');

    await page.locator('#sample-additional').click(); await page.locator('#confirm-yes').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#requestDocNo').inputValue(), '기업집단정책과-000');
    assert.match(await page.locator('#pages').innerText(), /동일인\(홍길동\)은/);
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
    await download.saveAs(path.join(artifacts, 'browser-additional.docx'));
    await page.screenshot({path:path.join(artifacts, 'app-additional.png'), fullPage:true});
    console.log('PASS original 가나다 wording and browser DOCX');

    await page.locator('.extract-details summary').click();
    await page.locator('#request-text').fill('2022. 12. 27. 기업집단정책과-012 기업집단국 기업집단정책과장');
    await page.locator('#extract-request').click();
    assert.equal(await page.locator('#candidate-number').inputValue(), '기업집단정책과-012');
    assert.equal(await page.locator('#candidate-date').inputValue(), '2022-12-27');
    console.log('PASS request candidates in UI');

    // Preserve selected contact snapshots when editing the master directory.
    await page.locator('#manage-lawyers').click();
    await page.locator('#lawyer-name').fill('테스트변호사'); await page.locator('#lawyer-phone').fill('02-0000-0000');
    await page.locator('#lawyer-email').fill('test@example.test'); await page.locator('#lawyer-form button[type="submit"]').click();
    assert.match(await page.locator('#master-list').innerText(), /테스트변호사/);
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-master').click()]);
    const exportedMaster = JSON.parse(fs.readFileSync(await download.path(), 'utf8')).lawyers;
    assert.equal(exportedMaster.length, 53, '기본 명단 52명 + 테스트변호사');
    assert.equal(exportedMaster.find(l => l.name === '한라다').email, 'rada.han@example.com');
    assert.equal(exportedMaster.find(l => l.name === '안채유').subPhone, '5545');
    await page.locator('[data-close="lawyer-dialog"]').click();
    await page.locator('#lawyer-search').fill('ㅌㅅㅌ');
    assert.match(await page.locator('#lawyer-results').innerText(), /테스트변호사/);
    await page.locator('#lawyer-results .lawyer-result').click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('#selected-lawyers .ordered-item').count(), 5);
    const firstName = await page.locator('#selected-lawyers .item-main strong').first().innerText();
    await page.locator('#selected-lawyers .ordered-item').last().getByLabel('5번째 항목 위로').click();
    assert.equal(await page.locator('#selected-lawyers .item-main strong').first().innerText(), firstName);
    console.log('PASS master management, initial-consonant search and reorder');

    // Unknown source files are rejected without changing the current document.
    await page.locator('#case-file-input').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"selectedLawyers":["l1"]}')});
    await page.waitForTimeout(200); assert.match(await page.locator('#toast').innerText(), /호환되지/);
    assert.equal(await page.locator('#requestDocNo').inputValue(), '기업집단정책과-000');
    console.log('PASS incompatible case import protection');

    // Multi-page overflow is divided into readable preview pages.
    await page.locator('#edit-body').click(); await page.locator('#body-editor').fill(('긴 본문의 줄바꿈과 페이지 나눔을 확인합니다. ').repeat(160)); await page.locator('#apply-body').click();
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.page-frame').count() > 2);
    const overflow = await page.locator('.page-content').evaluateAll(es => es.map(e => e.scrollHeight - e.clientHeight));
    assert.ok(overflow.every(n => n <= 2), 'preview overflow: ' + overflow.join(','));
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]); await download.saveAs(path.join(artifacts, 'browser-long.docx'));
    console.log('PASS long multi-page preview without clipping');

    await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(350);
    const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(horizontal <= 2, 'mobile horizontal overflow: ' + horizontal);
    await page.screenshot({path:path.join(artifacts, 'app-mobile.png'), fullPage:false});
    console.log('PASS narrow-screen layout');
    assert.deepEqual(errors, [], 'JavaScript errors'); assert.deepEqual(requests, [], 'external HTTP requests');
    console.log('PASS no application errors and no external requests');
    await context.close();
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
