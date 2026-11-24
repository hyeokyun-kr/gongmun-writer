/* Readers and analysis against the example letters (tests/fixtures/requests, all invented).
   Usage: node tests/readers.test.js [pdfjs-dist legacy build path]  (PDF checks are skipped without it) */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
if (process.argv[2]) globalThis.pdfjsLib = require(process.argv[2]);
require('../src/readers.js'); require('../src/analyze.js');
const R = globalThis.GongmunReaders, A = globalThis.GongmunAnalyze;
const examples = path.join(root, 'tests', 'fixtures', 'requests');
const file = prefix => path.join(examples, fs.readdirSync(examples).find(n => n.normalize('NFC').startsWith(prefix.normalize('NFC'))));
// The 요청서 is an HWP 5.0 file: ‘1. 260506 자료제출요청서….hwp’ when present, otherwise its HWPX version stands in
// (the HWP-only checks then print SKIP).
const requestForm = (() => {
  const names = fs.readdirSync(examples).filter(n => n.normalize('NFC').startsWith('1. 260506 자료제출요청서'.normalize('NFC')));
  return path.join(examples, names.find(n => /\.hwp$/i.test(n)) || names.find(n => /\.hwpx$/i.test(n)));
})();
const isHwp = /\.hwp$/i.test(requestForm);
const skipHwp = what => console.log(`SKIP ${what} (no .hwp fixture yet: ${path.basename(requestForm)} is read instead)`);
let passed = 0;
const ok = name => {passed++; console.log('PASS', name);};

