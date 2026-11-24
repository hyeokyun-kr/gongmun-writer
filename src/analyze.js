/* Rule-based analysis of a received 공문 and its request list. No network or AI service:
   every value is a candidate the user can see and correct before saving. */
(function (global) {
  'use strict';
  const FIRM = global.GONGMUN_FIRM || (typeof require === 'function' ? require('../firm/firm.json') : null);
  if (!FIRM) throw new Error('firm profile (firm/firm.json) missing');
  const squash = s => String(s || '').replace(/\s+/g, ' ').trim();
  const pad = n => String(n).padStart(2, '0');
  function isoDate(y, m, d) {
    const s = `${y}-${pad(m)}-${pad(d)}`, t = new Date(s + 'T12:00:00Z');
    return !isNaN(t) && t.toISOString().slice(0, 10) === s && +y >= 1990 && +y <= 2100 ? s : '';
  }
  const dateRe = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*[.일]?/;
  function firstDate(s) {const m = String(s).match(dateRe); return m ? isoDate(m[1], m[2], m[3]) : '';}
  function honorificFor(agency) {
    const a = squash(agency);
    if (/위원회$/.test(a)) return '위원회';
    if (/(?:청|처|원|부|국|실|공단|공사|센터|재단)$/.test(a)) return a.match(/(청|처|원|부|국|실|공단|공사|센터|재단)$/)[1];
    return '기관';
  }
  // ‘가나다(주)’ → ‘가나다 주식회사’, ‘라마바(주) 대표이사’ → ‘라마바 주식회사’
  function submitterFrom(recipient) {
    let s = squash(recipient).replace(/\s*(?:대표이사|대표자|대표)\s*(?:[가-힣]{2,4}\s*)?(?:귀하|님)?$/, '').replace(/\s*(?:귀하|귀중)$/, '').trim();
    s = s.replace(/^(?:\(주\)|㈜|\(주식회사\))\s*(.+)$/, '주식회사 $1').replace(/^(.+?)\s*(?:\(주\)|㈜)$/, '$1 주식회사');
    s = s.replace(/^(?:\(유\)|㈲)\s*(.+)$/, '유한회사 $1').replace(/^(.+?)\s*(?:\(유\)|㈲)$/, '$1 유한회사');
    return s;
  }
  // ‘○○ 사건 소명자료 추가제출 요구’ → ‘소명자료 추가제출 요구’
  function requestNameFrom(title) {
    const t = squash(title);
    const m = t.match(/(?:사건|건)\s+(.{2,40}(?:요구|요청|명령|제출|의뢰|조회|문의|협조))$/);
    return squash(m ? m[1] : t);
  }

  /* ---------- the 공문 itself ---------- */
  function gongmun(doc) {
    const lines = (doc.lines ? doc.lines.flat() : doc.paragraphs).map(l => ({text: squash(l.text), h: l.h || 0}));
    const texts = lines.map(l => l.text);
    const all = texts.join('\n');
    const found = {};
    const at = texts.findIndex(t => /^수\s*신(?:\s|:|$)/.test(t));
    if (at > 0) {
      let i = at - 1;
      while (i > 0 && (/^[\d\s/.\-]+$/.test(texts[i]) || texts[i].length > 40)) i--;
      // ‘공 정 거 래 위 원 회’ (letter-spaced) → joined; ‘공정거래위원회 부산지방사무소’ keeps its space.
      if (/[가-힣]/.test(texts[i])) found.agency = /^(?:\S\s+)+\S$/.test(texts[i]) ? texts[i].replace(/\s+/g, '') : texts[i];
    }
    if (!found.agency) {
      const cand = lines.slice(0, 6).filter(l => /(?:위원회|청|처|원|부|공단|공사|센터)$/.test(l.text.replace(/\s+/g, '')) && l.text.length <= 30)
        .sort((a, b) => b.h - a.h)[0];
      if (cand) found.agency = cand.text.replace(/\s+/g, '');
    }
    if (at >= 0) {
      const rest = texts[at].replace(/^수\s*신\s*:?\s*/, '');
      found.recipient = squash(rest || (texts[at + 1] && !/^\(?경유\)?/.test(texts[at + 1]) ? texts[at + 1] : '')).replace(/\s*\(경유\).*$/, '');
      // ‘수신자 참조’ / ‘내부결재’: the addressees are listed elsewhere; leave it to the user.
      if (/^(?:수신자\s*참조|내부\s*결재)/.test(found.recipient)) found.recipient = '';
    }
    const ti = texts.findIndex(t => /^제\s*목(?:\s|:|$)/.test(t));
    if (ti >= 0) {
      let title = texts[ti].replace(/^제\s*목\s*:?\s*/, '');
      for (let i = ti + 1; i < Math.min(texts.length, ti + 3); i++) {
        const t = texts[i];
        if (!t || /^(?:\d+\.|[○□◦ㅇ-]|사\s*건|가\.|<)/.test(t) || t.length > 60) break;
        title += ' ' + t;
      }
      found.title = squash(title);
    }
    // 시행 block: ‘시행 ○○과-000 (2026. 1. 5.)’ or a number split around the label line.
    const si = texts.findIndex(t => /^시\s*행(?:\s|\(|$)/.test(t) || /\s시\s*행\s/.test(' ' + t + ' '));
    if (si >= 0) {
      const own = texts[si].replace(/^.*?시\s*행/, '').replace(/접\s*수.*$/, '');
      const near = [texts[si - 1] || '', own, texts[si + 1] || ''];
      const tries = [own, near[0] + own + near[2], near.join('')];
      for (const raw of tries) {
        const s = raw.replace(/\((\d{4})\.\s*\d{1,2}\.\s*\d{1,2}\.?\)/g, ' ').replace(/(?:협조자|시\s*행|접\s*수)/g, '').replace(/\s+/g, '');
        const m = s.match(/((?:\([가-힣A-Za-z0-9·]{1,12}\))?[가-힣A-Za-z0-9·]{1,40}-\d{1,7})/);
        if (m) {found.docNo = m[1]; break;}
      }
      found.date = firstDate(texts[si]) || '';
    }
    if (!found.date) {
      const ap = texts.find(t => /(?:전\s*결|결\s*재|대\s*결)\s*\d{4}/.test(t));
      if (ap) found.date = firstDate(ap.replace(/^.*?(?:전\s*결|결\s*재|대\s*결)/, ''));
    }
    if (!found.date) {
      const sent = texts.find(t => /시행일|발송일|시행일자/.test(t));
      if (sent) found.date = firstDate(sent);
    }
    const due = deadline(all, found.date);
    if (due) {found.deadline = due.text; found.deadlineDate = due.date;}
    const caseNo = all.match(/사\s*건\s*번\s*호\s*[:：]\s*([^\n]+)/), caseName = all.match(/사\s*건\s*명\s*[:：]\s*([^\n]+)/);
    if (caseNo) found.caseNo = squash(caseNo[1]);
    if (caseName) found.caseName = squash(caseName[1]);
    // ‘심사보고서 송부 및 의견제출 요청’: the reply is an opinion on the 심사보고서 (의견서 제출 공문).
    if (/심사\s*보고서/.test(found.title || '') && /의견/.test(found.title || '')) Object.assign(found, {opinion: true}, opinionRequest(texts));
    return found;
  }
  /* ---------- 심사보고서 의견제출 요청 공문 ---------- */
  const masked = s => /\*{3,}/.test(s || '');
  const label = name => new RegExp(`^${[...name].join('\\s*')}\\s*[:：]\\s*`);
  function opinionRequest(texts) {
    const out = {};
    const at = re => texts.findIndex(t => re.test(t));
    const no = texts.find(t => label('사건번호').test(t));
    if (no) out.caseNo = squash(no.replace(label('사건번호'), ''));
    // The case name may wrap onto the next line(s) until the next label (신청인·피심인) or numbered paragraph.
    const ni = at(label('사건명'));
    if (ni >= 0) {
      let name = texts[ni].replace(label('사건명'), '');
      for (let i = ni + 1; i < Math.min(texts.length, ni + 4); i++) {
        const t = texts[i];
        if (!t || /^(?:피\s*심\s*인|신\s*청\s*인|사\s*건\s*번\s*호|\d+\.|[가-하]\.|-\s*아\s*래)/.test(t)) break;
        name += (/[가-힣)]$/.test(name) && /^[가-힣(]/.test(t) ? ' ' : '') + t;
      }
      out.caseName = squash(name);
    }
    const pi = texts.findIndex(t => /^(피\s*심\s*인|신\s*청\s*인)\s*[:：]\s*(.+)$/.test(t));
    if (pi >= 0) {
      const party = texts[pi].match(/^(피\s*심\s*인|신\s*청\s*인)\s*[:：]\s*(.+)$/);
      out.partyRole = party[1].replace(/\s+/g, ''); out.partyName = squash(party[2]);
      // ‘피 심 인: 1. 가나다…(유) (대표자: 갑)’ / ‘2. 라마바…(유) (대표자: 을)’: the numbered list ends where the numbers restart (‘1. 위 사건을 …’).
      const first = out.partyName.match(/^1\.\s*(.+)$/);
      if (first) {
        const names = [first[1]];
        for (let i = pi + 1; i < texts.length; i++) {
          const m = texts[i].match(/^(\d+)\.\s*(.+)$/);
          if (!m || +m[1] !== names.length + 1) break;
          names.push(m[2]);
        }
        out.parties = names.map(n => squash(n.replace(/\s*\(\s*대\s*표\s*(?:자|이사)\s*[:：][^)]*\)\s*$/, '')));
      }
    }
    const where = texts.map(t => t.match(/제\s*출\s*(?:처|장\s*소)\s*[:：]\s*(.+)$/)).find(Boolean);
    if (where) {out.submitTo = squash(where[1]); out.refDept = refFromSubmitTo(out.submitTo);}
    const copies = texts.map(t => t.match(/제\s*출\s*부\s*수\s*[:：]\s*(.+)$/)).find(Boolean);
    if (copies) out.copies = squash(copies[1]);
    out.leniency = /감면\s*신청/.test(out.caseName || '') || out.partyRole === '신청인';
    return out;
  }
  // ‘공정거래위원회 심판총괄담당관실, 국제카르텔조사과’ → ‘심판총괄담당관, 국제카르텔조사과장’ (the 2026 replies' 참조).
  function refFromSubmitTo(s) {
    return squash(s).replace(/^공정거래위원회\s*/, '').split(/\s*[,，·]\s*/).filter(Boolean)
      .map(u => u.replace(/^공정거래위원회\s*/, '').replace(/담당관실$/, '담당관').replace(/(과|팀)$/, '$1장')).join(', ');
  }
  // ‘주식회사 가나다’ → ‘㈜가나다’, as the lawyers write a company inside a case name.
  const corpMark = s => squash(s).replace(/^(?:주식회사|\(주\))\s*/, '㈜').replace(/\s*(?:주식회사|\(주\))$/, '㈜');
  const shortCompany = s => squash(s).replace(/^(?:주식회사|유한회사|㈜|\(주\))\s*|\s*(?:주식회사|유한회사|㈜|\(주\))$/g, '');

  /* ---------- 심사보고서 (optional): the respondent represented by our firm (firm.json ‘match’), and its lawyers ---------- */
  function looksLikeExamReport(doc) {
    const t = (doc.lines ? doc.lines.flat().map(l => l.text) : doc.paragraphs.map(p => p.text)).slice(0, 400).map(squash).join('\n');
    return /심\s*사\s*보\s*고\s*서/.test(t) && /사건번호/.test(t) && /피\s*심\s*인/.test(t) && /대리인/.test(t) && !looksLikeGongmun(doc);
  }
  function examReport(doc) {
    const texts = (doc.lines ? doc.lines.flat().map(l => l.text) : doc.paragraphs.map(p => p.text)).map(squash).filter(Boolean);
    const out = {parties: []};
    const no = texts.map(t => t.match(/사건번호\s*[:：]\s*([0-9]{4}[가-힣]{1,4}\d{3,5})/)).find(Boolean);
    if (no) out.caseNo = no[1];
    const title = texts.find(t => /^-\s*.+\s*-$/.test(t) && /건/.test(t)) || texts.find(t => /^【.+】$/.test(t));
    if (title) out.caseName = squash(title.replace(/^[-【]\s*|\s*[-】]$/g, ''));
    // ‘사건 담당자: 국제카르텔조사과장 …’: the 의견서 goes to 심판총괄담당관 and this 과 (both 의견제출 공문 samples).
    // Lines are joined without spaces: the 과 name may break across lines (‘국제카르텔조사’ / ‘과장 …’).
    const desk = texts.join('').match(/사건\s*담당자\s*[:：]\s*([가-힣]{2,20}?(?:과|팀))\s*장/);
    if (desk) out.dept = desk[1];
    // ‘나. 피심인’ … ‘다.’: numbered entries (회사, 주소, 대표이사, 대리인, 변호사). Footnotes and page numbers are skipped.
    // The summary page also has ‘나. 피심인: ①…’; the list itself is followed by ‘1) 회사’.
    const start = texts.findIndex((t, i) => /^[가-하]\.\s*피\s*심\s*인/.test(t) && /^1\)\s*\S/.test(texts[i + 1] || ''));
    if (start < 0) return out;
    let entry = null, footnote = false;
    for (const t of texts.slice(start + 1, start + 400)) {
      if (/^[가-하]\.\s/.test(t) || /^[ⅠⅡⅢIV]+\.\s/.test(t) || /^\d+\.\s/.test(t)) break;
      if (/^-\s*\d+\s*-$/.test(t)) {footnote = false; continue;}
      const m = t.match(/^(\d{1,2})\)\s*(.+)$/);
      if (m && (m[2].length > 40 || /이하|지칭|기재|다\.$/.test(m[2]))) {footnote = true; continue;}
      if (footnote) continue;
      if (m) {entry = {name: m[2], agent: '', lawyers: []}; out.parties.push(entry); continue;}
      if (!entry) continue;
      const agent = t.match(/^대리인\s*(.+)$/), lawyers = t.match(/^변호사\s*(.+)$/);
      if (agent) entry.agent = agent[1];
      else if (lawyers) entry.lawyers.push(...lawyers[1].split(/\s*[,，]\s*/).map(x => x.replace(/\s+/g, '')).filter(Boolean));
    }
    out.client = out.parties.find(p => FIRM.match.some(m => (p.agent || '').includes(m))) || null;
    return out;
  }

  /* ---------- 제출기한 (the cover's 발신일자 starts from it) ---------- */
  // ‘제출기한: 2026. 1. 9. 18시 까지’, ‘자료제출 일시 : 2026년 1월 9일(금) 18:00 까지’, ‘요구하오니 2026.1.9.(금)까지 제출하여’
  const dayRe = '(\\d{4})\\s*[.년]\\s*(\\d{1,2})\\s*[.월]\\s*(\\d{1,2})\\s*[.일]?';
  const tailRe = '(?:\\s*\\([월화수목금토일]\\))?(?:\\s*(?:오전|오후)?\\s*\\d{1,2}\\s*(?:시(?:\\s*\\d{1,2}\\s*분)?|:\\d{2}))?';
  const dueLabel = '(?:제\\s*출|회\\s*신|송\\s*부)\\s*(?:기\\s*한|기\\s*일|시\\s*한|일\\s*시|마\\s*감)\\s*[:：]?\\s*';
  const LABELLED = new RegExp(dueLabel + `(${dayRe}${tailRe})`);
  const UNTIL = new RegExp(`(${dayRe}${tailRe})\\s*까지(?!의)[\\s\\S]{0,25}?(?:제\\s*출|회\\s*신|송\\s*부|도\\s*착)`, 'g');
  const NO_YEAR = new RegExp(dueLabel + '(?<!\\d)((\\d{1,2})\\s*[.월]\\s*(\\d{1,2})\\s*[.일]?' + tailRe + ')');
  function deadline(text, refDate) {
    const all = String(text || '');
    const m = all.match(LABELLED);
    if (m && isoDate(m[2], m[3], m[4])) return {text: squash(m[1]), date: isoDate(m[2], m[3], m[4])};
    for (const u of all.matchAll(UNTIL)) {
      // ‘2020. 1. 1.부터 2024. 12. 31.까지 … 제출’ is a data period, not the deadline.
      if (/부터\s*$/.test(all.slice(Math.max(0, u.index - 30), u.index))) continue;
      const date = isoDate(u[2], u[3], u[4]);
      if (date) return {text: squash(u[1]), date};
    }
    // ‘제출기한: 1. 9.(금)’: the year of the request (the next year if the day has passed by then).
    const n = all.match(NO_YEAR);
    if (n) {
      const ref = /^\d{4}-\d{2}-\d{2}$/.test(refDate || '') ? refDate : new Date().toISOString().slice(0, 10);
      let date = isoDate(ref.slice(0, 4), n[2], n[3]);
      if (date && date < ref) date = isoDate(+ref.slice(0, 4) + 1, n[2], n[3]);
      if (date) return {text: squash(n[1]), date};
    }
    return null;
  }

  /* ---------- departments and contact person (공문 + 요청서 text) ---------- */
  const rankRe = '사무관|조사관|주무관|서기관|행정관|전문관|연구관|조사원|주사보|주사|과장|팀장|계장|담당관';
  function departments(texts, docNo) {
    const all = texts.join('\n');
    const docDept = (docNo || '').replace(/^\([^)]*\)/, '').replace(/-\d+$/, '');
    const pairs = [...all.matchAll(/([가-힣]{2,12}국)\s*([가-힣]{2,14}과)(?=[^가-힣]|$|로|에|장|\s)/g)].map(m => [m[1], m[2]]);
    const pair = pairs.find(p => p[1] === docDept) || (!docDept ? pairs[0] : null);
    const dept = pair ? `${pair[0]} ${pair[1]}` : docDept && /과$|팀$|실$|센터$|단$/.test(docDept) ? docDept : pairs[0] ? `${pairs[0][0]} ${pairs[0][1]}` : '';
    // Prefer a name with a rank next to an enquiry/phone context; the approval block lists ranks only.
    const notName = new RegExp(`^(?:${rankRe}|기안|전결|협조|협조자|담당|담당자|문의|국장|위원장|청장|대표|귀사|요청인|피요청)`);
    let person = null, best = -1;
    const consider = (name, rank, index, length) => {
      if (!name || notName.test(name)) return;
      const around = all.slice(Math.max(0, index - 60), index + length + 30);
      const score = (rank ? 2 : 0) + (/문의|담당|☏|☎|연락|제출처/.test(around) ? 1 : 0) + (/0\d{1,2}-\d{3,4}-\d{4}/.test(around) ? 1 : 0);
      if (score >= 2 && score > best) {best = score; person = {name, rank: rank || ''};}
    };
    for (const m of all.matchAll(new RegExp(`([가-힣]{2,4})\\s*(${rankRe})(?=[\\s(（,☏☎]|$)`, 'g'))) consider(m[1], m[2], m.index, m[0].length);
    for (const m of all.matchAll(/[가-힣]{2,12}(?:과|팀|실)\s+([가-힣]{2,4})\s*[(（]\s*[☏☎]/g)) consider(m[1], '', m.index, m[0].length);
    const candidates = [];
    const unitName = dept.split(' ').pop();
    if (dept) candidates.push(/과$|팀$/.test(unitName) ? dept + '장' : dept);
    if (dept && person) candidates.push(`${dept} (담당자: ${person.name}${person.rank ? ' ' + person.rank : ''}님)`);
    if (dept && !candidates.includes(dept)) candidates.push(dept);
    return {dept, person, candidates};
  }

  /* ---------- request list → numbered items ---------- */
  const START = /^(?:[□■▣◎○●◆◇▶▷►◈<〈《\[【(]\s*)*(?:자료\s*제출|소명\s*자료|추가\s*(?:자료|제출)|자료|제출|소명|질의|추가\s*소명)?\s*(?:요청|요구|소명\s*요구|제출\s*요구|관련|소명\s*요청|질의|확인)\s*(?:사항|내용|목록|자료|항목)(?:\s*목록)?\s*[>〉》\]】)]?\s*[:：]?$/;
  const END = /^(?:[<〈《\[【□■◈※(]\s*)*(?:자료\s*)?(?:작성\s*(?:및\s*제출\s*)?(?:시|방법)?\s*)?(?:유의\s*사항|작성\s*요령|작성\s*방법|녹취\s*내용|참고\s*사항|작성\s*예시|제출\s*방법\s*및\s*유의)/;
  const NOTE = /^(?:\*+|※|☞|ⓘ|ex\)|e\.g\.|예\s*\)|예시\s*\)|\(?(?:주의|참고|예시|비고)\s*사항?\)|[-–—]\s|[-–—](?=[가-힣])|[·•▪◦○●ㅇ□■◇◆▷▶►→]\s?)/i;
  const hangulSeq = '가나다라마바사아자차카타파하';
  const MARKERS = [
    ['bracket', /^\[\s*(?:요청|요구|질의|문항|소명)\s*(?:사항|자료|요구)?\s*(\d{1,2}(?:-\d{1,2})?)\s*\]\s*/],
    ['dash', /^(\d{1,2}-\d{1,2})[.)]?\s+/],
    ['dot2', /^(\d{1,2}\.\d{1,2})\.?\s+/],
    ['paren', /^\((\d{1,2})\)\s*/],
    ['numparen', /^(\d{1,2})\)\s*/],
    ['num', /^(\d{1,2})\.(?!\d)\s*/],
    ['circled', /^([①-⑳])\s*/],
    ['roman', /^((?:X{0,3})(?:IX|IV|V?I{0,3})|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])\.\s*/],
    ['ganada', /^([가-하])\.\s*/],
    ['ganadaparen', /^\(([가-하])\)\s*/],
    ['ganadahalf', /^([가-하])\)\s*/],
    ['question', /^(?:질의|질문|문항|Q)\s*(\d{1,2})\s*[.:)]\s*/i]
  ];
  function ordinal(type, label) {
    if (/^\d/.test(label)) return +label.split(/[-.]/).pop();
    if (/^[가-하]$/.test(label)) return hangulSeq.indexOf(label) + 1;
    if (/^[①-⑳]$/.test(label)) return label.charCodeAt(0) - 0x245f;
    const r = {Ⅰ: 1, Ⅱ: 2, Ⅲ: 3, Ⅳ: 4, Ⅴ: 5, Ⅵ: 6, Ⅶ: 7, Ⅷ: 8, Ⅸ: 9, Ⅹ: 10}[label];
    if (r) return r;
    if (/^[IVX]+$/.test(label)) return label.split('').reduce((s, c, i, a) => {const v = {I: 1, V: 5, X: 10}[c], n = {I: 1, V: 5, X: 10}[a[i + 1]] || 0; return s + (v < n ? -v : v);}, 0);
    return 0;
  }
  function marker(p) {
    if (p.auto && p.auto.label) {
      const label = p.auto.label.replace(/^[(\[]|[.)\]]$/g, '').replace(/[.)]$/, '');
      return {type: 'auto' + p.auto.level, label, rest: p.text, auto: true};
    }
    for (const [type, re] of MARKERS) {
      const m = p.text.match(re);
      if (m && (type !== 'roman' || m[1])) {
        const rest = p.text.slice(m[0].length).trim();
        if (!rest) return null;
        if (type === 'num' && /^\d/.test(rest)) return null;
        return {type, label: m[1], rest};
      }
    }
    return null;
  }
  const junk = t => !t.trim() || /^(?:[-–]\s*\d+\s*[-–]|\d+\s*\/\s*\d+|끝\.?|[-–]\s*다\s*음\s*[-–])$/.test(t.trim());
  function requests(doc, options = {}) {
    const paras = doc.paragraphs.map(p => ({...p, text: squash(p.text)})).filter(p => !junk(p.text));
    const warnings = [];
    let start = paras.findIndex(p => p.text.length <= 34 && START.test(p.text));
    // A heading can sit in a box (table) in 한글 documents; prefer one outside tables when both exist.
    const outside = paras.findIndex(p => !p.table && p.text.length <= 34 && START.test(p.text));
    if (outside >= 0) start = outside;
    // After a ‘요청사항’ heading, the request part ends at the next guidance heading (유의사항 등).
    let region = start >= 0 ? paras.slice(start + 1) : paras;
    if (start >= 0) {
      const end = region.findIndex(p => !p.table && p.text.length <= 40 && END.test(p.text) && !/^\(?주의/.test(p.text));
      if (end >= 0) region = region.slice(0, end);
    }
    function build(useTables) {
      const items = [], typeLevel = new Map(), last = {};
      let current = null, tablesSkipped = 0, sawItem = false, pendingNotes = [];
      for (let i = 0; i < region.length; i++) {
        const p = region[i];
        if (sawItem && p.text.length <= 40 && END.test(p.text) && !/^\(?주의/.test(p.text)) break;
        if (p.table && !useTables) {if (sawItem && !(region[i - 1] && region[i - 1].table)) tablesSkipped++; continue;}
        const m = marker(p);
        let level = null;
        if (m) {
          if (!typeLevel.has(m.type)) {
            if (typeLevel.size >= 3) level = null;
            else typeLevel.set(m.type, typeLevel.size + 1);
          }
          level = typeLevel.get(m.type) ?? null;
          if (level) {
            const n = ordinal(m.type, m.label), prev = last[m.type];
            // Accept repeats and small gaps, not a backward jump (inline references such as ‘1. 나.에서’).
            if (prev !== undefined && n && (n < prev || n > prev + 3)) level = null;
          }
        }
        if (m && level && level <= 2) {
          // Level-1 sequence resets the level-2 counters.
          if (level === 1) for (const [t, l] of typeLevel) if (l > 1) delete last[t];
          last[m.type] = ordinal(m.type, m.label);
          current = {level, label: m.label, text: m.rest, notes: [], type: m.type};
          if (!sawItem && pendingNotes.length) pendingNotes = [];
          items.push(current); sawItem = true;
        } else if (current) current.notes.push(p.text);
        else pendingNotes.push(p.text);
      }
      return {items, tablesSkipped};
    }
    let result = build(false);
    let items = result.items;
    if (!items.length) {
      const rows = tableRows(region);
      if (rows.length >= 1) {items = rows; result = {items, tablesSkipped: 0};}
    }
    if (!items.length) {result = build(true); items = result.items;}
    if (!items.length) {
      // No numbering at all: each paragraph of the request part is one item.
      items = region.filter(p => !p.table && !NOTE.test(p.text) && p.text.length >= 8).slice(0, 80)
        .map((p, i) => ({level: 1, label: String(i + 1), text: p.text.replace(/^[○●◦ㅇ□■▪·•\-–]\s*/, ''), notes: [], type: 'paragraph'}));
      if (items.length) warnings.push('요청사항 번호를 찾지 못해 문단마다 한 항목으로 나눴습니다. 항목을 확인해 주세요.');
    }
    if (result.tablesSkipped) warnings.push(`요청사항 안의 표 ${result.tablesSkipped}개(작성 양식 등)는 옮기지 않았습니다. 원문을 확인해 주세요.`);
    if (start < 0 && items.length) warnings.push('‘요청사항’ 제목을 찾지 못해 문서 처음부터 번호 항목을 찾았습니다. 앞부분의 안내 문구가 섞이지 않았는지 확인해 주세요.');
    items = mergeStems(items);
    return {items: items.map(({type, ...x}) => x), warnings, start};
  }
  // Request lists laid out as a table: one row per request (번호 | 요청 내용 | 비고).
  function tableRows(region) {
    const rows = new Map();
    for (const p of region) {
      if (!p.table || !p.cell) continue;
      const key = p.cell.t + ':' + p.cell.r;
      if (!rows.has(key)) rows.set(key, new Map());
      const cols = rows.get(key);
      cols.set(p.cell.c, squash((cols.get(p.cell.c) || '') + ' ' + p.text));
    }
    const items = [];
    for (const cols of rows.values()) {
      const cells = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]).filter(Boolean);
      const m = cells[0] && cells[0].match(/^[(\[]?(\d{1,2}(?:-\d{1,2})?)[.)\]]?$/);
      if (!m || cells.length < 2) continue;
      const [text, ...rest] = cells.slice(1);
      if (!text || text.length < 4) continue;
      items.push({level: 1, label: m[1], text, notes: rest, type: 'table'});
    }
    return items;
  }
  // ‘2. 귀사의 ○○ 관련,’ followed by 2-1, 2-2: the stem belongs to each sub-question.
  function mergeStems(items) {
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const kids = [];
      for (let j = i + 1; j < items.length && items[j].level > 1; j++) kids.push(items[j]);
      const stem = it.level === 1 && kids.length && !it.notes.length && /(?:,|，|관련|관련하여|대하여|관하여|대해|관해|다음)\s*[,，:：]?$/.test(it.text);
      if (!stem) {out.push(it); continue;}
      kids.forEach(k => out.push({...k, level: 1, text: `${it.text} ${k.text}`, label: /[-.]/.test(k.label) ? k.label : `${it.label}-${k.label}`}));
      i += kids.length;
    }
    return out;
  }
  // [요청사항 N] labels are shown when the source numbering differs from Word's automatic numbering.
  // Only the top level counts: a repeated ‘다.’ in a sub-list is a typo the lawyers renumber.
  function labelsNeeded(items) {
    let top = 0;
    for (const it of items) if (it.level === 1 && String(it.label) !== String(++top)) return true;
    return false;
  }
  function looksLikeGongmun(doc) {
    const t = doc.paragraphs.slice(0, 60).map(p => squash(p.text));
    let score = 0;
    if (t.some(x => /^수\s*신(?:\s|:|$)/.test(x))) score += 2;
    if (t.some(x => /^제\s*목(?:\s|:|$)/.test(x))) score += 1;
    if ((doc.lines ? doc.lines.flat().map(l => l.text) : t).some(x => /^시\s*행(?:\s|\(|$)|\s시\s*행\s/.test(' ' + x + ' '))) score += 2;
    if (t.some(x => /끝\.\s*$/.test(x))) score += 1;
    return score >= 3;
  }
  global.GongmunAnalyze = {gongmun, departments, requests, mergeStems, labelsNeeded, looksLikeGongmun, looksLikeExamReport, examReport, refFromSubmitTo, corpMark, shortCompany, masked, deadline, submitterFrom, requestNameFrom, honorificFor, firstDate, NOTE};
})(typeof window !== 'undefined' ? window : globalThis);
