/* Pure document logic. No network, browser storage, external libraries or eval. */
(function (global) {
  'use strict';
  const FORMAT = 'gongmun-case';
  const VERSION = 2;
  const agencyDefaults = [
    {name: '공정거래위원회', honorific: '위원회'},
    {name: '금융위원회', honorific: '위원회'},
    {name: '금융감독원', honorific: '원'},
    {name: '국세청', honorific: '청'},
    {name: '개인정보보호위원회', honorific: '위원회'},
    {name: '기타 기관', honorific: '기관'}
  ];
  // The firm profile (name, lawyer list) comes from firm/firm.json: inlined by scripts/build.py, read directly under Node.
  const FIRM = global.GONGMUN_FIRM || (typeof require === 'function' ? require('../firm/firm.json') : null);
  if (!FIRM) throw new Error('firm profile (firm/firm.json) missing');
  const contact = ([name, directPhone, subPhone, email, id = email]) => ({id, name, directPhone, subPhone, email});
  // The firm's lawyer list in signing order. A fifth value keeps an earlier ID so saved cases still recognize the person.
  const lawyerDefaults = FIRM.lawyers.map(contact);
  // The lawyers on the two example covers (some are no longer on the list above).
  const sampleLawyers = FIRM.sampleLawyers.map(contact);
  const departments = ['시장감시국 서비스업감시과장', '기업집단국 기업집단정책과장'];
  const requestNames = ['자료제출 요청', '자료제출 요구', '소명자료 제출요구', '자료제출 명령', '추가 자료제출 요청'];
  const titles = {reply: '자료제출 요구에 대한 회신', additional: '추가 설명자료 제출', custom: '', opinion: '심사보고서에 대한 의견서 제출',
    extension: '자료제출 기한 연장신청'};
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => global.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function dateValid(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s && +s.slice(0, 4) >= 1900;
  }
  function formatDate(s, signature = false) {
    if (!dateValid(s)) return '';
    const [y, m, d] = s.split('-').map(Number);
    return signature ? `${y}.  ${m}.  ${d}.` : `${y}. ${m}. ${d}.`;
  }
  // ‘2026. 1. 9.(금)’, as the 연장신청 samples write a deadline.
  const formatDay = s => dateValid(s) ? `${formatDate(s)}(${'일월화수목금토'[new Date(s + 'T12:00:00Z').getUTCDay()]})` : '';
  const addDays = (s, n) => {
    if (!dateValid(s)) return '';
    const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // 관리번호 ‘26-*’: two-digit year of the sending date; ‘*’ is the number still to be filled in.
  const firmRefFor = date => `${(dateValid(date) ? date : today()).slice(2, 4)}-*`;
  const autoFirmRef = s => /^\d{2}-\*$/.test(s);
  function particle(text, pair = ['은', '는']) {
    // A trailing parenthesis describes the noun; ‘동일인(홍길동)은’ agrees with 동일인.
    let noun = text.trim(), previous;
    do {previous = noun; noun = noun.replace(/(?:\([^()]*\)|（[^（）]*）)\s*$/, '').trim();} while (noun !== previous);
    const tail = (noun || text).trim().replace(/[)）\]」』"'\s]+$/g, '').slice(-1);
    const c = tail.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? pair[0] : pair[1];
    if (/\d/.test(tail)) return '013678'.includes(tail) ? pair[0] : pair[1];
    // Latin abbreviations have ambiguous pronunciation; the generated sentence stays editable.
    return pair[1];
  }
  const spaceName = name => /^[가-힣]{2}$/.test(name) ? [...name].join('      ') : /^[가-힣]{3}$/.test(name) ? [...name].join('  ') : name;
  const contactText = l => `T. ${l.directPhone}(직)${l.subPhone ? '/' + l.subPhone : ''}, E. ${l.email}`;
  const wordContactText = l => contactText(l).replace(/ /g, '\u00a0');
  // Times New Roman 12pt advance widths (1/1000 em); 직 and other non-ASCII are full width.
  const TNR = {' ': 250, '(': 333, ')': 333, ',': 250, '-': 333, '.': 250, '/': 278, '@': 921, '_': 500, E: 611, T: 611,
    a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500,
    o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444};
  const contactWidth = text => [...text].reduce((w, ch) => w + (/\d/.test(ch) ? 500 : TNR[ch] ?? (ch < '\u0080' ? 722 : 1000)) * 0.012, 0);
  // A contact wider than the cover's 270.65pt (67.5mm indent) gets the 양식's fix for long addresses: the email at −0.4pt spacing.
  const contactParts = l => contactWidth(contactText(l)) > 270.65 && l.email ? [contactText(l).slice(0, -l.email.length), l.email] : [contactText(l)];
  const wordContactParts = l => contactParts(l).map((s, i) => i ? s : s.replace(/ /g, '\u00a0'));
  function newCase() {
    return {docType: 'reply', caseLabel: '', sendDate: today(), firmRef: firmRefFor(today()), agencyName: '공정거래위원회',
      honorific: '위원회', refDept: '', submitter: '', shortName: '', agentOverride: '', requestDate: '', requestDocNo: '',
      requestTitle: '자료제출 요구', requestName: '', citationStyle: 'bracket', subjectFirst: true, partialReply: false,
      title: titles.reply, customVerb: '회신하오니', greetingOverride: null, bodyOverride: null, attachments: [], lawyers: [],
      includeBody: true, bodyTitleOverride: null, labelMode: 'auto', includeNotes: true, items: [], refMaterials: [],
      caseNo: '', caseName: '', partyRole: '피심인', confidentialNote: '',
      extBasis: 'data', extOrigDeadline: '', extPrev: false, extPrevDocNo: '', extPrevDeadline: '', extWeeks: '', extDeadline: '',
      extScope: '', extReason: null};
  }
  // Fields added with the 심사보고서 의견서 type and the 제출기한 연장신청 type; older case files do not have them.
  const opinionFields = ['caseNo', 'caseName', 'partyRole', 'confidentialNote'];
  const extensionFields = ['extBasis', 'extOrigDeadline', 'extPrevDocNo', 'extPrevDeadline', 'extWeeks', 'extDeadline', 'extScope'];
  const companyShort = s => String(s || '').trim().replace(/^(?:주식회사|유한회사|㈜|\(주\))\s*|\s*(?:주식회사|유한회사|㈜|\(주\))$/g, '');
  // ‘주식회사 가나다 대리인’ (2026 의견서) / ‘가나다 주식회사의 대리인’ (회신) / ‘가나다의 대리인’ (연장신청: 약칭).
  const agentName = c => c.agentOverride || (c.docType === 'extension' && c.shortName.trim()) || c.submitter;
  const agentLine = c => agentName(c) + (c.docType === 'opinion' ? ' 대리인' : '의 대리인');
  // 2026 의견서 본문 뼈대: the common opening, a slot for the case's own arguments, and the conclusion.
  function opinionItems(c) {
    const role = c.partyRole || '피심인', who = companyShort(c.submitter) || role;
    return [[1, `심사보고서 및 ${role} 의견 요지`], [2, '심사보고서 요지'], [2, `${who} 의견 요지`], [1, '[의견 제목]'], [1, '결론']]
      .map(([level, text]) => ({id: uid(), level, label: '', text, notes: []}));
  }
  // The 감면 의견서 sample asks, above the body, that the opinion be used only for the Commission's review.
  const confidentialDefault = c => `${companyShort(c.submitter) || '[회사]'} 의견서가 수사기관 등 제3자에게 제공되면 관련 형사절차에서 방어권 행사에 지장이 생길 수 있으므로, 이 의견서와 소을호증은 귀 위원회의 심의 목적으로만 사용하여 주시기를 요청드립니다.`;
  // ‘자료제출 요청[문서번호: …]과’, ‘「… 요구」(문서번호: …)와’: the particle follows the request name.
  function generatedBody(c) {
    const s = c.submitter || '[제출 주체]', short = (c.shortName || '').trim();
    const honor = c.honorific || '기관';
    if (c.docType === 'extension') return extensionParagraphs(c).join('\n');
    if (c.docType === 'opinion') {
      // 귀 위원회의 「사건명」(사건번호)과 관련하여, 피심인 ○○는 첨부와 같이 심사보고서에 대한 의견서를 제출합니다.
      const name = c.caseName.trim() || '[사건명]', no = c.caseNo.trim(), named = short ? `${s}(이하 “${short}”)` : s;
      return `귀 ${honor}의 「${name}」${no ? `(${no})` : ''}${particle(name, ['과', '와'])} 관련하여, ${c.partyRole || '피심인'} ${named}${particle(named)} ` +
        `${c.attachments.length ? '첨부와 같이 ' : ''}심사보고서에 대한 의견서를 제출합니다.`;
    }
    const dt = formatDate(c.requestDate) || '[요구일자]';
    const doc = c.requestDocNo.trim();
    const guillemet = c.citationStyle === 'guillemet';
    const rt = (guillemet ? c.requestTitle : c.requestName || c.requestTitle) || '자료제출 요구';
    const verb = c.docType === 'additional' ? '추가 설명자료를 제출하오니' : c.docType === 'custom' ? c.customVerb :
      c.partialReply ? '일부 회신하오니' : '회신하오니';
    const named = short ? `${s}(이하 “${short}”)` : s, actor = short || s;
    const lead = guillemet || c.subjectFirst ? `${named}에 대한 ` : '';
    const cited = guillemet ? `「${rt}」${doc ? `(문서번호: ${doc})` : ''}` : `${rt}${doc ? `[문서번호: ${doc}]` : ''}`;
    const subject = lead ? actor : named;
    return `${lead}귀 ${honor}의 ${dt}자 ${cited}${particle(rt, ['과', '와'])} 관련하여, ${subject}${particle(subject)} ` +
      `${c.attachments.length ? '첨부와 같이 ' : ''}${verb} 검토하여 주시기 바랍니다.`;
  }
  /* ---------- 제출기한 연장신청 (공문만, 본문 없음) ----------
     2. 원 요청(언제까지 무엇을), 3. 연장 사유, 4. 연장 기한. 자료제출 요구와 심사보고서 의견서는
     각각 변호사님이 보내 주신 연장신청 샘플의 문장을 따른다. */
  const extTitle = c => c.extBasis === 'opinion' ? '심사보고서에 대한 의견서 제출기한 연장신청' :
    c.requestName.trim() || c.requestTitle.trim() && c.requestTitle.trim() !== '자료제출 요구' ? `${c.requestName.trim() || c.requestTitle.trim()} 관련 자료제출 기한 연장신청` : titles.extension;
  // The deadline being extended: the one granted by an earlier extension, else the request's own.
  const extBase = c => c.extPrev && dateValid(c.extPrevDeadline) ? c.extPrevDeadline : c.extOrigDeadline;
  const extActor = c => (c.shortName || '').trim() || c.submitter || '[제출 주체]';
  const extReasonDefault = c => {
    const actor = extActor(c);
    return `현재 ${actor}${particle(actor)} 최선을 다하여 신속하게 ${c.extBasis === 'opinion' ? '의견서를' : '제출 자료를'} 준비 중에 있으나, ` +
      '구체적인 사실관계를 확인하고 관련 자료를 정리하는 데 추가적인 시간이 필요한 상황입니다.';
  };
  const extReasonText = c => c.extReason !== null && c.extReason !== undefined ? c.extReason : extReasonDefault(c);
  function extensionParagraphs(c) {
    const s = c.submitter || '[제출 주체]', short = (c.shortName || '').trim(), named = short ? `${s}(이하 “${short}”)` : s;
    const honor = c.honorific || '기관', actor = extActor(c), opinion = c.extBasis === 'opinion';
    const due = formatDay(c.extOrigDeadline) || '[제출기한]', doc = c.requestDocNo.trim();
    const prev = c.extPrev ? `${opinion ? '의견서 제출기한' : '자료제출 기한'} 연장신청에 대한 회신${c.extPrevDocNo.trim() ? `(문서번호: ${c.extPrevDocNo.trim()})` : ''}을 통해 ` +
      `${formatDay(c.extPrevDeadline) || '[연장된 기한]'}까지 제출기한을 한 차례 연장해 주신 바 있습니다.` : '';
    let request;
    if (opinion) {
      const name = c.caseName.trim() || '[사건명]', no = c.caseNo.trim(), cite = doc ? `[문서번호: ${doc}]` : '';
      request = `「${name}」${no ? `(사건번호: ${no})` : ''}${particle(name, ['과', '와'])} 관련하여, 귀 ${honor}${particle(honor)} ${named}에게 ` +
        `심사보고서를 송부하면서 ${due}까지 심사보고서에 대한 의견서를 제출할 것을 요구하였${prev ? `고${cite}, ${prev}` : `습니다${cite}.`}`;
    } else {
      const dt = formatDate(c.requestDate) || '[요구일자]', guillemet = c.citationStyle === 'guillemet';
      const rt = (guillemet ? c.requestTitle : c.requestName || c.requestTitle) || '자료제출 요구';
      const cited = guillemet ? `「${rt}」${doc ? `(문서번호: ${doc})` : ''}` : `${rt}${doc ? `[문서번호: ${doc}]` : ''}`;
      request = `귀 ${honor}의 ${dt}자 ${cited}${particle(rt, ['과', '와'])} 관련하여, 귀 ${honor}${particle(honor)} ${named}에게 ` +
        `${due}까지 자료제출을 요청하였${prev ? `고, ${prev}` : '습니다.'}`;
    }
    const scope = c.extScope.trim() ? `${c.extScope.trim()}의 ` : '', until = formatDay(c.extDeadline) || '[연장 기한]';
    // ‘끝.’ closes the last paragraph unless a 첨부 line follows (it carries the ‘끝.’ then).
    const end = c.attachments.length ? '' : ' 끝.';
    const ask = opinion ?
      `이에 ${actor}${particle(actor)} ${scope}심사보고서에 대한 의견서 제출기한을 ${until}까지 연장하여 주실 것을 간곡히 요청드리오니, 이를 허여하여 주시기 바랍니다.${end}` :
      `이에 ${actor}${particle(actor)} ${scope}자료제출 기한을 ${until}까지로 연장하여 주실 것을 신청하오니 이를 허여하여 주시기 바랍니다.${end}`;
    const reasons = extReasonText(c).split(/\r?\n/).map(t => t.trim()).filter(Boolean);
    return [request, ...reasons, ask];
  }
  const bodyText = c => c.bodyOverride !== null ? c.bodyOverride : generatedBody(c);
  /* ---------- 첨부 본문 (요청사항 목록) ---------- */
  const hangul = '가나다라마바사아자차카타파하';
  const bodyTitle = c => (c.bodyTitleOverride !== null && c.bodyTitleOverride !== undefined ? c.bodyTitleOverride :
    c.docType === 'opinion' ? '심사보고서에 대한 의견서' : c.attachments[0]?.text || c.title || '').trim();
  // 의견서: 겉표지·목차·본문 양식 / 회신: 요청사항 양식.
  const hasBody = c => c.docType !== 'extension' && !!(c.includeBody && (c.docType === 'opinion' || c.items.length || c.refMaterials.length));
  function labelsShown(c) {
    if (c.docType === 'opinion') return false;
    if (c.labelMode === 'on') return true;
    if (c.labelMode === 'off') return false;
    let top = 0;
    return c.items.some(it => it.level === 1 && String(it.label || '') !== String(++top));
  }
  const roman = n => [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']].reduce((out, [v, r]) => {while (n >= v) {out += r; n -= v;} return out;}, '');
  // Word numbers the headings itself (1. / 가., or I. / 1. in a 의견서); this mirrors it for the preview and text copy.
  function numberedItems(c) {
    if (c.docType === 'opinion') {
      let top = 0, sub = 0;
      return c.items.map(it => {
        if (it.level === 1) {top++; sub = 0;} else sub++;
        return {...it, number: it.level === 1 ? `${roman(top)}.` : `${sub}.`, heading: it.text.trim(), notes: []};
      }).map((it, i, all) => ({...it, parent: it.level === 1 && all[i + 1]?.level === 2}));
    }
    const show = labelsShown(c);
    let top = 0, sub = 0, parent = '';
    return c.items.map(it => {
      let number;
      if (it.level === 1) {top++; sub = 0; number = `${top}.`; parent = String(it.label || top);}
      else {sub++; number = `${hangul[(sub - 1) % 14]}.`;}
      const raw = String(it.label || (it.level === 1 ? top : hangul[(sub - 1) % 14])).trim();
      const label = it.level === 1 || /[-.]/.test(raw) ? raw : `${parent}-${raw}`;
      const heading = (show ? `[요청사항 ${label}] ` : '') + it.text.trim();
      return {...it, number, heading, notes: c.includeNotes ? it.notes.map(n => n.trim()).filter(Boolean) : []};
    }).map((it, i, all) => ({...it, parent: it.level === 1 && all[i + 1]?.level === 2}));
  }
  function refLines(c) {
    return c.refMaterials.filter(r => (r.no || '').trim() || (r.text || '').trim())
      .map((r, i) => ({lead: c.docType === 'opinion' ? `${i + 1}. 소을 제${(r.no || '').trim() || i + 1}호증` : `${i + 1}. 참고자료 ${(r.no || '').trim()}`.trim(), text: (r.text || '').trim()}));
  }
  const greetingText = c => c.greetingOverride !== null ? c.greetingOverride : `귀 ${c.honorific || '기관'}의 무궁한 발전을 기원합니다.`;
  const bodyParagraphs = c => bodyText(c).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  function attachmentLines(c) {
    if (!c.attachments.length) return [];
    const label = a => a.text + (a.copies ? ` ${a.copies}부` : '');
    if (c.attachments.length === 1) return [`첨부: ${label(c.attachments[0])}. 끝.`];
    return c.attachments.map((a, i) => `${i ? '' : '첨부 '}${i + 1}. ${label(a)}${i === c.attachments.length - 1 ? '. 끝.' : ''}`);
  }
  function sample(kind) {
    const c = newCase();
    if (kind === 'additional') {
      // The two examples are made up (company, person, document number, dates), laid out like the firm's covers: no case is to
      // be recognized from the program (2026-11-02).
      Object.assign(c, {docType: 'additional', caseLabel: '가나다 추가 설명자료', sendDate: '2025-12-15',
        refDept: departments[1], title: titles.additional, submitter: '기업집단 가나다의 동일인(홍길동)',
        agentOverride: '기업집단 가나다 동일인(홍길동)', requestDate: '2025-12-01', requestDocNo: '기업집단정책과-000',
        citationStyle: 'guillemet', attachments: [{id: uid(), text: '추가 설명자료', copies: '1'}],
        lawyers: clone(sampleLawyers.slice(4, 8))});
    } else {
      // The 약칭 shows ‘(이하 “가나다”)’ and its quote marks (2026-10-30, as asked).
      Object.assign(c, {caseLabel: '가나다 자료제출 회신', sendDate: '2026-01-12', refDept: departments[0], subjectFirst: false,
        submitter: '가나다 주식회사', shortName: '가나다', requestDate: '2026-01-05', requestDocNo: '(사건처리)서비스감시과-000',
        attachments: [{id: uid(), text: '일반현황자료제출', copies: ''}, {id: uid(), text: '요구자료 내용', copies: ''}],
        lawyers: clone(sampleLawyers.slice(0, 4))});
    }
    c.firmRef = firmRefFor(c.sendDate);
    return c;
  }
  function validate(c) {
    const errors = [], warnings = [];
    const error = (field, text) => errors.push({field, text});
    if (!dateValid(c.sendDate)) error('sendDate', '발신일자를 정확하게 입력해 주세요.');
    for (const [field, label] of [['agencyName', '수신 기관'], ['title', '제목'], ['submitter', '제출 주체']]) {
      if (!c[field].trim()) error(field, `${label}를 입력해 주세요.`);
    }
    if (!greetingText(c).trim()) error('greeting', '첫 문단이 비어 있습니다.');
    if (!bodyParagraphs(c).length) error('body', '본문을 입력해 주세요.');
    const opinion = c.docType === 'opinion', ext = c.docType === 'extension';
    if (ext && !['data', 'opinion'].includes(c.extBasis)) error('extBasis', '원 요청의 종류를 선택해 주세요.');
    if (ext && c.bodyOverride === null) {
      const base = extBase(c);
      if (!dateValid(c.extOrigDeadline)) error('extOrigDeadline', '원 요청의 제출기한을 입력해 주세요.');
      if (c.extPrev && !dateValid(c.extPrevDeadline)) error('extPrevDeadline', '앞서 연장받은 기한을 입력해 주세요.');
      if (!dateValid(c.extDeadline)) error('extDeadline', '연장 기한을 정해 주세요. 연장 기간(1~4주)을 누르거나 날짜를 고르세요.');
      else if (dateValid(base) && c.extDeadline <= base) error('extDeadline', `연장 기한은 지금 제출기한(${formatDay(base)})보다 뒤여야 합니다.`);
      if (c.extPrev && dateValid(c.extPrevDeadline) && dateValid(c.extOrigDeadline) && c.extPrevDeadline <= c.extOrigDeadline) error('extPrevDeadline', '앞서 연장받은 기한이 원 제출기한보다 뒤여야 합니다.');
      if (!extReasonText(c).trim()) error('extReason', '연장 사유를 입력해 주세요.');
      const day = dateValid(c.extDeadline) ? new Date(c.extDeadline + 'T12:00:00Z').getUTCDay() : -1;
      if (day === 0 || day === 6) warnings.push(`연장 기한 ${formatDay(c.extDeadline)}은 ${day ? '토' : '일'}요일입니다. 평일로 바꿀지 확인해 주세요. 공휴일은 따로 확인하지 않습니다.`);
      if (dateValid(base) && dateValid(c.sendDate) && c.sendDate > base) warnings.push(`발신일자(${formatDate(c.sendDate)})가 지금 제출기한(${formatDay(base)})보다 늦습니다. 기한 전에 보내는지 확인해 주세요.`);
    }
    if (opinion || ext && c.extBasis === 'opinion') {
      if (!c.caseName.trim()) error('caseName', '사건명을 입력해 주세요.');
      // A 감면 공문 masks the applicant (*****): the name must be filled in before saving.
      const masked = [['submitter', c.submitter], ['caseName', c.caseName], ['agentOverride', c.agentOverride]].find(([, v]) => /\*{3,}/.test(v));
      if (masked) error(masked[0], '공문에 가려진 이름(*****)이 남아 있습니다. 회사 이름을 넣거나 심사보고서를 올려 주세요.');
      if (!['피심인', '신청인'].includes(c.partyRole)) error('partyRole', '피심인 또는 신청인을 선택해 주세요.');
    } else if (c.bodyOverride === null) {
      if (!dateValid(c.requestDate)) error('requestDate', '요구일자를 정확하게 입력해 주세요.');
      if (!c.requestTitle.trim()) error('requestTitle', '원 요청 문서명을 입력해 주세요.');
      if (c.docType === 'custom' && !c.customVerb.trim()) error('customVerb', '본문 동사구를 입력하거나 본문을 직접 수정해 주세요.');
    }
    if (dateValid(c.requestDate) && dateValid(c.sendDate) && c.requestDate > c.sendDate) {
      error('requestDate', '요구일자가 발신일자보다 늦습니다.');
    }
    if (!c.lawyers.length) error('lawyers', '담당변호사를 한 명 이상 선택해 주세요.');
    c.lawyers.forEach((l, i) => {
      if (!l.name.trim() || !l.directPhone.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) {
        error('lawyers', `${i + 1}번째 변호사의 이름·직통번호·이메일을 확인해 주세요.`);
      }
    });
    c.attachments.forEach((a, i) => {
      if (!a.text.trim()) error('attachments', `${i + 1}번째 첨부 항목의 이름이 비어 있습니다.`);
      if (a.copies && !/^[1-9]\d{0,3}$/.test(a.copies)) error('attachments', '첨부 부수는 1~9999의 정수 또는 빈칸이어야 합니다.');
    });
    const content = [c.agencyName, c.refDept, c.title, c.submitter, c.agentOverride, c.firmRef, c.caseNo, c.caseName, c.confidentialNote,
      greetingText(c), bodyText(c), ...c.attachments.map(a => a.text), ...c.lawyers.flatMap(l => [l.name, l.email, l.directPhone, l.subPhone])].join('\n');
    if (/\[\s*\*\s*\]|\[202\*\]|\[(?:제출\s*주체|요구일자|문서번호|사건명|회사|제출기한|연장\s*기한|연장된\s*기한)\]|\{\{.+?\}\}/.test(content)) {
      error('body', '문서에 미완성 표시가 남아 있습니다. [*] 등의 표시를 수정해 주세요.');
    }
    if (FIRM.noteMarker && new RegExp(FIRM.noteMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*'), 'i').test(content)) error('body', `문서에 내부 메모(${FIRM.noteMarker})가 남아 있습니다.`);
    if (hasBody(c)) {
      c.items.forEach((it, i) => {if (!it.text.trim()) error('items', opinion ? `본문 뼈대의 ${i + 1}번째 제목이 비어 있습니다.` : `${i + 1}번째 요청사항의 내용이 비어 있습니다.`);});
      if (c.items.length && c.items[0].level !== 1) error('items', opinion ? '본문 뼈대의 첫 제목은 큰 제목(I.)이어야 합니다.' : '첫 요청사항은 한 단계 위(1.) 항목이어야 합니다.');
      const bodyContent = [bodyTitle(c), ...c.items.flatMap(it => [it.label, it.text, ...it.notes]), ...c.refMaterials.flatMap(r => [r.no, r.text])].join('\n');
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bodyContent)) error('items', '요청사항에 저장할 수 없는 제어 문자가 있습니다.');
      if (/\{\{.+?\}\}/.test(bodyContent)) error('items', '요청사항에 미완성 표시가 남아 있습니다.');
      if (!bodyTitle(c)) error('items', '첨부 본문의 제목이 비어 있습니다. 첨부 항목 또는 본문 제목을 입력해 주세요.');
    }
    if (hasBody(c) && !c.attachments.length) warnings.push('첨부 본문을 함께 저장하지만 표지에 ‘첨부’ 줄이 없습니다. 첨부 자료에 항목(예: 회신 제목 1부)을 추가해 주세요.');
    if (opinion && !c.caseNo.trim()) warnings.push('사건번호가 비어 있습니다. 공문의 사건번호를 확인해 주세요.');
    if (opinion && hasBody(c) && c.items.some(it => /\[의견 제목\]/.test(it.text))) warnings.push('본문 뼈대의 ‘[의견 제목]’은 Word에서 실제 의견 제목으로 바꿔 주세요.');
    if (c.includeBody && !c.items.length && !c.refMaterials.length && c.docType === 'reply') warnings.push('요청사항이 없어 표지만 저장합니다. 요청사항 목록을 올리면 첨부 본문 양식도 함께 만듭니다.');
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) error('body', '붙여넣은 내용에 저장할 수 없는 제어 문자가 있습니다.');
    if (!c.refDept.trim()) warnings.push('참조 부서가 비어 있습니다. 필요하다면 입력해 주세요.');
    if (c.bodyOverride !== null) warnings.push('직접 수정한 본문입니다. 기본 정보를 변경해도 본문은 자동으로 바뀌지 않습니다.');
    if (c.greetingOverride !== null) warnings.push('첫 문단을 직접 수정했습니다. 기관 호칭 변경 시 함께 확인해 주세요.');
    if (c.lawyers.length > 4 || bodyText(c).length > 350) warnings.push('표지 내용이 길어 여러 페이지가 될 수 있습니다. 저장 후 Word에서 배치를 확인해 주세요.');
    return {errors, warnings};
  }
  const escapeXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  // Quotes typed in the browser stay straight ("), while Word turns them into “ ” ‘ ’ as they are typed; the firm's documents use these.
  // Opening after the start, a space, an opening bracket or quote; closing (and apostrophe) elsewhere. A shortened year (’26.3.19.)
  // takes the apostrophe, as in the firm's replies.
  const smartQuotes = s => String(s).replace(/(^|[\s\p{Ps}\p{Pi}<])"/gu, '$1“').replace(/"/g, '”')
    .replace(/'(?=\d\d(?!\d))/g, '’').replace(/(^|[\s\p{Ps}\p{Pi}<])'/gu, '$1‘').replace(/'/g, '’');
  // In the firm's documents the quote marks sit in runs of their own without the East Asian hint, so Word sets them in Times New
  // Roman like the Latin text; inside our template runs (hint eastAsia) Word would take 바탕's larger marks.
  const quoteRuns = xml => xml.replace(/<w:r(\s[^>]*)?>(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)<w:t(?:\s[^>]*)?>([^<]*[“”‘’][^<]*)<\/w:t><\/w:r>/g,
    (m, attrs = '', rPr, text) => {
      if (!/w:hint="eastAsia"/.test(rPr)) return m;
      const plain = rPr.replace(/\s*w:hint="eastAsia"/, '').replace(/<w:rFonts\s*\/>/, '');
      return text.split(/([“”‘’]+)/).filter(Boolean)
        .map(part => `<w:r${attrs}>${/^[“”‘’]+$/.test(part) ? plain : rPr}<w:t xml:space="preserve">${part}</w:t></w:r>`).join('');
    });
  const wordText = s => escapeXml(smartQuotes(s));
  function fill(xml, values) {
    // One pass: user-entered braces cannot be interpreted as subsequent template slots.
    return xml.replace(/\{\{(\w+)\}\}/g, (m, key) => key in values ? wordText(values[key]) : m);
  }
  function documentXml(c, bundle) {
    const t = bundle.templates[c.docType === 'additional' ? 'additional' : 'reply'].snippets;
    const block = (template, text) => fill(template, {text});
    const contactXml = l => {
      const [text, email] = wordContactParts(l);
      return email ? fill(t.lawyerContactCondensed, {text, email}) : block(t.lawyerContact, text);
    };
    const body = hasBody(c);
    // No empty line after the last lawyer: on a full page it spilled over and left an empty 2nd page.
    const lawyers = c.lawyers.map((l, i) => block(t.lawyerName, '담당변호사   ' + spaceName(l.name)) +
      contactXml(l) + (i === c.lawyers.length - 1 ? '' : t.lawyerSpacer)).join('');
    const dynamic = {
      refRow: c.refDept.trim() ? fill(t.refRow, {refDept: c.refDept}) : '',
      // The three 연장신청 samples leave an empty cover line between every numbered paragraph.
      bodyParagraphs: bodyParagraphs(c).map(p => block(t.bodyParagraph, p)).join(c.docType === 'extension' ? t.lawyerSpacer : ''),
      attachments: attachmentLines(c).map((p, i) => i ? block(t.attachmentContinuation, p) :
        c.attachments.length > 1 ? block(t.attachmentFirst, p.slice(3)) : block(c.docType === 'opinion' && t.opinionAttachment || t.attachment, p)).join(''),
      lawyers,
      // ‘26-*’ → ‘26-’ plus a yellow ‘*’, as in the lawyers' replies.
      firmRef: c.firmRef.split(/(\*+)/).filter(Boolean).map(s => block(s[0] === '*' ? t.firmRefMark : t.firmRefRun, s)).join(''),
      ending: body ? t.sectionBreak + bodyXml(c, t) + t.bodySectPr : t.coverSectPr
    };
    const values = {sendDate: formatDate(c.sendDate), agency: c.agencyName, refDept: c.refDept,
      title: c.title, greeting: greetingText(c), agent: agentLine(c)};
    return quoteRuns(t.document.replace(/\{\{(\w+)\}\}/g, (m, key) => key in dynamic ? dynamic[key] : key in values ? wordText(values[key]) : m));
  }
  function bodyXml(c, t) {
    const block = (template, text) => fill(template, {text});
    const opinion = c.docType === 'opinion', items = numberedItems(c);
    const parts = [t.bodyMarker, block(t.bodyTitle, bodyTitle(c)), t.blank];
    if (opinion) {
      // 겉표지 (own section: letterhead, no page number) → 목차 (Word TOC, i, ii …) → 본문 (1, 2 …), as in the 2026 의견서.
      parts.splice(0, parts.length,
        fill(t.opinionCover, {caseName: c.caseName.trim(), caseNo: c.caseNo.trim() ? `(사건번호: ${c.caseNo.trim()})` : '', party: `${c.partyRole} ${c.submitter}`}),
        t.opinionCoverBreak, t.tocTitle, t.tocBegin,
        ...items.map(it => fill(it.level === 1 ? t.tocEntry1 : t.tocEntry2, {number: it.number, text: it.heading})), t.tocEnd, t.tocBreak, t.blank);
      if (c.confidentialNote.trim()) parts.push(block(t.confidentialBox, c.confidentialNote.trim()), t.blank);
      parts.push(block(t.opinionTitle, bodyTitle(c)), t.blank);
    }
    items.forEach(it => {
      // 회신: 1. / 가. (heading 2·3), 의견서: I. / 1. (heading 1·2).
      parts.push(block(it.level === 1 ? (opinion ? t.opinionHeading1 : t.heading1) : opinion ? t.heading1 : t.heading2, it.heading));
      it.notes.forEach(n => parts.push(block(it.level === 1 ? t.note1 : t.note2, n)));
      // A heading whose answers belong to its 가./나. items gets one spacer, not an answer line.
      parts.push(...(it.parent ? [t.blank] : [t.blank, t.answer, t.blank]));
    });
    const refs = refLines(c);
    if (refs.length) {
      // 첨부서류 starts on a new page (manual page break), as the lawyers lay it out. The break takes the place
      // of the last spacer, so it does not add a line that could spill over and leave an empty page.
      if (parts[parts.length - 1] === t.blank) parts.pop();
      parts.push(t.pageBreak, t.refHeading, t.blank);
      refs.forEach(r => parts.push(fill(t.refMaterialRow, {lead: r.lead, text: r.text})));
    } else if (parts[parts.length - 1] === t.blank) parts.pop();  // nor an empty line at the very end
    return parts.join('');
  }
  const crcTable = Array.from({length: 256}, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(data) {
    let crc = 0xffffffff;
    for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zipStore(entries) {
    const encode = new TextEncoder();
    const locals = [], centrals = [];
    let offset = 0, centralLength = 0;
    const now = new Date(), year = Math.max(1980, now.getFullYear());
    const time = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
    const date = (year - 1980) << 9 | (now.getMonth() + 1) << 5 | now.getDate();
    entries.forEach(([name, data]) => {
      const n = encode.encode(name), bytes = typeof data === 'string' ? encode.encode(data) : data;
      const crc = crc32(bytes), header = new Uint8Array(30 + n.length), v = new DataView(header.buffer);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x800, true);
      v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true);
      v.setUint32(18, bytes.length, true); v.setUint32(22, bytes.length, true); v.setUint16(26, n.length, true);
      header.set(n, 30); locals.push(header, bytes);
      const central = new Uint8Array(46 + n.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true);
      cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, n.length, true);
      cv.setUint32(42, offset, true); central.set(n, 46); centrals.push(central);
      offset += header.length + bytes.length; centralLength += central.length;
    });
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralLength, true); ev.setUint32(16, offset, true);
    const all = [...locals, ...centrals, end], out = new Uint8Array(offset + centralLength + end.length);
    let pos = 0;
    all.forEach(a => {out.set(a, pos); pos += a.length;});
    return out;
  }
  const fromBase64 = s => Uint8Array.from(global.atob(s), ch => ch.charCodeAt(0));
  function docx(c, bundle) {
    const {errors} = validate(c);
    if (errors.length) throw new Error(errors.map(e => e.text).join('\n'));
    const t = bundle.templates[c.docType === 'additional' ? 'additional' : 'reply'];
    const entries = Object.entries(t.parts).map(([n, v]) => [n, fromBase64(v)]);
    entries.push(['word/document.xml', documentXml(c, bundle)]);
    const stamp = new Date().toISOString();
    entries.push(['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(c.title)}</dc:title><dc:creator>${escapeXml(FIRM.name)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`]);
    return zipStore(entries);
  }
  function caseFile(c) {return {format: FORMAT, version: VERSION, savedAt: new Date().toISOString(), data: clone(c)};}
  const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);
  function readString(v, name, max = 20000) {
    if (typeof v !== 'string' || v.length > max) throw new Error(`${name} 항목의 형식 또는 길이가 올바르지 않습니다.`);
    return v;
  }
  function readLawyer(x) {
    if (!isObject(x)) throw new Error('변호사 정보 형식이 올바르지 않습니다.');
    return Object.fromEntries(['id', 'name', 'directPhone', 'subPhone', 'email'].map(k => [k, readString(x[k], '변호사 ' + k, 300)]));
  }
  function readCase(payload) {
    if (!isObject(payload) || payload.format !== FORMAT) throw new Error('이 프로그램에서 저장한 사건 파일을 선택해 주세요. Harvey 프로토타입의 사건 파일은 호환되지 않습니다.');
    if (payload.version !== 1 && payload.version !== VERSION) throw new Error('이 사건 파일의 버전은 지원하지 않습니다.');
    const d = payload.data;
    if (!isObject(d) || !['reply', 'additional', 'custom', 'opinion', 'extension'].includes(d.docType)) throw new Error('공문 유형이 올바르지 않습니다.');
    const result = newCase();
    const structured = ['attachments', 'lawyers', 'greetingOverride', 'bodyOverride', 'bodyTitleOverride', 'items', 'refMaterials',
      'subjectFirst', 'partialReply', 'includeBody', 'includeNotes', 'extPrev', 'extReason'];
    for (const k of Object.keys(result)) {
      if (structured.includes(k)) continue;
      // Fields added in version 2 are optional in older files.
      if ((payload.version === 1 || opinionFields.includes(k) || extensionFields.includes(k)) && d[k] === undefined) continue;
      result[k] = readString(d[k], k);
    }
    if (payload.version === 1) {
      // Keep the wording an older saved case produced.
      result.subjectFirst = false; result.includeBody = false;
    } else {
      for (const k of ['subjectFirst', 'partialReply', 'includeBody', 'includeNotes']) {
        if (typeof d[k] !== 'boolean') throw new Error(`${k} 항목의 형식이 올바르지 않습니다.`);
        result[k] = d[k];
      }
      result.bodyTitleOverride = d.bodyTitleOverride === null ? null : readString(d.bodyTitleOverride, 'bodyTitleOverride', 3000);
      if (!['auto', 'on', 'off'].includes(result.labelMode)) throw new Error('요청사항 번호 표시 형식이 올바르지 않습니다.');
      if (!Array.isArray(d.items) || d.items.length > 500 || !Array.isArray(d.refMaterials) || d.refMaterials.length > 300) throw new Error('요청사항 또는 참고자료 목록 형식이 올바르지 않습니다.');
      result.items = d.items.map(it => {
        if (!isObject(it) || ![1, 2].includes(it.level) || !Array.isArray(it.notes) || it.notes.length > 200) throw new Error('요청사항 항목 형식이 올바르지 않습니다.');
        return {id: uid(), level: it.level, label: readString(it.label, '요청사항 번호', 50), text: readString(it.text, '요청사항', 20000),
          notes: it.notes.map(n => readString(n, '세부 내용', 20000))};
      });
      result.refMaterials = d.refMaterials.map(r => {
        if (!isObject(r)) throw new Error('참고자료 항목 형식이 올바르지 않습니다.');
        return {id: uid(), no: readString(r.no, '참고자료 번호', 100), text: readString(r.text, '참고자료명', 3000)};
      });
    }
    if (!['bracket', 'guillemet'].includes(result.citationStyle)) throw new Error('인용 형식이 올바르지 않습니다.');
    if (!['피심인', '신청인'].includes(result.partyRole)) throw new Error('피심인·신청인 구분이 올바르지 않습니다.');
    // 제출기한 연장신청 (v8): optional in older files.
    if (!['data', 'opinion'].includes(result.extBasis)) throw new Error('연장신청의 원 요청 종류가 올바르지 않습니다.');
    if (!['', '1', '2', '3', '4'].includes(result.extWeeks)) throw new Error('연장 기간 형식이 올바르지 않습니다.');
    for (const k of ['extOrigDeadline', 'extPrevDeadline', 'extDeadline']) if (result[k] && !dateValid(result[k])) throw new Error(`${k} 날짜 형식이 올바르지 않습니다.`);
    if (d.extPrev !== undefined) {
      if (typeof d.extPrev !== 'boolean') throw new Error('extPrev 항목의 형식이 올바르지 않습니다.');
      result.extPrev = d.extPrev;
    }
    if (d.extReason !== undefined) result.extReason = d.extReason === null ? null : readString(d.extReason, 'extReason');
    for (const k of ['bodyOverride', 'greetingOverride']) result[k] = d[k] === null ? null : readString(d[k], k);
    if (!Array.isArray(d.attachments) || d.attachments.length > 100 || !Array.isArray(d.lawyers) || d.lawyers.length > 100) throw new Error('첨부 또는 변호사 목록 형식이 올바르지 않습니다.');
    result.attachments = d.attachments.map(a => {
      if (!isObject(a)) throw new Error('첨부 항목 형식이 올바르지 않습니다.');
      return {id: uid(), text: readString(a.text, '첨부명', 3000), copies: readString(a.copies, '부수', 4)};
    });
    result.lawyers = d.lawyers.map(readLawyer);
    if (new Set(result.lawyers.map(l => l.id)).size !== result.lawyers.length) throw new Error('변호사 ID가 중복되어 있습니다.');
    return result;
  }
  function masterFile(lawyers) {return {format: 'gongmun-master', version: VERSION, lawyers: clone(lawyers)};}
  function readMaster(payload) {
    if (!isObject(payload) || payload.format !== 'gongmun-master' || payload.version !== VERSION ||
        !Array.isArray(payload.lawyers) || payload.lawyers.length > 1000) throw new Error('이 프로그램에서 저장한 변호사 명단 파일을 선택해 주세요.');
    const ls = payload.lawyers.map(readLawyer);
    if (new Set(ls.map(l => l.id)).size !== ls.length) throw new Error('변호사 명단에 중복 ID가 있습니다.');
    if (ls.some(l => !l.id || !l.name.trim() || !l.directPhone.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email))) throw new Error('변호사의 이름·직통번호·이메일을 확인해 주세요.');
    return ls;
  }
  function extractRequest(s) {
    const dates = [...s.matchAll(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?/g)]
      .map(m => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`).filter(dateValid);
    const numbers = [...s.matchAll(/(?:\(사건처리\)\s*)?[가-힣A-Za-z]+(?:과|팀|국|실|위원회|청)\s*[-–]\s*\d+/g)]
      .map(m => m[0].replace(/\s*[-–]\s*/, '-'));
    const dept = s.match(/[가-힣]+국\s*[가-힣]+(?:과장|팀장)/)?.[0] || '';
    return {dates: [...new Set(dates)], numbers: [...new Set(numbers)], refDept: dept};
  }
  function textOutput(c) {
    return [formatDate(c.sendDate), `${FIRM.label}:${c.firmRef ? ' ' + c.firmRef : ''}`, `수신: ${c.agencyName}`,
      c.refDept ? `참조: ${c.refDept}` : '', `제목: ${c.title}`, '', '1. ' + greetingText(c), '',
      ...bodyParagraphs(c).map((p, i) => `${i + 2}. ${p}\n`), ...attachmentLines(c), '',
      agentLine(c), FIRM.name, '',
      ...c.lawyers.map(l => `담당변호사   ${spaceName(l.name)}\n${contactText(l)}\n`),
      ...(hasBody(c) && c.docType === 'opinion' ? ['', '심사보고서에 대한 의견서', `- ${c.caseName} -`, c.caseNo ? `(사건번호: ${c.caseNo})` : '',
        `${c.partyRole} ${c.submitter}`, `대리인 ${FIRM.name}`, '', '목  차',
        ...numberedItems(c).map(it => `${it.level === 2 ? '  ' : ''}${it.number} ${it.heading}`), '',
        ...(c.confidentialNote.trim() ? [c.confidentialNote.trim(), ''] : []), bodyTitle(c), '',
        ...numberedItems(c).flatMap(it => [`${it.number} ${it.heading}`, '']),
        ...(refLines(c).length ? ['첨  부  서  류', '', ...refLines(c).map(r => `${r.lead}\t${r.text}`)] : [])] : []),
      ...(hasBody(c) && c.docType !== 'opinion' ? ['', '<첨부>', bodyTitle(c), '',
        ...numberedItems(c).flatMap(it => [`${it.number} ${it.heading}`, ...it.notes.map(n => '    ' + n), '']),
        ...(refLines(c).length ? ['첨  부  서  류', '', ...refLines(c).map(r => `${r.lead}\t${r.text}`)] : [])] : [])].join('\n');
  }
  function search(query, text) {
    const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
    const cho = [...text].map(ch => {const n = ch.charCodeAt(0) - 0xac00; return n >= 0 && n < 11172 ? initials[Math.floor(n / 588)] : ch;}).join('');
    return text.toLowerCase().includes(query.trim().toLowerCase()) || cho.includes(query.trim());
  }
  global.Gongmun = {FIRM, FORMAT, VERSION, agencyDefaults, lawyerDefaults, departments, titles, clone, uid, today,
    dateValid, formatDate, particle, spaceName, contactText, contactParts, wordContactParts, newCase, generatedBody, bodyText, greetingText,
    bodyParagraphs, attachmentLines, sample, validate, documentXml, docx, caseFile, readCase, masterFile, wordContactText,
    readMaster, extractRequest, textOutput, search, escapeXml, smartQuotes, crc32, zipStore, requestNames, bodyTitle, hasBody, labelsShown,
    numberedItems, refLines, firmRefFor, autoFirmRef, agentLine, agentName, opinionItems, confidentialDefault, companyShort,
    formatDay, addDays, extTitle, extBase, extReasonDefault, extReasonText, extensionParagraphs};
})(typeof window !== 'undefined' ? window : globalThis);
