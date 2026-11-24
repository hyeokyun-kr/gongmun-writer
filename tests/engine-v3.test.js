/* v3 engine: cover wording against the example final replies (tests/fixtures/requests), and the 첨부 body section. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/engine.js');
const G = globalThis.Gongmun;
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/template-data.json'), 'utf8'));
const out = path.join(__dirname, '../build/verification/v3');
fs.mkdirSync(out, {recursive: true});
let passed = 0;
function check(name, fn) {fn(); passed++; console.log('PASS ' + name);}
const lawyer = G.clone(G.lawyerDefaults.find(l => l.name === '안채유'));
function rmbCase() {
  return Object.assign(G.newCase(), {sendDate: '2026-05-27', agencyName: '공정거래위원회', honorific: '위원회', refDept: '시장감시국 제조업감시과장',
    submitter: '라마바푸드 주식회사', shortName: '라마바', agentOverride: '라마바', requestDate: '2026-05-06',
    requestDocNo: '(사건처리)제조업감시과-0101', requestTitle: '소명자료 제출요구', requestName: '자료제출 요청', partialReply: true,
    title: '자료제출 요청에 대한 회신', attachments: [{id: 'a', text: '자료제출 요청에 대한 회신', copies: '1'}], lawyers: [lawyer],
    items: [
      {id: 'i1', level: 1, label: '1', text: '첫 요청입니다.', notes: ['* 참고 설명']},
      {id: 'i2', level: 1, label: '2', text: '둘째 요청입니다.', notes: []},
      {id: 'i3', level: 1, label: '2-1', text: '귀사의 ‘마진 플래너’ 관련, 산정표를 제출하여 주십시오.', notes: []},
      {id: 'i4', level: 1, label: '2-2', text: '귀사의 ‘마진 플래너’ 관련, 가맹점 목록을 제출하여 주십시오.', notes: ['※ 설명 필요', '※ 확인 필요']},
      {id: 'i5', level: 1, label: '3', text: '셋째 <요청> & "인용"', notes: []}],
    refMaterials: [{id: 'r1', no: '23', text: '마진 플래너 산정표'}, {id: 'r2', no: '24', text: '마진 플래너 적용 가맹점 및 공급 금액'}]});
}
check('라마바 회신 2번 문단: 약칭·대괄호 인용·‘요청’ 뒤 ‘과’·일부 회신 (회신 예시와 ‘6.자/6. 자’ 띄어쓰기만 다름)', () => {
  assert.equal(G.bodyText(rmbCase()), '라마바푸드 주식회사(이하 “라마바”)에 대한 귀 위원회의 2026. 5. 6.자 자료제출 요청[문서번호: (사건처리)제조업감시과-0101]과 관련하여, 라마바는 첨부와 같이 일부 회신하오니 검토하여 주시기 바랍니다.');
});
check('차카타전자 회신 2번 문단: 낫표식 인용과 기관 호칭 ‘청’', () => {
  const c = Object.assign(G.newCase(), {agencyName: '경기지방중소벤처기업청', honorific: '청', submitter: '차카타전자 주식회사', citationStyle: 'guillemet',
    requestDate: '2026-09-17', requestDocNo: '소상공인과-103', requestTitle: '수·위탁거래 분쟁조정 요청 사건 소명자료 추가제출 요구', requestName: '소명자료 추가제출 요구',
    attachments: [{id: 'a', text: '소명자료', copies: '1'}]});
  assert.equal(G.bodyText(c), '차카타전자 주식회사에 대한 귀 청의 2026. 9. 17.자 「수·위탁거래 분쟁조정 요청 사건 소명자료 추가제출 요구」(문서번호: 소상공인과-103)와 관련하여, 차카타전자 주식회사는 첨부와 같이 회신하오니 검토하여 주시기 바랍니다.');
  assert.equal(G.greetingText(c), '귀 청의 무궁한 발전을 기원합니다.');
});
check('조사 와/과는 요청 명칭의 받침을 따른다', () => {
  for (const [name, p] of [['자료제출 요구', '와'], ['자료제출 요청', '과'], ['자료제출 명령', '과'], ['소명자료 제출요구', '와']]) {
    const c = Object.assign(G.newCase(), {submitter: '가나 주식회사', requestDate: '2026-01-02', requestDocNo: '', requestName: name, attachments: []});
    assert.match(G.bodyText(c), new RegExp(`${name}${p} 관련하여`));
  }
});
check('표지 + 첨부 본문 두 구역: 구역 나눔 1회, 본문 쪽번호 새로 시작, 첫 쪽 레터헤드 없음', () => {
  const c = rmbCase(), xml = G.documentXml(c, bundle);
  assert.equal(G.validate(c).errors.length, 0, JSON.stringify(G.validate(c).errors));
  const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map(m => m[0]);
  assert.equal(sects.length, 2);
  assert.match(sects[0], /<w:titlePg\s*\/>/); assert.doesNotMatch(sects[1], /<w:titlePg/);
  assert.doesNotMatch(sects[1], /w:type="first"/); assert.match(sects[1], /<w:pgNumType w:start="1"\s*\/>/);
  const sectionParagraph = xml.match(/<w:p\b(?:(?!<\/w:p>)[\s\S])*?<w:sectPr\b[\s\S]*?<\/w:p>/)[0];
  assert.doesNotMatch(sectionParagraph, /<w:t\b[^>]*>[^<]/, 'section break paragraph is empty');
  const after = xml.slice(xml.indexOf(sectionParagraph) + sectionParagraph.length);
  assert.match(after, /^<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><\/w:pPr><w:r><w:t xml:space="preserve">&lt;첨부&gt;<\/w:t><\/w:r><\/w:p>/);
  assert.ok(xml.indexOf('담당변호사') < xml.indexOf(sectionParagraph), 'lawyers stay on the cover');
  assert.equal([...xml.matchAll(/<w:pStyle w:val="2"\/>/g)].length, 5);
  assert.match(xml, /\[요청사항 2-1\] 귀사의 ‘마진 플래너’ 관련/);
  // Typed straight quotes go to Word as “ ”, as Word itself would have set them.
  assert.match(xml, /셋째 &lt;요청&gt; &amp; “인용”/); assert.doesNotMatch(xml, /&quot;인용/);
  assert.equal([...xml.matchAll(/<w:sz w:val="20"\/>/g)].length, 3, 'three notes at 10pt');
  assert.match(xml, /첨  부  서  류/); assert.match(xml, /1\. 참고자료 23<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">마진 플래너 산정표/);
  assert.match(xml, /<w:t>참<\/w:t>[\s\S]{0,400}<w:t>조<\/w:t>[\s\S]{0,800}시장감시국 제조업감시과장/, 'cover reference row');
  fs.writeFileSync(path.join(out, 'engine-rmb.docx'), G.docx(c, bundle));
});
check('원문 번호 표시: 자동(번호가 다를 때만)·표시·숨김, 세부 내용 끄기', () => {
  const c = rmbCase();
  assert.equal(G.labelsShown(c), true);
  c.items = c.items.filter(i => !/-/.test(i.label)); c.items.forEach((it, i) => it.label = String(i + 1));
  assert.equal(G.labelsShown(c), false);
  assert.doesNotMatch(G.documentXml(c, bundle), /\[요청사항/);
  c.labelMode = 'on'; assert.match(G.documentXml(c, bundle), /\[요청사항 1\] 첫 요청입니다/);
  c.includeNotes = false; assert.doesNotMatch(G.documentXml(c, bundle), /\* 참고 설명/);
  const sub = Object.assign(rmbCase(), {labelMode: 'on', items: [{id: 'x', level: 1, label: '1', text: '상위', notes: []}, {id: 'y', level: 2, label: '가', text: '하위', notes: ['- 세부']}]});
  const n = G.numberedItems(sub);
  assert.deepEqual(n.map(i => [i.number, i.heading]), [['1.', '[요청사항 1] 상위'], ['가.', '[요청사항 1-가] 하위']]);
  const xml = G.documentXml(sub, bundle);
  assert.match(xml, /<w:pStyle w:val="3"\/><w:jc w:val="both"\/><\/w:pPr><w:r><w:t xml:space="preserve">\[요청사항 1-가\] 하위/);
  assert.match(xml, /<w:ind w:left="964" w:firstLineChars="0" w:firstLine="0"\/><\/w:pPr><w:r><w:rPr><w:sz w:val="20"\/><w:szCs w:val="20"\/><\/w:rPr><w:t xml:space="preserve">- 세부/);
  // ‘1. 상위’ followed by ‘가. 하위’: one spacer under the parent, answer line only under the sub item.
  const body = xml.slice(xml.indexOf('[요청사항 1] 상위'));
  assert.equal([...body.matchAll(/<w:p\/>/g)].length, 1, 'one answer line (under 가.)');
  assert.match(body, /\[요청사항 1\] 상위<\/w:t><\/w:r><\/w:p><w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><\/w:pPr><\/w:p><w:p><w:pPr><w:pStyle w:val="3"\/>/);
});
check('발신일자·관리번호 * 노란색, 관리번호는 넓은 칸, 연도는 발신일자', () => {
  const c = rmbCase(), xml = G.documentXml(c, bundle);
  assert.equal(G.newCase().firmRef, G.today().slice(2, 4) + '-*');
  assert.equal(c.firmRef, G.today().slice(2, 4) + '-*');
  assert.match(xml, /<w:szCs w:val="24" \/><w:highlight w:val="yellow" \/><\/w:rPr><w:t xml:space="preserve">2026\. 5\. 27\.<\/w:t>/);
  // ‘예시:’ alone in the 2cm label cell; ‘26-’ plain and ‘*’ yellow in the wide cell (라마바·사아자 회신 예시와 같음).
  const row = xml.match(/<w:tr>(?:(?!<\/w:tr>)[\s\S])*?예시:[\s\S]*?<\/w:tr>/)[0];
  const cells = [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(m => m[0]);
  assert.equal(cells.length, 2);
  assert.match(cells[0], /<w:t xml:space="preserve">예시:<\/w:t>/); assert.doesNotMatch(cells[0], /26-/);
  assert.match(cells[1], /<w:rPr><w:szCs w:val="24" \/><\/w:rPr><w:t xml:space="preserve">26-<\/w:t><\/w:r><w:r[^>]*><w:rPr><w:szCs w:val="24" \/><w:highlight w:val="yellow" \/><\/w:rPr><w:t xml:space="preserve">\*<\/w:t>/);
  c.firmRef = '26-0123';
  assert.doesNotMatch(G.documentXml(c, bundle).match(/<w:tr>(?:(?!<\/w:tr>)[\s\S])*?예시:[\s\S]*?<\/w:tr>/)[0], /<w:highlight/);
  c.firmRef = '';
  assert.equal(G.validate(c).errors.length, 0);
  assert.match(G.documentXml(c, bundle), /예시:<\/w:t><\/w:r><\/w:p><\/w:tc><w:tc><w:tcPr><w:tcW w:w="7938" w:type="dxa" \/><\/w:tcPr><w:p><w:pPr>[\s\S]*?<\/w:pPr><\/w:p><\/w:tc>/);
  assert.equal(G.firmRefFor('2027-01-04'), '27-*'); assert.equal(G.autoFirmRef('26-*'), true); assert.equal(G.autoFirmRef('26-12'), false);
  assert.equal(G.sample('reply').firmRef, '26-*');
  assert.match(G.textOutput(rmbCase()), /^2026\. 5\. 27\.\n예시: \d{2}-\*\n/);
});
check('요청사항 양쪽맞춤, 첨부서류 앞 페이지 나누기', () => {
  const xml = G.documentXml(rmbCase(), bundle);
  const headings = [...xml.matchAll(/<w:pStyle w:val="[23]"\/>(<w:jc w:val="both"\/>)?/g)];
  assert.equal(headings.length, 5); assert.ok(headings.every(m => m[1]), 'every request heading is justified');
  assert.match(xml, /<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><\/w:pPr><w:r><w:br w:type="page"\/><\/w:r><\/w:p><w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:sz w:val="30"\/><w:szCs w:val="30"\/><\/w:rPr><w:t xml:space="preserve">첨  부  서  류/);
  assert.equal([...xml.matchAll(/<w:br w:type="page"\/>/g)].length, 1);
  // The break replaces the last item's trailing spacer: answer line, then the break.
  assert.match(xml, /<w:p\/><w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><\/w:pPr><w:r><w:br w:type="page"\/>/);
  const none = rmbCase(); none.refMaterials = [];
  assert.doesNotMatch(G.documentXml(none, bundle), /w:type="page"/);
});
check('요청사항이 없거나 본문 끄기면 기존처럼 표지 한 구역만 저장', () => {
  const c = rmbCase(); c.items = []; c.refMaterials = [];
  assert.equal(G.hasBody(c), false);
  assert.equal([...G.documentXml(c, bundle).matchAll(/<w:sectPr\b/g)].length, 1);
  assert.ok(G.validate(c).warnings.some(w => /표지만 저장/.test(w)));
  const d = rmbCase(); d.includeBody = false;
  assert.equal([...G.documentXml(d, bundle).matchAll(/<w:sectPr\b/g)].length, 1);
  assert.doesNotMatch(G.documentXml(d, bundle), /&lt;첨부&gt;/);
});
check('빈 요청사항·하위로 시작하는 목록·제어 문자는 저장 차단', () => {
  for (const patch of [c => {c.items[1].text = ' ';}, c => {c.items[0].level = 2;}, c => {c.items[2].notes.push('a\u0001b');}]) {
    const c = rmbCase(); patch(c);
    assert.ok(G.validate(c).errors.some(e => e.field === 'items'));
    assert.throws(() => G.docx(c, bundle));
  }
});
check('사건 파일 v2: 요청사항·참고자료·옵션 보존, v1(이전 버전) 파일은 예전 문장 유지', () => {
  const c = rmbCase(), read = G.readCase(G.caseFile(c));
  assert.deepEqual(read.items.map(({id, ...x}) => x), c.items.map(({id, ...x}) => x));
  assert.deepEqual(read.refMaterials.map(({id, ...x}) => x), c.refMaterials.map(({id, ...x}) => x));
  assert.equal(read.partialReply, true); assert.equal(read.shortName, '라마바'); assert.equal(G.bodyText(read), G.bodyText(c));
  const v1data = {...G.sample('reply')}; for (const k of ['shortName', 'requestName', 'subjectFirst', 'partialReply', 'includeBody', 'bodyTitleOverride', 'labelMode', 'includeNotes', 'items', 'refMaterials']) delete v1data[k];
  const old = G.readCase({format: G.FORMAT, version: 1, data: v1data});
  assert.equal(G.bodyText(old), '귀 위원회의 2026. 1. 5.자 자료제출 요구[문서번호: (사건처리)서비스감시과-000]와 관련하여, 가나다 주식회사는 첨부와 같이 회신하오니 검토하여 주시기 바랍니다.');
  assert.equal(G.hasBody(old), false);
  assert.throws(() => G.readCase({...G.caseFile(c), data: {...G.caseFile(c).data, items: [{level: 3, label: '', text: 'x', notes: []}]}}));
});
check('텍스트 복사에도 첨부 본문 포함', () => {
  const t = G.textOutput(rmbCase());
  assert.match(t, /<첨부>\n자료제출 요청에 대한 회신/);
  assert.match(t, /3\. \[요청사항 2-1\] 귀사의/);
  assert.match(t, /첨  부  서  류/);
});
console.log(`${passed} v3 engine checks passed`);
