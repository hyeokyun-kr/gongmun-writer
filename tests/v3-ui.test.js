/* v3 editing UI in a real browser: pasted request list, item editing (add/move/level/delete),
   reference list, label modes, case save/restore with items, preview pages, narrow screen.
   Usage: node tests/v3-ui.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const out = path.join(root, 'build', 'verification', 'v3');
fs.mkdirSync(out, {recursive: true});
const pasted = `자료제출 요청사항
다음의 사항에 대하여 답변하여 주십시오.
1. 귀사의 최근 3년간 매출액을 제출하여 주십시오.
  * 연도별로 구분
2. 귀사의 ‘가격 정책’ 관련,
 2-1. 정책 문서를 제출하여 주십시오.
 2-2. 적용 대상 거래처 목록을 제출하여 주십시오.
3. 거래처별 계약서 사본을 제출하여 주십시오.
<자료 작성 시 유의사항>
1) 각 장마다 날인`;

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
  const errors = [], requests = [];
  let passed = 0; const ok = n => {passed++; console.log('PASS', n);};
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    await context.route(/^https?:/, r => {requests.push(r.request().url()); return r.abort();});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push(m.text());});
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await page.waitForTimeout(400);
    const items = () => page.evaluate(() => [...document.querySelectorAll('#items .request-item')].map(r => ({
      level: r.classList.contains('level2') ? 2 : 1, number: r.querySelector('.request-number').textContent,
      label: r.querySelector('.request-label').value, text: r.querySelector('.request-text').value, notes: r.querySelector('.request-notes').value})));
    const headings = () => page.evaluate(() => [...document.querySelectorAll('#pages .doc-item')].map(e => e.textContent));

    // Pasted list: stem ‘관련,’ merges into 2-1/2-2 (as in the 라마바 reply); guidance after 유의사항 is ignored.
    await page.locator('.paste-details summary').click();
    await page.locator('#paste-requests').fill(pasted);
    await page.locator('#paste-apply').click();
    await page.waitForSelector('#status-requests.done');
    await page.waitForTimeout(300);  // the preview re-renders shortly after each change
    let list = await items();
    assert.deepEqual(list.map(i => [i.number, i.label]), [['1.', '1'], ['2.', '2-1'], ['3.', '2-2'], ['4.', '3']]);
    assert.equal(list[1].text, '귀사의 ‘가격 정책’ 관련, 정책 문서를 제출하여 주십시오.');
    assert.equal(list[0].notes, '* 연도별로 구분');
    assert.ok((await headings()).some(h => h.startsWith('2.[요청사항 2-1] 귀사의 ‘가격 정책’ 관련')), 'labels shown automatically when numbering differs');
    ok('붙여넣기: 머리말 합치기·유의사항 제외·[요청사항 N] 자동 표시');

    // Label modes and notes toggle reach the preview.
    await page.locator('#labelMode').selectOption('off'); await page.waitForTimeout(250);
    assert.ok(!(await headings()).some(h => h.includes('[요청사항')));
    await page.locator('#labelMode').selectOption('auto');
    await page.locator('#includeNotes').uncheck(); await page.waitForTimeout(250);
    assert.equal(await page.locator('#pages .doc-note').count(), 0);
    await page.locator('#includeNotes').check(); await page.waitForTimeout(250);
    assert.equal(await page.locator('#pages .doc-note').count(), 1);
    ok('원문 번호 표시 방식·세부 내용 표시가 미리보기에 반영');

    // Editing: level change, move, add, delete.
    await page.locator('#items .request-item').nth(2).locator('.level-button').click();
    await page.waitForTimeout(250);
    list = await items();
    assert.deepEqual(list.map(i => [i.level, i.number]), [[1, '1.'], [1, '2.'], [2, '가.'], [1, '3.']]);
    await page.locator('#items .request-item').nth(3).getByRole('button', {name: /위로/}).click();
    list = await items();
    assert.equal(list[2].label, '3'); assert.equal(list[3].level, 2);
    await page.locator('#add-item').click();
    await page.keyboard.type('새로 추가한 요청사항입니다.');
    await page.waitForTimeout(250);
    list = await items();
    assert.equal(list.length, 5); assert.equal(list[4].text, '새로 추가한 요청사항입니다.');
    assert.ok((await page.locator('#pages').innerText()).includes('새로 추가한 요청사항입니다.'));
    await page.locator('#items .request-item').nth(4).getByRole('button', {name: /삭제/}).click();
    await page.locator('#confirm-yes').click();
    assert.equal((await items()).length, 4);
    // The first item can never become a sub item.
    assert.ok(await page.locator('#items .request-item').nth(0).locator('.level-button').isDisabled());
    ok('요청사항 단계 변경·순서 이동·추가·삭제와 첫 항목 보호');

    // Clicking a heading in the preview jumps to its editor.
    await page.locator('#pages .doc-item').nth(1).click();
    assert.equal(await page.evaluate(() => document.activeElement.closest('.request-item')?.dataset.item), '1');
    ok('미리보기 요청사항을 누르면 해당 편집 칸으로 이동');

    // Reference list with auto-incremented number.
    await page.locator('#ref-no').fill('23'); await page.locator('#ref-text').fill('마진 플래너 산정표'); await page.locator('#add-ref').click();
    assert.equal(await page.locator('#ref-no').inputValue(), '24');
    await page.locator('#ref-text').fill('마진 플래너 적용 가맹점 및 공급 금액'); await page.locator('#ref-text').press('Enter');
    await page.waitForTimeout(250);
    const refText = await page.locator('#pages .doc-ref-row').allInnerTexts();
    assert.deepEqual(refText.map(t => t.replace(/\s+/g, ' ')), ['1. 참고자료 23 마진 플래너 산정표', '2. 참고자료 24 마진 플래너 적용 가맹점 및 공급 금액']);
    ok('첨부서류 목록: 번호 자동 증가와 미리보기');

    // Cover fields so the document can be saved, then case save → new → restore keeps items.
    await page.locator('#submitter').fill('가나다 주식회사');
    await page.locator('#requestDate').fill('2026-10-01');
    await page.locator('#lawyer-search').fill('위재결'); await page.locator('#lawyer-results .lawyer-result').first().click();
    await page.waitForTimeout(250);
    assert.ok(await page.locator('#export-docx').isEnabled(), await page.locator('#validation').innerText());
    const pageCount = await page.locator('#page-count').innerText();
    assert.match(pageCount, /표지 1쪽 · 본문 \d+쪽/);
    const [caseDl] = await Promise.all([page.waitForEvent('download'), page.locator('#save-case').click()]);
    const casePath = path.join(out, 'ui-case.json'); await caseDl.saveAs(casePath);
    const saved = JSON.parse(fs.readFileSync(casePath, 'utf8'));
    assert.equal(saved.version, 2); assert.equal(saved.data.items.length, 4); assert.equal(saved.data.refMaterials.length, 2);
    const before = await items();
    await page.locator('#new-case').click();
    assert.equal((await items()).length, 0);
    await page.locator('#case-file-input').setInputFiles(casePath);
    await page.waitForTimeout(400);
    assert.deepEqual(await items(), before);
    assert.equal(await page.locator('#pages .doc-ref-row').count(), 2);
    const [docDl] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
    await docDl.saveAs(path.join(out, 'ui-restored.docx'));
    ok(`사건 저장(v2)·새 공문·불러오기 후 요청사항·참고자료 복원, Word 저장 (${pageCount})`);

    await page.screenshot({path: path.join(out, 'ui-desktop.png')});
    await page.setViewportSize({width: 390, height: 900});
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
    await page.locator('.upload-card').screenshot({path: path.join(out, 'ui-mobile-upload.png')});
    await page.locator('#items-card').screenshot({path: path.join(out, 'ui-mobile-items.png')});
    ok('좁은 화면(390px) 가로 넘침 없음');
  } finally {await browser.close();}
  assert.deepEqual(errors, [], 'page errors'); assert.deepEqual(requests, [], 'network');
  console.log(`${passed} v3 UI checks passed; no page errors or network requests`);
})().catch(e => {console.error(e); process.exit(1);});
