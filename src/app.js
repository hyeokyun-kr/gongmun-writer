(function () {
  'use strict';
  const G = window.Gongmun, Word = window.GongmunWord, templates = window.GONGMUN_TEMPLATES;
  const Readers = window.GongmunReaders, Analyze = window.GongmunAnalyze;
  const $ = id => document.getElementById(id);
  let current = G.newCase(), master = G.clone(G.lawyerDefaults);
  let dirty = false, masterDirty = false, zoom = null, activeLawyer = null, activeField = null;
  let toastTimer, previewTimer, resizeTimer, lastPages = 1;
  let importedWord = null, importedLawyers = [], importBusy = false, importDirty = false, importGeneration = 0, contactForImport = false;
  // Documents read in this session (never stored): slot -> {name, doc}; autoValues are what the analysis last filled in.
  const sources = {gongmun: null, requests: null};
  let autoValues = {}, autoItems = null, analysisInfo = null, readGeneration = 0;
  // A 회신's items and 첨부 line set aside while the 의견서 type button is tried, restored when switching back.
  let typeStash = null;
  // 만들 문서 tabs: the document each tab had (see switchType), with the files it was made from. Each file put in a box
  // gets an id (the same 공문 again keeps its id); sharedKeys are the values all the documents of one case have in common.
  const sharedKeys = ['firmRef', 'agencyName', 'honorific', 'submitter', 'requestDate', 'requestDocNo', 'requestTitle', 'requestName', 'caseNo', 'caseName', 'partyRole'];
  let tabDocs = {}, fileSeq = 0;
  const filesNow = () => ({gongmun: sources.gongmun?.id, requests: sources.requests?.id});
  const labels = {title: '제목', agencyName: '수신 기관', refDept: '참조 부서', firmRef: '관리번호',
    agentOverride: '대리인 표시', submitter: '제출 주체', bodyTitle: '본문 제목', caseNo: '사건번호', caseName: '사건명',
    partyRole: '피심인·신청인', confidentialNote: '비공개 요청 문구', shortName: '약칭', extBasis: '연장할 원 요청',
    extOrigDeadline: '원 제출기한', extPrevDeadline: '연장받은 기한', extDeadline: '연장 기한', extReason: '연장 사유'};
  const replyGroup = type => type === 'reply' || type === 'additional' || type === 'custom';
  const strip = items => JSON.stringify(items.map(({id, ...x}) => x));
  const lowerRoman = n => ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n - 1] || String(n);
  function element(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer); const box = $('toast'); box.textContent = message;
    box.className = 'toast' + (error ? ' error' : ''); box.hidden = false;
    toastTimer = setTimeout(() => box.hidden = true, error ? 7000 : 4000);
  }
  function changed() {
    dirty = true;
    $('save-state').textContent = '미저장 변경';
    $('save-state').classList.add('dirty');
    schedulePreview();
  }
  function showDialog(id) {
    if (!$(id).open) $(id).showModal();
  }
  function confirmAction(message, title = '변경 확인', yes = '계속') {
    return new Promise(resolve => {
      const dialog = $('confirm-dialog');
      $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-yes').textContent = yes;
      const finish = value => {
        $('confirm-yes').onclick = null; $('confirm-no').onclick = null; dialog.oncancel = null;
        dialog.close(); resolve(value);
      };
      $('confirm-yes').onclick = () => finish(true); $('confirm-no').onclick = () => finish(false);
      dialog.oncancel = e => {e.preventDefault(); finish(false);};
      dialog.showModal(); $('confirm-no').focus();
    });
  }
  async function mayReplace() {
    return !dirty || await confirmAction('저장하지 않은 현재 공문이 있습니다. 현재 내용을 바꾸려면 먼저 사건 파일로 저장하거나, 아래 버튼으로 변경을 계속하세요.', '현재 공문을 바꿀까요?', '저장하지 않고 변경');
  }
  function syncFields() {
    document.querySelectorAll('[data-field]').forEach(e => {if (!(e === document.activeElement && e.value === current[e.dataset.field])) e.value = current[e.dataset.field];});
    $('partialReply').checked = current.partialReply; $('includeBody').checked = current.includeBody; $('includeNotes').checked = current.includeNotes;
    $('labelMode').value = current.labelMode; $('bodyTitle').placeholder = (current.attachments[0]?.text || current.title || '') + ' (자동)';
    if (!($('bodyTitle') === document.activeElement)) $('bodyTitle').value = current.bodyTitleOverride ?? '';
    $('partial-field').hidden = current.docType !== 'reply';
    renderRequestChips();
    // 만들 문서 (회신 · 의견서 · 연장신청) at the top; 회신 · 추가 설명자료 · 직접 작성 inside 회신.
    const pressed = (e, on) => {e.classList.toggle('active', on); e.setAttribute('aria-pressed', String(on));};
    document.querySelectorAll('[data-type]').forEach(e => pressed(e, e.dataset.type === (replyGroup(current.docType) ? 'reply' : current.docType)));
    document.querySelectorAll('[data-variant]').forEach(e => pressed(e, e.dataset.variant === current.docType));
    $('verb-field').hidden = current.docType !== 'custom';
    document.body.dataset.doctype = current.docType; document.body.dataset.basis = current.extBasis; syncTypeTexts(); syncExtension();
    syncBodyMode();
  }
  // 제출기한 연장신청: 원 요청 종류, 연장 기간 버튼, 연장 사유 (the default sentence until edited).
  function syncExtension() {
    document.querySelectorAll('.basis-button').forEach(e => {const on = e.dataset.basis === current.extBasis; e.classList.toggle('active', on); e.setAttribute('aria-pressed', String(on));});
    document.querySelectorAll('.week-button').forEach(e => {const on = e.dataset.weeks === current.extWeeks; e.classList.toggle('active', on); e.setAttribute('aria-pressed', String(on));});
    $('extPrev').checked = current.extPrev; $('ext-prev-fields').hidden = !current.extPrev;
    const base = G.extBase(current);
    $('weeks-base').textContent = G.dateValid(base) ? `지금 기한 ${G.formatDay(base)}에서` : '원 제출기한을 먼저 넣으세요';
    // While the user types, the box is theirs; a reason the program reset (another 공문) shows even with the cursor in it.
    if ($('extReason') !== document.activeElement || current.extReason !== $('extReason').value) $('extReason').value = G.extReasonText(current);
    $('reset-reason').hidden = current.extReason === null;
    const note = $('ext-deadline-note'), day = G.dateValid(current.extDeadline) ? new Date(current.extDeadline + 'T12:00:00Z').getUTCDay() : -1;
    const gap = day >= 0 && G.dateValid(base) ? Math.round((new Date(current.extDeadline) - new Date(base)) / 864e5) : null;
    note.textContent = day < 0 ? '연장 기간을 누르면 채워집니다. 다른 날짜는 직접 고르세요.' :
      `${G.formatDay(current.extDeadline)}${gap === null ? '' : gap > 0 ? ` · 지금 기한보다 ${gap}일 뒤` : ' · 지금 기한보다 늦어야 합니다'}${day === 0 || day === 6 ? ' · 주말입니다' : ''}`;
    note.classList.toggle('weekend', day === 0 || day === 6);
  }
  // Texts that depend on the document type (회신 ↔ 심사보고서 의견서).
  function syncTypeTexts() {
    const opinion = current.docType === 'opinion', ext = current.docType === 'extension';
    const set = (id, reply, op, extension = reply) => {$(id).textContent = ext ? extension : opinion ? op : reply;};
    set('intro-title', '받은 공문으로 회신을 만드세요', '의견제출 요청 공문으로 의견서를 만드세요', '받은 공문으로 제출기한 연장신청을 만드세요');
    set('intro-text', '공문과 요청사항 목록을 올리면 표지와 본문 양식이 자동으로 채워집니다. 공정위 ‘심사보고서 송부 및 의견제출 요청’ 공문을 올리면 의견서로 바뀝니다. 미리보기에서 확인한 뒤 ‘Word로 저장’을 누르세요.',
      '공정위 ‘심사보고서 송부 및 의견제출 요청’ 공문을 올리면 의견서 제출 공문과 의견서 양식(겉표지·목차·본문 뼈대)을 만듭니다. 미리보기에서 확인한 뒤 ‘Word로 저장’을 누르세요.',
      '기한을 연장하려는 공문(자료제출 요구 또는 심사보고서 의견제출 요청)을 올리면 원 요청·기본 연장 사유가 채워집니다. 3번 칸에서 연장 기간을 고른 뒤 ‘Word로 저장’을 누르세요. 공문만 만들고 본문은 없습니다.');
    set('upload-title', '공문과 요청사항 목록 올리기', '공문과 심사보고서 올리기', '받은 공문 올리기');
    set('upload-hint', '공문(PDF)은 ①에, 요청사항 목록(주로 한글 파일)은 ②에 올리세요.', '의견제출 요청 공문은 ①에, 심사보고서(PDF, 선택)는 ②에 올리세요.', '기한을 연장하려는 공문(PDF·한글·Word)을 ①에 올리세요.');
    const report = !!(sources.requests && Analyze.looksLikeExamReport(sources.requests.doc));
    set('requests-title', '② 요청사항 목록', '② 심사보고서 (선택)', '② 함께 올린 파일');
    set('requests-types', '한글 · PDF · Word', 'PDF', report ? '심사보고서' : '공문이 아닌 파일');
    set('requests-small', '요청사항 → 번호를 매겨 본문', '회사 정식 이름 · 담당변호사 찾기', report ? '회사 이름 · 사건명을 찾는 데 씀' : '제출기한 · 담당 부서만 씀 (회신에서는 요청사항)');
    set('request-card-title', '원 요청과 본문', '사건 정보와 본문', '원 요청과 연장 내용');
    set('lawyer-step', '7', '7', '5');
    set('items-title', '요청사항 · 첨부 본문', '의견서 본문 뼈대');
    set('items-note', '요청사항 목록을 올리면 자동으로 채워집니다. Word에서는 ‘1.’·‘가.’ 자동 번호 제목으로 저장되고, 각 항목 아래에 답변을 쓸 빈 줄이 들어갑니다.',
      '의견서 본문의 제목(I. / 1.)입니다. Word에는 제목 스타일로 들어가 목차에 자동으로 나오고, 각 제목 아래에 의견을 쓸 빈 줄이 들어갑니다. ‘[의견 제목]’은 사건에 맞게 고치세요.');
    set('includeBody-label', '표지 뒤에 첨부 본문(요청사항 양식)을 함께 저장', '공문 뒤에 의견서 양식(겉표지·목차·본문 뼈대)을 함께 저장');
    set('add-item', '+ 요청사항 추가', '+ 제목 추가');
    set('refs-title', '첨부서류(참고자료) 목록', '첨부서류(소을호증) 목록');
    set('refs-note', '본문 끝 ‘첨 부 서 류’에 ‘1. 참고자료 23 ⇥ 자료명’ 형식으로 들어갑니다. 비워 두면 넣지 않습니다.',
      '의견서 끝 ‘첨 부 서 류’에 ‘1. 소을 제1호증 ⇥ 자료명’ 형식으로 들어갑니다. 첨부서류 앞에서 페이지가 나뉩니다.');
    $('ref-no').placeholder = opinion ? '호증' : '23'; $('ref-text').placeholder = opinion ? '예: 거래처별 매출 자료' : '예: 연도별 거래 내역';
  }
  // 의견서: the body skeleton, one 소을호증 row and the 첨부 line, unless the user already wrote their own.
  // oldTitle: the title before the switch, which a 회신's single 첨부 line follows.
  // replace: also replace what the user wrote (they agreed to take the documents' values).
  function enterOpinion(oldTitle, replace = false) {
    if (replace || !current.items.length || strip(current.items) === autoItems) {current.items = G.opinionItems(current); autoItems = strip(current.items);}
    if (!current.refMaterials.length) current.refMaterials = [{id: G.uid(), no: '1', text: ''}];
    // The 제출부수 read from the 공문 comes back when switching back to 의견서.
    const line = analysisInfo?.opinion ? analysisInfo.info.attachment : {text: '심사보고서에 대한 의견서', copies: '1'};
    if (!current.attachments.length || current.attachments.length === 1 && [G.titles.reply, oldTitle, current.title].includes(current.attachments[0].text)) current.attachments = [{id: G.uid(), ...line}];
    current.includeBody = true;
  }
  function leaveOpinion(replace = false) {
    if (replace || [strip(G.opinionItems(current)), autoItems].includes(strip(current.items))) {current.items = []; autoItems = null;}
    if (current.refMaterials.length === 1 && current.refMaterials[0].no === '1' && !current.refMaterials[0].text) current.refMaterials = [];
    // ‘심사보고서에 대한 의견서 20부(…)’ is no 첨부 for a 회신.
    if (current.attachments.length === 1 && /^심사보고서에 대한 의견서/.test(current.attachments[0].text)) current.attachments = [];
  }
  // The skeleton (‘가나다 의견 요지’) and the 비공개 문구 follow the company and role until edited.
  function refreshOpinionDefaults(old) {
    if (strip(current.items) === strip(G.opinionItems(old))) {current.items = G.opinionItems(current); autoItems = strip(current.items); renderItems();}
    if (current.confidentialNote && current.confidentialNote === G.confidentialDefault(old)) {
      const auto = current.confidentialNote === autoValues.confidentialNote;
      current.confidentialNote = G.confidentialDefault(current);
      if (auto) autoValues.confidentialNote = current.confidentialNote;
    }
  }
  // 심사보고서의 우리 법인 변호사 → the current case, matched by name (‘홍 길’ = ‘홍길’) in the lawyer list.
  function addLawyersByName(names) {
    const key = n => n.replace(/\s+/g, ''), added = [], missing = [];
    names.forEach(n => {
      const l = master.find(m => key(m.name) === key(n));
      if (!l) {missing.push(n); return;}
      if (!current.lawyers.some(x => x.id === l.id)) {current.lawyers.push(G.clone(l)); added.push(l.name);}
    });
    changed(); renderSelectedLawyers(); renderLawyerResults(); renderSummary();
    const rest = missing.length ? ` 명단에 없는 이름: ${missing.join(', ')}` : '';
    toast(added.length ? `담당변호사 ${added.join(', ')}을(를) 추가했습니다.${rest}` : missing.length ? `명단에 없는 이름입니다: ${missing.join(', ')}` : '이미 모두 선택되어 있습니다.');
  }
  function syncBodyMode() {
    const manual = current.bodyOverride !== null || current.greetingOverride !== null;
    $('body-mode').classList.toggle('manual', manual);
    $('body-mode').textContent = manual ? '직접 수정한 문장을 유지하고 있습니다. 입력 정보 변경 후 본문도 확인해 주세요.' : '입력 정보에 따라 본문이 자동으로 생성됩니다.';
    $('reset-body').hidden = !manual;
  }
  function setCase(c, saved = false) {
    current = c; dirty = !saved; typeStash = null; tabDocs = {};
    $('save-state').textContent = saved ? '불러온 사건' : '미저장 변경';
    $('save-state').classList.toggle('dirty', !saved);
    $('request-text').value = ''; $('extract-result').hidden = true;
    syncFields(); renderAttachments(); renderItems(); renderRefs(); renderSelectedLawyers(); renderLawyerResults(); renderPreview();
    document.querySelectorAll('.inputs, .editor-scroll, .side-scroll').forEach(e => e.scrollTo(0, 0));
  }
  // The reply title follows the request name, and a single attachment follows the title,
  // until the user writes something different there.
  const replyTitle = c => `${c.requestName || c.requestTitle}에 대한 회신`;
  function setTitle(title, oldTitle) {
    current.title = title;
    if (current.attachments.length === 1 && current.attachments[0].text === oldTitle) {current.attachments[0].text = title; renderAttachments();}
  }
  function updateField(key, value) {
    const before = {title: current.title, base: replyTitle(current), snapshot: {...current}};
    current[key] = value;
    if (current.docType === 'opinion' && (key === 'submitter' || key === 'partyRole')) refreshOpinionDefaults(before.snapshot);
    if (key === 'agencyName') {
      const known = G.agencyDefaults.find(a => a.name === value);
      if (known) {current.honorific = known.honorific; $('honorific').value = current.honorific;}
    }
    if ((key === 'requestName' || key === 'requestTitle') && current.docType === 'reply' && before.title === before.base) setTitle(replyTitle(current), before.title);
    if (current.docType === 'extension') {
      // The title follows the request until edited; a deadline picked by weeks follows the deadline it counts from.
      if (['requestName', 'requestTitle', 'extBasis'].includes(key) && before.title === G.extTitle(before.snapshot)) setTitle(G.extTitle(current), before.title);
      if (['extOrigDeadline', 'extPrevDeadline'].includes(key) && current.extWeeks && G.dateValid(G.extBase(current))) current.extDeadline = G.addDays(G.extBase(current), 7 * current.extWeeks);
      if (key === 'extDeadline') current.extWeeks = '';
      // ‘(이하 “피심인들”)’ follows 피심인 ↔ 신청인 until edited.
      const role = before.snapshot.partyRole;
      if (key === 'partyRole' && [role, role + '들'].includes(current.shortName)) current.shortName = value + (current.shortName.endsWith('들') ? '들' : '');
    }
    if (key === 'title') setTitle(value, before.title);
    // ‘26-*’ follows the year of the sending date until a number is written in.
    if (key === 'sendDate' && G.autoFirmRef(current.firmRef) && G.dateValid(value)) current.firmRef = G.firmRefFor(value);
    if (['requestName', 'requestTitle', 'title', 'sendDate', 'extBasis', 'extOrigDeadline', 'extPrevDeadline', 'extDeadline', 'submitter', 'shortName', 'partyRole'].includes(key)) syncFields();
    changed();
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 110);
  }
  function nameFor(extension, fallback) {
    const label = (current.caseLabel || `${current.submitter || '공문'}_${current.title || fallback}`)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 90) || fallback;
    return `${label}_${current.sendDate || G.today()}${extension}`;
  }
  function download(data, name, type) {
    const blob = new Blob([data], {type}), url = URL.createObjectURL(blob), a = element('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function saveCase() {
    try {
      download(JSON.stringify(G.caseFile(current), null, 2), nameFor('.json', '사건'), 'application/json');
      dirty = false; $('save-state').textContent = '사건 파일 저장 요청됨'; $('save-state').classList.remove('dirty');
      toast('사건 파일 저장을 시작했습니다. 다운로드 폴더 또는 선택한 위치를 확인하세요.');
    } catch (e) {toast('사건 저장 실패: ' + e.message, true);}
  }
  function focusField(field) {
    if (field === 'body' || field === 'greeting') {openBody(field); return;}
    if (field === 'items') {$('items-card').scrollIntoView({behavior: 'smooth', block: 'start'}); return;}
    if (field === 'extBasis') {document.querySelector('.basis-button').focus(); return;}
    const e = $(field === 'lawyers' ? 'lawyer-search' : field === 'attachments' ? 'attachment-name' : field);
    if (e) {e.scrollIntoView({behavior: 'smooth', block: 'center'}); e.focus({preventScroll: true});}
  }
  function renderValidation() {
    const {errors, warnings} = G.validate(current), box = $('validation');
    box.replaceChildren(); box.classList.toggle('has-errors', !!errors.length);
    box.append(element('div', 'valid-title', errors.length ? `저장 전 ${errors.length}가지 확인이 필요합니다` : 'Word 문서로 저장할 수 있습니다'));
    errors.forEach(e => {const b = element('button', '', '• ' + e.text); b.type = 'button'; b.onclick = () => focusField(e.field); box.append(b);});
    warnings.forEach(t => box.append(element('div', 'warning', '참고 · ' + t)));
    $('export-docx').disabled = !!errors.length;
    $('export-status').textContent = errors.length ? `필수 입력 ${errors.length}건 남음` : '검토한 문서를 저장하세요';
    document.querySelectorAll('[data-field]').forEach(e => {const invalid = errors.some(x => x.field === e.dataset.field); e.classList.toggle('invalid', invalid); e.setAttribute('aria-invalid', String(invalid));});
    return {errors, warnings};
  }
  function exportDocx() {
    const check = renderValidation();
    if (check.errors.length) {focusField(check.errors[0].field); toast(check.errors[0].text, true); return;}
    try {
      download(G.docx(current, templates), nameFor('.docx', '공문'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast(current.docType === 'extension' ? '제출기한 연장신청 공문을 Word로 저장했습니다. Word에서 연장 사유와 기한을 확인하세요.' : current.docType === 'opinion' && G.hasBody(current) ? '의견서 제출 공문과 의견서 양식(겉표지·목차·본문 뼈대)을 Word로 저장했습니다. Word에서 의견을 작성한 뒤 목차는 ‘필드 업데이트’로 쪽 번호를 맞추세요.' :
        G.hasBody(current) ? `표지와 첨부 본문(요청사항 ${current.items.length}개)을 Word로 저장했습니다. Word에서 답변을 작성하세요.` : 'Word 문서 저장을 시작했습니다. Word에서 열어 최종 배치를 확인하세요.');
    } catch (e) {toast('Word 저장 실패: ' + e.message, true);}
  }
  function openBody(which = 'body') {
    $('greeting-editor').value = G.greetingText(current); $('body-editor').value = G.bodyText(current);
    showDialog('body-dialog'); $(which === 'greeting' ? 'greeting-editor' : 'body-editor').focus();
  }
  function move(list, index, delta) {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    changed();
  }
  function orderButtons(index, length, onMove, onRemove, onEdit) {
    const actions = element('div', 'item-actions');
    if (onEdit) {const edit = element('button', '', '수정'); edit.type = 'button'; edit.setAttribute('aria-label', `${index + 1}번째 항목 수정`); edit.onclick = onEdit; actions.append(edit);}
    for (const [text, delta, disabled, label] of [['↑', -1, !index, '위로'], ['↓', 1, index === length - 1, '아래로']]) {
      const b = element('button', '', text); b.type = 'button'; b.disabled = disabled; b.setAttribute('aria-label', `${index + 1}번째 항목 ${label}`); b.onclick = () => onMove(delta); actions.append(b);
    }
    const remove = element('button', 'remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${index + 1}번째 항목 삭제`); remove.onclick = onRemove; actions.append(remove);
    return actions;
  }
  function renderAttachments() {
    const list = $('attachments'); list.replaceChildren(); $('attachment-count').textContent = `${current.attachments.length}건`;
    current.attachments.forEach((a, i) => {
      const row = element('div', 'ordered-item'); row.dataset.attachment = a.id;
      const main = element('div', 'item-main'), input = element('input'); input.value = a.text; input.maxLength = 3000; input.setAttribute('aria-label', `${i + 1}번째 첨부명`);
      input.oninput = () => {a.text = input.value; changed();};
      main.append(input);
      const copies = element('input'); copies.type = 'number'; copies.min = 1; copies.max = 9999; copies.value = a.copies; copies.placeholder = '부수 생략'; copies.style.marginTop = '4px'; copies.style.width = '86px'; copies.setAttribute('aria-label', `${i + 1}번째 첨부 부수`);
      copies.oninput = () => {a.copies = copies.value; changed();}; main.append(copies);
      row.append(element('span', 'order-number', String(i + 1)), main, orderButtons(i, current.attachments.length,
        d => {move(current.attachments, i, d); renderAttachments();}, () => {current.attachments.splice(i, 1); changed(); renderAttachments();}));
      list.append(row);
    });
  }
  function renderSelectedLawyers() {
    const list = $('selected-lawyers'); list.replaceChildren(); $('lawyer-count').textContent = `${current.lawyers.length}명`;
    current.lawyers.forEach((l, i) => {
      const row = element('div', 'ordered-item'), main = element('div', 'item-main');
      main.append(element('strong', '', l.name), element('small', '', `${l.directPhone} · ${l.email}`));
      row.append(element('span', 'order-number', String(i + 1)), main, orderButtons(i, current.lawyers.length,
        d => {move(current.lawyers, i, d); renderSelectedLawyers();}, () => {current.lawyers.splice(i, 1); changed(); renderSelectedLawyers(); renderLawyerResults();}, () => openContact(i)));
      list.append(row);
    });
  }
  function renderLawyerResults() {
    renderWordSelection();
    const list = $('lawyer-results'), query = $('lawyer-search').value; list.replaceChildren();
    const results = master.filter(l => !current.lawyers.some(s => s.id === l.id) && G.search(query, l.name + ' ' + l.email));
    if (!results.length) {list.append(element('div', 'empty-message', query ? '검색 결과가 없습니다. 명단 관리에서 추가할 수 있습니다.' : '명단의 변호사를 모두 선택했습니다.')); return;}
    results.forEach(l => {
      const b = element('button', 'lawyer-result'), text = element('div'); b.type = 'button';
      text.append(element('strong', '', l.name), element('small', '', l.directPhone + ' · ' + l.email)); b.append(text, element('span', 'add-sign', '+'));
      b.setAttribute('aria-label', l.name + ' 변호사 선택');
      b.onclick = () => {current.lawyers.push(G.clone(l)); changed(); renderSelectedLawyers(); renderLawyerResults();}; list.append(b);
    });
  }
  function openContact(index, forImport = false) {
    contactForImport = forImport;
    activeLawyer = index; const l = (forImport ? importedLawyers : current.lawyers)[index];
    $('contact-name').value = l.name; $('contact-phone').value = l.directPhone;
    $('contact-subphone').value = l.subPhone; $('contact-email').value = l.email;
    $('contact-dialog').querySelector('h2').textContent = forImport ? '저장할 변호사 이름·연락처' : '이 공문의 변호사 연락처';
    $('contact-dialog').querySelector('p').textContent = forImport ? '이 공문의 별도 수정본에 반영됩니다. 원본 파일과 선택용 명단은 바뀌지 않습니다.' : '수정 사항은 현재 공문과 사건 파일에 반영됩니다.';
    showDialog('contact-dialog');
  }
  function renderWordSelection() {
    if (!$('existing-word-results')) return;
    const list = $('existing-word-selected'); list.replaceChildren();
    importedLawyers.forEach((l, i) => {
      const row = element('div', 'ordered-item'), main = element('div', 'item-main');
      const origin = importedWord?.existing.some(p => p.id === l.id);
      main.append(element('strong', '', l.name), element('span', 'word-person-origin', origin ? '원본' : '추가'), element('small', '', G.contactText(l)));
      row.append(element('span', 'order-number', String(i + 1)), main, orderButtons(i, importedLawyers.length,
        delta => {const target = i + delta; if (target < 0 || target >= importedLawyers.length) return; [importedLawyers[i], importedLawyers[target]] = [importedLawyers[target], importedLawyers[i]]; importDirty = true; renderWordSelection();},
        async () => {
          if (origin && !await confirmAction(`${l.name} 변호사를 저장할 목록에서 제외할까요? 원본 파일은 바뀌지 않습니다.`, '원본 변호사 제외', '목록에서 제외')) return;
          importedLawyers.splice(i, 1); importDirty = true; renderWordSelection();
        }, () => openContact(i, true)));
      list.append(row);
    });
    if (!importedLawyers.length) list.append(element('div', 'empty-message', importedWord?.existing.length ? '모든 담당변호사를 목록에서 제외했습니다. 아래 명단에서 다시 선택할 수 있습니다.' : '아래 명단에서 담당변호사를 선택하세요.'));
    const results = $('existing-word-results'); results.replaceChildren();
    const unavailable = l => !!Word.duplicate(importedLawyers, l);
    const candidates = master.filter(l => G.search($('existing-word-search').value, l.name + ' ' + l.email))
      .sort((a, b) => Number(unavailable(a)) - Number(unavailable(b)));
    candidates.forEach(l => {
      const selected = Word.duplicate(importedLawyers, l), existing = selected && importedWord?.existing.some(p => p.id === selected.id);
      const b = element('button', 'lawyer-result'), text = element('div'); b.type = 'button';
      text.append(element('strong', '', l.name), element('small', '', `${l.directPhone} · ${l.email}`));
      b.append(text, element('span', 'add-sign', existing ? '이미 포함' : selected ? '선택됨' : '+'));
      b.disabled = !importedWord || !!existing || !!selected || importBusy;
      b.setAttribute('aria-label', l.name + (existing ? ' 이미 포함' : selected ? ' 선택됨' : ' 변호사 추가'));
      b.onclick = () => {importedLawyers.push(G.clone(l)); importDirty = true; renderWordSelection();};
      results.append(b);
    });
    if (!candidates.length) results.append(element('div', 'empty-message', '검색 결과가 없습니다. 명단 관리에서 변호사를 추가할 수 있습니다.'));
    const errors = [], seen = [];
    importedLawyers.forEach(l => {
      if (Word.duplicate(seen, l)) errors.push(`${l.name}: 이름 또는 이메일이 표시할 목록에서 중복됩니다.`);
      seen.push(l);
      try {G.readMaster(G.masterFile([l]));} catch (e) {errors.push(e.message);}
    });
    if (importedLawyers.length > 100) errors.push('담당변호사는 최대 100명까지 표시할 수 있습니다.');
    $('existing-word-check').textContent = errors.length ? errors.join('\n') : importedLawyers.length ? `최종 ${importedLawyers.length}명을 위 순서대로 표시합니다. 기존·추가 변호사 모두 수정·삭제·순서 변경이 가능합니다. 원본 본문은 유지합니다.` : importedWord?.existing.length ? '담당변호사 없는 수정본으로 저장합니다. 원본 본문·서명부는 유지합니다.' : '담당변호사를 한 명 이상 선택해 주세요.';
    $('existing-word-check').classList.toggle('error', !!errors.length);
    $('existing-word-export').disabled = importBusy || !importedWord || !importedLawyers.length && !importedWord.existing.length || !!errors.length;
    $('existing-word-export').textContent = importedWord?.hasEdits(importedLawyers) ? '변호사 수정본 저장' : '변호사 추가본 저장';
  }
  async function loadExistingWord(file) {
    if (!file) return;
    if (importDirty && !await confirmAction('저장 요청하지 않은 변호사 목록 변경이 있습니다. 새 파일을 선택하면 현재 목록의 수정 사항이 초기화됩니다.', '기존 Word 파일을 바꿀까요?', '파일 바꾸기')) {
      $('existing-word-file').value = '';
      $('existing-word-status').classList.remove('error');
      $('existing-word-status').textContent = `파일 변경을 취소했습니다. ${importedWord.filename}과 수정 중인 변호사 목록을 그대로 유지합니다.`;
      return;
    }
    const generation = ++importGeneration;
    importedWord = null; importedLawyers = []; importDirty = false; importBusy = true;
    $('existing-word-summary').hidden = true; $('existing-word-selection').hidden = true;
    const status = $('existing-word-status'); status.classList.remove('error'); status.textContent = '공문을 내 PC에서 확인하고 있습니다…'; renderWordSelection();
    try {
      if (file.size > Word.MAX_FILE) throw new Error('20MB 이하의 공문 DOCX 파일을 선택해 주세요.');
      const loaded = await Word.open(await file.arrayBuffer(), file.name);
      if (generation !== importGeneration) return;
      importedWord = loaded; importedLawyers = G.clone(loaded.existing); $('existing-word-search').value = '';
      $('existing-word-filename').textContent = `현재 기준 파일: ${file.name}`;
      status.textContent = `${file.name} · ${loaded.insertionDescription}`;
      $('existing-word-count').textContent = `(${loaded.existing.length}명)`;
      const people = $('existing-word-people'); people.replaceChildren();
      loaded.existing.forEach(l => {const person = element('div', 'word-import-person'); person.append(element('strong', '', l.name), element('small', '', l.contactText)); people.append(person);});
      if (!loaded.existing.length) people.append(element('div', 'word-import-person', '원본에는 담당변호사가 없습니다. 아래 목록에서 선택하면 서명부 아래에 추가됩니다.'));
      $('existing-word-warnings').textContent = loaded.warnings.join('\n');
      $('existing-word-summary').hidden = false; $('existing-word-selection').hidden = false;
    } catch (e) {
      if (generation !== importGeneration) return;
      status.textContent = e.message; status.classList.add('error');
    } finally {if (generation === importGeneration) {importBusy = false; renderWordSelection();}}
  }
  async function exportExistingWord() {
    if (!importedWord || !importedLawyers.length && !importedWord.existing.length || importBusy) return;
    if (!importedLawyers.length && !await confirmAction('담당변호사 목록을 모두 제외한 별도 수정본을 저장합니다. 원본 파일은 유지됩니다.', '담당변호사 없이 저장할까요?', '변호사 없이 저장')) return;
    try {
      const edited = importedWord.hasEdits(importedLawyers), data = importedWord.save(G.clone(importedLawyers));
      const stem = importedWord.filename.replace(/\.docx$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || '기존공문';
      download(data, `${stem}_${edited ? '변호사수정본' : '변호사추가본'}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      importDirty = false;
      $('existing-word-status').classList.remove('error');
      $('existing-word-status').textContent = `최종 ${importedLawyers.length}명으로 ${edited ? '수정본' : '추가본'} 저장을 시작했습니다. 원본 파일은 그대로입니다. 다운로드 파일을 Word에서 열어 최종 배치를 확인하세요.`;
    } catch (e) {$('existing-word-status').textContent = e.message; $('existing-word-status').classList.add('error');}
  }
  function editable(node, target, label) {
    node.classList.add('editable'); node.dataset.previewEdit = target; node.tabIndex = 0;
    node.setAttribute('role', 'button'); node.setAttribute('aria-label', (label || target) + ' 수정');
    return node;
  }
  function visibleText(s, fallback) {
    const e = element('span', s ? '' : 'doc-placeholder', s || fallback);
    return e;
  }
  function previewBlocks() {
    const blocks = [], meta = element('div', 'doc-meta');
    // Yellow as in Word: the date and the ‘*’ of ‘26-*’ are still to be confirmed.
    const date = element('div', 'doc-top-date'), dateText = G.formatDate(current.sendDate);
    date.append(dateText ? element('mark', 'doc-mark', dateText) : visibleText('', '[발신일자]')); editable(date, 'sendDate', '발신일자'); meta.append(date);
    const table = element('table'), tbody = element('tbody');
    const refRow = element('tr'), refCell = element('td');
    current.firmRef.split(/(\*+)/).filter(Boolean).forEach(part => refCell.append(part[0] === '*' ? element('mark', 'doc-mark', part) : document.createTextNode(part)));
    editable(refCell, 'firmRef', '관리번호'); refRow.append(element('td', '', G.FIRM.label + ':'), refCell); tbody.append(refRow);
    [['수  신:', 'agencyName', current.agencyName, '[수신 기관]'], ...(current.refDept ? [['참  조:', 'refDept', current.refDept, '']] : []), ['제  목:', 'title', current.title, '[제목]']].forEach(([label, field, text, placeholder]) => {
      const tr = element('tr'), td = element('td'); td.append(visibleText(text, placeholder)); editable(td, field, labels[field]); tr.append(element('td', '', label), td); tbody.append(tr);
    });
    table.append(tbody); meta.append(table, element('div', 'meta-line')); blocks.push({node: meta});
    const numbered = (n, text, target) => {
      const p = element('div', 'doc-paragraph'); p.append(element('span', 'para-number', n ? n + '.' : ''), element('span', 'para-text', text));
      editable(p, target, n === 1 ? '첫 문단' : '본문'); return p;
    };
    const greeting = element('div'); greeting.append(numbered(1, G.greetingText(current), 'greeting'), element('div', 'doc-spacer')); blocks.push({node: greeting});
    const body = G.bodyParagraphs(current);
    body.forEach((text, i) => {
      if (i && current.docType === 'extension') blocks.push({node: element('div', 'doc-spacer')});  // as in Word (연장신청 samples)
      blocks.push({node: numbered(i + 2, text, 'body'), text, number: i + 2, make: t => numbered(i + 2, t, 'body'), continue: t => numbered(null, t, 'body')});
    });
    const at = G.attachmentLines(current);
    if (at.length) blocks.push({node: element('div', 'doc-spacer')});
    at.forEach((text, i) => {
      const p = element('div', 'doc-attachments' + (i ? ' continuation' : ''));
      // Several attachments: in Word ‘첨부’ is followed by a tab to 27pt, where the next lines are indented.
      if (!i && at.length > 1) p.append(element('span', 'attachment-label', text.slice(0, 3)), document.createTextNode(text.slice(3))); else p.textContent = text;
      editable(p, 'attachment:' + i, '첨부 항목'); blocks.push({node: p});
    });
    blocks.push({node: element('div', 'doc-spacer')});
    const agent = element('div', 'doc-agent'); agent.append(visibleText(G.agentName(current), '[제출 주체]'), document.createTextNode(current.docType === 'opinion' ? ' 대리인' : '의 대리인')); editable(agent, 'agentOverride', '대리인 표시');
    const logo = element('img', 'signature-logo'); logo.src = templates.assets.signature; logo.alt = G.FIRM.name; logo.width = 160; logo.height = 20;
    // Each line is its own paragraph in Word, which (like the 양식, with no ‘keep with next’: it would mark the lines with
    // squares on Windows) may end a page anywhere: after ‘대리인’, the logo, a name or the empty line after a lawyer.
    const lawyerLines = (l, i) => {
      const [text, email] = G.contactParts(l), name = element('div', 'doc-lawyer-name', '담당변호사   ' + G.spaceName(l.name));
      const contact = element('div', 'doc-lawyer-contact', text); contact.dataset.lawyer = l.name;
      if (email) contact.append(element('span', 'condensed', email));
      [name, contact].forEach(e => editable(e, 'lawyer:' + i, l.name + ' 연락처'));
      return [{node: name}, {node: contact}];
    };
    blocks.push({node: element('div', 'doc-spacer')}, {node: agent}, {node: logo}, {node: element('div', 'doc-spacer')});
    current.lawyers.forEach((l, i) => blocks.push(...(i ? [{node: element('div', 'doc-spacer')}] : []), ...lawyerLines(l, i)));
    return blocks;
  }
  // 의견서 겉표지: letterhead, a double-ruled box with the case, the party and the firm below.
  function coverPageNode() {
    const page = element('div', 'doc-cover-page'), box = element('div', 'doc-cover-box');
    const caseLine = element('div', 'doc-cover-case'); caseLine.append(document.createTextNode('- '), visibleText(current.caseName.trim(), '[사건명]'), document.createTextNode(' -'));
    box.append(element('div', 'doc-cover-title', '심사보고서에 대한 의견서'), editable(caseLine, 'caseName', '사건명'));
    if (current.caseNo.trim()) box.append(editable(element('div', 'doc-cover-no', `(사건번호: ${current.caseNo.trim()})`), 'caseNo', '사건번호'));
    const party = element('div', 'doc-cover-party'), who = element('div');
    who.append(document.createTextNode(current.partyRole + ' '), visibleText(current.submitter, '[제출 주체]'));
    party.append(editable(who, 'submitter', '제출 주체'), element('div', '', '대리인 ' + G.FIRM.name));
    page.append(box, party); return page;
  }
  // 목차: Word builds it from the headings; the preview shows the pages the headings fall on here.
  function tocBlocks(pageOf) {
    const blocks = [{node: element('div', 'doc-toc-title', '목  차')}];
    G.numberedItems(current).forEach((it, i) => {
      const row = element('div', `doc-toc-row level${it.level}`);
      row.append(element('span', 'toc-number', it.number), element('span', 'toc-text', it.heading), element('span', 'toc-dots'), element('span', 'toc-page', String(pageOf[i] || '')));
      blocks.push({node: editable(row, 'item:' + i, `${i + 1}번째 제목`)});
    });
    return blocks;
  }
  // 첨부 본문 pages: same paper, continuation header, numbering restarts like Word's second section.
  function bodyBlocks() {
    const blocks = [], opinion = current.docType === 'opinion';
    if (opinion) {
      blocks.push({node: element('div', 'doc-spacer')});
      if (current.confidentialNote.trim()) blocks.push({node: editable(element('div', 'doc-confidential', current.confidentialNote.trim()), 'confidentialNote', '비공개 요청 문구')}, {node: element('div', 'doc-spacer')});
      const title = element('div', 'doc-opinion-title'); title.append(visibleText(G.bodyTitle(current), '[본문 제목]')); editable(title, 'bodyTitle', '본문 제목');
      blocks.push({node: title}, {node: element('div', 'doc-spacer')});
    } else {
      blocks.push({node: element('div', 'doc-body-marker', '<첨부>')});
      const title = element('div', 'doc-body-title'); title.append(visibleText(G.bodyTitle(current), '[본문 제목]')); editable(title, 'bodyTitle', '본문 제목');
      blocks.push({node: title}, {node: element('div', 'doc-spacer')});
    }
    G.numberedItems(current).forEach((it, i) => {
      const heading = (t, first = true) => {
        const h = element('div', `doc-item ${opinion ? 'opinion' : 'level'}${it.level}`);
        if (first) h.dataset.toc = String(i);
        h.append(element('span', 'item-number', first ? it.number : ''), element('span', 'item-text', t));
        return editable(h, 'item:' + i, `${i + 1}번째 ${opinion ? '제목' : '요청사항'}`);
      };
      blocks.push({node: heading(it.heading), text: it.heading, make: t => heading(t), continue: t => heading(t, false)});
      it.notes.forEach(n => {
        const note = t => editable(element('div', `doc-note level${it.level}`, t), 'item:' + i, '세부 내용');
        blocks.push({node: note(n), text: n, make: note, continue: note});
      });
      if (it.parent) {blocks.push({node: element('div', 'doc-spacer')}); return;}
      const answer = element('div', 'doc-answer'); answer.append(element('span', '', opinion ? '의견 작성란' : '답변 작성란'));
      blocks.push({node: element('div', 'doc-spacer')}, {node: answer}, {node: element('div', 'doc-spacer')});
    });
    const refs = G.refLines(current);
    if (refs.length) {
      // Word starts the 첨부서류 list on a new page (manual page break in place of the last spacer).
      if (blocks[blocks.length - 1].node?.classList.contains('doc-spacer')) blocks.pop();
      blocks.push({pageBreak: true}, {node: element('div', 'doc-ref-heading', '첨  부  서  류')}, {node: element('div', 'doc-spacer')});
      refs.forEach(r => {const row = element('div', 'doc-ref-row'); row.append(element('span', 'ref-lead', r.lead), element('span', 'ref-text', r.text)); blocks.push({node: row});});
    }
    return blocks;
  }
  function renderPreview() {
    clearTimeout(previewTimer); renderValidation(); syncBodyMode();
    const pages = $('pages'), measure = $('measure'); pages.replaceChildren(); measure.replaceChildren();
    measure.classList.toggle('additional-paper', current.docType === 'additional');
    const opinion = current.docType === 'opinion', sections = [{kind: 'cover', groups: paginate(previewBlocks())}];
    if (G.hasBody(current)) {
      const body = paginate(bodyBlocks());
      if (opinion) {
        // 공문 표지 → 겉표지 → 목차 (i, ii) → 본문 (1, 2 …), each its own Word section.
        const pageOf = {};
        body.forEach((nodes, p) => nodes.forEach(n => {const k = n.dataset?.toc; if (k !== undefined && !(k in pageOf)) pageOf[k] = p + 1;}));
        sections.push({kind: 'title', groups: [[typeset(coverPageNode())]]}, {kind: 'toc', groups: paginate(tocBlocks(pageOf))});
      }
      sections.push({kind: 'body', groups: body});
    }
    const available = Math.max(180, $('preview-scroll').clientWidth - (innerWidth <= 1060 ? 32 : 60));
    const scale = zoom === null ? Math.min(1, available / (210 * 96 / 25.4)) : zoom;
    let pageNo = 0;
    sections.forEach(({kind, groups}) => groups.forEach((nodes, i) => {
      pageNo++;
      const frame = element('div', 'page-frame'), paper = element('article', 'paper' + (current.docType === 'additional' ? ' additional-paper' : ''));
      frame.style.width = `${210 * 96 / 25.4 * scale}px`; frame.style.height = `${297 * 96 / 25.4 * scale}px`; paper.style.transform = `scale(${scale})`;
      paper.setAttribute('aria-label', {cover: `공문 표지 ${i + 1}페이지`, title: '의견서 겉표지', toc: `목차 ${i + 1}페이지`, body: `${opinion ? '의견서 본문' : '첨부 본문'} ${i + 1}페이지`}[kind]);
      const header = element('img', 'page-header'); header.src = kind === 'title' || kind === 'cover' && !i ? templates.assets.header : templates.assets.continuation; header.alt = G.FIRM.name + ' 레터헤드';
      const content = element('div', 'page-content'); nodes.forEach(n => content.append(n));
      const footer = kind === 'title' ? element('div', 'page-footer blank') : element('div', 'page-footer', kind === 'toc' ? `${lowerRoman(i + 1)} / ${lowerRoman(groups.length)}` : `${i + 1} / ${groups.length}`);
      paper.append(header, content, footer); frame.append(paper); pages.append(frame);
    }));
    lastPages = pageNo;
    const count = kind => sections.find(x => x.kind === kind)?.groups.length || 0;
    $('page-count').textContent = opinion && sections.length > 1 ? `표지 ${count('cover')}쪽 · 겉표지 · 목차 · 본문 ${count('body')}쪽` : sections.length > 1 ? `표지 ${count('cover')}쪽 · 본문 ${count('body')}쪽` : `${lastPages}페이지`;
    $('zoom-label').textContent = `${Math.round(scale * 100)}%`; measure.replaceChildren();
  }
  // The preview set as Word sets it: typed quotes become “ ” ‘ ’ in Times New Roman (as in the firm's documents), and a space
  // next to Korean is half a Korean character wide (the 양식's ‘balance single-byte and double-byte widths’ setting); other spaces
  // stay as wide as a Times New Roman space.
  const KOREAN = '\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3\u4e00-\u9fff';
  const marks = new RegExp(`(?<=[${KOREAN}]) +| +(?=[${KOREAN}])|[“”‘’]+`, 'g');
  function typeset(node) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), texts = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('.wide-space, .quote-mark')) texts.push(walker.currentNode);
    for (const t of texts) {
      const text = G.smartQuotes(t.data), parts = [];
      let at = 0;
      for (const m of text.matchAll(marks)) {
        if (m.index > at) parts.push(document.createTextNode(text.slice(at, m.index)));
        parts.push(element('span', m[0][0] === ' ' ? 'wide-space' : 'quote-mark', m[0])); at = m.index + m[0].length;
      }
      if (!parts.length) {if (text !== t.data) t.data = text; continue;}
      if (at < text.length) parts.push(document.createTextNode(text.slice(at)));
      t.replaceWith(...parts);
    }
    return node;
  }
  // The preview font's own space, in em, so that the spaces above come out at Word's widths (see .wide-space in styles.css).
  function measureSpace() {
    const probe = element('span'); probe.style.cssText = 'font-size:100px;word-spacing:0;white-space:pre';
    probe.textContent = '가 가'; $('measure').replaceChildren(probe); const spaced = probe.getBoundingClientRect().width;
    probe.textContent = '가가'; const plain = probe.getBoundingClientRect().width; $('measure').replaceChildren();
    if (spaced > plain) document.documentElement.style.setProperty('--space-em', ((spaced - plain) / 100).toFixed(4));
  }
  function paginate(blockList) {
    const measure = $('measure');
    const height = 227 * 96 / 25.4, groups = [[]]; let used = 0;
    function measureHeight(node) {measure.replaceChildren(node.cloneNode(true)); return measure.getBoundingClientRect().height;}
    function push(node, h) {
      if (used + h > height + .5 && groups[groups.length - 1].length) {groups.push([]); used = 0;}
      groups[groups.length - 1].push(node); used += h;
    }
    for (const b of blockList) {
      if (b.pageBreak) {if (groups[groups.length - 1].length) {groups.push([]); used = 0;} continue;}
      let h = measureHeight(typeset(b.node));
      // Word (the 양식 turns widow control off) fills a page to its last line and carries the rest of a paragraph over.
      const line = 24 * 96 / 72;
      if (b.text && (h > height || used + h > height + .5 && height - used >= line - .5)) {
        // Quotes are turned before cutting, so a piece that starts with one keeps the right direction.
        let remaining = [...G.smartQuotes(b.text)], first = true;
        while (remaining.length) {
          if (height - used < line - .5) {groups.push([]); used = 0;}
          const maker = first ? b.make : b.continue;
          let lo = 1, hi = remaining.length, best = 1;
          while (lo <= hi) {const mid = (lo + hi) >> 1; const mh = measureHeight(typeset(maker(remaining.slice(0, mid).join('')))); if (mh <= height - used) {best = mid; lo = mid + 1;} else hi = mid - 1;}
          // Prefer a natural word boundary without making a very short fragment.
          if (best < remaining.length) {const fragment = remaining.slice(0, best).join(''); const space = fragment.lastIndexOf(' '); if (space > best * .75) best = space + 1;}
          const part = typeset(maker(remaining.splice(0, best).join(''))); push(part, measureHeight(part)); first = false;
        }
      } else {push(b.node, h);}
    }
    // Do not leave a spacer-only page at the end.
    if (groups.length > 1 && groups[groups.length - 1].every(n => n.classList.contains('doc-spacer'))) groups.pop();
    return groups;
  }
  function renderMaster() {
    const list = $('master-list'); list.replaceChildren();
    master.forEach(l => {
      const row = element('div', 'master-row'), main = element('div'), actions = element('div', 'inline-actions');
      main.append(element('strong', '', l.name), element('small', '', `${l.directPhone}${l.subPhone ? '/' + l.subPhone : ''} · ${l.email}`));
      const edit = element('button', 'button quiet', '수정'); edit.onclick = () => {
        $('lawyer-id').value = l.id; $('lawyer-name').value = l.name; $('lawyer-phone').value = l.directPhone; $('lawyer-subphone').value = l.subPhone; $('lawyer-email').value = l.email;
        $('lawyer-editor-title').textContent = '변호사 수정'; $('cancel-lawyer-edit').hidden = false; $('lawyer-name').focus();
      };
      const remove = element('button', 'button quiet', '삭제'); remove.onclick = async () => {
        if (await confirmAction(`${l.name} 변호사를 선택용 명단에서 삭제할까요? 현재 공문에 선택한 연락처는 유지됩니다.`, '명단에서 삭제', '삭제')) {
          master = master.filter(x => x.id !== l.id); masterDirty = true; renderMaster(); renderLawyerResults(); resetLawyerForm();
        }
      };
      actions.append(edit, remove); row.append(main, actions); list.append(row);
    });
    if (!master.length) list.append(element('div', 'empty-message', '등록된 변호사가 없습니다. 아래에서 추가해 주세요.'));
  }
  function resetLawyerForm() {$('lawyer-form').reset(); $('lawyer-id').value = ''; $('lawyer-editor-title').textContent = '변호사 추가'; $('cancel-lawyer-edit').hidden = true;}
  async function readJson(file) {
    if (!file) return null;
    if (file.size > 2 * 1024 * 1024) throw new Error('파일은 2MB 이하여야 합니다.');
    const text = await file.text();
    try {return JSON.parse(text.replace(/^\uFEFF/, ''));} catch {throw new Error('JSON 파일을 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.');}
  }
  function buildCandidates() {
    const s = $('request-text').value;
    if (!s.trim()) {toast('요구서 텍스트를 먼저 붙여넣어 주세요.', true); return;}
    const result = G.extractRequest(s), box = $('extract-result'); box.replaceChildren(); box.hidden = false;
    box.append(element('p', 'section-note', '원문을 확인한 뒤 적용할 값만 선택하세요. 빈칸은 기존 값을 유지합니다.'));
    function candidates(label, id, values, format = x => x) {
      const div = element('div', 'candidate-field'), lab = element('label', '', label), sel = element('select'); sel.id = id;
      const blank = element('option', '', values.length ? '적용하지 않음' : '후보 없음'); blank.value = ''; sel.append(blank);
      values.forEach(v => {const opt = element('option', '', format(v)); opt.value = v; sel.append(opt);});
      if (values.length === 1) sel.value = values[0]; lab.htmlFor = id; div.append(lab, sel); box.append(div);
    }
    candidates('요구일자 후보', 'candidate-date', result.dates, G.formatDate);
    candidates('문서번호 후보', 'candidate-number', result.numbers);
    const dep = element('div', 'candidate-field'), input = element('input'), label = element('label', '', '참조 부서'); input.id = 'candidate-department'; input.value = result.refDept; label.htmlFor = input.id; dep.append(label, input); box.append(dep);
    const apply = element('button', 'button secondary', '선택한 정보 적용'); apply.type = 'button'; apply.style.marginTop = '10px'; apply.onclick = () => {
      const selected = [['requestDate', $('candidate-date').value], ['requestDocNo', $('candidate-number').value], ['refDept', input.value.trim()]].filter(([, v]) => v);
      if (!selected.length) {toast('적용할 후보를 선택하거나 입력해 주세요.', true); return;}
      selected.forEach(([k, v]) => current[k] = v); changed(); syncFields(); toast('선택한 요청 정보를 반영했습니다.');
    }; box.append(apply);
  }
  /* ---------- 요청사항 (첨부 본문) ---------- */
  function renderItems() {
    const list = $('items'); list.replaceChildren(); $('item-count').textContent = `${current.items.length}개`;
    const numbered = G.numberedItems({...current, includeNotes: true});
    current.items.forEach((it, i) => {
      const row = element('div', `request-item level${it.level}`); row.dataset.item = String(i);
      const head = element('div', 'request-head');
      const label = element('input', 'request-label'); label.value = it.label; label.placeholder = '원문 번호'; label.maxLength = 50;
      label.setAttribute('aria-label', `${i + 1}번째 요청사항의 원문 번호`); label.oninput = () => {it.label = label.value; changed();};
      const level = element('button', 'level-button', it.level === 1 ? '하위로 →' : '← 상위로'); level.type = 'button';
      const opinion = current.docType === 'opinion';
      level.title = it.level === 1 ? `한 단계 아래(${opinion ? '1.' : '가.'}) ${opinion ? '제목' : '항목'}으로` : `한 단계 위(${opinion ? 'I.' : '1.'}) ${opinion ? '제목' : '항목'}으로`; level.disabled = it.level === 1 && i === 0;
      level.setAttribute('aria-label', `${i + 1}번째 요청사항 ${level.title}`);
      level.onclick = () => {it.level = it.level === 1 ? 2 : 1; changed(); renderItems();};
      const actions = orderButtons(i, current.items.length, d => {move(current.items, i, d); if (current.items[0].level !== 1) current.items[0].level = 1; renderItems();},
        async () => {if ((it.text.trim() || it.notes.length) && !await confirmAction(`${numbered[i].number} ${current.docType === 'opinion' ? '제목' : '요청사항'}을 삭제할까요?`, current.docType === 'opinion' ? '제목 삭제' : '요청사항 삭제', '삭제')) return;
          current.items.splice(i, 1); if (current.items[0]?.level === 2) current.items[0].level = 1; changed(); renderItems();});
      actions.prepend(level);
      head.append(element('span', 'request-number', numbered[i].number), label, actions);
      const text = element('textarea', 'request-text'); text.value = it.text; text.maxLength = 20000;
      text.rows = Math.min(7, Math.max(current.docType === 'opinion' ? 1 : 2, Math.ceil(it.text.length / 36))); text.setAttribute('aria-label', `${i + 1}번째 ${current.docType === 'opinion' ? '제목' : '요청사항 내용'}`);
      text.oninput = () => {it.text = text.value; changed();};
      const notes = element('textarea', 'request-notes'); notes.value = it.notes.join('\n'); notes.maxLength = 50000;
      notes.placeholder = '세부 내용 (*, ※ 등 · 줄마다 한 문단 · 없으면 비워 두기)'; notes.rows = Math.min(6, Math.max(1, it.notes.length));
      notes.setAttribute('aria-label', `${i + 1}번째 요청사항의 세부 내용`);
      notes.oninput = () => {it.notes = notes.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean); changed();};
      row.append(head, text, notes); list.append(row);
    });
    if (!current.items.length) list.append(element('div', 'empty-message', current.docType === 'opinion' ? '‘+ 제목 추가’를 눌러 본문 제목을 넣으세요.' : '요청사항 목록을 올리거나 ‘+ 요청사항 추가’를 눌러 주세요.'));
  }
  function focusItem(index) {
    const row = $('items').querySelector(`[data-item="${index}"]`);
    if (!row) return;
    row.scrollIntoView({behavior: 'smooth', block: 'center'}); row.querySelector('.request-text').focus();
    row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1200);
  }
  function renderRefs() {
    const list = $('refs'); list.replaceChildren(); $('ref-count').textContent = `${current.refMaterials.length}건`;
    current.refMaterials.forEach((r, i) => {
      const row = element('div', 'ordered-item'), main = element('div', 'item-main ref-inputs');
      const no = element('input'); no.value = r.no; no.maxLength = 100; no.placeholder = '번호'; no.setAttribute('aria-label', `${i + 1}번째 참고자료 번호`); no.oninput = () => {r.no = no.value; changed();};
      const text = element('input'); text.value = r.text; text.maxLength = 3000; text.placeholder = '자료명'; text.setAttribute('aria-label', `${i + 1}번째 참고자료명`); text.oninput = () => {r.text = text.value; changed();};
      main.append(no, text);
      row.append(element('span', 'order-number', String(i + 1)), main, orderButtons(i, current.refMaterials.length,
        d => {move(current.refMaterials, i, d); renderRefs();}, () => {current.refMaterials.splice(i, 1); changed(); renderRefs();}));
      list.append(row);
    });
  }
  function renderRequestChips() {
    const box = $('request-name-chips'); box.replaceChildren();
    const derived = current.requestTitle ? Analyze.requestNameFrom(current.requestTitle) : '';
    [...new Set([derived, ...G.requestNames].filter(Boolean))].filter(n => n !== current.requestName).slice(0, 6).forEach(n => {
      const b = element('button', 'chip', n); b.type = 'button'; b.setAttribute('aria-label', `요청 명칭을 ${n}(으)로`);
      b.onclick = () => updateField('requestName', n); box.append(b);
    });
  }

  /* ---------- 공문·요청사항 올리기 ---------- */
  const docTexts = doc => doc.paragraphs.map(p => p.text);
  const idleStatus = '또는 파일을 이 칸에 끌어다 놓기';
  function setStatus(slot, text, state = '') {
    const box = $('status-' + slot); box.textContent = text; box.className = 'drop-status' + (state ? ' ' + state : '');
    $('drop-' + slot).classList.toggle('loaded', state === 'done');
  }
  function describe(doc) {
    if (!Analyze.looksLikeGongmun(doc) && Analyze.looksLikeExamReport(doc)) return `심사보고서 · 피심인 ${Analyze.examReport(doc).parties.length}곳`;
    const kind = {pdf: 'PDF', hwp: '한글(HWP)', hwpx: '한글(HWPX)', docx: 'Word', text: '텍스트'}[doc.kind] || doc.kind;
    return `${kind} · 문단 ${doc.paragraphs.length}개`;
  }
  function showSource(slot) {
    // 연장신청 shows ② only when a file is in it, so that file can be seen and replaced.
    document.body.classList.toggle('has-second', !!sources.requests); syncTypeTexts();
    if (reading[slot]) return;  // a file dropped here is still being read
    const s = sources[slot];
    if (!s) {setStatus(slot, idleStatus); return;}
    const warn = s.doc.warnings.length ? ' · ' + s.doc.warnings.join(' ') : '';
    setStatus(slot, `${s.name} · ${describe(s.doc)}${warn}`, s.doc.warnings.length && !s.doc.paragraphs.length ? 'error' : 'done');
  }
  // What a file is for: the 의견제출 요청 공문 and the 심사보고서 make a 의견서; any other 공문 and a request list make a 회신.
  const kindOf = (slot, doc) => (slot === 'gongmun' ? Analyze.gongmun(doc).opinion : Analyze.looksLikeExamReport(doc)) ? 'opinion' : 'reply';
  // The same 공문 again (another copy or format): the same 문서번호, or the same 제목 and 시행일 when a copy has no number found.
  function sameGongmun(a, b) {
    const x = Analyze.gongmun(a), y = Analyze.gongmun(b);
    return x.docNo && y.docNo ? x.docNo === y.docNo : x.title === y.title && x.date === y.date;
  }
  // Which box each file of one upload goes in, by what it is rather than where it was dropped.
  function place(slot, docs, notes) {
    const other = slot === 'gongmun' ? 'requests' : 'gongmun';
    const [a, b] = docs.map(d => ({...d, what: Analyze.looksLikeGongmun(d.doc) ? 'gongmun' : Analyze.looksLikeExamReport(d.doc) ? 'report' : 'list'}));
    // Two files: the 공문 goes to ①, the other to ②.
    if (b) return a.what === 'gongmun' ? {gongmun: a, requests: b} : b.what === 'gongmun' ? {gongmun: b, requests: a} : {[slot]: a, [other]: b};
    let target = slot;
    const g = sources.gongmun;
    if (a.what === 'report') target = 'requests';
    // A 공문 dropped on ② goes to ①, except a 회신 공문 next to another 회신 공문 in ① (some request lists look like a 공문).
    else if (a.what === 'gongmun') {if (!g || kindOf('gongmun', a.doc) === 'opinion' || kindOf('gongmun', g.doc) === 'opinion' || sameGongmun(g.doc, a.doc)) target = 'gongmun';}
    else if (slot === 'gongmun' && !sources.requests && Analyze.requests(a.doc).items.length) target = 'requests';
    // 연장신청 is made from the 공문 alone: anything else waits in ② (shown then), not read as a 공문.
    else if (current.docType === 'extension') target = 'requests';
    if (target !== slot) notes.push(target === 'gongmun' ? `${a.name}은(는) 공문 형식(수신·제목·시행)이어서 ‘받은 공문’으로 읽었습니다.` : a.what === 'report' ? `${a.name}은(는) 심사보고서여서 ②칸(심사보고서)으로 읽었습니다.` :
      current.docType === 'extension' ? `${a.name}은(는) 공문 형식(수신·제목·시행)이 아니어서 ②칸에 두었습니다. 연장신청에는 이 파일의 제출기한·담당 부서만 씁니다. 받은 공문을 ①에 올려 주세요.` : `${a.name}은(는) 공문 형식이 아니어서 ‘요청사항 목록’으로 읽었습니다.`);
    return {[target]: a};
  }
  // The same file put in a box again (to read it once more).
  const sameFile = (a, b) => a.name === b.name && JSON.stringify(docTexts(a.doc)) === JSON.stringify(docTexts(b.doc));
  let uploadSeq = 0, applying = Promise.resolve();
  // lastDrop / lastPut: the latest upload dropped on / put in each box; reading: uploads dropped on each box that are still being read.
  const lastDrop = {gongmun: 0, requests: 0}, lastPut = {gongmun: 0, requests: 0}, reading = {gongmun: 0, requests: 0};
  // Files still being read belong to the case being replaced: stop them. True if there were any.
  function stopReading() {readGeneration++; return !!(reading.gongmun || reading.requests);}
  // One upload (one or two files): read them, then put each in its box, clear what is left of the previous case and fill the form.
  async function readFiles(slot, files) {
    const list = [...files], docs = [], notes = [], generation = readGeneration, seq = ++uploadSeq;
    if (list.length > 2) {toast(`한 번에 두 파일(공문 1개와 요청사항 목록 또는 심사보고서 1개)까지 올릴 수 있습니다. ${list.length}개를 놓아서 읽지 않았습니다.`, true); return;}
    lastDrop[slot] = seq; reading[slot]++;
    setStatus(slot, `${list.map(f => f.name).join(', ')} 읽는 중…`, 'busy');
    for (const file of list) {
      try {docs.push({name: file.name, doc: await Readers.read(file.name, await file.arrayBuffer())});}
      catch (e) {notes.push(`${file.name}: ${e.message}`);}
    }
    reading[slot]--;
    // Uploads go into the boxes one at a time, in the order they were dropped, so their questions never overlap.
    const run = applying.then(() => putInBoxes(slot, seq, generation, docs, notes));
    applying = run.catch(() => {});
    return run;
  }
  async function putInBoxes(slot, seq, generation, docs, notes) {
    if (generation !== readGeneration) {showSource(slot); return;}  // ‘새 공문’ was pressed while reading
    if (!docs.length) {if (lastDrop[slot] === seq) setStatus(slot, notes.join(' '), 'error'); return;}
    const placed = place(slot, docs, notes), old = {...sources};
    // A box a later upload was dropped on or already put in keeps that later file (reading may finish out of order).
    for (const box of ['gongmun', 'requests']) if (placed[box] && Math.max(lastDrop[box], lastPut[box]) > seq) delete placed[box];
    if (!placed.gongmun && !placed.requests) {showSource(slot); return;}
    const kind = placed.gongmun ? kindOf('gongmun', placed.gongmun.doc) : kindOf('requests', placed.requests.doc);
    const sameCase = !!(placed.gongmun && old.gongmun && sameGongmun(old.gongmun.doc, placed.gongmun.doc));
    const clear = box => {
      notes.push(`${box === 'gongmun' ? '①' : '②'}칸의 ‘${sources[box].name}’은(는) 앞 사건의 파일이어서 비웠습니다. 이 사건의 파일이면 다시 올려 주세요.`);
      sources[box] = null; $('file-' + box).value = '';
    };
    // A file for the other kind of document (회신 ↔ 의견서), or a different 공문, starts a new case and the other box's file goes.
    // ‘own’: the ② file was put in with the present 공문. Only a ② swapped in after that 공문 may be the first file of the next case; then ask.
    if (placed.gongmun && !placed.requests && old.requests) {
      const keep = kindOf('requests', old.requests.doc) === kind && (sameCase || !old.gongmun || !old.requests.own &&
        await confirmAction(`①에 다른 공문을 올렸습니다. ②칸의 ‘${old.requests.name}’은(는) 앞 공문 다음에 바꿔 올린 파일입니다. 새 공문과 함께 쓸까요? ‘취소’를 누르면 ②칸을 비웁니다.`, '②칸 파일도 함께 쓸까요?', '함께 쓰기'));
      if (keep) old.requests.own = true; else if (sources.requests === old.requests) clear('requests');
    }
    if (placed.requests) {
      if (!placed.gongmun && old.gongmun && kindOf('gongmun', old.gongmun.doc) !== kind) clear('gongmun');
      placed.requests.own = !!placed.gongmun || !!sources.gongmun && (!old.requests || old.requests.own && sameFile(old.requests, placed.requests));
    }
    // The same 공문 (or the same ② file) again keeps its id: the other tabs' documents still belong to it.
    const idFor = box => box === 'gongmun' ? (sameCase ? old.gongmun.id : ++fileSeq) : (old.requests && sameFile(old.requests, placed.requests) ? old.requests.id : ++fileSeq);
    for (const box of ['gongmun', 'requests']) if (placed[box]) {sources[box] = {name: placed[box].name, doc: placed[box].doc, own: !!placed[box].own, id: idFor(box)}; lastPut[box] = seq;}
    showSource('gongmun'); showSource('requests');
    await applyAnalysis(placed.requests ? 'requests' : 'gongmun', sameCase, {newGongmun: !!placed.gongmun && !sameCase});
    if (current.docType === 'extension' && placed.gongmun && placed.requests && !Analyze.looksLikeExamReport(placed.requests.doc)) notes.push(`연장신청은 ①의 공문으로 만듭니다. ‘${placed.requests.name}’은(는) ②칸에 두었습니다(회신에서는 요청사항으로 씀).`);
    // After the form is filled, so the note is not hidden behind a question about it.
    if (notes.length) toast(notes.join(' '));
  }
  // sameCase: the same 공문 was put in again, so what it filled in before stays even if this copy does not give it.
  // force: the type chosen at the top when switching tabs; otherwise 회신·의견서 follow the files and 연장신청 stays.
  function analyse(sameCase = false, force = null) {
    const g = sources.gongmun ? Analyze.gongmun(sources.gongmun.doc) : {};
    // ② holds a 심사보고서 (의견서) or a request list (회신).
    const report = sources.requests && Analyze.looksLikeExamReport(sources.requests.doc) ? Analyze.examReport(sources.requests.doc) : null;
    const opinion = !!(g.opinion || report), list = report ? null : sources.requests;
    const texts = [...(sources.gongmun ? docTexts(sources.gongmun.doc) : []), ...(list ? docTexts(list.doc) : [])];
    const departments = Analyze.departments(texts, g.docNo);
    const requests = list ? Analyze.requests(list.doc) : null;
    const next = {};
    if (g.agency) {
      next.agencyName = g.agency;
      next.honorific = G.agencyDefaults.find(a => a.name === g.agency)?.honorific || Analyze.honorificFor(g.agency);
      next.citationStyle = g.agency === '공정거래위원회' ? 'bracket' : 'guillemet';
    }
    if (g.recipient && !opinion) next.submitter = Analyze.submitterFrom(g.recipient);
    if (g.title && !opinion) {next.requestTitle = g.title; next.requestName = Analyze.requestNameFrom(g.title); next.title = `${next.requestName}에 대한 회신`;}
    if (g.docNo) next.requestDocNo = g.docNo;
    if (g.date) next.requestDate = g.date;
    if (departments.candidates[0] && !opinion) next.refDept = departments.candidates[0];
    // The cover is dated with the 제출기한 (공문 first, then the request list) for the lawyer to confirm.
    const due = g.deadlineDate ? {text: g.deadline, date: g.deadlineDate} : list ? Analyze.deadline(docTexts(list.doc).join('\n'), g.date) : null;
    if (due) next.sendDate = due.date;
    const info = opinion ? opinionValues(g, report, next) : null;
    const mode = force || (current.docType === 'extension' ? 'extension' : opinion ? 'opinion' : 'reply');
    // A 회신 chosen for a 의견제출 공문 keeps the 회신 title, as before v8.
    if (opinion && replyGroup(mode)) delete next.title;
    if (mode === 'extension') extensionValues(g, due, opinion, info, next);
    // A field's value after this reading: what an earlier file filled in and these files no longer give goes back to its default.
    const after = k => k in next ? next[k] : current[k] === autoValues[k] && !sameCase ? defaults[k] : current[k];
    // 연장신청 title from the request name as it will be (an earlier 공문's name does not linger).
    if (mode === 'extension') next.title = G.extTitle({extBasis: next.extBasis, requestName: after('requestName'), requestTitle: after('requestTitle')});
    if (next.submitter || next.title) next.caseLabel = `${after('submitter')} ${after('title')}`.trim();
    return {g, departments, requests, next, due, opinion, report, info, mode, extension: mode === 'extension'};
  }
  // 제출기한 연장신청: the request's own deadline is the one to extend; the cover goes out now, not on that deadline.
  function extensionValues(g, due, opinion, info, next) {
    next.extBasis = opinion ? 'opinion' : 'data';
    if (due) next.extOrigDeadline = due.date;
    next.sendDate = G.today();
    if (opinion) {
      // 의견서 연장신청 sample: 참조 심판총괄담당관실(, 소비자거래심판담당관실) and ‘(이하 “피심인들”)’.
      next.refDept = '심판총괄담당관실';
      next.shortName = next.partyRole + (info.parties > 1 ? '들' : '');
      delete next.confidentialNote;
    }
  }
  // Titles the program wrote (not the user): a 공문 read afterwards may replace them.
  const programTitle = t => [...Object.values(G.titles), '[감면] ' + G.titles.opinion, replyTitle(current)].includes(t) ||
    ['data', 'opinion'].some(basis => t === G.extTitle({...current, extBasis: basis}));
  // 심사보고서 의견제출 요청 공문 (+ optional 심사보고서) → the 의견서 제출 공문 fields, written the 2026 way.
  function opinionValues(g, report, next) {
    const named = n => n && !Analyze.masked(n) ? Analyze.submitterFrom(n) : '';
    // Two or more 피심인: written as the 공문 lists them, ‘A 및 B’.
    const parties = (g.parties || []).filter(n => n && !Analyze.masked(n));
    const joined = parties.length > 1 ? `${parties.slice(0, -1).join(', ')} 및 ${parties[parties.length - 1]}` : '';
    const company = joined || named(parties[0] || g.partyName) || named(g.recipient) || report?.client?.name || '';
    const raw = g.caseName || (!sources.gongmun && report?.caseName) || '';
    const leniency = !!g.leniency || /감면\s*신청/.test(raw);
    // ‘(주)가나다의 …’ → ‘㈜가나다의 …’; a masked applicant (*****) becomes ‘㈜라마바’; 감면 건 is ‘(비공개)’.
    let caseName = raw.replace(/\(주\)\s*/g, '㈜');
    if (company) caseName = caseName.replace(/\*{3,}/g, Analyze.corpMark(company));
    if (leniency && caseName && !/\(비공개\)$/.test(caseName)) caseName += '(비공개)';
    if (company) next.submitter = company;
    next.partyRole = g.partyRole === '신청인' ? '신청인' : '피심인';
    const caseNo = g.caseNo || (!sources.gongmun && report?.caseNo) || '';
    if (caseNo) next.caseNo = caseNo;
    if (caseName) next.caseName = caseName;
    next.title = (leniency ? '[감면] ' : '') + G.titles.opinion;
    // Without the 공문, 참조 follows its usual form: 심판총괄담당관 and the 과 in charge named in the 심사보고서.
    const refFromReport = !g.refDept && report?.dept ? `심판총괄담당관, ${report.dept}장` : '';
    if (g.refDept || refFromReport) next.refDept = g.refDept || refFromReport;
    if (leniency && company) next.confidentialNote = G.confidentialDefault({submitter: company});
    return {company, leniency, refFromReport, parties: parties.length, masked: Analyze.masked(g.partyName) || Analyze.masked(g.recipient), lawyers: report?.client?.lawyers || [],
      attachment: g.copies ? {text: `심사보고서에 대한 의견서 ${g.copies}`, copies: ''} : {text: '심사보고서에 대한 의견서', copies: '1'}};
  }
  const defaults = G.newCase();
  // opts.force: the document type of a tab opened afresh (switchType); opts.quiet: fill only what the user has not written,
  // without asking (opts.askItems: but ask before replacing request items the user edited);
  // opts.newGongmun: another case's 공문 was put in (its 연장 기한·사유 are not this one's).
  async function applyAnalysis(slot, sameCase = false, opts = {}) {
    const result = analyse(sameCase, opts.force), {next, requests} = result, target = result.mode;
    typeStash = null;
    // A title the program wrote (e.g. the 연장신청 default) is not the user's either.
    const replaceable = key => !current[key] || current[key] === autoValues[key] || current[key] === defaults[key] || key === 'title' && programTitle(current[key]);
    // 회신 ↔ 의견서 always follows the files; a body written by hand for the other kind is one more value to ask about.
    const crossing = current.docType !== target && (target === 'opinion' || current.docType === 'opinion');
    const conflicts = Object.keys(next).filter(k => current[k] !== next[k] && !replaceable(k)).map(fieldName);
    if (crossing && current.items.length && strip(current.items) !== autoItems) conflicts.push(current.docType === 'opinion' ? '의견서 본문 뼈대' : '요청사항');
    // 연장신청 with another case's 공문: what was entered for the previous 공문's deadline is one more value to ask about.
    const extEntered = target === 'extension' && opts.newGongmun && !!(current.extDeadline || current.extReason !== null || current.extScope.trim() || current.extPrev);
    if (extEntered) conflicts.push('연장 기한·사유·범위');
    let overwrite = true;
    if (conflicts.length) overwrite = !opts.quiet && await confirmAction(`직접 입력한 칸 ${conflicts.length}개(${conflicts.join(', ')})가 문서에서 찾은 값과 다릅니다. 문서의 값으로 바꿀까요? ‘취소’하면 입력한 값을 유지하고 빈 칸만 채웁니다.`, '문서 내용으로 바꿀까요?', '문서 값으로 바꾸기');
    const oldTitle = current.title;
    for (const [k, v] of Object.entries(next)) if (overwrite || replaceable(k)) current[k] = v;
    if (extEntered && overwrite) Object.assign(current, {extPrev: false, extPrevDocNo: '', extPrevDeadline: '', extWeeks: '', extDeadline: '', extScope: '', extReason: null});
    // A deadline chosen in weeks counts from the deadline now read.
    if (target === 'extension' && current.extWeeks && G.dateValid(G.extBase(current))) current.extDeadline = G.addDays(G.extBase(current), 7 * current.extWeeks);
    // What earlier files filled in and the files now loaded no longer give goes back to blank, so the old case does not linger.
    if (!sameCase) for (const k of Object.keys(autoValues)) if (!(k in next) && current[k] === autoValues[k]) {current[k] = defaults[k]; delete autoValues[k];}
    if ((sources.gongmun || result.opinion || current.docType === 'opinion') && current.docType !== target && (crossing || overwrite || !dirty)) {
      if (target === 'opinion') {current.docType = target; enterOpinion(oldTitle, overwrite);} else {if (current.docType === 'opinion') leaveOpinion(overwrite); current.docType = target;}
    }
    // Without a request list, the items read from an earlier list go too.
    if (replyGroup(current.docType) && !requests && autoItems !== null && strip(current.items) === autoItems) {current.items = []; autoItems = null;}
    if (G.autoFirmRef(current.firmRef)) current.firmRef = G.firmRefFor(current.sendDate);
    if (current.docType === 'opinion') {
      // ‘첨부: 심사보고서에 대한 의견서 15부(심판총괄담당관실 10부, …). 끝.’ from the 공문's 제출부수.
      const auto = current.attachments.length === 1 && /^심사보고서에 대한 의견서/.test(current.attachments[0].text);
      if (result.opinion && (!current.attachments.length || auto)) current.attachments = [{id: G.uid(), ...result.info.attachment}];
      if (!current.items.length || strip(current.items) === autoItems) {current.items = G.opinionItems(current); autoItems = strip(current.items);}
    } else if (replyGroup(current.docType) && current.title !== oldTitle && (!current.attachments.length || current.attachments.length === 1 && [oldTitle, autoValues.title].includes(current.attachments[0].text))) {
      current.attachments = [{id: G.uid(), text: current.title, copies: '1'}];
    }
    if (requests && slot === 'requests' && replyGroup(current.docType)) {
      const fresh = requests.items.map(it => ({id: G.uid(), level: it.level, label: String(it.label), text: it.text, notes: [...it.notes]}));
      const same = JSON.stringify(current.items.map(({id, ...x}) => x)) === autoItems;
      if (!current.items.length || same || (!opts.quiet || opts.askItems) && await confirmAction(`지금 요청사항 ${current.items.length}개를 올린 목록의 ${fresh.length}개로 바꿀까요?`, '요청사항을 바꿀까요?', '바꾸기')) {
        current.items = fresh; current.labelMode = 'auto'; current.includeBody = true;
        autoItems = JSON.stringify(fresh.map(({id, ...x}) => x));
        // The cover should announce the body it carries: ‘첨부: … 1부. 끝.’
        if (fresh.length && !current.attachments.length) current.attachments = [{id: G.uid(), text: current.title, copies: '1'}];
      }
    }
    autoValues = {...autoValues, ...next};
    analysisInfo = result;
    changed(); syncFields(); renderAttachments(); renderItems(); renderRefs(); renderSummary();
  }
  function fieldName(k) {return {requestTitle: '공문 제목', requestName: '요청 명칭', requestDocNo: '문서번호', requestDate: '요구일자', sendDate: '발신일자', honorific: '기관 호칭', citationStyle: '인용 형식', caseLabel: '사건 이름'}[k] || labels[k] || k;}
  function renderSummary() {
    const box = $('analysis-summary'), info = analysisInfo; box.replaceChildren();
    if (!info) {box.hidden = true; return;}
    box.hidden = false;
    if (current.docType === 'extension') {renderExtensionSummary(box, info); return;}
    if (info.opinion) {renderOpinionSummary(box, info); return;}
    const {g, departments, requests, due} = info;
    const rows = [];
    if (sources.gongmun || due) rows.push(['발신일자', due && `${G.formatDate(due.date)} (제출기한)`]);
    if (sources.gongmun) rows.push(['수신 기관', g.agency], ['참조', departments.candidates[0]], ['공문 제목', g.title], ['문서번호', g.docNo],
      ['요구일자', g.date && G.formatDate(g.date) + ' (시행일)'], ['제출 주체', g.recipient && Analyze.submitterFrom(g.recipient)]);
    const table = element('dl', 'found-list');
    rows.forEach(([k, v]) => {table.append(element('dt', '', k), element('dd', v ? 'ok' : 'missing', v || '찾지 못함 · 직접 입력'));});
    if (requests) {
      const top = requests.items.filter(i => i.level === 1).length, sub = requests.items.length - top;
      table.append(element('dt', '', '요청사항'), element('dd', requests.items.length ? 'ok' : 'missing', requests.items.length ? `${requests.items.length}개 (1. 단계 ${top}개${sub ? ` · 가. 단계 ${sub}개` : ''})` : '찾지 못함 · 붙여넣기 또는 직접 추가'));
    } else table.append(element('dt', '', '요청사항'), element('dd', 'missing', '요청사항 목록을 올려 주세요'));
    box.append(element('div', 'summary-title', '문서에서 찾아 채운 값'), table);
    const extra = [due && `제출기한 ${due.text}`, g.caseNo && `사건번호 ${g.caseNo}`, departments.person && `담당 ${departments.person.name}${departments.person.rank ? ' ' + departments.person.rank : ''}`].filter(Boolean);
    if (extra.length) box.append(element('p', 'summary-extra', '참고 · ' + extra.join(' · ')));
    if (departments.candidates.length > 1) {
      const chips = element('div', 'chip-row'); chips.append(element('span', 'chip-label', '참조 다른 표기'));
      departments.candidates.filter(c => c !== current.refDept).forEach(c => {const b = element('button', 'chip', c); b.type = 'button'; b.onclick = () => {updateField('refDept', c); syncFields(); renderSummary();}; chips.append(b);});
      box.append(chips);
    }
    const warnings = [...(requests ? requests.warnings : []), ...(sources.requests?.doc.warnings || []), ...(sources.gongmun?.doc.warnings || [])];
    if (current.bodyOverride !== null) warnings.push('본문 문장을 직접 수정한 상태여서 표지 2번 문단은 자동으로 바뀌지 않았습니다. ‘자동 생성으로 돌아가기’를 누르면 새 정보로 문장을 만듭니다.');
    if (sources.gongmun && g.date) warnings.push('요구일자는 공문의 시행일입니다. 접수일을 쓰는 경우 고쳐 주세요.');
    if (due && current.sendDate === due.date) warnings.push('발신일자는 공문의 제출기한으로 넣었습니다. 실제로 보내는 날이 다르면 고쳐 주세요. Word에서는 발신일자와 관리번호의 ‘*’가 노란색으로 표시됩니다.');
    // 공문 수신란이 ‘가나다’처럼 상호만 적힌 경우: 공정위 제출 표지에는 정식 상호를 씁니다.
    if (g.recipient && current.submitter && !/(?:주식회사|유한회사|유한책임회사|합자회사|합명회사|㈜|\(주\)|재단법인|사단법인|법인|조합|공사|공단|협회|은행|대학교?)/.test(current.submitter))
      warnings.push(`제출 주체 ‘${current.submitter}’에 법인 형태(주식회사 등)가 없습니다. 공문 수신란에 적힌 그대로이니 정식 상호(예: 주식회사 ${current.submitter})를 확인해 주세요.`);
    warnings.forEach(w => box.append(element('p', 'summary-warning', '확인 · ' + w)));
  }
  function renderExtensionSummary(box, info) {
    const {g, due, next, departments} = info, x = info.info, opinion = next.extBasis === 'opinion';
    if (!info.extension) {box.hidden = true; return;}  // read for another type: shown again when the files are read for 연장신청
    const rows = [['연장할 원 요청', opinion ? '심사보고서 의견제출 요청' : sources.gongmun && '자료제출 요구'], ['원 제출기한', due && G.formatDay(due.date)],
      ['수신 기관', g.agency], opinion ? [next.partyRole, x.company] : ['제출 주체', g.recipient && Analyze.submitterFrom(g.recipient)],
      opinion ? ['사건명', next.caseName] : ['공문 제목', g.title], ['문서번호', g.docNo]];
    if (!opinion) rows.push(['요구일자', g.date && G.formatDate(g.date) + ' (시행일)'], ['참조', departments.candidates[0]]);
    else rows.push(['참조', next.refDept]);
    const table = element('dl', 'found-list');
    rows.forEach(([k, v]) => {table.append(element('dt', '', k), element('dd', v ? 'ok' : 'missing', v || '찾지 못함 · 직접 입력'));});
    box.append(element('div', 'summary-title', '문서에서 찾아 채운 값 · 제출기한 연장신청'), table);
    if (!opinion && departments.candidates.length > 1) {
      const chips = element('div', 'chip-row'); chips.append(element('span', 'chip-label', '참조 다른 표기'));
      departments.candidates.filter(c => c !== current.refDept).forEach(c => {const b = element('button', 'chip', c); b.type = 'button'; b.onclick = () => {updateField('refDept', c); syncFields(); renderSummary();}; chips.append(b);});
      box.append(chips);
    }
    const warnings = [...(sources.gongmun?.doc.warnings || [])];
    if (!G.dateValid(current.extDeadline)) warnings.push('3번 칸에서 연장 기간(1~4주)을 누르거나 연장 기한을 고르세요.');
    if (opinion) warnings.push('참조는 심판총괄담당관실로 넣었습니다. 사건에 따라 해당 분야의 심판담당관실(예: 소비자거래심판담당관실)을 함께 적기도 하니, 더할지 확인해 주세요.');
    if (opinion && x.parties > 1) warnings.push(`피심인이 ${x.parties}곳이어서 ‘${next.shortName}’로 줄여 적었습니다.`);
    if (opinion && x.masked && !x.company) warnings.push('공문에 회사 이름이 가려져 있습니다(*****). ‘제출 주체’ 칸에 직접 입력하세요.');
    warnings.push('발신일자는 오늘로 넣었습니다. 보내는 날이 다르면 고쳐 주세요. Word에서는 발신일자와 관리번호의 ‘*’가 노란색으로 표시됩니다.');
    if (g.recipient && !opinion && current.submitter && !/(?:주식회사|유한회사|유한책임회사|합자회사|합명회사|㈜|\(주\)|재단법인|사단법인|법인|조합|공사|공단|협회|은행|대학교?)/.test(current.submitter))
      warnings.push(`제출 주체 ‘${current.submitter}’에 법인 형태(주식회사 등)가 없습니다. 공문 수신란에 적힌 그대로이니 정식 상호를 확인해 주세요.`);
    if (current.bodyOverride !== null) warnings.push('본문 문장을 직접 수정한 상태여서 2~4번 문단은 자동으로 바뀌지 않습니다. ‘자동 생성으로 돌아가기’를 누르면 새 정보로 문장을 만듭니다.');
    warnings.forEach(w => box.append(element('p', 'summary-warning', '확인 · ' + w)));
  }
  function renderOpinionSummary(box, info) {
    const {g, due, report, next} = info, x = info.info;
    const rows = [['발신일자', due && `${G.formatDate(due.date)} (제출기한)`], ['사건번호', next.caseNo], ['사건명', next.caseName],
      [next.partyRole, x.company], ['참조', next.refDept && `${next.refDept} (${x.refFromReport ? '심사보고서 담당 과' : '제출처'})`], ['첨부', g.copies && x.attachment.text]];
    if (report) rows.push(['심사보고서', report.client && `우리 법인 대리: ${report.client.name}`]);
    const table = element('dl', 'found-list');
    rows.forEach(([k, v]) => {table.append(element('dt', '', k), element('dd', v ? 'ok' : 'missing', v || (k === '심사보고서' ? '우리 법인이 대리하는 피심인을 찾지 못함' : '찾지 못함 · 직접 입력')));});
    box.append(element('div', 'summary-title', '문서에서 찾아 채운 값 · 심사보고서 의견서'), table);
    const extra = [due && `제출기한 ${due.text}`, g.docNo && `공문 ${g.docNo}`].filter(Boolean);
    if (extra.length) box.append(element('p', 'summary-extra', '참고 · ' + extra.join(' · ')));
    if (x.lawyers.length) {
      const key = n => n.replace(/\s+/g, ''), missing = x.lawyers.filter(n => !current.lawyers.some(l => key(l.name) === key(n)));
      const chips = element('div', 'chip-row'); chips.append(element('span', 'chip-label', '심사보고서의 우리 법인 변호사'));
      if (missing.length) {const b = element('button', 'chip', `${missing.join(' · ')} 추가`); b.type = 'button'; b.id = 'add-report-lawyers'; b.onclick = () => addLawyersByName(missing); chips.append(b);}
      else chips.append(element('span', 'chip-label', `${x.lawyers.join(' · ')} (모두 선택됨)`));
      box.append(chips);
    }
    const warnings = [...(sources.requests?.doc.warnings || []), ...(sources.gongmun?.doc.warnings || [])];
    if (x.masked && !x.company) warnings.push('공문에 회사 이름이 가려져 있습니다(*****). ②에 심사보고서를 올리면 우리 법인이 대리하는 회사로 채웁니다. 아니면 ‘제출 주체’ 칸에 직접 입력하세요.');
    if (x.masked && x.company && report?.client) warnings.push(`공문에 가려진 이름(*****)을 심사보고서의 ‘${x.company}’로 채웠습니다.`);
    if (report && g.caseNo && report.caseNo && report.caseNo !== g.caseNo) warnings.push(`올린 심사보고서의 사건번호(${report.caseNo})가 공문(${g.caseNo})과 다릅니다. 감면 건이면 원사건 심사보고서일 수 있어, 회사 이름과 변호사만 가져왔습니다.`);
    if (!sources.gongmun) warnings.push('의견제출 요청 공문이 없어 발신일자는 오늘, 첨부는 ‘1부’로 넣었습니다. 공문의 제출기한과 제출부수(예: 15부(심판총괄담당관실 10부, …))로 고치거나 ①에 공문을 올려 주세요.' +
      (x.refFromReport ? ' 참조는 심사보고서의 담당 과로 만들었으니 공문의 제출처와 같은지 확인하세요.' : ''));
    if (x.leniency && current.confidentialNote) warnings.push('감면 건이라 샘플 의견서의 비공개 요청 문구(형사소송 관련)를 본문 앞에 넣었습니다. 사건에 맞지 않으면 3번 칸에서 고치거나 지우세요.');
    if (due && current.sendDate === due.date) warnings.push('발신일자는 공문의 제출기한으로 넣었습니다. 실제로 보내는 날이 다르면 고쳐 주세요. Word에서는 발신일자와 관리번호의 ‘*’가 노란색으로 표시됩니다.');
    if (current.bodyOverride !== null) warnings.push('본문 문장을 직접 수정한 상태여서 표지 2번 문단은 자동으로 바뀌지 않았습니다. ‘자동 생성으로 돌아가기’를 누르면 새 정보로 문장을 만듭니다.');
    warnings.forEach(w => box.append(element('p', 'summary-warning', '확인 · ' + w)));
  }
  function resetSources() {
    sources.gongmun = sources.requests = null; autoValues = {}; autoItems = null; analysisInfo = null; readGeneration++;
    for (const slot of ['gongmun', 'requests']) {setStatus(slot, idleStatus); $('file-' + slot).value = '';}
    document.body.classList.remove('has-second');
    renderSummary();
  }
  for (const slot of ['gongmun', 'requests']) {
    const zone = $('drop-' + slot), input = $('file-' + slot);
    input.onchange = () => {if (input.files.length) readFiles(slot, input.files).finally(() => {input.value = '';});};
    zone.addEventListener('keydown', e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); input.click();}});
    zone.addEventListener('dragover', e => {e.preventDefault(); zone.classList.add('dragging');});
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', e => {e.preventDefault(); zone.classList.remove('dragging'); if (e.dataTransfer.files.length) readFiles(slot, e.dataTransfer.files);});
  }
  // A file dropped elsewhere on the page must not open in the browser and replace the work.
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  // While a file is dragged over the window, light up both upload boxes so it is clear where to drop.
  let dragDepth = 0;
  const draggingFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const endFileDrag = () => {dragDepth = 0; document.body.classList.remove('file-drag');};
  window.addEventListener('dragenter', e => {if (draggingFiles(e)) {dragDepth++; document.body.classList.add('file-drag');}});
  window.addEventListener('dragleave', e => {if (draggingFiles(e) && --dragDepth <= 0) endFileDrag();});
  window.addEventListener('drop', endFileDrag);
  window.addEventListener('dragend', endFileDrag);
  $('paste-apply').onclick = async () => {
    const text = $('paste-requests').value;
    if (!text.trim()) {toast('요청사항 내용을 붙여넣어 주세요.', true); return;}
    // Like an upload into ②: a file still being read there does not replace the pasted text afterwards.
    const seq = ++uploadSeq; lastDrop.requests = seq;
    const run = applying.then(async () => {
      sources.requests = {name: '붙여넣은 내용', doc: Readers.readText(text), own: !!sources.gongmun, id: ++fileSeq}; lastPut.requests = seq;
      setStatus('requests', `붙여넣은 내용 · 문단 ${sources.requests.doc.paragraphs.length}개`, 'done');
      await applyAnalysis('requests');
    });
    applying = run.catch(() => {});
    await run;
  };
  $('add-item').onclick = () => {
    const top = current.items.filter(i => i.level === 1).length, last = current.items[current.items.length - 1];
    // 의견서: a new heading goes above ‘결론’.
    const at = current.docType === 'opinion' && last && /^결\s*론$/.test(last.text.trim()) ? current.items.length - 1 : current.items.length;
    current.items.splice(at, 0, {id: G.uid(), level: 1, label: current.docType === 'opinion' ? '' : String(top + 1), text: '', notes: []}); current.includeBody = true;
    changed(); syncFields(); renderItems(); focusItem(at);
  };
  $('clear-items').onclick = async () => {
    if (!current.items.length) return;
    if (await confirmAction(`요청사항 ${current.items.length}개를 모두 지울까요?`, '요청사항 모두 지우기', '모두 지우기')) {current.items = []; changed(); renderItems();}
  };
  $('add-ref').onclick = () => {
    const no = $('ref-no').value.trim(), text = $('ref-text').value.trim();
    if (!no && !text) {toast('참고자료 번호나 자료명을 입력해 주세요.', true); $('ref-no').focus(); return;}
    current.refMaterials.push({id: G.uid(), no, text});
    const n = no.match(/^(.*?)(\d+)$/); $('ref-no').value = n ? n[1] + (+n[2] + 1) : ''; $('ref-text').value = '';
    changed(); renderRefs(); $('ref-text').focus();
  };
  $('ref-text').onkeydown = e => {if (e.key === 'Enter' && !e.isComposing) {e.preventDefault(); $('add-ref').click();}};
  $('partialReply').onchange = () => {current.partialReply = $('partialReply').checked; changed();};
  $('includeBody').onchange = () => {current.includeBody = $('includeBody').checked; changed();};
  $('includeNotes').onchange = () => {current.includeNotes = $('includeNotes').checked; changed();};
  $('labelMode').onchange = () => {current.labelMode = $('labelMode').value; changed();};
  $('bodyTitle').oninput = () => {current.bodyTitleOverride = $('bodyTitle').value.trim() ? $('bodyTitle').value : null; changed();};
  document.querySelectorAll('[data-field]').forEach(e => e.addEventListener('input', () => updateField(e.dataset.field, e.value)));
  $('agencyName').addEventListener('change', () => {
    if (!G.agencyDefaults.some(a => a.name === current.agencyName)) {current.honorific = '기관'; $('honorific').value = '기관'; changed(); toast('직접 입력한 기관의 호칭을 확인해 주세요.');}
  });
  $('case-form').addEventListener('submit', e => e.preventDefault());
  // 회신 · 추가 설명자료 · 직접 작성 (1번 칸): the same 회신 with another sentence.
  function switchVariant(type) {
    const prev = current.docType;
    if (current.title === G.titles[prev]) current.title = G.titles[type];
    current.docType = type;
    if (type === 'additional' && current.bodyOverride === null) current.citationStyle = 'guillemet';
    if (type === 'reply' && current.bodyOverride === null) current.citationStyle = 'bracket';
    if (type === 'custom' && current.bodyOverride === null) current.bodyOverride = '';
    if (prev === 'custom' && current.bodyOverride === '') current.bodyOverride = null;  // nothing was written in 직접 작성
    changed(); syncFields();
    if (prev === 'custom' && current.bodyOverride !== null) toast('직접 작성한 본문은 유지됩니다. 필요하면 자동 생성으로 돌아가세요.');
  }
  /* 만들 문서 (회신 · 의견서 · 연장신청): each tab is its own document of the same case.
     Leaving a tab keeps its document; coming back to the same 공문 brings it back as it was left (a ② file replaced
     meanwhile is read into it, filling only what the user has not written). A tab not opened yet, or opened for
     another 공문, is made afresh from the files. Then the case's shared values come as last left — the user's edits
     too — through updateField, so what follows them in this document follows (title, 약칭, 의견서 뼈대 …). */
  const groupOf = type => replyGroup(type) ? 'reply' : type;
  async function switchType(type) {
    if (type === current.docType) return;
    if (groupOf(type) === groupOf(current.docType)) {switchVariant(type); return;}
    const from = groupOf(current.docType), to = groupOf(type), files = filesNow(), latest = G.clone(current);
    tabDocs[from] = {files, c: latest, autoValues: {...autoValues}, autoItems, analysisInfo};
    const kept = tabDocs[to];
    if (kept && kept.files.gongmun === files.gongmun) {
      current = G.clone(kept.c); autoValues = {...kept.autoValues}; autoItems = kept.autoItems; analysisInfo = kept.analysisInfo; typeStash = null;
      if (kept.files.requests !== files.requests) await applyAnalysis(sources.requests && to === 'reply' ? 'requests' : 'gongmun', true, {quiet: true, askItems: true});
    } else {
      // Afresh from the files: the shared values as the files give them (the user's edits follow below).
      const auto = tabDocs[from].autoValues, base = G.newCase();
      sharedKeys.forEach(k => {if (k in auto) base[k] = auto[k];});
      base.docType = to;
      if (to === 'extension') base.extBasis = from === 'opinion' ? 'opinion' : 'data';
      current = base; autoItems = null; typeStash = null;
      autoValues = Object.fromEntries(sharedKeys.filter(k => k in auto).map(k => [k, auto[k]]));
      if (to === 'opinion') enterOpinion(base.title);
      if (sources.gongmun || sources.requests) await applyAnalysis(sources.requests && to === 'reply' ? 'requests' : 'gongmun', false, {force: to, quiet: true});
      else analysisInfo = null;
      // Without files, the title follows the type.
      if (current.title === G.titles.reply || !current.title) current.title = to === 'extension' ? G.extTitle(current) : to === 'reply' ? replyTitle(current) : G.titles[to];
    }
    current.lawyers = G.clone(latest.lawyers);
    // ‘26-*’ follows this document's sending date, not the other tab's.
    for (const k of sharedKeys) if (current[k] !== latest[k] && !(k === 'firmRef' && G.autoFirmRef(latest[k]))) updateField(k, latest[k]);
    if (G.autoFirmRef(current.firmRef)) current.firmRef = G.firmRefFor(current.sendDate);
    changed(); syncFields(); renderItems(); renderRefs(); renderAttachments(); renderSelectedLawyers(); renderLawyerResults(); renderSummary();
  }
  document.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.type === 'reply' && replyGroup(current.docType)) return;  // already making a 회신
    switchType(b.dataset.type);
  }));
  document.querySelectorAll('[data-variant]').forEach(b => b.addEventListener('click', () => switchType(b.dataset.variant)));
  document.querySelectorAll('.basis-button').forEach(b => b.addEventListener('click', () => updateField('extBasis', b.dataset.basis)));
  document.querySelectorAll('.week-button').forEach(b => b.addEventListener('click', () => {
    const base = G.extBase(current);
    if (!G.dateValid(base)) {toast(current.extPrev ? '연장받은 기한을 먼저 넣어 주세요.' : '원 제출기한을 먼저 넣어 주세요.', true); $(current.extPrev ? 'extPrevDeadline' : 'extOrigDeadline').focus(); return;}
    current.extWeeks = b.dataset.weeks; current.extDeadline = G.addDays(base, 7 * current.extWeeks);
    changed(); syncFields();
  }));
  $('extPrev').onchange = () => {
    current.extPrev = $('extPrev').checked;
    if (current.extWeeks && G.dateValid(G.extBase(current))) current.extDeadline = G.addDays(G.extBase(current), 7 * current.extWeeks);
    changed(); syncFields();
  };
  $('extReason').oninput = () => {current.extReason = $('extReason').value; $('reset-reason').hidden = false; changed();};
  $('reset-reason').onclick = () => {current.extReason = null; changed(); syncFields();};
  $('new-case').onclick = async () => {
    // A file still being read belongs to the old case: drop it now, so its questions cannot take the place of this one.
    const reading = stopReading();
    // 연장신청 cannot be told from the files, so a new case stays one.
    const ext = current.docType === 'extension';
    if (await mayReplace()) {resetSources(); setCase(ext ? Object.assign(G.newCase(), {docType: 'extension', title: G.titles.extension}) : G.newCase(), true); $('save-state').textContent = '새 문서'; toast(ext ? '새 제출기한 연장신청을 시작했습니다.' : '새 공문을 시작했습니다.');}
    else if (reading) toast('읽던 파일은 취소했습니다. 필요하면 다시 올려 주세요.');
  };
  $('sample-reply').onclick = async () => {stopReading(); if (await mayReplace()) {resetSources(); setCase(G.sample('reply')); toast('회신 예시를 불러왔습니다.');}};
  $('sample-additional').onclick = async () => {stopReading(); if (await mayReplace()) {resetSources(); setCase(G.sample('additional')); toast('추가 설명자료 예시를 불러왔습니다.');}};
  $('save-case').onclick = saveCase; $('export-docx').onclick = exportDocx;
  $('load-case').onclick = () => {$('case-file-input').value = ''; $('case-file-input').click();};
  $('case-file-input').onchange = async e => {
    try {const data = await readJson(e.target.files[0]); if (!data) return; const c = G.readCase(data); stopReading(); if (await mayReplace()) {resetSources(); setCase(c, true); toast('사건의 입력·수정 내용과 당시 연락처를 불러왔습니다.');}} catch (error) {toast(error.message, true);}
  };
  $('edit-body').onclick = () => openBody();
  $('apply-body').onclick = () => {
    const text = $('body-editor').value, greeting = $('greeting-editor').value;
    if (!text.trim() || !greeting.trim()) {toast('첫 문단과 본문을 입력해 주세요.', true); return;}
    if (text !== G.bodyText(current)) current.bodyOverride = text;
    if (greeting !== G.greetingText(current)) current.greetingOverride = greeting;
    $('body-dialog').close(); changed(); syncBodyMode(); renderPreview(); toast('수정 내용을 문서에 반영했습니다.');
  };
  $('reset-body').onclick = async () => {
    if (await confirmAction('직접 수정한 첫 문단과 본문을 현재 입력 정보에 따른 자동 생성 문장으로 바꿉니다.', '자동 생성으로 돌아갈까요?', '자동 생성 적용')) {current.bodyOverride = null; current.greetingOverride = null; changed(); syncBodyMode(); renderPreview();}
  };
  $('add-attachment').onclick = () => {
    const text = $('attachment-name').value.trim(), copies = $('attachment-copies').value;
    if (!text) {toast('첨부명을 입력해 주세요.', true); $('attachment-name').focus(); return;}
    if (copies && !/^[1-9]\d{0,3}$/.test(copies)) {toast('부수는 1~9999의 정수 또는 빈칸으로 입력해 주세요.', true); return;}
    current.attachments.push({id: G.uid(), text, copies}); $('attachment-name').value = ''; changed(); renderAttachments(); $('attachment-name').focus();
  };
  $('attachment-name').onkeydown = e => {if (e.key === 'Enter' && !e.isComposing) {e.preventDefault(); $('add-attachment').click();}};
  $('lawyer-search').oninput = renderLawyerResults;
  $('manage-lawyers').onclick = () => {renderMaster(); resetLawyerForm(); showDialog('lawyer-dialog');};
  $('existing-word-open').onclick = () => {renderWordSelection(); showDialog('existing-word-dialog');};
  $('existing-word-file').onchange = e => loadExistingWord(e.target.files[0]);
  $('existing-word-search').oninput = renderWordSelection;
  $('existing-word-manage').onclick = $('manage-lawyers').onclick;
  $('existing-word-export').onclick = exportExistingWord;
  $('cancel-lawyer-edit').onclick = resetLawyerForm;
  $('lawyer-form').onsubmit = e => {
    e.preventDefault(); if (!$('lawyer-form').reportValidity()) return;
    const id = $('lawyer-id').value || G.uid(), l = {id, name: $('lawyer-name').value.trim(), directPhone: $('lawyer-phone').value.trim(), subPhone: $('lawyer-subphone').value.trim(), email: $('lawyer-email').value.trim()};
    try {G.readMaster(G.masterFile([l]));} catch (error) {toast(error.message, true); return;}
    const existing = master.findIndex(x => x.id === id);
    if (master.some(x => x.email.toLowerCase() === l.email.toLowerCase() && x.id !== id)) {toast('같은 이메일의 변호사가 이미 등록되어 있습니다.', true); return;}
    if (existing >= 0) master[existing] = l; else master.push(l);
    masterDirty = true; renderMaster(); renderLawyerResults(); resetLawyerForm(); toast('선택용 명단에 저장했습니다. 계속 사용하려면 명단 파일도 저장하세요.');
  };
  $('contact-form').onsubmit = e => {
    e.preventDefault(); if (!$('contact-form').reportValidity()) return;
    const list = contactForImport ? importedLawyers : current.lawyers;
    const l = {...list[activeLawyer], name: $('contact-name').value.trim(), directPhone: $('contact-phone').value.trim(), subPhone: $('contact-subphone').value.trim(), email: $('contact-email').value.trim()};
    try {G.readMaster(G.masterFile([l]));} catch (error) {toast(error.message, true); return;}
    if (contactForImport) {list[activeLawyer] = l; importDirty = true; renderWordSelection();}
    else {current.lawyers[activeLawyer] = l; changed(); renderSelectedLawyers();}
    $('contact-dialog').close();
  };
  $('export-master').onclick = () => {download(JSON.stringify(G.masterFile(master), null, 2), '변호사명단.json', 'application/json'); masterDirty = false; toast('변호사 명단 파일 저장을 시작했습니다.');};
  $('import-master').onclick = () => {$('master-file-input').value = ''; $('master-file-input').click();};
  $('master-file-input').onchange = async e => {
    try {
      const data = await readJson(e.target.files[0]); if (!data) return; const ls = G.readMaster(data);
      if (await confirmAction(`선택용 명단을 파일의 ${ls.length}명으로 바꿀까요? 현재 사건에 선택한 연락처는 유지됩니다.`, '변호사 명단 불러오기', '명단 바꾸기')) {master = ls; masterDirty = false; renderMaster(); renderLawyerResults(); resetLawyerForm(); toast('변호사 명단을 불러왔습니다.');}
    } catch (error) {toast(error.message, true);}
  };
  $('extract-request').onclick = buildCandidates;
  $('pages').addEventListener('click', e => {
    const node = e.target.closest('[data-preview-edit]'); if (!node) return; const target = node.dataset.previewEdit;
    if (target === 'body' || target === 'greeting') {openBody(target); return;}
    if (['sendDate', 'caseNo', 'caseName', 'confidentialNote', 'partyRole'].includes(target)) {focusField(target); return;}
    if (target.startsWith('attachment:')) {const index = +target.split(':')[1]; const input = $('attachments').children[index]?.querySelector('input'); if (input) {input.scrollIntoView({block: 'center', behavior: 'smooth'}); input.focus();} return;}
    if (target.startsWith('lawyer:')) {openContact(+target.split(':')[1]); return;}
    if (target.startsWith('item:')) {focusItem(+target.split(':')[1]); return;}
    activeField = target; $('field-editor-title').textContent = labels[target] + ' 수정'; $('field-editor-label').textContent = labels[target];
    $('field-editor-value').value = target === 'agentOverride' ? current.agentOverride || current.submitter : target === 'bodyTitle' ? G.bodyTitle(current) : current[target]; showDialog('field-dialog'); $('field-editor-value').focus();
  });
  $('pages').addEventListener('keydown', e => {if (e.target.matches('[data-preview-edit]') && (e.key === 'Enter' || e.key === ' ')) {e.preventDefault(); e.target.click();}});
  $('field-editor-form').onsubmit = e => {
    e.preventDefault(); const value = $('field-editor-value').value.replace(/\r?\n/g, ' ').trim();
    if (activeField === 'bodyTitle') {current.bodyTitleOverride = value ? value : null; changed();} else updateField(activeField, value);
    syncFields(); $('field-dialog').close();
  };
  $('copy-text').onclick = async () => {
    const text = G.textOutput(current);
    try {await navigator.clipboard.writeText(text); toast('공문 텍스트를 복사했습니다.');}
    catch {const area = element('textarea'); area.value = text; area.style.position = 'fixed'; area.style.left = '-9999px'; document.body.append(area); area.select(); const copied = document.execCommand('copy'); area.remove(); toast(copied ? '공문 텍스트를 복사했습니다.' : '복사할 수 없습니다. Word로 저장을 이용해 주세요.', !copied);}
  };
  $('print').onclick = () => {const {errors} = renderValidation(); if (errors.length) {toast('필수 항목을 확인한 뒤 인쇄할 수 있습니다.', true); focusField(errors[0].field); return;} renderPreview(); window.print();};
  $('zoom-fit').onclick = () => {zoom = null; renderPreview();};
  $('zoom-in').onclick = () => {zoom = Math.min(1.5, (zoom || parseFloat($('zoom-label').textContent) / 100) + .1); renderPreview();};
  $('zoom-out').onclick = () => {zoom = Math.max(.3, (zoom || parseFloat($('zoom-label').textContent) / 100) - .1); renderPreview();};
  $('help-open').onclick = () => showDialog('help-dialog');
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
  window.addEventListener('beforeunload', e => {if (dirty || masterDirty || importDirty) {e.preventDefault(); e.returnValue = '';}});
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {e.preventDefault(); if (!document.querySelector('dialog[open]')) saveCase();}
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !document.querySelector('dialog[open]')) {e.preventDefault(); exportDocx();}
  });
  new ResizeObserver(() => {clearTimeout(resizeTimer); resizeTimer = setTimeout(renderPreview, 100);}).observe($('preview-scroll'));
  G.agencyDefaults.filter(a => a.name !== '기타 기관').forEach(a => {const option = element('option'); option.value = a.name; $('agency-list').append(option);});
  G.departments.forEach(name => {const option = element('option'); option.value = name; $('department-list').append(option);});
  measureSpace();
  syncFields(); renderAttachments(); renderItems(); renderRefs(); renderSelectedLawyers(); renderLawyerResults(); renderPreview();
  document.fonts.ready.then(() => {measureSpace(); renderPreview();});
})();