(async () => {
  // 1. The built-in DEFLATE decoder matches zlib on every compressed member/stream we have.
  let streams = 0;
  const zips = [];
  (function walk(dir) {for (const n of fs.readdirSync(dir)) {const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(docx|hwpx)$/i.test(n)) zips.push(p);}})(path.join(root, 'tests', 'fixtures'));
  for (const z of zips) {
    const bytes = new Uint8Array(fs.readFileSync(z)), view = new DataView(bytes.buffer);
    let at = 0;
    while (view.getUint32(at, true) === 0x04034b50) {
      const method = view.getUint16(at + 8, true), size = view.getUint32(at + 18, true);
      const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
      if (method === 8 && size) {
        const data = bytes.subarray(start, start + size);
        assert.deepEqual(Buffer.from(R.inflate(data)), zlib.inflateRawSync(data), `${path.basename(z)} member at ${at}`);
        streams++;
      }
      at = start + size;
    }
  }
  if (isHwp) {
    const hwp = R.readCfb(new Uint8Array(fs.readFileSync(requestForm)));
    for (const name of hwp.names.filter(n => n === 'DocInfo' || n.startsWith('BodyText/'))) {
      const raw = hwp.read(name);
      assert.deepEqual(Buffer.from(R.inflate(raw)), zlib.inflateRawSync(raw), name);
      streams++;
    }
  } else skipHwp('HWP 5.0 container (CFB) and its DocInfo/BodyText streams with trailing bytes');
  ok(`built-in DEFLATE decoder equals zlib on ${streams} streams${isHwp ? ' (incl. HWP streams with trailing bytes)' : ' of the DOCX/HWPX fixtures'}`);

  // 2. 라마바 요청서 (HWP, or its HWPX stand-in) → 6 items exactly as the reply numbers them ([요청사항 1], 2, 2-1, 2-2, 3, 4).
  const rmbDoc = await R.read(path.basename(requestForm), fs.readFileSync(requestForm));
  if (isHwp) assert.equal(rmbDoc.kind, 'hwp');
  else {skipHwp("kind === 'hwp'"); assert.equal(rmbDoc.kind, 'hwpx');}
  assert.equal(A.looksLikeGongmun(rmbDoc), false);
  const rmb = A.requests(rmbDoc);
  assert.deepEqual(rmb.items.map(i => [i.level, i.label]), [[1, '1'], [1, '2'], [1, '2-1'], [1, '2-2'], [1, '3'], [1, '4']]);
  assert.ok(rmb.items[2].text.startsWith('귀사의 ‘마진 플래너(Margin Planner)’ 관련, ‘마진 플래너 산정표(엑셀파일)’를 제출하고'));
  assert.ok(rmb.items[3].text.startsWith('귀사의 ‘마진 플래너(Margin Planner)’ 관련, 외식유통사업부에서 (1) 마진 플래너가 적용된 가맹점 목록'));
  assert.deepEqual(rmb.items.map(i => i.notes.length), [1, 1, 0, 2, 0, 0]);
  assert.ok(rmb.items[0].notes[0].startsWith('* 배송 거리와 배송 주기'));
  assert.ok(rmb.items[3].notes.every(n => n.startsWith('※')));
  assert.equal(A.labelsNeeded(rmb.items), true);
  assert.ok(rmb.items[0].text.endsWith('설명하여 주십시오.') && !rmb.items[0].text.includes('자료 작성 및 제출 방법'));
  ok(`${isHwp ? 'HWP' : 'HWPX(HWP 대신)'} 요청서: 6개 항목·라벨·세부 내용이 회신 정답지와 같은 구조`);

  // 3. HWPX: 사아자 안내문 → 5 top items, 4 sub items under item 1 (the second ‘다.’ kept as a 4th sub item).
  const saDoc = await R.read('sa.hwpx', fs.readFileSync(file('2. ★자료')));
  assert.equal(saDoc.kind, 'hwpx');
  const sa = A.requests(saDoc);
  assert.deepEqual(sa.items.map(i => [i.level, i.text]), [
    [1, '예시분말 부산물 판매 실적'], [2, '연도별 판매량 및 판매액'], [2, '거래처 유형별 판매액'], [2, '월별 평균 판매단가'], [2, '분기별 재고 및 출하량'],
    [1, '회사 개요 및 조직 변동'], [1, '예시분말 생산 설비 및 가동률'], [1, '부산물 가격 결정 절차'], [1, '제품 등급 기준 확인']]);
  assert.equal(A.labelsNeeded(sa.items), false);
  const cells = ['구분(거래처 유형별)', '(단위: 원)', '합계', '전체 판매액*', '가공업체(직거래) 판매액', '부산물 평균단가 계**'];
  assert.ok(!sa.items.some(i => i.notes.some(n => cells.includes(n))), 'form tables must not leak into notes');
  assert.ok(sa.warnings.some(w => /표 \d+개/.test(w)));
  const saDept = A.departments(saDoc.paragraphs.map(p => p.text), '(사건처리)국제카르텔조사과-0102');
  assert.equal(saDept.candidates[0], '카르텔조사국 국제카르텔조사과장');
  assert.equal(saDept.candidates[1], '카르텔조사국 국제카르텔조사과 (담당자: 정가온 조사관님)');
  ok('HWPX 안내문: 1.~5. 및 가.~라. 구조, 양식 표 제외, 참조 후보(담당자 포함) 일치');

  // 4. Helpers
  assert.equal(A.submitterFrom('라마바푸드(주)'), '라마바푸드 주식회사');
  assert.equal(A.submitterFrom('차카타전자(주) 대표이사'), '차카타전자 주식회사');
  assert.equal(A.submitterFrom('㈜사아자'), '주식회사 사아자');
  assert.equal(A.requestNameFrom('수·위탁거래 분쟁조정 요청 사건 소명자료 추가제출 요구'), '소명자료 추가제출 요구');
  assert.equal(A.requestNameFrom('소명자료 제출요구'), '소명자료 제출요구');
  assert.equal(A.honorificFor('경기지방중소벤처기업청'), '청');
  assert.equal(A.honorificFor('중소벤처기업부'), '부');
  assert.equal(R.joinLines('어떤 내부 규정에', '근거하여'), '어떤 내부 규정에 근거하여');
  assert.equal(R.joinLines('요청인에게 추가 인건', '비를'), '요청인에게 추가 인건비를');
  assert.equal(R.joinLines('(☏ 044-200-', '0101)에게'), '(☏ 044-200-0101)에게');
  const pasted = A.requests(R.readText('자료제출 요청사항\n1. 첫 번째 요청입니다.\n * 참고 설명\n2. 두 번째 요청입니다.\n가. 하위 요청\n나. 하위 요청 둘\n3. 세 번째\n<자료 작성 시 유의사항>\n1) 날인'));
  assert.deepEqual(pasted.items.map(i => [i.level, i.label, i.notes.length]), [[1, '1', 1], [1, '2', 0], [2, '가', 0], [2, '나', 0], [1, '3', 0]]);
  ok('제출 주체·요청 명칭·기관 호칭·PDF 줄 잇기·붙여넣기 분석');

  // 5. Automatic numbering (no literal numbers in the text) still yields items.
  const auto = A.requests({paragraphs: [{text: '요청사항'}, {text: '첫 요청', auto: {level: 0, label: '1.'}}, {text: '하위', auto: {level: 1, label: '가.'}}, {text: '둘째 요청', auto: {level: 0, label: '2.'}}]});
  assert.deepEqual(auto.items.map(i => [i.level, i.label, i.text]), [[1, '1', '첫 요청'], [2, '가', '하위'], [1, '2', '둘째 요청']]);
  ok('자동 번호 문단(한글 문단 번호·Word 목록)도 항목으로 인식');

  // 6. Word fixtures: a request table (번호 | 요청 자료 | 비고) and Word's automatic list numbering.
  const tableDoc = await R.read('t.docx', fs.readFileSync(path.join(__dirname, 'fixtures', 'table-requests.docx')));
  assert.deepEqual(A.requests(tableDoc).items.map(i => [i.label, i.text, i.notes]), [['1', '최근 3년간 연도별 매출액 자료', ['엑셀 파일']],
    ['2', '주요 거래처 목록 및 거래 조건', []], ['3', '가격 결정 관련 내부 보고서 일체', ['2024년 이후']]]);
  const autoDoc = await R.read('a.docx', fs.readFileSync(path.join(__dirname, 'fixtures', 'auto-numbered.docx')));
  assert.deepEqual(A.requests(autoDoc).items.map(i => i.text), ['귀사의 조직도를 제출하여 주십시오.', '부서별 인원 현황을 함께 기재하여 주십시오.', '귀사의 2025년 매출액을 제출하여 주십시오.']);
  // 공문 edge cases: two-word agency keeps its space; letter-spaced title is joined; ‘수신자 참조’ is left blank.
  const fake = lines => ({paragraphs: lines.map(text => ({text}))});
  assert.equal(A.gongmun(fake(['공정거래위원회 부산지방사무소', '수신 가나 주식회사', '제목 자료제출 요청', '시행 부산사무소-12 (2026. 1. 2.) 접수'])).agency, '공정거래위원회 부산지방사무소');
  assert.equal(A.gongmun(fake(['공 정 거 래 위 원 회', '수신 가나(주)', '제목 자료제출 요청'])).agency, '공정거래위원회');
  const multi = A.gongmun(fake(['금융위원회', '수신 수신자 참조', '제목 자료 요청', '시행 공정시장과-77 (2026. 3. 4.) 접수']));
  assert.deepEqual([multi.recipient, multi.docNo, multi.date], ['', '공정시장과-77', '2026-03-04']);
  ok('Word 표 형식 목록·Word 자동 번호 목록·공문 기관명 띄어쓰기·수신자 참조');
  // 제출기한 → 발신일자: labelled, ‘…까지 제출’, 년월일, no year; data periods are not deadlines.
  const due = (t, ref) => {const d = A.deadline(t, ref); return d && [d.text, d.date];};
  assert.deepEqual(due('다. 제출기한: 2026. 5. 22. 18시 까지'), ['2026. 5. 22. 18시', '2026-05-22']);
  assert.deepEqual(due('◈ 자료제출 일시 : 2026년 9월 9일(수) 18:00 까지'), ['2026년 9월 9일(수) 18:00', '2026-09-09']);
  assert.deepEqual(due('요구하오니\n2026.10.19.(월)까지 제출하여 주시기 바랍니다.'), ['2026.10.19.(월)', '2026-10-19']);
  assert.deepEqual(due('제출기한: 1. 5.(월)', '2026-12-20'), ['1. 5.(월)', '2027-01-05']);
  assert.equal(due('2020. 1. 1.부터 2025. 12. 31.까지 거래내역을 제출하여 주십시오.'), null);
  assert.equal(due('2025. 12. 31.까지의 매출액을 제출하여 주십시오.'), null);
  assert.equal(due('제출기한 내에 제출하여 주시기 바랍니다.'), null);
  assert.deepEqual(due(saDoc.paragraphs.map(p => p.text).join('\n')), ['2026년 9월 9일(수) 18:00', '2026-09-09']);
  assert.equal(due(rmbDoc.paragraphs.map(p => p.text).join('\n')), null, '라마바 요청서: ‘지정일 18시까지 도착’ has no date');
  ok('제출기한 찾기: 3가지 표기·연도 생략·자료 기간 제외·사아자 안내문(HWPX)');

  if (!globalThis.pdfjsLib) {console.log('SKIP PDF checks (pass the pdfjs-dist legacy build path)'); console.log(`${passed} reader checks passed`); return;}
  // 6. PDF 공문 3건 + PDF 요구서
  const gm = async prefix => {const d = await R.read('x.pdf', fs.readFileSync(file(prefix))); assert.ok(A.looksLikeGongmun(d), prefix); return [d, A.gongmun(d)];};
  const [rmbG, rmbInfo] = await gm('1. 260506 자료제출요청_라마바');
  assert.deepEqual([rmbInfo.agency, rmbInfo.recipient, rmbInfo.title, rmbInfo.docNo, rmbInfo.date], ['공정거래위원회', '라마바푸드(주)', '소명자료 제출요구', '(사건처리)제조업감시과-0101', '2026-05-06']);
  assert.equal(A.departments(rmbG.paragraphs.map(p => p.text), rmbInfo.docNo).candidates[0], '시장감시국 제조업감시과장');
  const [, saInfo] = await gm('2. 자료제출명령');
  assert.deepEqual([saInfo.agency, saInfo.recipient, saInfo.title, saInfo.docNo, saInfo.date, saInfo.caseNo], ['공정거래위원회', '사아자', '자료제출 명령', '(사건처리)국제카르텔조사과-0102', '2026-08-31', '2026국카0012']);
  const [cktG, cktInfo] = await gm('3. 수·위탁거래');
  assert.deepEqual([cktInfo.agency, cktInfo.recipient, cktInfo.docNo, cktInfo.date], ['경기지방중소벤처기업청', '차카타전자(주) 대표이사', '소상공인과-103', '2026-09-16']);
  assert.equal(A.departments(cktG.paragraphs.map(p => p.text), cktInfo.docNo).candidates[0], '소상공인과장');
  assert.deepEqual([rmbInfo.deadlineDate, saInfo.deadlineDate, cktInfo.deadlineDate], ['2026-05-22', '2026-09-09', '2026-10-19']);
  const cktReq = await R.read('y.pdf', fs.readFileSync(file('3. 소명자료 제출 요구서')));
  assert.equal(A.looksLikeGongmun(cktReq), false);
  const ckt = A.requests(cktReq);
  assert.deepEqual(ckt.items.map(i => [i.level, i.label]), [[1, '1'], [1, '2'], [1, '3']]);
  assert.equal(ckt.items[1].text, '설비 반입이 늦어져 정비 기간이 늘어난 경우 피요청인은 요청인에게 추가 인건비를 정산하여 지급한 사실이 있는지? 없다면 이에 대한 근거 제시');
  assert.equal(A.labelsNeeded(ckt.items), false);
  ok('PDF 공문 3건(기관·수신·제목·문서번호·시행일·제출기한) 및 PDF 요구서 3개 항목');
  // 7. 심사보고서 의견서: 의견제출 요청 공문 2건 + 심사보고서 (tests/fixtures/opinion)
  const opinions = path.join(root, 'tests', 'fixtures', 'opinion');
  const sample = prefix => path.join(opinions, fs.readdirSync(opinions).find(n => n.normalize('NFC').startsWith(prefix.normalize('NFC'))));
  const op = async prefix => {const d = await R.read('x.pdf', fs.readFileSync(sample(prefix))); assert.ok(A.looksLikeGongmun(d), prefix); return A.gongmun(d);};
  const gm3 = await op('(공문)심사보고서 송부');
  assert.deepEqual([gm3.opinion, gm3.caseNo, gm3.partyRole, gm3.partyName, gm3.refDept, gm3.copies, gm3.deadlineDate, gm3.leniency],
    [true, '2026국카0001', '신청인', '*****', '심판총괄담당관, 국제카르텔조사과장', '20부(심판총괄담당관실 13부, 국제카르텔조사과 7부)', '2026-04-16', true]);
  assert.equal(gm3.caseName, '7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건 관련 *****의 감면신청에 대한 건', 'two-line case name joined');
  const studio = await op('[공문] 심사보고서 송부');
  assert.deepEqual([studio.opinion, studio.caseNo, studio.partyRole, studio.partyName, studio.caseName, studio.refDept, studio.copies, studio.deadlineDate, studio.leniency],
    [true, '2024집단0003', '피심인', '(주)스튜디오파하', '(주)스튜디오파하의 손자회사 행위제한규정 위반행위에 대한 건', '심판총괄담당관, 기업집단관리과장', '11부(심판총괄담당관실 8부, 기업집단관리과 3부)', '2025-02-17', false]);
  assert.equal(rmbInfo.opinion, undefined, '자료제출 요청 공문은 의견서가 아님');
  const report = await R.read('r.pdf', fs.readFileSync(sample('(심사보고서)7개')));
  assert.ok(A.looksLikeExamReport(report) && !A.looksLikeGongmun(report));
  assert.equal(A.looksLikeExamReport(cktReq), false);
  const er = A.examReport(report);
  assert.deepEqual([er.caseNo, er.caseName, er.parties.length], ['2025제카0002', '7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건', 7]);
  assert.deepEqual([er.client.name, er.client.agent, er.client.lawyers, er.dept], ['주식회사 사아자', '법무법인 예시', ['곽솔', '나현하', '이담혜', '고지하'], '국제카르텔조사과']);
  assert.equal(er.parties[2].agent, '법무법인 가상', '쪽이 넘어가고 각주가 끼어도 같은 피심인으로 이어 읽음');
  assert.equal(A.refFromSubmitTo('공정거래위원회 심판총괄담당관실·시장감시총괄과'), '심판총괄담당관, 시장감시총괄과장');
  assert.deepEqual([A.corpMark('주식회사 사아자'), A.corpMark('가나다식품 주식회사'), A.shortCompany('주식회사 하나둘')], ['㈜사아자', '가나다식품㈜', '하나둘']);
  ok('의견제출 요청 공문 2건(사건번호·두 줄 사건명·신청인/피심인·제출처→참조·제출부수·감면) 및 심사보고서 피심인 7곳·우리 법인 대리 회사');
  console.log(`${passed} reader checks passed`);
})().catch(e => {console.error(e); process.exit(1);});
