/* ‘만들 문서’ tabs (v8) with files loaded: each tab keeps its own document; a tab opened afresh is made from the same
   files and takes along only the shared values (who writes to whom about which case, and who signs).
   The cases are the 13 problems an independent tester found on 2026-10-28 in the first v8 build.
   Usage: node tests/tab-switch.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const dirs = {ext: 'extension', ex: 'requests', op: 'opinion'};
const find = (d, prefix) => {
  const dir = path.join(root, 'tests', 'fixtures', dirs[d]);
  const names = fs.readdirSync(dir).filter(n => n.normalize('NFC').startsWith(prefix.normalize('NFC')));
  // The 라마바 요청서 is an HWP 5.0 file; until the .hwp is added, its HWPX version stands in.
  return path.join(dir, names.find(n => /\.hwp$/i.test(n)) || names[0]);
};
const F = {CKT: find('ext', '1. 수·위탁거래'), XYZ: find('ext', '2. 공문_심사보고서'), RMB공문: find('ex', '1. 260506 자료제출요청_'),
  RMB요청: find('ex', '1. 260506 자료제출요청서_'), 사아자공문: find('ex', '2. 자료제출명령'), 사아자요청: find('ex', '2. ★자료'),
  심사보고서: find('op', '(심사보고서)7개'), 피심인공문: find('op', '[공문] 심사보고서 송부')};
const today = (() => {const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;})();
let passed = 0;
const ok = name => {passed++; console.log('PASS', name);};

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-default-browser-check']});
  const requests = [], errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
    await context.route(/^https?:/, route => {requests.push(route.request().url()); return route.abort();});
    let page, dialogs = [];
    const settle = async () => {
      // Answer the program's own questions (‘바꾸기’), and wait until nothing is being read.
      for (let quiet = 0, t = 0; quiet < 3 && t < 300; t++) {
        await page.waitForTimeout(100);
        const st = await page.evaluate(() => ({open: document.getElementById('confirm-dialog').open, message: document.getElementById('confirm-message').textContent, busy: !!document.querySelector('.drop-status.busy')}));
        if (st.open) {dialogs.push(st.message); await page.locator('#confirm-yes').click(); quiet = 0; continue;}
        quiet = st.busy ? 0 : quiet + 1;
      }
      await page.waitForTimeout(250);
    };
    const fresh = async () => {
      if (page) await page.close();
      page = await context.newPage(); dialogs = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => {if (m.type() === 'error') errors.push('console: ' + m.text());});
      await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
      await page.waitForTimeout(400);
    };
    // landed: the box the file ends up in (a file the program moves to the other box).
    const upload = async (slot, file, landed = slot) => {
      await page.locator('#file-' + slot).setInputFiles(file);
      await page.waitForSelector(`#status-${landed}.done, #status-${landed}.error`, {timeout: 60000});
      await settle();
    };
    const tab = async type => {await page.locator(`.mode-tab[data-type="${type}"]`).click(); await settle();};
    const fill = async (id, value) => {await page.locator('#' + id).fill(value); await settle();};
    const fields = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.id || e.dataset.field, e.value])));
    const state = () => page.evaluate(() => ({
      type: document.body.dataset.doctype, basis: document.body.dataset.basis,
      body: [...document.querySelectorAll('#pages .doc-paragraph')].map(p => p.innerText.replace(/\s+/g, ' ').trim()),
      att: [...document.querySelectorAll('#pages .doc-attachments')].map(p => p.innerText.trim()),
      agent: document.querySelector('#pages .doc-agent')?.innerText.trim(),
      pages: [...document.querySelectorAll('#pages .paper')].map(p => p.getAttribute('aria-label')),
      items: [...document.querySelectorAll('#items .request-text')].map(e => e.value),
      attachments: [...document.querySelectorAll('#attachments input:not([type=number])')].map(e => e.value),
      note: document.getElementById('ext-deadline-note').textContent, toast: document.getElementById('toast').textContent,
      validation: document.getElementById('validation').innerText, export: !document.getElementById('export-docx').disabled,
      second: getComputedStyle(document.getElementById('drop-requests')).display !== 'none', secondTitle: document.getElementById('requests-title').textContent
    }));

    // 1. 회신(요청사항 6개) → 연장신청 → 의견서 → 회신: 요청사항·첨부 본문이 그대로.
    await fresh();
    await upload('gongmun', F.RMB공문); await upload('requests', F.RMB요청);
    const reply = await state();
    assert.equal(reply.items.length, 6);
    await tab('extension'); await tab('opinion'); await tab('reply');
    let s = await state();
    assert.deepEqual([s.items, s.att, s.pages], [reply.items, reply.att, reply.pages]);
    ok('회신 → 연장신청 → 의견서 → 회신: 요청사항 6개·첨부 줄·쪽수 그대로');

    // 2. 연장신청에서 다른 사건의 공문(+요청사항)을 올린 뒤 회신: 새 사건으로 새로 만들어 앞 사건의 첨부·요청사항이 없음.
    await page.locator('#items .request-text').nth(0).fill('직접 고친 요청사항 1'); await settle();
    await tab('extension');
    await upload('gongmun', F.사아자공문);
    await tab('reply');
    let f = await fields(); s = await state();
    assert.deepEqual([f.title, s.att, s.items], ['자료제출 명령에 대한 회신', ['첨부: 자료제출 명령에 대한 회신 1부. 끝.'], []]);
    ok('연장신청에서 다른 공문을 올린 뒤 회신: 그 공문으로 새로 만듦(앞 사건 첨부 줄·요청사항 없음)');

    // 3. 의견제출 공문 → (자동 의견서) → 연장신청 → 회신: 회신 제목, 의견서 첨부 없음 (의견서 → 회신과 같음).
    await fresh();
    await upload('gongmun', F.XYZ);
    assert.equal((await state()).type, 'opinion');
    await tab('extension'); await tab('reply');
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, s.att], ['reply', '자료제출 요구에 대한 회신', []]);
    ok('의견제출 공문 → 연장신청 → 회신: 의견서 제목·첨부가 회신에 들어가지 않음');

    // 4. 회신에서 직접 고친 본문은 연장신청으로 넘어가지 않고, 연장 기한 없이는 저장할 수 없음.
    await fresh();
    await upload('gongmun', F.RMB공문);
    await page.locator('#edit-body').click();
    await page.locator('#body-editor').fill((await page.locator('#body-editor').inputValue()).replace('회신하오니', '회신하오니 (수정)'));
    await page.locator('#apply-body').click(); await settle();
    await page.locator('#lawyer-search').fill('sol.kwak'); await page.locator('#lawyer-results .lawyer-result').first().click(); await page.locator('#lawyer-search').fill(''); await settle();
    await tab('extension');
    s = await state();
    assert.ok(!s.body.join('\n').includes('(수정)') && /^4\. 이에 라마바푸드 주식회사는/.test(s.body[3]), s.body.join('\n'));
    assert.equal(s.export, false); assert.match(s.validation, /연장 기한을 정해 주세요/);
    assert.equal(await page.locator('#lawyer-count').textContent(), '1명', '변호사는 따라감');
    await tab('reply');
    assert.match((await state()).body[1], /회신하오니 \(수정\)/, '회신으로 돌아오면 고친 본문 그대로');
    ok('직접 고친 회신 본문은 연장신청에 들어가지 않음(연장 기한 검사 유지), 회신으로 돌아오면 그대로');

    // 5. 추가 설명자료 → 연장신청 → 회신 탭: 추가 설명자료 그대로.
    await fresh();
    await upload('gongmun', F.CKT);
    await page.locator('[data-variant="additional"]').click(); await settle();
    const additional = {f: await fields(), s: await state()};
    await tab('extension'); await tab('reply');
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, f.citationStyle, s.body[1]], ['additional', additional.f.title, additional.f.citationStyle, additional.s.body[1]]);
    ok('추가 설명자료 → 연장신청 → 회신 탭: 추가 설명자료(문장·인용 형식) 그대로');

    // 6. 직접 고른 값이 기본값과 같아도(발신일자 오늘, 인용 형식 대괄호식) 탭 왕복 뒤 그대로.
    await fresh();
    await upload('gongmun', F.RMB공문);
    await fill('sendDate', today);
    await tab('extension'); await tab('reply');
    assert.equal((await fields()).sendDate, today);
    await fresh();
    await upload('gongmun', F.CKT);
    await page.locator('#citationStyle').selectOption('bracket'); await settle();
    await tab('extension'); await tab('reply');
    assert.equal((await fields()).citationStyle, 'bracket');
    ok('직접 고른 발신일자(오늘)·인용 형식(대괄호식)이 탭 왕복 뒤에도 그대로');

    // 7. 연장신청에서 넣은 첨부는 연장신청 것: 회신의 첨부 줄은 그대로.
    await fresh();
    await upload('gongmun', F.RMB공문); await upload('requests', F.RMB요청);
    const replyAttachments = (await state()).attachments;
    await tab('extension');
    await page.locator('#attachment-name').fill('위임장'); await page.locator('#add-attachment').click(); await settle();
    assert.match((await state()).att.join(), /첨부: 위임장 1부\. 끝\./);
    await tab('reply');
    assert.deepEqual((await state()).attachments, replyAttachments);
    await tab('extension');
    assert.deepEqual((await state()).attachments, ['위임장']);
    ok('연장신청의 첨부(위임장)와 회신의 첨부 줄이 서로 섞이지 않음');

    // 8. 연장신청 ①에 공문이 아닌 요청사항 목록: 공문으로 읽지 않고 ②에 두어 보여 주고 알림.
    await fresh();
    await tab('extension');
    assert.equal((await state()).second, false, '빈 ②칸은 숨김');
    await upload('gongmun', F.사아자요청, 'requests');
    f = await fields(); s = await state();
    assert.notEqual(f.agencyName.replace(/\s/g, ''), '◈문의처및제출처');
    assert.match(s.toast, /공문 형식\(수신·제목·시행\)이 아니어서 ②칸에 두었습니다/);
    assert.deepEqual([s.second, s.secondTitle], [true, '② 함께 올린 파일']);
    ok('연장신청 ①에 요청사항 목록: 기관명으로 읽지 않고 ②에 보여 주며 안내');

    // 9. 연장신청에 심사보고서만: ②에 보이고, 의견서용 문장(피심인·사건명)으로 채움.
    await fresh();
    await tab('extension');
    await upload('gongmun', F.심사보고서, 'requests');
    f = await fields(); s = await state();
    assert.deepEqual([s.second, s.basis, f.submitter, f.caseNo], [true, 'opinion', '주식회사 사아자', '2025제카0002']);
    ok('연장신청에 심사보고서만: ②에 보이고 회사·사건번호를 채움');

    // 10. 파일 없이 고른 ‘심사보고서 의견제출 요청’은 탭 왕복 뒤에도 그대로.
    await fresh();
    await tab('extension');
    await page.locator('.basis-button[data-basis="opinion"]').click(); await settle();
    await fill('caseName', '테스트 사건');
    await tab('reply'); await tab('extension');
    f = await fields(); s = await state();
    assert.deepEqual([s.basis, f.title, f.caseName], ['opinion', '심사보고서에 대한 의견서 제출기한 연장신청', '테스트 사건']);
    ok('파일 없이 고른 원 요청 종류(의견제출)가 탭 왕복 뒤에도 그대로');

    // 11. 피심인 → 신청인으로 바꾸면 약칭·서명도 ‘신청인’.
    await fresh();
    await tab('extension');
    await upload('gongmun', F.피심인공문);
    assert.equal((await fields()).shortName, '피심인');
    await page.locator('#partyRole').selectOption('신청인'); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([f.shortName, s.agent], ['신청인', '신청인의 대리인']);
    assert.match(s.body[1], /\(이하 “신청인”\)/);
    ok('제출하는 쪽을 신청인으로 바꾸면 약칭·서명도 신청인');

    // 12. 연장 기한이 지금 기한보다 이르면 음수 날짜 대신 안내.
    await fill('extOrigDeadline', '2026-11-10'); await fill('extDeadline', '2026-11-05');
    s = await state();
    assert.equal(s.note, '2026. 11. 5.(목) · 지금 기한보다 늦어야 합니다'); assert.equal(s.export, false);
    ok('연장 기한이 이르면 ‘늦어야 합니다’ 안내와 저장 막음');

    // 13. 공통 값을 고치고 탭을 오가면 다른 탭에도: 제출 주체를 연장신청에서 고친 뒤 회신으로.
    await fresh();
    await upload('gongmun', F.RMB공문);
    await tab('extension');
    await fill('submitter', 'RMB푸드 주식회사');
    await tab('reply');
    assert.equal((await fields()).submitter, 'RMB푸드 주식회사');
    await tab('extension');
    assert.equal((await fields()).submitter, 'RMB푸드 주식회사');
    ok('공통 값(제출 주체)을 한 탭에서 고치면 다른 탭에도 반영');

    // 14. (2차) 공통 값을 고치면 몇 탭을 건너도 모든 탭에: 의견서에서 고친 제출 주체가 연장신청을 거쳐 회신까지.
    await fresh();
    await upload('gongmun', F.RMB공문); await upload('requests', F.RMB요청);
    await tab('extension'); await tab('opinion');
    await fill('submitter', '라마바푸드(주) 수정');
    await tab('extension'); assert.equal((await fields()).submitter, '라마바푸드(주) 수정');
    await tab('reply'); assert.equal((await fields()).submitter, '라마바푸드(주) 수정');
    assert.equal((await state()).items.length, 6);
    ok('공통 값은 여러 탭을 건너도 모든 탭에 반영(회신 요청사항은 그대로)');

    // 15. (2차) 공통 값을 따라 바뀌는 값: 요청 명칭 → 연장신청·회신 제목·첨부 줄, 제출 주체 → 의견서 본문 뼈대·비공개 문구.
    await fill('requestName', '자료제출 요청');
    f = await fields(); s = await state();
    assert.deepEqual([f.title, s.att], ['자료제출 요청에 대한 회신', ['첨부: 자료제출 요청에 대한 회신 1부. 끝.']]);
    await tab('extension');
    assert.equal((await fields()).title, '자료제출 요청 관련 자료제출 기한 연장신청');
    await fresh();
    await upload('gongmun', find('op', '(공문)심사보고서 송부')); await upload('requests', F.심사보고서);
    await tab('extension');
    await fill('submitter', '주식회사 나다라식품');
    await tab('opinion');
    s = await state();
    assert.equal(s.items[2], '나다라식품 의견 요지');
    assert.match(await page.locator('#confidentialNote').inputValue(), /^나다라식품 의견서가/);
    await fill('submitter', '주식회사 나다라식품2');
    assert.equal((await state()).items[2], '나다라식품2 의견 요지', '그 뒤 이 탭에서 고쳐도 계속 따라감');
    ok('공통 값을 따라 다른 탭의 제목·첨부 줄·의견서 뼈대·비공개 문구도 바뀜');

    // 16. (2차) ②칸을 바꾸거나 같은 공문을 다시 올려도 다른 탭에 써 둔 것은 그대로.
    await fresh();
    await upload('gongmun', F.RMB공문);
    await tab('extension');
    await page.locator('.week-button[data-weeks="2"]').click(); await fill('extScope', '요청자료 4번'); await fill('extReason', '내가 쓴 사유');
    await page.locator('#attachment-name').fill('위임장'); await page.locator('#add-attachment').click(); await settle();
    const extBefore = {f: await fields(), s: await state()};
    await tab('reply');
    await upload('requests', F.RMB요청);
    await upload('gongmun', F.RMB공문);  // the same 공문 again
    assert.equal((await state()).items.length, 6);
    await tab('extension');
    f = await fields(); s = await state();
    assert.deepEqual([f.extDeadline, f.extScope, s.attachments, f.sendDate], [extBefore.f.extDeadline, '요청자료 4번', ['위임장'], extBefore.f.sendDate]);
    assert.equal(await page.locator('#extReason').inputValue(), '내가 쓴 사유');
    ok('②칸에 요청사항을 올리거나 같은 공문을 다시 올려도 연장신청에 써 둔 기한·범위·사유·첨부는 그대로');

    // 17. (2차) 연장신청 탭에서 다른 사건의 공문: 앞 공문의 연장 기한·사유를 바꿀지 묻고, 바꾸면 비움(사유 칸에 커서가 있어도).
    await fresh();
    await tab('extension');
    await upload('gongmun', F.CKT);
    await page.locator('.week-button[data-weeks="2"]').click(); await fill('extReason', '앞 사건 사유');
    await page.locator('#extReason').focus();
    dialogs = [];
    await upload('gongmun', F.RMB공문);
    assert.ok(dialogs.some(d => /연장 기한·사유·범위/.test(d)), JSON.stringify(dialogs));
    f = await fields(); s = await state();
    assert.deepEqual([f.extOrigDeadline, f.extDeadline, s.note], ['2026-05-22', '', '연장 기간을 누르면 채워집니다. 다른 날짜는 직접 고르세요.']);
    assert.match(await page.locator('#extReason').inputValue(), /^현재 라마바푸드 주식회사는 최선을/);
    ok('연장신청 탭에서 다른 공문을 올리면 앞 공문의 연장 기한·사유를 바꿀지 묻고 비움');

    // 18. (2차) 관리번호 ‘26-*’의 연도는 그 탭의 발신일자를 따름.
    await fresh();
    await tab('extension');
    await upload('gongmun', F.CKT);
    await fill('sendDate', '2027-01-04');
    assert.equal((await fields()).firmRef, '27-*');
    await tab('reply');
    f = await fields();
    assert.deepEqual([f.sendDate, f.firmRef], ['2026-10-27', '26-*']);
    ok('관리번호 연도는 탭마다 그 발신일자를 따름');

    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    ok('네트워크 요청 0건, 페이지 오류 0건');
    console.log(`${passed} tab switch checks passed`);
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
