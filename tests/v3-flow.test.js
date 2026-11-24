/* v3 end-to-end check in a real browser: upload each example 공문 + 요청사항 목록 pair (tests/fixtures/requests),
   compare the auto-filled cover and request items with the example final replies, save the DOCX.
   Usage: node tests/v3-flow.test.js <playwright module path> */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), project = path.join(root, '..');
const examples = path.join(root, 'tests', 'fixtures', 'requests');
const out = path.join(root, 'build', 'verification', 'v3');
fs.mkdirSync(out, {recursive: true});
const file = prefix => {
  const names = fs.readdirSync(examples).filter(n => n.normalize('NFC').startsWith(prefix.normalize('NFC')));
  // The 라마바 요청서 is an HWP 5.0 file; until the .hwp is added, its HWPX version stands in.
  return path.join(examples, names.find(n => /\.hwp$/i.test(n)) || names[0]);
};

const cases = [
  {key: 'rmb', gongmun: '1. 260506 자료제출요청_라마바', requests: '1. 260506 자료제출요청서_라마바', expect: {
    agencyName: '공정거래위원회', honorific: '위원회', refDept: '시장감시국 제조업감시과장', submitter: '라마바푸드 주식회사',
    requestDocNo: '(사건처리)제조업감시과-0101', requestDate: '2026-05-06', citationStyle: 'bracket', sendDate: '2026-05-22', firmRef: '26-*'},
    items: 6, labels: true, headings: ['[요청사항 1] 귀사는 권역별 외식 가맹점', '[요청사항 2] 물류혁신본부(콜드체인운영팀)', '[요청사항 2-1] 귀사의 ‘마진 플래너(Margin Planner)’ 관련, ‘마진 플래너 산정표',
      '[요청사항 2-2] 귀사의 ‘마진 플래너(Margin Planner)’ 관련, 외식유통사업부', '[요청사항 3] 최근 3년간 귀사가', '[요청사항 4] 귀사가 ’26.3.12. 제출한']},
  {key: 'saaja', gongmun: '2. 자료제출명령', requests: '2. ★자료', expect: {
    agencyName: '공정거래위원회', refDept: '카르텔조사국 국제카르텔조사과장', submitter: '사아자',
    requestDocNo: '(사건처리)국제카르텔조사과-0102', requestDate: '2026-08-31', sendDate: '2026-09-09', firmRef: '26-*'},
    items: 9, labels: false, headings: ['예시분말 부산물 판매 실적', '연도별 판매량 및 판매액', '거래처 유형별 판매액', '월별 평균 판매단가', '분기별 재고 및 출하량',
      '회사 개요 및 조직 변동', '예시분말 생산 설비 및 가동률', '부산물 가격 결정 절차', '제품 등급 기준 확인']},
  {key: 'ckt', gongmun: '3. 수·위탁거래', requests: '3. 소명자료 제출 요구서', expect: {
    agencyName: '경기지방중소벤처기업청', honorific: '청', refDept: '소상공인과장', submitter: '차카타전자 주식회사',
    requestDocNo: '소상공인과-103', requestDate: '2026-09-16', citationStyle: 'guillemet', title: '소명자료 추가제출 요구에 대한 회신', sendDate: '2026-10-19', firmRef: '26-*'},
    items: 3, labels: false, headings: ['차카타전자(주)가 협력사에 부과하는 ‘품질 벌점’은 어떤 내부 규정에 근거하여 산정되고, 협력사의 이의 제기는 어떤 절차로 처리되는지?',
      '설비 반입이 늦어져 정비 기간이 늘어난 경우 피요청인은 요청인에게 추가 인건비를 정산하여 지급한 사실이 있는지? 없다면 이에 대한 근거 제시',
      '피요청인이 요청인에게 지급한 2025년 하반기 정비 대금 중 감액한 금액이 있다면 그 금액과 감액 사유는 무엇인지?']}
];

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
    await page.waitForTimeout(500);
    for (const c of cases) {
      await page.locator('#new-case').click();
      if (await page.locator('#confirm-dialog[open]').count()) await page.locator('#confirm-yes').click();
      await page.locator('#file-gongmun').setInputFiles(file(c.gongmun));
      await page.waitForSelector('#status-gongmun.done, #status-gongmun.error', {timeout: 30000});
      await page.locator('#file-requests').setInputFiles(file(c.requests));
      await page.waitForSelector('#status-requests.done, #status-requests.error', {timeout: 30000});
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => ({
        fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e.value])),
        items: document.querySelectorAll('#items .request-item').length,
        headings: [...document.querySelectorAll('#pages .doc-item .item-text')].map(e => e.textContent),
        body: [...document.querySelectorAll('#pages .para-text')].map(e => e.textContent),
        summary: document.getElementById('analysis-summary').innerText,
        statuses: [document.getElementById('status-gongmun').textContent, document.getElementById('status-requests').textContent]
      }));
      console.log(`\n=== ${c.key}`, state.statuses);
      console.log(state.summary);
      console.log('title:', state.fields.title, '| requestName:', state.fields.requestName, '| caseLabel:', state.fields.caseLabel);
      console.log('body 2.:', state.body[0]);
      for (const [k, v] of Object.entries(c.expect)) assert.equal(state.fields[k], v, `${c.key}: ${k}`);
      assert.equal(state.items, c.items, `${c.key}: item count`);
      // Headings may continue onto the next preview page; compare joined starts.
      c.headings.forEach((h, i) => assert.ok(state.headings.some(x => x.startsWith(h)), `${c.key}: heading ${i + 1} «${h}» not in ${JSON.stringify(state.headings.map(x => x.slice(0, 40)))}`));
      assert.equal(state.headings.some(x => x.startsWith('[요청사항')), c.labels, `${c.key}: label decision`);
      // A bare company name (사아자) is flagged for the formal name; full names are not.
      assert.equal(/법인 형태/.test(state.summary), c.key === 'saaja', `${c.key}: formal-name warning`);
      await page.locator('#lawyer-search').fill('안채유');
      await page.locator('#lawyer-results .lawyer-result').first().click();
      await page.locator('#lawyer-search').fill('');
      await page.waitForTimeout(250);
      assert.ok(await page.locator('#export-docx').isEnabled(), `${c.key}: export should be enabled`);
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-docx').click()]);
      const target = path.join(out, `${c.key}.docx`);
      await download.saveAs(target);
      console.log('saved', path.relative(project, target), download.suggestedFilename());
      await page.screenshot({path: path.join(out, `${c.key}-screen.png`)});
    }
  } finally {await browser.close();}
  assert.deepEqual(requests, [], 'no network requests');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('\nPASS v3 upload → auto-fill → DOCX for 3 examples; no network requests, no page errors');
})().catch(e => {console.error(e); process.exit(1);});
