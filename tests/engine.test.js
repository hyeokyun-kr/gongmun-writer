const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/engine.js');
const G = globalThis.Gongmun;
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/template-data.json'), 'utf8'));
const out = path.join(__dirname, '../build/verification');
fs.mkdirSync(out, {recursive: true});
let passed = 0;
function check(name, fn) {fn(); passed++; console.log('PASS ' + name);}

check('two original examples are complete and preserve wording', () => {
  const reply = G.sample('reply'), lg = G.sample('additional');
  assert.equal(G.validate(reply).errors.length, 0);
  assert.equal(G.validate(lg).errors.length, 0);
  // The reply example carries a 약칭 so that it shows the quote marks; company names and numbers are made up (2026-11-02).
  assert.equal(G.bodyText(reply), '귀 위원회의 2026. 1. 5.자 자료제출 요구[문서번호: (사건처리)서비스감시과-000]와 관련하여, 가나다 주식회사(이하 “가나다”)는 첨부와 같이 회신하오니 검토하여 주시기 바랍니다.');
  assert.equal(G.bodyText(Object.assign(G.sample('reply'), {shortName: ''})), '귀 위원회의 2026. 1. 5.자 자료제출 요구[문서번호: (사건처리)서비스감시과-000]와 관련하여, 가나다 주식회사는 첨부와 같이 회신하오니 검토하여 주시기 바랍니다.');
  // In Word the marks sit in runs of their own without the East Asian hint (Times New Roman), as in the firm's documents.
  assert.match(G.documentXml(reply, bundle), /<w:r><w:rPr><w:szCs w:val="24" \/><\/w:rPr><w:t xml:space="preserve">“<\/w:t><\/w:r>/);
  assert.equal(G.bodyText(lg), '기업집단 가나다의 동일인(홍길동)에 대한 귀 위원회의 2025. 12. 1.자 「자료제출 요구」(문서번호: 기업집단정책과-000)와 관련하여, 기업집단 가나다의 동일인(홍길동)은 첨부와 같이 추가 설명자료를 제출하오니 검토하여 주시기 바랍니다.');
  assert.deepEqual(G.attachmentLines(reply), ['첨부 1. 일반현황자료제출', '2. 요구자료 내용. 끝.']);
  assert.deepEqual(G.attachmentLines(lg), ['첨부: 추가 설명자료 1부. 끝.']);
  for (const [key, c] of [['reply', reply], ['additional', lg]]) fs.writeFileSync(path.join(out, key + '.docx'), G.docx(c, bundle));
});
check('cover paragraphs avoid Windows pagination squares and retain body numbering', () => {
  for (const kind of ['reply', 'additional']) {
    const xml = G.documentXml(G.sample(kind), bundle);
    assert.doesNotMatch(xml, /<w:(?:keepNext|keepLines|pageBreakBefore)\b/);
    assert.equal([...xml.matchAll(/<w:numPr>/g)].length, 2, 'the two numbered body paragraphs must remain numbered');
    assert.match(xml, /담당변호사/);
    assert.match(xml, /<w:drawing>/);
  }
});
check('Word contacts use the same extra right-margin space as the preview', () => {
  for (const kind of ['reply','additional','custom']) {
    const c = G.sample(kind === 'additional' ? 'additional' : 'reply');
    c.docType = kind; c.lawyers = G.clone(G.lawyerDefaults);
    const xml = G.documentXml(c, bundle);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(m => m[0]);
    const contacts = paragraphs.filter(p => /<w:t\b[^>]*>T\./.test(p));
    assert.equal(contacts.length, G.lawyerDefaults.length);
    for (const p of contacts) {
      assert.match(p, /<w:ind\b[^>]*w:right="-170"/);
      assert.match(p, /<w:rFonts\b[^>]*w:ascii="Times New Roman"/);
      assert.match(p, /<w:rFonts\b[^>]*w:hint="default"/);
      assert.match(p, /<w:ind\b[^>]*w:firstLineChars="0"/);
      assert.match(p, /<w:ind\b[^>]*w:firstLine="0"/);
      assert.doesNotMatch(p, /<w:ind\b[^>]*(?:w:leftChars|w:rightChars|w:hangingChars)=/);
      const text = p.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/)[1];
      assert.ok(text.includes('\u00a0'));
      assert.ok(!text.includes(' '), 'Word must not break the contact at ordinary spaces');
    }
    // Only 곽희율 (272.0pt > 270.65pt) gets the 양식's −0.4pt email run; 길성영 (266.7pt) stays as is.
    const condensed = contacts.filter(p => /<w:spacing w:val="-8"/.test(p));
    assert.equal(condensed.length, 1);
    assert.match(condensed[0], /T\.\u00a00000-6996\(직\)\/2992,\u00a0E\.\u00a0<\/w:t><\/w:r><w:r><w:rPr><w:rFonts [^>]*\/>(?:<w:spacing w:val="-8" \/>|<w:spacing w:val="-8"\/>)/);
    assert.match(condensed[0], />heeyul\.kwak\.@example\.com<\/w:t>/);
    fs.writeFileSync(path.join(out, 'word-contacts-' + kind + '.docx'), G.docx(c,bundle));
  }
  assert.deepEqual(G.contactParts(G.lawyerDefaults.find(l => l.name === '곽희율')), ['T. 0000-6996(직)/2992, E. ', 'heeyul.kwak.@example.com']);
  assert.equal(G.contactParts(G.lawyerDefaults.find(l => l.name === '길성영')).length, 1);
  const short = G.sample('reply');
  short.lawyers = G.clone(G.lawyerDefaults.filter(l => ['길성영','고지하','곽희율'].includes(l.name)));
  assert.equal(short.lawyers.length,3);
  fs.writeFileSync(path.join(out,'word-long-emails.docx'),G.docx(short,bundle));
});
// 2026-10-23: a cover filling page 1 exactly (고지하·곽희율·길성영, cover only) got an empty 2nd page in Word
// from the empty line after the last lawyer; the same applies to an empty line at the very end of the body.
check('no empty line after the last lawyer or at the end of the body', () => {
  const t = bundle.templates.reply.snippets;
  const before = (xml, at) => xml.slice(0, at);
  const cover = Object.assign(G.sample('reply'), {includeBody: false}), coverXml = G.documentXml(cover, bundle);
  assert.match(before(coverXml, coverXml.lastIndexOf('<w:sectPr')), /chaeyu\.ahn@example\.com<\/w:t><\/w:r><\/w:p>$/);
  const items = [{id: 'i1', level: 1, label: '1', text: '첫 요청입니다.', notes: []}];
  const body = Object.assign(G.sample('reply'), {includeBody: true, items}), bodyXml = G.documentXml(body, bundle);
  const cut = bodyXml.indexOf(t.sectionBreak);
  assert.match(before(bodyXml, cut), /chaeyu\.ahn@example\.com<\/w:t><\/w:r><\/w:p>$/, 'cover: section break right after the last lawyer');
  const end = before(bodyXml, bodyXml.lastIndexOf('<w:sectPr'));
  assert.ok(end.endsWith('<w:p/>') && !end.endsWith(t.blank + '<w:p/>' + t.blank), 'body ends with the answer line');
  assert.ok(!end.endsWith(t.blank));
});
check('automatic bodies allow missing request numbers and attachments in all types and citation styles', () => {
  for (const kind of ['reply','additional','custom']) {
    for (const style of ['bracket','guillemet']) {
      for (const hasNumber of [false,true]) for (const hasAttachments of [false,true]) {
        const c = G.sample(kind === 'additional' ? 'additional' : 'reply');
        c.docType = kind; c.citationStyle = style;
        if (!hasNumber) c.requestDocNo = '';
        if (!hasAttachments) c.attachments = [];
        assert.equal(c.bodyOverride,null);
        assert.deepEqual(G.validate(c).errors,[]);
        const body = G.bodyText(c);
        assert.equal(body.includes('문서번호:'),hasNumber);
        assert.equal(body.includes('첨부와 같이'),hasAttachments);
        assert.doesNotMatch(body,/\[문서번호\]|문서번호:\s*[\])]/);
        if (!hasNumber && !hasAttachments) fs.writeFileSync(path.join(out,`optional-${kind}.docx`),G.docx(c,bundle));
      }
    }
  }
});
check('attachment indentation begins at item two for both document types', () => {
  for (const kind of ['reply', 'additional']) {
    const c = G.sample(kind);
    c.attachments = Array.from({length: 3}, (_, i) => ({id:'attachment-' + i, text:'첨부자료' + (i + 1), copies:''}));
    const xml = G.documentXml(c, bundle);
    const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(m => m[0]);
    const attachments = paragraphs.filter(p => /첨부자료[123]/.test(p));
    assert.equal(attachments.length, 3);
    assert.doesNotMatch(attachments[0], /w:left="540"/);
    assert.match(attachments[0], /<w:tab w:val="left" w:pos="540"/);
    assert.match(attachments[0], /<w:tab\s*\/>/);
    for (const p of attachments.slice(1)) assert.match(p, /<w:ind w:left="540" w:firstLine="0" w:firstLineChars="0"/);
    assert.deepEqual(G.attachmentLines(c), ['첨부 1. 첨부자료1', '2. 첨부자료2', '3. 첨부자료3. 끝.']);
    fs.writeFileSync(path.join(out, 'attachments-' + kind + '.docx'), G.docx(c, bundle));
    c.attachments.pop(); c.attachments.pop();
    assert.deepEqual(G.attachmentLines(c), ['첨부: 첨부자료1. 끝.']);
    assert.doesNotMatch(G.documentXml(c, bundle), /w:left="540"/);
  }
});
check('manual paragraphs survive changed fields and are included in DOCX', () => {
  const c = G.sample('reply'); c.bodyOverride = '직접 수정한 본문입니다.\n두 번째 사용자 문단입니다.'; c.submitter = '새 의뢰인';
  assert.equal(G.bodyParagraphs(c).length, 2);
  assert.match(G.documentXml(c, bundle), /직접 수정한 본문입니다/);
  assert.doesNotMatch(G.documentXml(c, bundle), /가나다 주식회사/);
  fs.writeFileSync(path.join(out, 'manual.docx'), G.docx(c, bundle));
});
check('XML escaping preserves literal hostile-looking text', () => {
  const c = G.sample('reply'); c.title = 'A & B <검토> "제목"'; c.bodyOverride = '문자열 </w:t><w:p> & <script>는 텍스트입니다.';
  const xml = G.documentXml(c, bundle);
  assert.match(xml, /A &amp; B &lt;검토&gt;/);
  assert.match(xml, /&lt;\/w:t&gt;&lt;w:p&gt;/);
  fs.writeFileSync(path.join(out, 'escaped.docx'), G.docx(c, bundle));
});
check('invalid dates, placeholders, internal notes and incomplete lawyers are blocked', () => {
  for (const patch of [{sendDate: '2026-02-30'}, {requestDate: '2099-01-01'}, {bodyOverride: '2026. [*]. 제출'},
    {bodyOverride: 'Draft Note: 삭제 필요'}, {bodyOverride: ''}, {title: ''}, {lawyers: [{id:'x',name:'김',directPhone:'',subPhone:'',email:'bad'}]}]) {
    const c = Object.assign(G.sample('reply'), patch);
    assert.ok(G.validate(c).errors.length > 0);
    assert.throws(() => G.docx(c, bundle));
  }
  assert.equal(G.dateValid('2024-02-29'), true);
  assert.equal(G.dateValid('2023-02-29'), false);
});
check('case serialization preserves contact snapshots independently of master', () => {
  const c = G.sample('reply'), payload = G.caseFile(c), read = G.readCase(payload);
  c.lawyers[0].name = '변경된 이름';
  assert.equal(read.lawyers[0].name, '한라다');
  assert.deepEqual(read.lawyers, payload.data.lawyers);
  assert.equal(read.title, c.title);
  assert.throws(() => G.readCase({selectedLawyers:['l1']}), /호환되지/);
  assert.throws(() => G.readCase({...payload, version:99}), /버전/);
  assert.throws(() => G.readCase({...payload, data:{...payload.data, attachments:'bad'}}));
  assert.throws(() => G.readCase({...payload, data:{...payload.data, title:{}}}));
});
check('optional reference row is omitted and different counts are supported', () => {
  const c = G.sample('reply'); c.refDept = ''; c.attachments[0].copies = '3';
  assert.doesNotMatch(G.documentXml(c, bundle), /참  조:/);
  assert.match(G.documentXml(c, bundle), /일반현황자료제출 3부/);
  c.lawyers = [...G.clone(G.lawyerDefaults), {id:'test-long',name:'Alex Kim',directPhone:'02-0000-0000',subPhone:'',email:'alex@example.test'}];
  c.bodyOverride = ('길게 작성한 본문을 검토해 주시기 바랍니다. ').repeat(150);
  fs.writeFileSync(path.join(out, 'long.docx'), G.docx(c, bundle));
});
check('request extraction supports both supplied document number formats', () => {
  const r = G.extractRequest('2022. 12. 27. 자료제출 요구 기업집단정책과-000 기업집단국 기업집단정책과장\n2023-1-5 (사건처리)서비스업감시과-001');
  assert.deepEqual(r.dates, ['2022-12-27','2023-01-05']);
  assert.ok(r.numbers.includes('기업집단정책과-000'));
  assert.ok(r.numbers.includes('(사건처리)서비스업감시과-001'));
  assert.equal(r.refDept, '기업집단국 기업집단정책과장');
  assert.equal(G.search('ㅎㄹㄷ', '한라다'), true);
});
check('direct case with no underlying request or attachments is supported', () => {
  const c = G.sample('reply'); c.docType = 'custom'; c.title = '직접 작성한 공문'; c.bodyOverride = '관련하여 안내드립니다.'; c.requestDate = ''; c.requestDocNo = ''; c.attachments = [];
  assert.equal(G.validate(c).errors.length, 0);
  fs.writeFileSync(path.join(out, 'custom.docx'), G.docx(c, bundle));
});
check('master import rejects duplicate ids and malformed contacts', () => {
  assert.throws(() => G.readMaster(G.masterFile([G.lawyerDefaults[0], G.lawyerDefaults[0]])), /중복/);
  assert.throws(() => G.readMaster(G.masterFile([{...G.lawyerDefaults[0], email:'wrong'}])));
  assert.equal(G.readMaster(G.masterFile(G.lawyerDefaults)).length, G.lawyerDefaults.length);
});
check('updated directory preserves saved-case identity and contact snapshots', () => {
  const rada = G.lawyerDefaults.find(l => l.name === '한라다');
  assert.equal(rada.id, 'han.rada.old@example.com');
  assert.equal(rada.email, 'rada.han@example.com');
  const oldCase = G.caseFile(G.sample('reply'));
  oldCase.data.lawyers[0].email = 'han.rada.old@example.com';
  oldCase.data.lawyers[3].subPhone = '9737';
  const restored = G.readCase(oldCase);
  assert.equal(restored.lawyers[0].email, 'han.rada.old@example.com');
  assert.equal(restored.lawyers[3].subPhone, '9737');
  assert.equal(restored.lawyers[0].id, rada.id);
  assert.equal(G.sample('reply').lawyers[3].subPhone, '5545');
});
console.log(`${passed} engine checks passed; DOCX fixtures saved to build/verification.`);
