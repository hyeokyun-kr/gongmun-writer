/* Changing the uploaded files (회신 ↔ 심사보고서 의견서, or another 공문) must give what a fresh start with the new files gives:
   nothing of the old case may stay behind in the fields, the 첨부 line, the body or the preview.
   Usage: node tests/file-switch.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const dirs = {op: path.join(root, 'tests', 'fixtures', 'opinion'), ex: path.join(root, 'tests', 'fixtures', 'requests')};
const file = (d, prefix) => {
  const names = fs.readdirSync(dirs[d]).filter(n => n.normalize('NFC').startsWith(prefix.normalize('NFC')));
  // The 라마바 요청서 is an HWP 5.0 file; until the .hwp is added, its HWPX version stands in.
  return path.join(dirs[d], names.find(n => /\.hwp$/i.test(n)) || names[0]);
};
const files = {
  감면공문: ['gongmun', file('op', '(공문)심사보고서 송부')], 심사보고서: ['requests', file('op', '(심사보고서)7개')],
  피심인공문: ['gongmun', file('op', '[공문] 심사보고서 송부')],
  RMB공문: ['gongmun', file('ex', '1. 260506 자료제출요청_')], RMB요청: ['requests', file('ex', '1. 260506 자료제출요청서_')],
  사아자공문: ['gongmun', file('ex', '2. 자료제출명령')], 사아자요청: ['requests', file('ex', '2. ★자료')],
  CKT요구서: ['gongmun', file('ex', '3. 소명자료 제출 요구서')], CKT추가: ['requests', file('ex', '3. 수·위탁거래')],
};
// A step is a file key (into its own box), ‘key@box’ (into the other box), ‘key!no’ (answer a question with ‘취소’),
// or {drop: box, files: [...]} (several files dropped at once).
// [처음 올린 파일, 바꿔 올린 파일, (새로 시작할 때 올릴 파일, 기본은 바꿔 올린 파일), (바꿀 때만 뜨는 확인 창)].
const scenarios = {
  '의견서 → 회신': [['감면공문', '심사보고서'], ['RMB공문', 'RMB요청']],
  '의견서 → 회신(공문만)': [['감면공문', '심사보고서'], ['RMB공문']],
  '의견서(공문만) → 회신': [['감면공문'], ['RMB공문', 'RMB요청']],
  '의견서 → 회신(②부터)': [['감면공문', '심사보고서'], ['RMB요청', 'RMB공문']],
  '회신 → 의견서': [['RMB공문', 'RMB요청'], ['감면공문', '심사보고서']],
  '회신 → 의견서(공문만)': [['RMB공문', 'RMB요청'], ['피심인공문']],
  '회신 → 의견서(②부터)': [['RMB공문', 'RMB요청'], ['심사보고서', '감면공문']],
  '회신 → 다른 회신': [['RMB공문', 'RMB요청'], ['사아자공문', '사아자요청']],
  '회신 → 다른 회신(공문만)': [['RMB공문', 'RMB요청'], ['사아자공문']],
  '회신 → 다른 회신(②부터, 함께 쓰기)': [['RMB공문', 'RMB요청'], ['사아자요청', '사아자공문'], null, /새 공문과 함께 쓸까요/],
  '회신 → 다른 회신(②부터, 취소)': [['RMB공문', 'RMB요청'], ['사아자요청', '사아자공문!no'], ['사아자공문'], /새 공문과 함께 쓸까요/],
  '같은 목록을 다시 올린 뒤 다른 회신 공문': [['RMB공문', 'RMB요청', 'RMB요청'], ['사아자공문']],
  '같은 심사보고서를 다시 올린 뒤 다른 의견서 공문': [['감면공문', '심사보고서', '심사보고서'], ['피심인공문']],
  '의견서 → 다른 의견서 공문을 ②칸에': [['감면공문', '심사보고서'], ['피심인공문@requests'], ['피심인공문']],
  '같은 공문을 ②칸에 다시': [['RMB공문', 'RMB요청'], ['RMB공문@requests'], ['RMB공문', 'RMB요청']],
  '의견서(감면) → 다른 의견서': [['감면공문', '심사보고서'], ['피심인공문']],
  '의견서 → 회신 공문을 ②칸에': [['감면공문', '심사보고서'], ['RMB공문@requests']],
  '회신 → 의견서 공문을 ②칸에': [['RMB공문', 'RMB요청'], ['감면공문@requests']],
  '회신 → 다른 회신 두 파일을 ②칸에 한꺼번에': [['RMB공문', 'RMB요청'], [{drop: 'requests', files: ['사아자요청', '사아자공문']}]],
  '의견서 → 회신 두 파일을 ①칸에 한꺼번에': [['감면공문', '심사보고서'], [{drop: 'gongmun', files: ['RMB요청', 'RMB공문']}]],
  '의견서 → CKT 두 파일을 ②칸에 한꺼번에': [['감면공문', '심사보고서'], [{drop: 'requests', files: ['CKT요구서', 'CKT추가']}]],
};
let passed = 0;
const ok = name => {passed++; console.log('PASS', name);};

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-default-browser-check']});
  const requests = [], errors = [];
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
    await context.route(/^https?:/, route => {requests.push(route.request().url()); return route.abort();});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => {if (m.type() === 'error') errors.push('console: ' + m.text());});
    const open = async () => {
      await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
      await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForTimeout(300);
    };
    let dialogs = [], toasts = [], answer = 'yes';
    // Done when no box is reading, the files are shown in the boxes and nothing changes for a moment; answer any question with `answer`.
    const settle = async names => {
      for (let t = 0, quiet = 0; quiet < 3; t++) {
        assert.ok(t < 300, `${names.join(', ')}: reading did not finish`);
        await page.waitForTimeout(150);
        const st = await page.evaluate(() => ({dialog: document.getElementById('confirm-dialog').open, message: document.getElementById('confirm-message').textContent,
          busy: !!document.querySelector('.drop-status.busy'), shown: [...document.querySelectorAll('.drop-status')].map(e => e.textContent).join('|'),
          toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent}));
        if (st.toast && !toasts.includes(st.toast)) toasts.push(st.toast);
        if (st.dialog) {dialogs.push(st.message); await page.locator(answer === 'yes' ? '#confirm-yes' : '#confirm-no').click(); quiet = 0; continue;}
        quiet = !st.busy && names.every(n => st.shown.normalize('NFC').includes(n)) ? quiet + 1 : 0;
      }
    };
    const step = async s => {
      if (typeof s === 'object') {
        const payload = s.files.map(k => ({name: path.basename(files[k][1]).normalize('NFC'), bytes: [...fs.readFileSync(files[k][1])]}));
        const dt = await page.evaluateHandle(list => {const dt = new DataTransfer(); list.forEach(f => dt.items.add(new File([new Uint8Array(f.bytes)], f.name))); return dt;}, payload);
        await page.dispatchEvent('#drop-' + s.drop, 'drop', {dataTransfer: dt});
        return settle(payload.map(f => f.name));
      }
      const [spec, reply] = s.split('!'), [key, box] = spec.split('@'), [own, p] = files[key];
      await page.locator('#file-' + (box || own)).setInputFiles(p);
      const before = answer; if (reply) answer = reply;
      await settle([path.basename(p).normalize('NFC')]);
      answer = before;
    };
    const snapshot = () => page.evaluate(() => ({
      type: document.body.dataset.doctype,
      fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value])),
      attachments: [...document.querySelectorAll('#attachments .ordered-item')].map(r => [...r.querySelectorAll('input')].map(i => i.value).join(' / ')),
      items: [...document.querySelectorAll('#items .request-text')].map(e => e.value),
      refs: [...document.querySelectorAll('#refs .ordered-item')].map(r => [...r.querySelectorAll('input')].map(i => i.value).join(' / ')),
      includeBody: document.getElementById('includeBody').checked, bodyTitle: document.getElementById('bodyTitle').placeholder,
      boxes: [...document.querySelectorAll('.drop-status')].map(e => e.textContent.normalize('NFC')),
      summary: document.getElementById('analysis-summary').innerText,
      preview: [...document.querySelectorAll('#pages .paper')].map(p => p.innerText.replace(/\s+/g, ' ').trim())
    }));
    const same = (now, expected, name) => {
      for (const k of Object.keys(expected)) {
        if (k === 'fields') for (const f of Object.keys(expected.fields)) assert.equal(now.fields[f], expected.fields[f], `${name}: ${f}`);
        else assert.deepEqual(now[k], expected[k], `${name}: ${k}`);
      }
    };
    const fresh = {};
    const freshRun = async steps => {
      const key = JSON.stringify(steps);
      if (!fresh[key]) {await open(); dialogs = []; for (const s of steps) await step(s); fresh[key] = {snap: await snapshot(), dialogs};}
      return fresh[key];
    };

    for (const [name, [first, second, freshSteps, question]] of Object.entries(scenarios)) {
      const expected = await freshRun(freshSteps || second);
      await open();
      for (const s of first) await step(s);
      dialogs = []; toasts = [];
      for (const s of second) await step(s);
      const now = await snapshot();
      same(now, expected.snap, name);
      assert.deepEqual(dialogs.filter(d => !question?.test(d)), expected.dialogs, `${name}: 새로 시작할 때 없던 확인 창이 떴습니다 ${JSON.stringify(dialogs)}`);
      if (question) assert.ok(dialogs.some(d => question.test(d)), `${name}: 확인 창이 떠야 합니다`);
      if (now.type === 'reply') assert.ok(!now.attachments.some(a => a.startsWith('심사보고서에 대한 의견서')) && !now.bodyTitle.startsWith('심사보고서'), `${name}: 의견서 첨부 줄이 남음`);
      ok(`${name}: 새로 시작한 것과 같음 (${now.type}${toasts.some(t => /비웠습니다/.test(t)) ? ' · 앞 사건 파일 비움 안내' : ''})`);
    }
    // Files dropped together are placed by what they are, as if uploaded one by one into their boxes.
    for (const [dropped, oneByOne] of [[{drop: 'requests', files: ['사아자요청', '사아자공문']}, ['사아자공문', '사아자요청']],
      [{drop: 'gongmun', files: ['RMB요청', 'RMB공문']}, ['RMB공문', 'RMB요청']], [{drop: 'requests', files: ['CKT요구서', 'CKT추가']}, ['CKT요구서', 'CKT추가']]]) {
      same((await freshRun([dropped])).snap, (await freshRun(oneByOne)).snap, `한꺼번에 ${dropped.files.join('+')}`);
    }
    ok('두 파일을 한꺼번에 놓아도 하나씩 올린 것과 같음 (사아자·RMB·CKT)');

    // A cleared box says why, after the form is filled, so the lawyer knows what to upload again.
    await open();
    for (const s of ['RMB공문', 'RMB요청']) await step(s);
    toasts = []; await step('감면공문');
    assert.ok(toasts.some(t => /②칸.*앞 사건의 파일이어서 비웠습니다/.test(t)), 'toast for the cleared ② box: ' + JSON.stringify(toasts));
    ok('비운 칸은 이유와 파일 이름을 안내');

    // ‘취소’ keeps what was typed, but the document type and the rest still follow the new files (no mixed case).
    await open();
    for (const s of ['감면공문', '심사보고서']) await step(s);
    await page.locator('#title').fill('직접 쓴 제목');
    answer = 'no'; dialogs = [];
    for (const s of ['RMB공문', 'RMB요청']) await step(s);
    answer = 'yes';
    let s = await snapshot();
    assert.ok(dialogs.length >= 1, 'the typed title is asked about');
    assert.equal(s.type, 'reply'); assert.equal(s.fields.title, '직접 쓴 제목');
    assert.deepEqual([s.fields.caseNo, s.fields.caseName, s.fields.confidentialNote, s.fields.partyRole], ['', '', '', '피심인']);
    assert.ok(!s.attachments.some(a => a.startsWith('심사보고서')), JSON.stringify(s.attachments));
    assert.equal(s.items.length, 6);
    assert.doesNotMatch(s.preview.join('\n'), /국카0001|감면|신청인|의견 요지/);
    ok('확인 창에서 ‘취소’: 입력한 제목만 유지, 유형·본문은 새 파일(회신)대로');

    // The 비공개 문구 that followed a hand-corrected company name is still an automatic value: it goes with the old case.
    await open();
    for (const s of ['감면공문', '심사보고서']) await step(s);
    await page.locator('#submitter').fill('주식회사 사아자(대표이사 홍길동)');
    for (const s of ['RMB공문', 'RMB요청', '피심인공문']) await step(s);
    s = await snapshot();
    assert.equal(s.type, 'opinion'); assert.equal(s.fields.confidentialNote, '');
    assert.doesNotMatch(s.preview.join('\n'), /수사기관 등 제3자에게/);
    ok('고친 회사 이름을 따라 바뀐 비공개 문구도 다음 사건으로 넘어가지 않음');

    // A skeleton edited by hand is asked about before it is dropped for a 회신.
    const rmbOnly = (await freshRun(['RMB공문'])).snap;
    await open();
    for (const s of ['감면공문', '심사보고서']) await step(s);
    assert.equal(await page.locator('#items .request-text').nth(3).inputValue(), '[의견 제목]');
    await page.locator('#items .request-text').nth(3).fill('시장획정의 오류');
    dialogs = [];
    await step('RMB공문');
    assert.ok(dialogs.some(d => d.includes('의견서 본문 뼈대')), JSON.stringify(dialogs));
    same(await snapshot(), rmbOnly, '고친 뼈대 → 회신(문서 값으로 바꾸기)');
    ok('직접 고친 의견서 뼈대는 확인 창에서 묻고, ‘바꾸기’면 새로 시작한 것과 같음');

    // Type buttons back and forth keep what was read from the files.
    await open();
    for (const s of ['감면공문', '심사보고서']) await step(s);
    const opinion = await snapshot();
    await page.locator('[data-type="reply"]').click(); await page.waitForTimeout(250);
    s = await snapshot();
    assert.equal(s.type, 'reply'); assert.equal(s.fields.title, '자료제출 요구에 대한 회신');
    await page.locator('[data-type="opinion"]').click(); await page.waitForTimeout(250);
    s = await snapshot();
    assert.deepEqual([s.fields.title, s.attachments, s.items], [opinion.fields.title, opinion.attachments, opinion.items]);
    await open();
    for (const s of ['RMB공문', 'RMB요청']) await step(s);
    const reply = await snapshot();
    await page.locator('[data-type="opinion"]').click(); await page.waitForTimeout(250);
    await page.locator('[data-type="reply"]').click(); await page.waitForTimeout(250);
    s = await snapshot();
    assert.deepEqual([s.type, s.fields.title, s.attachments, s.items, s.preview], [reply.type, reply.fields.title, reply.attachments, reply.items, reply.preview]);
    ok('유형 버튼 왕복: 의견서 ‘[감면]’ 제목·첨부 20부, 회신 요청사항·첨부가 돌아옴');

    // More than two files at once: nothing is read, and the lawyer is told why.
    await open();
    for (const s of ['RMB공문', 'RMB요청']) await step(s);
    const rmb = await snapshot();
    toasts = [];
    const three = ['사아자공문', '사아자요청', 'CKT요구서'].map(k => ({name: path.basename(files[k][1]).normalize('NFC'), bytes: [...fs.readFileSync(files[k][1])]}));
    await page.dispatchEvent('#drop-gongmun', 'drop', {dataTransfer: await page.evaluateHandle(list => {const dt = new DataTransfer(); list.forEach(f => dt.items.add(new File([new Uint8Array(f.bytes)], f.name))); return dt;}, three)});
    await page.waitForTimeout(400);
    assert.match(await page.locator('#toast').textContent(), /두 파일.*3개를 놓아서 읽지 않았습니다/);
    same(await snapshot(), rmb, '파일 3개');
    ok('파일 3개 이상은 읽지 않고 안내');

    // An example or a saved case starts without the previous files: the type buttons no longer bring back the old 공문's values.
    await open();
    for (const s of ['감면공문', '심사보고서']) await step(s);
    await page.locator('.more-tools summary').click(); await page.locator('#sample-reply').click();
    await page.locator('#confirm-yes').click(); await page.waitForTimeout(300);
    await page.locator('[data-type="opinion"]').click(); await page.waitForTimeout(250);
    s = await snapshot();
    assert.equal(s.fields.title, '심사보고서에 대한 의견서 제출');
    assert.ok(s.boxes.every(b => b === '또는 파일을 이 칸에 끌어다 놓기'), JSON.stringify(s.boxes));
    assert.equal(await page.locator('#analysis-summary').isHidden(), true);
    ok('원본 예시를 열면 올린 파일과 그 분석을 비움');

    // Slow reading (as on a slow PC): a file replaced while reading, and ‘새 공문’ while reading, leave nothing of the earlier file.
    // Reading takes `ms` per file name (‘*’ for the rest).
    const slow = (ms = {'*': 1200}) => page.evaluate(d => {
      const R = window.GongmunReaders, read = R.read;
      R.read = async (name, buf) => {await new Promise(r => setTimeout(r, d[name.normalize('NFC')] ?? d['*'] ?? 0)); return read(name, buf);};
    }, ms);
    const nameOf = key => path.basename(files[key][1]).normalize('NFC');
    await open();
    await step('RMB공문');
    await slow();
    await page.locator('#file-requests').setInputFiles(files.심사보고서[1]); await page.waitForTimeout(150);
    await step('RMB요청');
    await page.waitForTimeout(2500);
    same(await snapshot(), (await freshRun(['RMB공문', 'RMB요청'])).snap, '읽는 중 ②칸 파일 바꾸기');
    await open();
    await step('감면공문');
    await page.locator('#submitter').fill('주식회사 직접입력');
    await slow();
    await page.locator('#file-requests').setInputFiles(files.심사보고서[1]); await page.waitForTimeout(200);
    await page.locator('#new-case').click();
    assert.match(await page.locator('#confirm-title').textContent(), /현재 공문을 바꿀까요/);
    await page.locator('#confirm-yes').click(); await page.waitForTimeout(2500);
    assert.equal(await page.locator('#confirm-dialog').evaluate(d => d.open), false, 'no question from the dropped file');
    s = await snapshot();
    assert.deepEqual([s.type, s.fields.submitter, s.items.length], ['reply', '', 0]);
    ok('읽는 중에 파일을 바꾸거나 ‘새 공문’을 누르면 먼저 읽던 파일은 버림');

    // Uploads that overlap go into the boxes in the order they were dropped; a later drop on a box wins that box.
    // a) a ② file that arrives while the ‘함께 쓸까요?’ question is open is not the one ‘취소’ clears.
    await open();
    for (const k of ['RMB공문', 'RMB요청', '사아자요청']) await step(k);
    await page.locator('#file-gongmun').setInputFiles(files.사아자공문[1]);
    // Poll with evaluate: the page's CSP forbids the eval that waitForFunction needs once it has to poll again.
    for (const end = Date.now() + 20000; !(await page.evaluate(() => document.getElementById('confirm-dialog').open));) {
      assert.ok(Date.now() < end, 'the question did not open'); await page.waitForTimeout(100);
    }
    assert.match(await page.locator('#confirm-message').textContent(), /새 공문과 함께 쓸까요/);
    await page.locator('#file-requests').setInputFiles(files.RMB요청[1]); await page.waitForTimeout(1200);
    await page.locator('#confirm-no').click();
    await settle([nameOf('사아자공문'), nameOf('RMB요청')]);
    same(await snapshot(), (await freshRun(['사아자공문', 'RMB요청'])).snap, '질문 중에 올린 ② 파일');
    // b) a 심사보고서 dropped on ①, then the 공문 on ①: both are used.
    await open(); await slow();
    await page.locator('#file-gongmun').setInputFiles(files.심사보고서[1]); await page.waitForTimeout(600);
    await page.locator('#file-gongmun').setInputFiles(files.감면공문[1]);
    await settle([nameOf('감면공문'), nameOf('심사보고서')]);
    same(await snapshot(), (await freshRun(['감면공문', '심사보고서'])).snap, '①칸에 차례로 심사보고서·공문');
    // c) two files dropped on ①, then another list on ② that finishes first: ② keeps the later list, and ① shows it is still reading.
    await open(); await slow({[nameOf('RMB공문')]: 2500, [nameOf('RMB요청')]: 2500, '*': 200});
    const two = ['RMB요청', 'RMB공문'].map(k => ({name: nameOf(k), bytes: [...fs.readFileSync(files[k][1])]}));
    await page.dispatchEvent('#drop-gongmun', 'drop', {dataTransfer: await page.evaluateHandle(list => {const dt = new DataTransfer(); list.forEach(f => dt.items.add(new File([new Uint8Array(f.bytes)], f.name))); return dt;}, two)});
    await page.waitForTimeout(150);
    await page.locator('#file-requests').setInputFiles(files.사아자요청[1]); await page.waitForTimeout(900);
    assert.match(await page.locator('#status-gongmun').textContent(), /읽는 중/);
    await settle([nameOf('RMB공문'), nameOf('사아자요청')]);
    same(await snapshot(), (await freshRun(['RMB공문', '사아자요청'])).snap, '두 파일을 놓은 뒤 ②에 다른 목록');
    // d) reading finishes out of order: a list dropped on ② first but read last does not replace the later two-file upload's list.
    await open(); await slow({[nameOf('사아자요청')]: 2500, '*': 200});
    await page.locator('#file-requests').setInputFiles(files.사아자요청[1]); await page.waitForTimeout(150);
    await page.dispatchEvent('#drop-gongmun', 'drop', {dataTransfer: await page.evaluateHandle(list => {const dt = new DataTransfer(); list.forEach(f => dt.items.add(new File([new Uint8Array(f.bytes)], f.name))); return dt;}, two)});
    await page.waitForTimeout(3000); await settle([nameOf('RMB공문'), nameOf('RMB요청')]);
    same(await snapshot(), (await freshRun(['RMB공문', 'RMB요청'])).snap, '먼저 놓은 ② 목록이 늦게 읽힘');
    // e) text pasted while a list is being read into ② stays.
    await open(); await step('RMB공문'); await slow({'*': 2000});
    await page.locator('#file-requests').setInputFiles(files.RMB요청[1]); await page.waitForTimeout(150);
    await page.locator('.paste-details summary').click();
    await page.locator('#paste-requests').fill('1. 첫째 요청입니다.\n2. 둘째 요청입니다.');
    await page.locator('#paste-apply').click(); await page.waitForTimeout(2600);
    s = await snapshot();
    assert.deepEqual(s.items, ['첫째 요청입니다.', '둘째 요청입니다.']); assert.match(s.boxes[1], /붙여넣은 내용/);
    ok('겹친 올리기: 놓은 순서대로 넣고, 나중에 놓거나 넣은 칸의 파일이 남음(질문 중·같은 칸·두 파일 뒤·늦게 읽힘·붙여넣기)');

    // Narrow screen: a validation link brings its field into view below the sticky bars, not under them.
    await open();
    await page.setViewportSize({width: 390, height: 844});
    await step('RMB공문');
    await page.locator('#validation button', {hasText: '담당변호사'}).click(); await page.waitForTimeout(900);
    const box = await page.locator('#lawyer-search').boundingBox();
    assert.ok(box.y > 60 && box.y + box.height < 844 - 70, JSON.stringify(box));
    await page.setViewportSize({width: 1440, height: 1000});
    ok('좁은 화면: 확인 목록을 누르면 해당 칸이 고정 줄에 가리지 않게 보임');

    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log(`${passed} file-switch checks passed`);
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exit(1);});
