/* 심사보고서 의견서: cover wording against the example 의견서 samples
   (tests/fixtures/opinion), and the 공문 표지 → 겉표지 → 목차 → 본문 sections. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/engine.js');
const G = globalThis.Gongmun;
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/template-data.json'), 'utf8'));
const out = path.join(__dirname, '../build/verification/opinion');
fs.mkdirSync(out, {recursive: true});
let passed = 0;
function check(name, fn) {fn(); passed++; console.log('PASS ' + name);}
// 임현겸·남기온 변호사는 기본 명단에 없어 샘플 의견서의 연락처를 그대로 씀.
const former = {임현겸: {id: 'hlim@example.com', name: '임현겸', directPhone: '0000-9592', subPhone: '7442', email: 'hlim@example.com'},
  남기온: {id: 'kion.nam@example.com', name: '남기온', directPhone: '0000-4127', subPhone: '4177', email: 'kion.nam@example.com'}};
const pick = names => names.map(n => G.clone(G.lawyerDefaults.find(l => l.name === n) || former[n]));
// The 감면 의견서 sample (tests/fixtures/opinion)
function leniencyCase() {
  const c = Object.assign(G.newCase(), {docType: 'opinion', sendDate: '2026-04-15', title: '[감면] 심사보고서에 대한 의견서 제출',
    refDept: '심판총괄담당관, 국제카르텔조사과장', submitter: '주식회사 사아자', partyRole: '신청인', caseNo: '2026국카0001',
    caseName: '7개 예시분말 제조∙판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건(비공개)',
    attachments: [{id: 'a', text: '심사보고서에 대한 의견서 20부(심판총괄담당관실 13부, 국제카르텔조사과 7부)', copies: ''}],
    lawyers: pick(['곽솔', '나현하', '이담혜', '임현겸', '안채유', '남기온']), refMaterials: [{id: 'r', no: '1', text: ''}]});
  c.items = G.opinionItems(c); c.confidentialNote = G.confidentialDefault(c);
  return c;
}
const text = xml => [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
check('감면 의견서 표지: 2번 문단·첨부 줄·대리인 줄이 샘플과 같음', () => {
  const c = leniencyCase();
  assert.equal(G.validate(c).errors.length, 0, JSON.stringify(G.validate(c).errors));
  assert.equal(G.bodyText(c), '귀 위원회의 「7개 예시분말 제조∙판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건(비공개)」(2026국카0001)과 관련하여, 신청인 주식회사 사아자는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다.');
  assert.deepEqual(G.attachmentLines(c), ['첨부: 심사보고서에 대한 의견서 20부(심판총괄담당관실 13부, 국제카르텔조사과 7부). 끝.']);
  assert.equal(G.agentLine(c), '주식회사 사아자 대리인');
  assert.equal(G.agentLine(Object.assign(G.newCase(), {submitter: '가나 주식회사'})), '가나 주식회사의 대리인', '회신은 그대로');
});
check('원사건(피심인) 2번 문단도 샘플과 같음', () => {
  const c = Object.assign(leniencyCase(), {partyRole: '피심인', caseNo: '2025제카0002', caseName: '7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건', title: G.titles.opinion});
  assert.equal(G.bodyText(c), '귀 위원회의 「7개 예시분말 제조·판매사업자의 부당한 공동행위에 대한 건」(2025제카0002)과 관련하여, 피심인 주식회사 사아자는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다.');
  assert.deepEqual(G.opinionItems(c).map(i => [i.level, i.text]), [[1, '심사보고서 및 피심인 의견 요지'], [2, '심사보고서 요지'], [2, '사아자 의견 요지'], [1, '[의견 제목]'], [1, '결론']]);
});
check('Word: 공문 표지 → 겉표지(레터헤드, 쪽번호 없음) → 목차(i, ii) → 본문(1부터) 네 구역', () => {
  const c = leniencyCase(), xml = G.documentXml(c, bundle);
  const sects = [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map(m => m[0]);
  assert.equal(sects.length, 4);
  const footer = s => s.match(/<w:footerReference w:type="first" r:id="(\w+)"/)?.[1];
  assert.equal(footer(sects[0]), 'rId15', '공문 표지는 원본 첫 쪽 바닥글(쪽번호)');
  assert.equal(footer(sects[1]), 'rId12', '겉표지는 빈 바닥글');
  assert.match(sects[1], /<w:headerReference w:type="first" r:id="rId14"/); assert.match(sects[1], /<w:titlePg/);
  assert.match(sects[2], /<w:pgNumType w:start="1" w:fmt="lowerRoman"/); assert.doesNotMatch(sects[2], /titlePg/);
  // 목차 바닥글: ‘i / ii’ (PAGE·SECTIONPAGES 모두 \* roman), 독립 검증에서 찾은 ‘i / 1’ 수정.
  assert.match(sects[2], /<w:footerReference w:type="default" r:id="rIdTocFooter"/);
  const tocFooter = Buffer.from(bundle.templates.reply.parts['word/footerToc.xml'], 'base64').toString();
  assert.match(tocFooter, / PAGE \\\* roman /); assert.match(tocFooter, / SECTIONPAGES \\\* roman /);
  // 첨부 줄: 2026 의견서처럼 ‘첨부: ’ 뒤로 내어쓰기, 자간 -0.5pt.
  assert.match(xml, /<w:ind w:left="610" w:hangingChars="311" w:hanging="610" \/>[\s\S]{0,120}<w:spacing w:val="-10" \/>[\s\S]{0,80}첨부: 심사보고서에 대한 의견서 20부/);
  assert.match(sects[3], /<w:pgNumType w:start="1"\s*\/>/);
  const parts = xml.split(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/);
  assert.equal(text(parts[1]), '심사보고서에 대한 의견서- 7개 예시분말 제조∙판매사업자의 부당한 공동행위에 대한 건 관련 ㈜사아자의 감면신청에 대한 건(비공개) -(사건번호: 2026국카0001)신청인 주식회사 사아자대리인 법무법인 예시');
  assert.match(parts[1], /w:val="double"/, '겉표지 이중 테두리 상자');
  assert.match(parts[2], /목  차/); assert.match(parts[2], /<w:fldChar w:fldCharType="begin" w:dirty="true"\/><\/w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-4" \\h \\z \\u <\/w:instrText>/);
  assert.match(text(parts[2]), /^목  차I\.심사보고서 및 신청인 의견 요지1\.심사보고서 요지2\.사아자 의견 요지II\.\[의견 제목\]III\.결론$/);
  const body = parts[3];
  assert.ok(body.indexOf('수사기관 등 제3자에게') < body.indexOf('심사보고서에 대한 의견서'), '감면 비공개 요청 상자가 본문 제목 앞');
  assert.equal([...body.matchAll(/<w:pStyle w:val="1"\/>/g)].length, 3, 'I. 제목 3개(heading 1)');
  assert.equal([...body.matchAll(/<w:pStyle w:val="2"\/>/g)].length, 2, '1. 제목 2개(heading 2)');
  assert.match(body, /<w:br w:type="page"\/><\/w:r><\/w:p><w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:sz w:val="30"\/><w:szCs w:val="30"\/><\/w:rPr><w:t xml:space="preserve">첨  부  서  류/);
  assert.match(body, /1\. 소을 제1호증<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">주식회사 사아자 대리인<\/w:t>/);
  assert.doesNotMatch(xml, /\{\{/);
  fs.writeFileSync(path.join(out, 'engine-gammyeon.docx'), G.docx(c, bundle));
});
check('공문만 저장(양식 끄기)·비공개 문구 없음·가려진 이름 저장 차단', () => {
  const c = leniencyCase(); c.includeBody = false;
  assert.equal([...G.documentXml(c, bundle).matchAll(/<w:sectPr\b/g)].length, 1);
  const d = leniencyCase(); d.confidentialNote = '';
  assert.doesNotMatch(G.documentXml(d, bundle), /수사기관 등 제3자에게/);
  for (const patch of [{submitter: '*****'}, {caseName: '… 관련 *****의 감면신청에 대한 건'}]) {
    const e = Object.assign(leniencyCase(), patch);
    assert.ok(G.validate(e).errors.some(x => /가려진 이름/.test(x.text)), JSON.stringify(patch));
  }
  const f = Object.assign(leniencyCase(), {caseName: ''});
  assert.ok(G.validate(f).errors.some(x => x.field === 'caseName'));
  assert.ok(G.validate(leniencyCase()).warnings.some(w => /\[의견 제목\]/.test(w)));
});
check('사건 파일: 의견서 저장·복원, 이전 v2 파일(새 칸 없음)도 열림', () => {
  const c = leniencyCase(), read = G.readCase(G.caseFile(c));
  for (const k of ['docType', 'caseNo', 'caseName', 'partyRole', 'confidentialNote']) assert.equal(read[k], c[k], k);
  const old = G.caseFile(Object.assign(G.newCase(), {submitter: '가나 주식회사', requestDate: '2026-01-02'}));
  for (const k of ['caseNo', 'caseName', 'partyRole', 'confidentialNote']) delete old.data[k];
  assert.equal(G.readCase(old).partyRole, '피심인');
});
check('텍스트 복사: 의견서 겉표지·목차·본문 뼈대', () => {
  const t = G.textOutput(leniencyCase());
  assert.match(t, /주식회사 사아자 대리인\n법무법인 예시/);
  assert.match(t, /목  차\nI\. 심사보고서 및 신청인 의견 요지\n  1\. 심사보고서 요지/);
  assert.match(t, /첨  부  서  류\n\n1\. 소을 제1호증\t/);
});
console.log(`${passed} opinion checks passed`);
