/* 제출기한 연장신청 (v8) in a real browser: choose it at the top, upload the request 공문 of each example
   (tests/fixtures/extension: 차카타전자 중기청 자료제출, 라마바푸드 공정위 자료제출, XYZ 심사보고서 의견서),
   compare the cover with the sample, switch types with the files loaded, save/load the case and the DOCX.
   Usage: node tests/extension-flow.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const samples = path.join(root, 'tests', 'fixtures', 'extension');
const examples = path.join(root, 'tests', 'fixtures', 'requests');
const opinionSamples = path.join(root, 'tests', 'fixtures', 'opinion');
const out = path.join(root, 'build', 'verification', 'extension');
fs.mkdirSync(out, {recursive: true});
const find = (dir, prefix) => {
  const names = fs.readdirSync(dir).filter(n => n.normalize('NFC').startsWith(prefix.normalize('NFC')));
  // The 라마바 요청서 is an HWP 5.0 file; until the .hwp is added, its HWPX version stands in.
  return path.join(dir, names.find(n => /\.hwp$/i.test(n)) || names[0]);
};
const docText = buf => {
  for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
    const size = buf.readUInt32LE(at + 18), nameLength = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLength), start = at + 30 + nameLength + extra;
    if (name === 'word/document.xml') return buf.toString('utf8', start, start + size);
    at = start + size;
  }
  throw new Error('word/document.xml not found');
};
const plain = xml => xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/ /g, ' ');
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
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push('console: ' + m.text());});
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await page.waitForTimeout(400);
    const settle = () => page.waitForTimeout(350);
    const fields = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.id || e.dataset.field, e.value])));
    const visible = id => page.evaluate(id => {const e = document.getElementById(id); return !!e && e.getClientRects().length > 0;}, id);
    const state = () => page.evaluate(() => ({
      type: document.body.dataset.doctype, basis: document.body.dataset.basis,
      tabs: [...document.querySelectorAll('.mode-tab')].filter(b => b.classList.contains('active')).map(b => b.dataset.type),
      summary: document.getElementById('analysis-summary').innerText,
      body: [...document.querySelectorAll('#pages .doc-paragraph')].map(p => p.innerText.replace(/\s+/g, ' ').trim()),
      agent: document.querySelector('#pages .doc-agent')?.innerText.trim(),
      title: [...document.querySelectorAll('#pages .doc-meta td')].map(t => t.innerText.trim()),
      pages: [...document.querySelectorAll('#pages .paper')].map(p => p.getAttribute('aria-label')),
      items: [...document.querySelectorAll('#items .request-text')].map(e => e.value),
      attachments: [...document.querySelectorAll('#attachments input:not([type=number])')].map(e => e.value),
      reason: document.getElementById('extReason').value, note: document.getElementById('ext-deadline-note').textContent,
      weeks: [...document.querySelectorAll('.week-button.active')].map(b => b.dataset.weeks),
      validation: document.getElementById('validation').innerText, export: !document.getElementById('export-docx').disabled,
      step: document.getElementById('lawyer-step').textContent
    }));
    const upload = async (slot, file) => {
      await page.locator('#file-' + slot).setInputFiles(file);
      await page.waitForSelector(`#status-${slot}.done, #status-${slot}.error`, {timeout: 60000});
      await page.waitForTimeout(500);
    };
    const newCase = async () => {
      await page.locator('#new-case').click(); await page.waitForTimeout(150);
      if (await page.locator('#confirm-dialog').evaluate(d => d.open)) await page.locator('#confirm-yes').click();
      await settle();
    };
    const addLawyers = async names => {
      for (const n of names) {await page.locator('#lawyer-search').fill(n); await page.waitForTimeout(80); await page.locator('#lawyer-results .lawyer-result').first().click();}
      await page.locator('#lawyer-search').fill(''); await settle();
    };
    const save = async name => {
      await settle();
      const s = await state();
      assert.ok(s.export, `${name}: export should be enabled · ${s.validation}`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
      const target = path.join(out, name + '.docx'); await download.saveAs(target);
      // Where the preview puts each lawyer, to compare with Word's pages (scripts: Word PDF of the same DOCX).
      fs.writeFileSync(path.join(out, name + '.preview.json'), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#pages .paper')]
        .map(p => [...p.querySelectorAll('.doc-lawyer-name')].map(e => e.textContent.replace(/\s+/g, '').replace('담당변호사', ''))))));
      console.log('saved', path.relative(project, target), download.suggestedFilename());
      return plain(docText(fs.readFileSync(target)));
    };

    // 1. 만들 문서: 맨 위 탭 세 개. 기본은 회신, 연장신청을 누르면 ①만 남고 요청사항·첨부서류 칸이 사라진다.
    let s = await state();
    assert.deepEqual([s.type, s.tabs], ['reply', ['reply']]);
    assert.ok(await visible('drop-requests') && await visible('items-card'));
    await page.locator('.mode-tab[data-type="extension"]').click(); await settle();
    s = await state();
    assert.deepEqual([s.type, s.tabs, s.step], ['extension', ['extension'], '5']);
    assert.equal(await page.locator('#intro-title').textContent(), '받은 공문으로 제출기한 연장신청을 만드세요');
    assert.equal(await page.locator('#upload-title').textContent(), '받은 공문 올리기');
    for (const id of ['drop-requests', 'items-card', 'partial-field']) assert.equal(await visible(id), false, id + ' hidden');
    for (const id of ['extOrigDeadline', 'extDeadline', 'extReason']) assert.ok(await visible(id), id + ' shown');
    assert.equal((await fields()).title, '자료제출 기한 연장신청');
    assert.deepEqual(s.pages, ['공문 표지 1페이지'], '공문만 (본문 없음)');
    ok('맨 위 탭으로 연장신청 선택: ②·요청사항·첨부서류 칸 숨김, 연장 칸 표시, 공문 1쪽');

    // Without a deadline, the week buttons ask for it first.
    await page.locator('.week-button[data-weeks="1"]').click(); await page.waitForTimeout(100);
    assert.match(await page.locator('#toast').innerText(), /원 제출기한을 먼저/);

    // 2. 차카타전자 (경기지방중소벤처기업청, 낫표식): 샘플과 3·4번 문단은 글자 그대로, 2번 문단은 인용 부호만 다름(‘’ → 「」, 회신 정답지와 같은 표기).
    await upload('gongmun', find(samples, '1. 수·위탁거래'));
    let f = await fields(); s = await state();
    assert.deepEqual([f.agencyName, f.honorific, f.submitter, f.requestDate, f.requestDocNo, f.extOrigDeadline, f.sendDate, f.refDept, f.citationStyle, s.basis],
      ['경기지방중소벤처기업청', '청', '차카타전자 주식회사', '2026-10-20', '소상공인과-0201', '2026-10-27', today, '소상공인과장', 'guillemet', 'data']);
    assert.equal(f.title, '소명자료 추가제출 요구 관련 자료제출 기한 연장신청');
    assert.match(s.summary, /연장할 원 요청\s*자료제출 요구/); assert.match(s.summary, /원 제출기한\s*2026\. 10\. 27\.\(화\)/);
    assert.match(s.validation, /연장 기한을 정해 주세요/); assert.equal(s.export, false);
    await page.locator('#extDeadline').fill('2026-11-06'); await page.locator('#sendDate').fill('2026-10-26');
    await addLawyers(['sol.kwak', 'jaegyeol.wi', 'chaeyu.ahn']);
    s = await state();
    assert.equal(s.note, '2026. 11. 6.(금) · 지금 기한보다 10일 뒤');
    assert.deepEqual(s.body, [
      '1. 귀 청의 무궁한 발전을 기원합니다.',
      '2. 귀 청의 2026. 10. 20.자 「수·위탁거래 분쟁조정 요청 사건 소명자료 추가제출 요구」(문서번호: 소상공인과-0201)와 관련하여, 귀 청은 차카타전자 주식회사에게 2026. 10. 27.(화)까지 자료제출을 요청하였습니다.',
      '3. 현재 차카타전자 주식회사는 최선을 다하여 신속하게 제출 자료를 준비 중에 있으나, 구체적인 사실관계를 확인하고 관련 자료를 정리하는 데 추가적인 시간이 필요한 상황입니다.',
      '4. 이에 차카타전자 주식회사는 자료제출 기한을 2026. 11. 6.(금)까지로 연장하여 주실 것을 신청하오니 이를 허여하여 주시기 바랍니다. 끝.']);
    assert.equal(s.agent, '차카타전자 주식회사의 대리인');
    let word = await save('ckt-extension');
    for (const line of s.body.slice(1).map(b => b.replace(/^\d+\. /, ''))) assert.ok(word.includes(line), 'DOCX: ' + line.slice(0, 30));
    assert.match(word, /소명자료 추가제출 요구 관련 자료제출 기한 연장신청/); assert.match(word, /차카타전자 주식회사의 대리인/);
    assert.doesNotMatch(word, /<첨부>|첨부:/);
    // As in all three samples: an empty line between the numbered paragraphs 2·3·4 (Word and preview).
    assert.match(word, /요청하였습니다\.\n\n현재 차카타전자/); assert.match(word, /상황입니다\.\n\n이에 차카타전자/);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('#pages .doc-paragraph')].filter(p => p.previousElementSibling?.classList.contains('doc-spacer')).length), 2, '3·4번 앞 (2번 앞 빈 줄은 1번 문단 상자 안)');
    ok('차카타전자: 기관·호칭·제출 주체·요구일자·문서번호·원 제출기한·참조·제목 자동, 3·4번 문단 샘플과 같음, 10일 연장 표시, DOCX 표지만');
    // The saved 연장신청 opens in ‘기존 Word 변호사 추가·편집’ with its three lawyers.
    await page.locator('#existing-word-open').click();
    await page.locator('#existing-word-file').setInputFiles(path.join(out, 'ckt-extension.docx'));
    // Poll with evaluate: the page's CSP forbids the eval that waitForFunction needs once it has to poll again.
    for (const end = Date.now() + 20000; !(await page.evaluate(() => document.getElementById('existing-word-count').textContent.includes('3명')));) {
      assert.ok(Date.now() < end, 'existing Word import did not finish'); await page.waitForTimeout(100);
    }
    assert.equal(await page.locator('#existing-word-status').evaluate(e => e.classList.contains('error')), false);
    await page.locator('#existing-word-dialog [data-close="existing-word-dialog"]').first().click(); await settle();
    ok('저장한 연장신청을 ‘기존 Word 변호사 추가·편집’으로 열면 변호사 3명을 읽음');

    // 3. 사건 저장 → 새 공문(연장신청 유지) → 불러오기.
    const [caseDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#save-case').click()]);
    const caseFile = path.join(out, 'ckt-extension.json'); await caseDownload.saveAs(caseFile);
    const saved = JSON.parse(fs.readFileSync(caseFile, 'utf8')).data;
    assert.deepEqual([saved.docType, saved.extBasis, saved.extOrigDeadline, saved.extDeadline, saved.extPrev, saved.extReason], ['extension', 'data', '2026-10-27', '2026-11-06', false, null]);
    await newCase();
    s = await state(); f = await fields();
    assert.deepEqual([s.type, f.submitter, f.title, f.extDeadline], ['extension', '', '자료제출 기한 연장신청', '']);
    await page.locator('#case-file-input').setInputFiles(caseFile); await settle();
    s = await state();
    assert.equal(s.body[3], '4. 이에 차카타전자 주식회사는 자료제출 기한을 2026. 11. 6.(금)까지로 연장하여 주실 것을 신청하오니 이를 허여하여 주시기 바랍니다. 끝.');
    ok('사건 저장·불러오기(연장 필드 포함), ‘새 공문’은 연장신청을 유지');

    // 4. 라마바푸드 (공정위, 대괄호식): 1주 버튼 = 샘플의 9. 15.(화), 약칭·일부 항목 → 샘플 4번 문단의 요소.
    await newCase();
    await upload('gongmun', find(samples, '3. 260831'));
    f = await fields();
    assert.deepEqual([f.agencyName, f.submitter, f.requestName, f.requestDocNo, f.extOrigDeadline, f.citationStyle, f.refDept],
      ['공정거래위원회', '라마바푸드 주식회사', '소명자료 제출요구', '(사건처리)제조업감시과-0203', '2026-09-08', 'bracket', '시장감시국 제조업감시과장']);
    await page.locator('.week-button[data-weeks="1"]').click(); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([f.extDeadline, s.weeks, s.note], ['2026-09-15', ['1'], '2026. 9. 15.(화) · 지금 기한보다 7일 뒤']);
    await page.locator('.week-button[data-weeks="2"]').click(); await settle();
    assert.equal((await fields()).extDeadline, '2026-09-22');
    await page.locator('.week-button[data-weeks="1"]').click();
    await page.locator('#shortName').fill('라마바'); await page.locator('#extScope').fill('요청자료 중 3번과 6번을 제외한 항목');
    await page.locator('#sendDate').fill('2026-09-08');
    await addLawyers(['rada.han', 'jaegyeol.wi', 'chaeyu.ahn']);
    s = await state();
    assert.deepEqual(s.body.slice(1), [
      '2. 귀 위원회의 2026. 8. 31.자 소명자료 제출요구[문서번호: (사건처리)제조업감시과-0203]와 관련하여, 귀 위원회는 라마바푸드 주식회사(이하 “라마바”)에게 2026. 9. 8.(화)까지 자료제출을 요청하였습니다.',
      '3. 현재 라마바는 최선을 다하여 신속하게 제출 자료를 준비 중에 있으나, 구체적인 사실관계를 확인하고 관련 자료를 정리하는 데 추가적인 시간이 필요한 상황입니다.',
      '4. 이에 라마바는 요청자료 중 3번과 6번을 제외한 항목의 자료제출 기한을 2026. 9. 15.(화)까지로 연장하여 주실 것을 신청하오니 이를 허여하여 주시기 바랍니다. 끝.']);
    assert.equal(s.agent, '라마바의 대리인', '라마바 샘플: 약칭의 대리인');
    // A deadline typed by hand drops the week choice; a week choice follows the deadline it counts from.
    await page.locator('#extDeadline').fill('2026-09-19'); await settle();
    s = await state();
    assert.deepEqual(s.weeks, []); assert.match(s.note, /주말입니다/); assert.match(s.validation, /토요일입니다/);
    await page.locator('.week-button[data-weeks="1"]').click(); await page.locator('#extOrigDeadline').fill('2026-09-09'); await settle();
    assert.equal((await fields()).extDeadline, '2026-09-16');
    await page.locator('#extOrigDeadline').fill('2026-09-08'); await settle();
    // The reason, once edited, stays; ‘기본 사유 문장으로’ brings the default back.
    await page.locator('#extReason').fill('첫째 사유입니다.\n둘째 사유입니다.'); await settle();
    s = await state();
    assert.deepEqual(s.body.slice(2, 4), ['3. 첫째 사유입니다.', '4. 둘째 사유입니다.']);
    assert.match(s.body[4], /^5\. 이에 라마바는/);
    await page.locator('#shortName').fill('알엠비'); await settle();
    assert.equal((await state()).body[2], '3. 첫째 사유입니다.', '고친 사유는 약칭이 바뀌어도 유지');
    await page.locator('#reset-reason').click(); await settle();
    assert.match((await state()).body[2], /^3\. 현재 알엠비는 최선을 다하여/);
    await page.locator('#shortName').fill('라마바'); await settle();
    // An extension date not after the deadline is an error.
    await page.locator('#extDeadline').fill('2026-09-08'); await settle();
    s = await state(); assert.equal(s.export, false); assert.match(s.validation, /지금 제출기한\(2026\. 9\. 8\.\(화\)\)보다 뒤여야/);
    await page.locator('.week-button[data-weeks="1"]').click();
    word = await save('rmb-extension');
    assert.match(word, /요청자료 중 3번과 6번을 제외한 항목의 자료제출 기한을 2026\. 9\. 15\.\(화\)까지로/);
    ok('라마바: 대괄호식 인용·참조 자동, 1주=9. 15.(화)·2주, 직접 고른 날짜·주말 경고·기한 이전 오류, 원 기한 변경 따라감, 약칭·일부 항목·사유 여러 문단·기본 문장 복귀');

    // 5. XYZ (심사보고서 의견제출 요청, 피심인 2곳): 연장신청 탭에서는 의견서로 바뀌지 않고 의견서용 문장. 두 번째 연장 표시.
    await newCase();
    await upload('gongmun', find(samples, '2. 공문_심사보고서'));
    f = await fields(); s = await state();
    assert.deepEqual([s.type, s.basis, f.submitter, f.shortName, f.caseNo, f.refDept, f.extOrigDeadline, f.requestDocNo, f.title],
      ['extension', 'opinion', '엑스와이지전자코리아(유) 및 엑스와이지인터내셔널홀딩스(유)', '피심인들', '2024서소0004', '심판총괄담당관실', '2026-04-30', '(사건처리)소비자과-0202', '심사보고서에 대한 의견서 제출기한 연장신청']);
    assert.equal(f.caseName, '엑스와이지전자코리아(유) 및 엑스와이지인터내셔널홀딩스(유)의 부당한 표시광고행위에 대한 건');
    assert.ok(await visible('caseName') && await visible('opinionDocNo') && !await visible('requestDate') && !await visible('confidentialNote'));
    assert.match(s.summary, /해당 분야의 심판담당관실\(예: 소비자거래심판담당관실\)을 함께/); assert.match(s.summary, /피심인이 2곳이어서 ‘피심인들’/);
    await page.locator('#extPrev').check(); await settle();
    assert.ok(await visible('extPrevDeadline'));
    await page.locator('#extPrevDocNo').fill('심판총괄담당관-0204'); await page.locator('#extPrevDeadline').fill('2026-06-11');
    await page.locator('#extDeadline').fill('2026-09-10'); await page.locator('#sendDate').fill('2026-06-08');
    await page.locator('#refDept').fill('심판총괄담당관실, 소비자거래심판담당관실');
    await addLawyers(['rada.han', 'chaeyu.ahn', 'yusu.jin']);
    s = await state();
    assert.deepEqual(s.body.slice(1), [
      '2. 「엑스와이지전자코리아(유) 및 엑스와이지인터내셔널홀딩스(유)의 부당한 표시광고행위에 대한 건」(사건번호: 2024서소0004)과 관련하여, 귀 위원회는 엑스와이지전자코리아(유) 및 엑스와이지인터내셔널홀딩스(유)(이하 “피심인들”)에게 심사보고서를 송부하면서 2026. 4. 30.(목)까지 심사보고서에 대한 의견서를 제출할 것을 요구하였고[문서번호: (사건처리)소비자과-0202], 의견서 제출기한 연장신청에 대한 회신(문서번호: 심판총괄담당관-0204)을 통해 2026. 6. 11.(목)까지 제출기한을 한 차례 연장해 주신 바 있습니다.',
      '3. 현재 피심인들은 최선을 다하여 신속하게 의견서를 준비 중에 있으나, 구체적인 사실관계를 확인하고 관련 자료를 정리하는 데 추가적인 시간이 필요한 상황입니다.',
      '4. 이에 피심인들은 심사보고서에 대한 의견서 제출기한을 2026. 9. 10.(목)까지 연장하여 주실 것을 간곡히 요청드리오니, 이를 허여하여 주시기 바랍니다. 끝.']);
    assert.equal(s.agent, '피심인들의 대리인');
    assert.match((await state()).note, /지금 기한보다 91일 뒤/, '연장받은 기한(6. 11.)에서 셈');
    word = await save('xyz-extension');
    assert.match(word, /심사보고서에 대한 의견서 제출기한 연장신청/); assert.match(word, /피심인들의 대리인/);
    ok('XYZ: 연장신청 유지·의견서용 문장, 피심인 2곳 ‘A 및 B’·‘피심인들’, 사건번호·사건명·참조(심판총괄담당관실), 두 번째 연장(문서번호·연장받은 기한에서 셈)');

    // 6. 같은 파일로 탭 바꾸기: 처음 여는 의견서 탭은 같은 공문으로 새로 만들고(발신일자·참조는 의견서 것), 공통 값(제출 주체·변호사)은 따라간다.
    //    연장신청 탭으로 돌아오면 두고 간 그대로(직접 넣은 참조·발신일자·연장 값).
    await page.locator('.mode-tab[data-type="opinion"]').click(); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, f.shortName, f.sendDate, f.refDept], ['opinion', '심사보고서에 대한 의견서 제출', '', '2026-04-30', '심판관리관실, 서울지방공정거래사무소 소비자과장']);
    assert.equal(await page.locator('#lawyer-count').textContent(), '3명');
    assert.deepEqual(s.attachments, ['심사보고서에 대한 의견서 심판관리관실 9부, 소비자과 3부']);
    assert.ok(s.pages.length >= 4, '의견서 양식 포함');
    assert.equal(f.submitter, '엑스와이지전자코리아(유) 및 엑스와이지인터내셔널홀딩스(유)');
    await page.locator('.mode-tab[data-type="extension"]').click(); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, f.shortName, f.extDeadline, f.extPrevDeadline, s.attachments, f.sendDate, f.refDept],
      ['extension', '심사보고서에 대한 의견서 제출기한 연장신청', '피심인들', '2026-09-10', '2026-06-11', [], '2026-06-08', '심판총괄담당관실, 소비자거래심판담당관실']);
    assert.ok(s.pages.every(p => p.startsWith('공문 표지')), '공문 표지만 (XYZ은 문단이 길어 2쪽): ' + s.pages.join(', '));
    ok('연장신청 → 의견서(같은 공문으로 새로, 변호사 따라감) → 연장신청(두고 간 그대로: 참조·발신일자·연장 값)');

    // 7. 회신에서 공문+요청사항 목록을 올린 뒤 연장신청으로 바꿨다가 돌아오기: 요청사항·첨부·제목·발신일자(제출기한)가 돌아온다.
    await newCase();
    await page.locator('.mode-tab[data-type="reply"]').click(); await settle();
    await upload('gongmun', find(examples, '1. 260506 자료제출요청_라마바'));
    await upload('requests', find(examples, '1. 260506 자료제출요청서'));
    const before = {f: await fields(), s: await state()};
    assert.equal(before.s.items.length, 6);
    await page.locator('.mode-tab[data-type="extension"]').click(); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, f.sendDate, f.extOrigDeadline, s.attachments],
      ['extension', `${before.f.requestName} 관련 자료제출 기한 연장신청`, today, before.f.sendDate, []]);
    assert.ok(s.pages.every(p => p.startsWith('공문 표지')), s.pages.join(', '));
    assert.equal(await visible('items-card'), false);
    await page.locator('.mode-tab[data-type="reply"]').click(); await settle();
    f = await fields(); s = await state();
    assert.deepEqual([s.type, f.title, f.sendDate, s.items, s.attachments], ['reply', before.f.title, before.f.sendDate, before.s.items, before.s.attachments]);
    ok('회신(공문+요청사항 6개) → 연장신청 → 회신: 연장신청 값으로 바뀌었다가 요청사항·첨부·제목·발신일자 복원');

    // 8. 회신 탭에서는 지금처럼 의견제출 공문이면 의견서로 바뀐다 (자동 전환은 회신 ↔ 의견서만).
    await newCase();
    await page.locator('.mode-tab[data-type="reply"]').click(); await settle();
    await upload('gongmun', find(opinionSamples, '(공문)심사보고서 송부'));
    s = await state(); assert.deepEqual([s.type, s.tabs], ['opinion', ['opinion']]);
    ok('회신 탭에서 의견제출 공문을 올리면 의견서 탭으로 자동 전환(기존 동작)');

    // 9. 휴대폰 폭: 탭 세 개가 한 줄, 가로 스크롤 없음.
    await page.locator('.mode-tab[data-type="extension"]').click(); await settle();
    await page.setViewportSize({width: 390, height: 844}); await settle();
    const layout = await page.evaluate(() => ({overflow: document.documentElement.scrollWidth - innerWidth,
      tabs: [...document.querySelectorAll('.mode-tab')].map(b => {const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.right)];})}));
    assert.ok(layout.overflow <= 0, 'no horizontal scroll: ' + layout.overflow);
    assert.equal(new Set(layout.tabs.map(t => t[0])).size, 1, 'tabs on one row'); assert.ok(layout.tabs.every(t => t[1] <= 390));
    await page.setViewportSize({width: 1440, height: 1000});
    ok('휴대폰 폭(390px): 탭 한 줄, 가로 스크롤 없음');

    assert.deepEqual(requests, [], 'no network requests'); assert.deepEqual(errors, [], 'no page errors');
    ok('네트워크 요청 0건, 페이지 오류 0건');
    console.log(`${passed} extension flow checks passed`);
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
