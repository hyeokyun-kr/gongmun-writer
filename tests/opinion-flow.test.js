/* 심사보고서 의견서 in a real browser: upload the 의견제출 요청 공문 (+ 심사보고서), check the filled fields against the
   example 의견서 samples (tests/fixtures/opinion), the preview (겉표지·목차) and the saved DOCX. Usage: node tests/opinion-flow.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const samples = path.join(root, 'tests', 'fixtures', 'opinion');
const out = path.join(root, 'build', 'verification', 'opinion');
fs.mkdirSync(out, {recursive: true});
const file = prefix => path.join(samples, fs.readdirSync(samples).find(n => n.normalize('NFC').startsWith(prefix.normalize('NFC'))));
const docText = buf => {
  // The app writes a stored (uncompressed) ZIP: walk the local headers to word/document.xml.
  for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
    const size = buf.readUInt32LE(at + 18), nameLength = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength), start = at + 30 + nameLength + extra;
    if (name === 'word/document.xml') return buf.toString('utf8', start, start + size);
    at = start + size;
  }
  throw new Error('word/document.xml not found');
};
let passed = 0;
const ok = name => {passed++; console.log('PASS', name);};

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-default-browser-check']});
  const requests = [], errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    await context.route(/^https?:/, route => {requests.push(route.request().url()); return route.abort();});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push('console: ' + m.text());});
    page.on('dialog', d => d.accept());
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await page.waitForTimeout(400);
    const fields = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value])));
    const state = () => page.evaluate(() => ({
      type: document.body.dataset.doctype, summary: document.getElementById('analysis-summary').innerText,
      items: [...document.querySelectorAll('#items .request-text')].map(e => e.value),
      attachments: [...document.querySelectorAll('#attachments input:not([type=number])')].map(e => e.value),
      lawyers: [...document.querySelectorAll('#selected-lawyers strong')].map(e => e.textContent),
      pages: [...document.querySelectorAll('#pages .paper')].map(p => p.getAttribute('aria-label')),
      toc: [...document.querySelectorAll('#pages .doc-toc-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
      cover: document.querySelector('#pages .doc-cover-page')?.innerText.replace(/\s+/g, ' ').trim(),
      uploadTitle: document.getElementById('upload-title').textContent, slot2: document.getElementById('requests-title').textContent,
      replyHidden: getComputedStyle(document.getElementById('requestDate').closest('.reply-only')).display === 'none'
    }));
    const upload = async (slot, prefix) => {
      await page.locator('#file-' + slot).setInputFiles(file(prefix));
      await page.waitForSelector(`#status-${slot}.done, #status-${slot}.error`, {timeout: 60000});
      await page.waitForTimeout(400);
    };
    const save = async name => {
      await page.locator('#lawyer-search').fill('');
      await page.waitForTimeout(300);  // the preview and its checks refresh shortly after each change
      assert.ok(await page.locator('#export-docx').isEnabled(), `${name}: export should be enabled · ${await page.locator('#validation').innerText()}`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
      const target = path.join(out, name + '.docx'); await download.saveAs(target);
      console.log('saved', path.relative(project, target), download.suggestedFilename());
      return docText(fs.readFileSync(target));
    };

    // 1. 감면 건: 공문의 신청인은 ***** → 심사보고서에서 우리 법인이 대리하는 회사로 채움.
    await upload('gongmun', '(공문)심사보고서 송부');
    let f = await fields(), s = await state();
    assert.equal(s.type, 'opinion'); assert.equal(s.uploadTitle, '공문과 심사보고서 올리기'); assert.equal(s.slot2, '② 심사보고서 (선택)'); assert.ok(s.replyHidden);
    assert.deepEqual([f.caseNo, f.partyRole, f.refDept, f.title, f.sendDate, f.firmRef, f.submitter],
      ['2026국카0001', '신청인', '심판총괄담당관, 국제카르텔조사과장', '[감면] 심사보고서에 대한 의견서 제출', '2026-04-16', '26-*', '']);
    assert.match(f.caseName, /관련 \*{5}의 감면신청에 대한 건\(비공개\)$/);
    assert.match(s.summary, /회사 이름이 가려져 있습니다/);
    assert.deepEqual(s.attachments, ['심사보고서에 대한 의견서 20부(심판총괄담당관실 13부, 국제카르텔조사과 7부)']);
    ok('감면 공문: 의견서 유형으로 전환, 사건번호·신청인·참조·[감면] 제목·제출기한·첨부 부수, 가려진 이름 안내');
    await upload('requests', '(심사보고서)7개');
    f = await fields(); s = await state();
    assert.equal(f.submitter, '주식회사 사아자');
    assert.equal(f.caseName, '7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건(비공개)');
    assert.equal(f.caseNo, '2026국카0001', '감면 건 사건번호는 공문 것을 유지');
    assert.deepEqual(s.items, ['심사보고서 및 신청인 의견 요지', '심사보고서 요지', '사아자 의견 요지', '[의견 제목]', '결론']);
    assert.match(f.confidentialNote, /^사아자 의견서가 수사기관 등 제3자에게/);
    assert.match(s.summary, /우리 법인 대리: 주식회사 사아자/); assert.match(s.summary, /사건번호\(2025제카0002\)가 공문\(2026국카0001\)과 다릅니다/);
    await page.locator('#add-report-lawyers').click(); await page.waitForTimeout(200);
    s = await state();
    assert.deepEqual(s.lawyers, ['곽솔', '나현하', '이담혜', '고지하']);
    ok('심사보고서: 정식 이름 주식회사 사아자로 *****·사건명 채움, 본문 뼈대 ‘사아자 의견 요지’, 비공개 문구, 변호사 4명 한 번에 추가');
    s = await state();
    // 공문 표지 (lawyers may run onto a 2nd page) → 겉표지 → 목차 → 의견서 본문, in this order.
    const kinds = [...new Set(s.pages.map(x => x.replace(/\s*\d+페이지$/, '')))];
    assert.deepEqual(kinds, ['공문 표지', '의견서 겉표지', '목차', '의견서 본문'], JSON.stringify(s.pages));
    assert.equal(s.cover, '심사보고서에 대한 의견서 - 7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건(비공개) - (사건번호: 2026국카0001) 신청인 주식회사 사아자 대리인 법무법인 예시');
    assert.deepEqual(s.toc.map(t => t.replace(/\s*\d+$/, '')), ['I. 심사보고서 및 신청인 의견 요지', '1. 심사보고서 요지', '2. 사아자 의견 요지', 'II. [의견 제목]', 'III. 결론']);
    await page.screenshot({path: path.join(out, 'ui-gammyeon.png')});
    let xml = await save('ui-gammyeon');
    assert.equal([...xml.matchAll(/<w:sectPr\b/g)].length, 4);
    assert.match(xml, /귀 위원회의 「7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건\(비공개\)」\(2026국카0001\)과 관련하여, 신청인 주식회사 사아자는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다\./);
    assert.match(xml, /첨부: 심사보고서에 대한 의견서 20부\(심판총괄담당관실 13부, 국제카르텔조사과 7부\)\. 끝\./);
    assert.match(xml, />주식회사 사아자 대리인</); assert.match(xml, /TOC \\o "1-4"/);
    ok('미리보기 겉표지·목차(쪽번호 포함)·본문, Word 저장(구역 4개, 2번 문단·첨부 줄·대리인 줄)');

    // 2. 피심인 건(스튜디오파하): 공문 수신의 (주) → 주식회사, 사건명의 (주) → ㈜.
    await page.locator('#new-case').click();
    if (await page.locator('#confirm-dialog[open]').count()) await page.locator('#confirm-yes').click();
    await upload('gongmun', '[공문] 심사보고서 송부');
    f = await fields(); s = await state();
    assert.deepEqual([f.caseNo, f.partyRole, f.submitter, f.caseName, f.refDept, f.title, f.sendDate, f.firmRef, f.confidentialNote],
      ['2024집단0003', '피심인', '주식회사 스튜디오파하', '㈜스튜디오파하의 손자회사 행위제한규정 위반행위에 대한 건', '심판총괄담당관, 기업집단관리과장',
        '심사보고서에 대한 의견서 제출', '2025-02-17', '25-*', '']);
    assert.deepEqual(s.attachments, ['심사보고서에 대한 의견서 11부(심판총괄담당관실 8부, 기업집단관리과 3부)']);
    assert.deepEqual(s.items, ['심사보고서 및 피심인 의견 요지', '심사보고서 요지', '스튜디오파하 의견 요지', '[의견 제목]', '결론']);
    await page.locator('#lawyer-search').fill('천라희'); await page.locator('#lawyer-results .lawyer-result').first().click();
    xml = await save('ui-studio');
    assert.match(xml, /귀 위원회의 「㈜스튜디오파하의 손자회사 행위제한규정 위반행위에 대한 건」\(2024집단0003\)과 관련하여, 피심인 주식회사 스튜디오파하는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다\./);
    assert.doesNotMatch(xml, /수사기관 등 제3자에게/);
    ok('피심인 공문: 주식회사 스튜디오파하·㈜ 사건명·참조·첨부 11부, 비공개 문구 없음, Word 저장');

    // 3. 심사보고서를 ①에 올려도 ②로 읽고, 원사건 정보(피심인·사건번호·사건명)를 채움.
    await page.locator('#new-case').click();
    if (await page.locator('#confirm-dialog[open]').count()) await page.locator('#confirm-yes').click();
    await page.locator('#file-gongmun').setInputFiles(file('(심사보고서)7개'));
    await page.waitForSelector('#status-requests.done', {timeout: 60000});
    await page.waitForTimeout(400);
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.submitter, f.partyRole, f.caseNo, f.caseName, f.refDept], ['opinion', '주식회사 사아자', '피심인', '2025제카0002', '7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건', '심판총괄담당관, 국제카르텔조사과장']);
    assert.match(s.summary, /공문이 없어 발신일자는 오늘, 첨부는 ‘1부’로 넣었습니다/);
    await page.locator('#add-report-lawyers').click(); await page.waitForTimeout(200);
    xml = await save('ui-wonsageon');
    assert.match(xml, /귀 위원회의 「7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건」\(2025제카0002\)과 관련하여, 피심인 주식회사 사아자는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다\./);
    // 회신으로 되돌리면 의견서 뼈대는 비우고 회신 칸을 다시 보여 줌.
    await page.locator('[data-type="reply"]').click(); await page.waitForTimeout(200);
    s = await state();
    assert.equal(s.type, 'reply'); assert.deepEqual(s.items, []); assert.equal(s.uploadTitle, '공문과 요청사항 목록 올리기'); assert.ok(!s.replyHidden);
    ok('심사보고서를 ①에 올려도 ②로 읽어 원사건 정보 채움, 회신으로 되돌리면 뼈대 정리');

    const mobile = await browser.newPage({viewport: {width: 390, height: 900}});
    await mobile.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await mobile.locator('#file-gongmun').setInputFiles(file('(공문)심사보고서 송부'));
    await mobile.waitForSelector('#status-gongmun.done', {timeout: 60000});
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, '390px: no horizontal scroll');
    await mobile.screenshot({path: path.join(out, 'ui-mobile.png'), fullPage: false});
    await mobile.close();
    ok('390px 화면: 가로 넘침 없음');
  } finally {await browser.close();}
  assert.deepEqual(requests, [], 'no network requests');
  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\nPASS ${passed} opinion flow checks; no network requests, no page errors`);
})().catch(e => {console.error(e); process.exit(1);});
