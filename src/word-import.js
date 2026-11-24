/* Local DOCX amendment. Preserve every original ZIP member except document.xml.
   Keep original document XML verbatim outside the insertion/section boundary. */
(function (global) {
  'use strict';
  const G = global.Gongmun;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const MAX_FILE = 20 * 1024 * 1024, MAX_XML = 8 * 1024 * 1024;
  const fail = message => {throw new Error(message);};
  const invalidZip = () => fail('DOCX 파일이 손상되었거나 지원하지 않는 압축 형식입니다. Word에서 .docx로 다시 저장해 주세요.');
  const decode = bytes => {
    try {return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes);}
    catch {fail('문서의 문자 인코딩을 읽을 수 없습니다. Word에서 .docx로 다시 저장해 주세요.');}
  };
  function readZip(input) {
    const bytes = new Uint8Array(input);
    if (bytes.length > MAX_FILE) fail('20MB 이하의 공문 DOCX 파일을 선택해 주세요.');
    if (bytes.length < 22) return invalidZip();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {end = i; break;}
    }
    if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return invalidZip();
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
    if (!count || count > 2000 || count !== view.getUint16(end + 8, true) || start + size !== end) return invalidZip();
    const entries = [], byName = new Map(); let at = start, total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) return invalidZip();
      const nameLength = view.getUint16(at + 28, true), extraLength = view.getUint16(at + 30, true), commentLength = view.getUint16(at + 32, true);
      const next = at + 46 + nameLength + extraLength + commentLength;
      if (!nameLength || next > end || view.getUint16(at + 34, true)) return invalidZip();
      const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true);
      if (flags & (1 | 64) || ![0, 8].includes(method)) return invalidZip();
      const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
      if (!(flags & 0x800) && nameBytes.some(b => b >= 128)) return invalidZip();
      const name = decode(nameBytes);
      if (byName.has(name) || /[\\\x00]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.')) return invalidZip();
      const length = view.getUint32(at + 24, true), compressed = view.getUint32(at + 20, true), offset = view.getUint32(at + 42, true);
      total += length;
      if (total > 80 * 1024 * 1024 || [length, compressed, offset].includes(0xffffffff)) return invalidZip();
      // ZIP64 and symbolic links are intentionally outside this document-only reader.
      if ((view.getUint32(at + 38, true) >>> 16 & 0xf000) === 0xa000) return invalidZip();
      for (let x = at + 46 + nameLength; x < at + 46 + nameLength + extraLength;) {
        if (x + 4 > at + 46 + nameLength + extraLength || view.getUint16(x, true) === 1) return invalidZip();
        x += 4 + view.getUint16(x + 2, true);
        if (x > at + 46 + nameLength + extraLength) return invalidZip();
      }
      if (offset + 30 > start || view.getUint32(offset, true) !== 0x04034b50) return invalidZip();
      const localNameLength = view.getUint16(offset + 26, true), localExtraLength = view.getUint16(offset + 28, true);
      const dataStart = offset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressed > start || view.getUint16(offset + 6, true) !== flags || view.getUint16(offset + 8, true) !== method ||
          decode(bytes.subarray(offset + 30, offset + 30 + localNameLength)) !== name) return invalidZip();
      if (!(flags & 8) && (view.getUint32(offset + 14, true) !== view.getUint32(at + 16, true) ||
          view.getUint32(offset + 18, true) !== compressed || view.getUint32(offset + 22, true) !== length)) return invalidZip();
      const entry = {name, flags, method, length, compressed, offset, dataStart, crc:view.getUint32(at + 16, true), central:bytes.slice(at, next)};
      entries.push(entry); byName.set(name, entry); at = next;
    }
    if (at !== end) return invalidZip();
    const localOrder = [...entries].sort((a, b) => a.offset - b.offset);
    if (localOrder[0].offset !== 0) return invalidZip();
    localOrder.forEach((e, i) => {
      const next = localOrder[i + 1]?.offset ?? start;
      if (e.offset >= next || e.dataStart + e.compressed > next) return invalidZip();
      if (e.flags & 8) {
        let d = e.dataStart + e.compressed;
        if (d + 4 <= next && view.getUint32(d, true) === 0x08074b50) d += 4;
        if (d + 12 > next || view.getUint32(d, true) !== e.crc || view.getUint32(d + 4, true) !== e.compressed || view.getUint32(d + 8, true) !== e.length) return invalidZip();
      }
      e.local = bytes.subarray(e.offset, next);
    });
    return {bytes, entries, byName, localOrder, endRecord:bytes.slice(end)};
  }
  async function entryBytes(zip, name, limit = MAX_XML) {
    const e = zip.byName.get(name);
    if (!e) fail('필수 Word 문서 구성요소를 찾지 못했습니다. .docx 파일인지 확인해 주세요.');
    if (e.length > limit) fail('문서 내부 내용이 너무 큽니다. 공문 표지 DOCX만 선택해 주세요.');
    let data = zip.bytes.subarray(e.dataStart, e.dataStart + e.compressed);
    if (e.method === 8 && global.GongmunReaders) {
      // Same built-in DEFLATE decoder as the request readers; no browser feature needed.
      try {data = global.GongmunReaders.inflate(data, Math.min(limit, e.length) + 1);} catch {return invalidZip();}
    } else if (e.method === 8) {
      let stream;
      try {stream = new DecompressionStream('deflate-raw');}
      catch {fail('이 브라우저에서는 DOCX 압축을 읽을 수 없습니다. 최신 Chrome 또는 Edge에서 다시 열어 주세요.');}
      const reader = new Blob([data]).stream().pipeThrough(stream).getReader(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read(); if (done) break;
          size += value.length;
          if (size > limit || size > e.length) {await reader.cancel(); return invalidZip();}
          chunks.push(value);
        }
      } catch {return invalidZip();}
      data = new Uint8Array(size); let at = 0;
      chunks.forEach(c => {data.set(c, at); at += c.length;});
    }
    if (data.length !== e.length || G.crc32(data) !== e.crc) return invalidZip();
    return data;
  }
  function replaceMember(zip, name, content) {
    const single = readZip(G.zipStore([[name, content]])), replacement = single.entries[0];
    const locals = [], offsets = new Map(); let size = 0;
    zip.localOrder.forEach(e => {
      const local = e.name === name ? replacement.local : e.local;
      offsets.set(e.name, size); locals.push(local); size += local.length;
    });
    const start = size, centrals = zip.entries.map(e => {
      const central = (e.name === name ? replacement.central : e.central).slice();
      new DataView(central.buffer).setUint32(42, offsets.get(e.name), true);
      size += central.length; return central;
    });
    const end = zip.endRecord.slice(), ev = new DataView(end.buffer);
    ev.setUint32(12, size - start, true); ev.setUint32(16, start, true);
    const result = new Uint8Array(size + end.length); let at = 0;
    [...locals, ...centrals, end].forEach(b => {result.set(b, at); at += b.length;});
    return result;
  }
  function parseXml(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<\?xml[^>]+encoding\s*=\s*["'](?!utf-8["'])/i.test(xml)) fail('지원하지 않는 XML 형식입니다. Word에서 .docx로 다시 저장해 주세요.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagNameNS('*', 'parsererror').length) fail('Word 문서의 XML이 손상되었습니다. Word에서 다시 저장해 주세요.');
    return doc;
  }
  function spansFor(xml, doc) {
    // Match structure only, skipping comments/CDATA/processing instructions. Never
    // serialize the original document: untouched XML remains byte-for-byte identical.
    const tokens = /<!-{2}[\s\S]*?-{2}>|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][\w:.-]*)(?:[^"'<>]|"[^"]*"|'[^']*')*>/g;
    const stack = [], roots = []; let count = 0;
    for (const m of xml.matchAll(tokens)) {
      if (!m[1]) continue;
      if (m[0].startsWith('</')) {
        const span = stack.pop();
        if (!span || span.name !== m[1]) fail('문서 구조를 안전하게 확인할 수 없습니다.');
        span.closeStart = m.index; span.end = m.index + m[0].length;
      } else {
        const span = {name:m[1], start:m.index, openEnd:m.index + m[0].length, children:[]};
        (stack.length ? stack[stack.length - 1].children : roots).push(span);
        if (/\/\s*>$/.test(m[0])) {span.closeStart = span.openEnd; span.end = span.openEnd;} else stack.push(span);
        if (++count > 100000 || stack.length > 150) fail('문서 구조가 너무 복잡합니다. 공문 표지 DOCX만 선택해 주세요.');
      }
    }
    if (stack.length || roots.length !== 1) fail('문서 구조를 안전하게 확인할 수 없습니다.');
    const map = new Map(), pending = [[doc.documentElement, roots[0]]];
    while (pending.length) {
      const [node, span] = pending.pop(), children = [...node.children];
      if (node.nodeName !== span.name || children.length !== span.children.length) fail('문서 구조를 안전하게 확인할 수 없습니다.');
      map.set(node, span);
      children.forEach((child, i) => pending.push([child, span.children[i]]));
    }
    return map;
  }
  const isW = (node, name) => node.namespaceURI === W && node.localName === name;
  const descendants = (node, name) => [...node.getElementsByTagNameNS(W, name)];
  const paragraphText = node => [...node.getElementsByTagNameNS(W, '*')].map(n => n.localName === 't' ? n.textContent : ['tab','br','cr'].includes(n.localName) ? ' ' : '').join('');
  const nameKey = name => name.normalize('NFC').replace(/\s/g, '').toLowerCase();
  const emailKey = email => email.trim().toLowerCase();
  const isBlank = node => isW(node, 'p') && !paragraphText(node).trim() && !['drawing','pict','br','fldSimple','sectPr','object'].some(n => descendants(node, n).length);
  function duplicate(existing, lawyer) {
    return existing.find(l => nameKey(l.name) === nameKey(lawyer.name) || emailKey(l.email) === emailKey(lawyer.email));
  }
  function makeParagraph(original, text, condensed = '') {
    const p = original.cloneNode(false), doc = original.ownerDocument, prefix = original.prefix || 'w';
    [...p.attributes].forEach(a => {if (a.namespaceURI !== 'http://www.w3.org/2000/xmlns/') p.removeAttributeNode(a);});
    const create = local => doc.createElementNS(W, prefix + ':' + local);
    const oldPr = [...original.children].find(n => isW(n, 'pPr'));
    const pr = oldPr ? oldPr.cloneNode(true) : create('pPr');
    // Do not add pagination-property squares to newly written paragraphs, even
    // when the source was produced by an older version of this application.
    [...pr.children].forEach(n => {if (['sectPr','pageBreakBefore','numPr','pPrChange','keepNext','keepLines'].includes(n.localName)) n.remove();});
    if (/^(?:T\.\s|담당변호사\s)/.test(text)) {
      let ind = [...pr.children].find(n => isW(n, 'ind'));
      if (!ind) {
        ind = create('ind');
        const afterIndent = ['contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange'];
        pr.insertBefore(ind, [...pr.children].find(n => afterIndent.includes(n.localName)) || null);
      }
      const left = Number(ind.getAttributeNS(W,'left') || 0) + Number(ind.getAttributeNS(W,'firstLine') || 0) - Number(ind.getAttributeNS(W,'hanging') || 0);
      const right = /^T\.\s/.test(text) ? '-170' : ind.getAttributeNS(W,'right') || '0';
      [...ind.attributes].forEach(a => ind.removeAttributeNode(a));
      for (const [key,value] of Object.entries({left:String(left),right,firstLine:'0',firstLineChars:'0'})) ind.setAttributeNS(W,prefix + ':' + key,value);
    }
    p.append(pr);
    if (text !== '') {
      const r = create('r'), firstText = descendants(original, 't')[0];
      const oldRun = firstText?.parentNode;
      const runPr = oldRun && [...oldRun.children].find(n => isW(n, 'rPr'));
      if (runPr) r.append(runPr.cloneNode(true));
      if (/^T\.\s/.test(text)) {
        let rp = [...r.children].find(n => isW(n, 'rPr'));
        if (!rp) {rp = create('rPr'); r.append(rp);}
        let fonts = [...rp.children].find(n => isW(n, 'rFonts'));
        if (!fonts) {fonts = create('rFonts'); rp.insertBefore(fonts, rp.firstChild);}
        for (const script of ['ascii','hAnsi','cs']) fonts.setAttributeNS(W, prefix + ':' + script, 'Times New Roman');
        fonts.setAttributeNS(W, prefix + ':hint', 'default');
      }
      const t = create('t'); t.setAttributeNS(XML, 'xml:space', 'preserve'); t.textContent = text; r.append(t); p.append(r);
      if (condensed) {
        // A contact too wide for one line: the email in a second run at −0.4pt (Gongmun.contactParts).
        const r2 = r.cloneNode(true), rp = [...r2.children].find(n => isW(n, 'rPr')), sp = create('spacing');
        [...rp.children].filter(n => isW(n, 'spacing')).forEach(n => n.remove());
        sp.setAttributeNS(W, prefix + ':val', '-8');
        const afterSpacing = ['w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath','rPrChange'];
        rp.insertBefore(sp, [...rp.children].find(n => afterSpacing.includes(n.localName)) || null);
        descendants(r2, 't')[0].textContent = condensed; p.append(r2);
      }
    }
    return p;
  }
  const personFields = ['id','name','directPhone','subPhone','email'];
  const samePerson = (a, b) => !!a && !!b && personFields.every(k => a[k] === b[k]);
  function validatePeople(lawyers, seen = []) {
    if (!Array.isArray(lawyers) || lawyers.length > 100) fail('담당변호사는 최대 100명까지 표시할 수 있습니다.');
    G.readMaster(G.masterFile(lawyers));
    lawyers.forEach(l => {
      if (/[\x00-\x1f<>]/.test([l.name,l.directPhone,l.subPhone,l.email].join('')) || /\[\s*\*\s*\]/.test([l.name,l.directPhone,l.subPhone,l.email].join('')) || (G.FIRM.noteMarker && [l.name,l.directPhone,l.subPhone,l.email].join('').toLowerCase().includes(G.FIRM.noteMarker.toLowerCase()))) fail('변호사의 연락처에 미완성 표시 또는 저장할 수 없는 문자가 있습니다.');
      if (duplicate(seen, l)) fail(`${l.name} 변호사는 이름 또는 이메일이 목록과 중복됩니다. 중복 항목을 제외해 주세요.`);
      seen.push(l);
    });
  }
  async function open(input, filename) {
    if (typeof filename !== 'string' || !/\.docx$/i.test(filename)) fail('Word의 .docx 파일만 지원합니다. .doc 또는 .docm은 Word에서 .docx로 저장해 주세요.');
    const zip = readZip(input);
    if (zip.entries.some(e => /(?:^_xmlsignatures\/|vbaProject|encryption)/i.test(e.name))) fail('전자서명·매크로·암호화가 포함된 문서는 수정하지 않습니다. 별도의 일반 DOCX 사본을 사용해 주세요.');
    const types = parseXml(decode(await entryBytes(zip, '[Content_Types].xml')));
    if ([...types.documentElement.children].some(n => /macroEnabled|vbaProject/i.test(n.getAttribute('ContentType') || ''))) fail('매크로 문서는 지원하지 않습니다. 일반 .docx 사본을 사용해 주세요.');
    const mainType = [...types.documentElement.children].find(n => n.getAttribute('PartName') === '/word/document.xml');
    if (mainType?.getAttribute('ContentType') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') fail('일반 Word DOCX 문서가 아닙니다. Word에서 .docx로 다시 저장해 주세요.');
    if (zip.byName.has('word/settings.xml')) {
      const settings = parseXml(decode(await entryBytes(zip, 'word/settings.xml')));
      if (descendants(settings, 'documentProtection').some(n => !['0','false','off'].includes(n.getAttributeNS(W, 'enforcement')))) fail('편집 보호된 문서는 수정하지 않습니다. Word에서 보호를 해제한 사본을 사용해 주세요.');
    }
    const xml = decode(await entryBytes(zip, 'word/document.xml')), doc = parseXml(xml);
    if (!isW(doc.documentElement, 'document')) fail('이 Word 문서 형식은 지원하지 않습니다. 일반 .docx 형식으로 저장해 주세요.');
    if (['ins','del','moveFrom','moveTo','pPrChange','rPrChange','sectPrChange'].some(n => descendants(doc, n).length)) fail('변경 내용 추적이 남아 있습니다. Word에서 변경 내용을 수락하거나 거절한 사본을 사용해 주세요.');
    const body = [...doc.documentElement.children].find(n => isW(n, 'body'));
    if (!body) fail('Word 문서의 본문을 찾지 못했습니다.');
    const children = [...body.children], table = children.find(n => isW(n, 'tbl'));
    const metadata = table ? paragraphText(table).replace(/\s/g, '') : '';
    if (!metadata.includes(G.FIRM.label.replace(/\s/g, '') + ':') || !metadata.includes('수신:') || !metadata.includes('제목:')) fail(`${G.FIRM.name} 공문 표지 양식을 확인하지 못했습니다. 이 기능은 해당 양식의 공문만 지원합니다.`);
    // The cover is the first section. A 첨부 body (요청사항·답변) may follow its section break and is kept verbatim.
    const coverEnd = children.findIndex(n => isW(n, 'p') && descendants(n, 'sectPr').length);
    const coverLimit = coverEnd < 0 ? children.length : coverEnd + 1;
    const topIndex = node => {while (node && node.parentNode !== body) node = node.parentNode; return node ? children.indexOf(node) : -1;};
    const allNames = descendants(body, 'p').filter(p => /^\s*담당\s*변호사/.test(paragraphText(p)) && topIndex(p) < coverLimit);
    if (allNames.some(p => p.parentNode !== body)) fail('본문 끝의 담당변호사 영역을 찾지 못했습니다. 표·텍스트 상자·다른 양식의 변호사 영역은 지원하지 않습니다.');
    if (allNames.length > 100) fail('담당변호사 목록이 너무 깁니다. 공문 표지 DOCX만 선택해 주세요.');
    const pairs = allNames.map(p => {
      const match = paragraphText(p).match(/^\s*담당\s*변호사\s+(.+?)\s*$/);
      const index = children.indexOf(p), contact = children[index + 1];
      if (!match || !isW(contact || {}, 'p') || descendants(p, 'sectPr').length) fail('담당변호사 이름과 연락처의 배치를 확인하지 못했습니다. 기존 공문 양식의 이름·연락처 문단이 필요합니다.');
      const text = paragraphText(contact), email = text.match(/[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+/)?.[0];
      if (!/^\s*T\s*[.:]/i.test(text) || !/E\s*[.:]/i.test(text) || !email || /[<>@]/.test(match[1]) || match[1].length > 100) fail('담당변호사의 이름·전화번호·이메일을 안전하게 읽지 못했습니다. 이름과 연락처가 분리된 기존 양식을 사용해 주세요.');
      if (['sdt','fldSimple','object','drawing'].some(n => descendants(p, n).length || descendants(contact, n).length)) fail('변호사 영역에 복잡한 편집 요소가 있습니다. 일반 이름·연락처 문단을 사용해 주세요.');
      const displayName = /^[가-힣\s]+$/.test(match[1]) ? match[1].replace(/\s/g, '') : match[1].trim().replace(/\s+/g, ' ');
      const phonePart = text.slice(text.match(/^\s*T\s*[.:]\s*/i)[0].length, text.search(/E\s*[.:]/i)).replace(/[,\s]+$/, '');
      const phones = phonePart.split(/\s*\/\s*/);
      const directPhone = phones[0].replace(/\(\s*직\s*\)\s*$/, '').trim(), subPhone = (phones[1] || '').trim();
      if (phones.length > 2 || !directPhone) fail('기존 변호사의 전화번호 형식을 확인하지 못했습니다. Word에서 연락처를 확인해 주세요.');
      return {id:'word-' + G.uid(), name:displayName.normalize('NFC'), directPhone, subPhone,
        email:email.replace(/[.)]+$/, ''), contactText:text, p, contact, index};
    });
    for (let i = 1; i < pairs.length; i++) {
      const gap = children.slice(pairs[i - 1].index + 2, pairs[i].index);
      if (gap.some(n => !isBlank(n) && !isW(n, 'bookmarkEnd') && !isW(n, 'bookmarkStart')) || descendants(pairs[i - 1].contact, 'sectPr').length) fail('담당변호사 영역이 여러 곳으로 나뉘어 있습니다. 추가 위치를 확정할 수 없어 문서를 수정하지 않습니다.');
    }
    let last = pairs[pairs.length - 1], emptySignature = false;
    const tailAllowed = n => isW(n, 'sectPr') || isBlank(n) || isW(n, 'bookmarkEnd') ||
      // An empty section-break paragraph may also carry a page break (as in the lawyers' replies).
      isW(n, 'p') && !paragraphText(n).trim() && descendants(n, 'sectPr').length === 1 &&
      !['drawing','pict','fldSimple','object'].some(tag => descendants(n, tag).length);
    if (!last) {
      // With no lawyer rows, use the unambiguous signature: date -> agent -> logo.
      // The date may be the cover's only one, at the top or in the heading table (2026 replies have no date above the agent).
      // Do not silently accept renamed lawyer rows or a logo elsewhere in the body.
      // ‘○○의 대리인’ (회신) or ‘주식회사 ○○ 대리인’ (2026 의견서).
      const agents = children.slice(0, coverLimit).filter(p => isW(p, 'p') && /\S\s*대리인\s*$/.test(paragraphText(p)));
      if (agents.length !== 1) fail('담당변호사 영역을 찾지 못했고, 변호사를 넣을 서명부도 확인하지 못했습니다.');
      const agent = agents[0], agentIndex = children.indexOf(agent);
      const logos = children.slice(agentIndex + 1).filter(p => isW(p, 'p') && (descendants(p, 'drawing').length || descendants(p, 'pict').length));
      if (logos.length !== 1 || !children.slice(0, agentIndex).some(n => (isW(n, 'p') ? [n] : descendants(n, 'p')).some(p => /^\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*$/.test(paragraphText(p))))) fail('담당변호사 영역을 찾지 못했습니다. 날짜·대리인·법인 로고가 있는 서명부가 필요합니다.');
      const logo = logos[0], logoIndex = children.indexOf(logo);
      if (paragraphText(logo).trim() || descendants(agent, 'sectPr').length || descendants(logo, 'sectPr').length ||
          children.slice(agentIndex + 1, logoIndex).some(n => !isBlank(n)) || children.slice(logoIndex + 1, coverLimit).some(n => !tailAllowed(n))) fail('담당변호사 영역을 찾지 못했습니다. 서명부 뒤에 다른 내용이 있어 추가 위치를 확정할 수 없습니다.');
      let anchorIndex = logoIndex;
      // Keep the logo's original following spacer, rather than adding a second one.
      if (isBlank(children[anchorIndex + 1] || {})) anchorIndex++;
      last = {p:agent, contact:children[anchorIndex], index:anchorIndex - 1};
      emptySignature = true;
    } else if (children.slice(last.index + 2, coverLimit).some(n => !tailAllowed(n))) fail('담당변호사 뒤에 다른 내용이 있어 추가 위치를 확정할 수 없습니다. 공문 표지 문서만 선택해 주세요.');
    const spans = spansFor(xml, doc), contactSpan = spans.get(last.contact);
    let insertAt = contactSpan.end;
    for (const n of children.slice(last.index + 2)) {if (!isW(n, 'bookmarkEnd')) break; insertAt = spans.get(n).end;}
    const section = descendants(last.contact, 'sectPr')[0];
    const sectionSpan = section ? spans.get(section) : null;
    const spacer = pairs.length > 1 ? children.slice(pairs[pairs.length - 2].index + 2, last.index).find(isBlank) : children.slice(last.index + 2, coverLimit).find(isBlank);
    const warnings = [];
    if (emptySignature) warnings.push('담당변호사가 없는 표지입니다. 원본 날짜·대리인·법인 로고를 유지하고 서명부 아래에 명단을 넣습니다.');
    if (section) warnings.push('마지막 연락처의 구역 나눔은 추가할 마지막 변호사 뒤로 옮겨, 기존 구역 서식을 유지합니다.');
    const afterCover = children.slice(coverLimit);
    if (coverEnd >= 0 && afterCover.some(n => isW(n, 'p') && paragraphText(n).trim() || isW(n, 'tbl'))) warnings.push('표지 뒤의 첨부 본문은 그대로 두고, 표지의 담당변호사만 수정합니다.');
    else if (descendants(body, 'sectPr').length > 1) warnings.push('원본의 여러 구역과 빈 페이지는 자동으로 정리하지 않습니다. Word에서 마지막 페이지와 쪽번호를 확인해 주세요.');
    if (zip.entries.some(e => e.name.endsWith('.rels'))) {
      // No relations are executed or fetched. Inspect only, and retain them verbatim.
      for (const e of zip.entries.filter(e => e.name.endsWith('.rels'))) {
        const rels = parseXml(decode(await entryBytes(zip, e.name)));
        if ([...rels.documentElement.children].some(n => n.getAttribute('TargetMode') === 'External' && !/^mailto:/i.test(n.getAttribute('Target') || ''))) {warnings.push('원본의 외부 링크·서식 참조는 그대로 유지됩니다. 이 도구는 연결하지 않지만 Word에서 열 때는 연결 여부를 확인하세요.'); break;}
      }
    }
    const existing = pairs.map(({id,name,directPhone,subPhone,email,contactText}) => ({id,name,directPhone,subPhone,email,contactText}));
    const originalById = new Map(pairs.map((p, i) => [p.id, {pair:p, person:existing[i]}]));
    const serialize = node => new XMLSerializer().serializeToString(node);
    function add(lawyers) {
      if (!Array.isArray(lawyers) || !lawyers.length || lawyers.length > 100) fail('추가할 변호사를 1~100명 선택해 주세요.');
      if (existing.length + lawyers.length > 100) fail('담당변호사는 기존 명단을 포함해 최대 100명까지 표시할 수 있습니다.');
      validatePeople(lawyers, [...existing]);
      const inserted = [];
      lawyers.forEach((l, i) => {
        if (!emptySignature || i) inserted.push(serialize(makeParagraph(spacer || last.p, '')));
        inserted.push(serialize(makeParagraph(last.p, '담당변호사   ' + G.spaceName(l.name))));
        const contact = makeParagraph(emptySignature ? last.p : last.contact, ...G.wordContactParts(l));
        if (section && i === lawyers.length - 1) {
          const pr = [...contact.children].find(n => isW(n, 'pPr'));
          pr.append(section.cloneNode(true));
        }
        inserted.push(serialize(contact));
      });
      let prefix = xml.slice(0, insertAt);
      if (sectionSpan) prefix = prefix.slice(0, sectionSpan.start) + prefix.slice(sectionSpan.end);
      const updated = prefix + inserted.join('') + xml.slice(insertAt);
      parseXml(updated);
      return replaceMember(zip, 'word/document.xml', updated);
    }
    const hasEdits = lawyers => existing.some((l, i) => !samePerson(l, lawyers[i]));
    function save(lawyers) {
      validatePeople(lawyers);
      if (!hasEdits(lawyers)) {
        if (lawyers.length === existing.length) return zip.bytes.slice();
        return add(lawyers.slice(existing.length));
      }
      if (!pairs.length) return add(lawyers);
      // Moving/deleting a row with cross-paragraph ranges can corrupt bookmark or
      // comment semantics. Ordinary supplied rows (including hyperlinks) are safe.
      if (pairs.some(p => ['bookmarkStart','bookmarkEnd','commentRangeStart','commentRangeEnd'].some(n => descendants(p.p, n).length || descendants(p.contact, n).length))) fail('변호사 문단에 복잡한 북마크·주석 범위가 있습니다. 이 문서의 기존 명단 편집은 Word에서 해 주세요.');
      const raw = node => {const s = spans.get(node); return xml.slice(s.start, s.end);};
      const removeSection = (value, node) => {
        if (!section || !node.contains(section)) return value;
        const s = spans.get(node);
        return value.slice(0, sectionSpan.start - s.start) + value.slice(sectionSpan.end - s.start);
      };
      const sectionRaw = section ? raw(section) : '';
      function contactXml(l, isLast) {
        const source = originalById.get(l.id), pair = source?.pair || last;
        const unchanged = source && ['directPhone','subPhone','email'].every(k => source.person[k] === l[k]);
        if (!unchanged) {
          const contact = makeParagraph(pair.contact, ...G.wordContactParts(l));
          if (isLast && section) contact.firstElementChild.append(section.cloneNode(true));
          return serialize(contact);
        }
        let value = removeSection(raw(pair.contact), pair.contact);
        if (isLast && section) {
          const s = spans.get(pair.contact), pr = [...pair.contact.children].find(n => isW(n, 'pPr'));
          if (!pr) {
            const at = s.openEnd - s.start, prefix = pair.contact.prefix || 'w';
            value = value.slice(0, at) + `<${prefix}:pPr>${sectionRaw}</${prefix}:pPr>` + value.slice(at);
          } else {
            const ps = spans.get(pr);
            if (ps.closeStart === ps.openEnd) {
              const start = ps.start - s.start, end = ps.end - s.start;
              value = value.slice(0, start) + raw(pr).replace(/\/\s*>$/, '>') + sectionRaw + `</${pr.nodeName}>` + value.slice(end);
            } else {
              const at = ps.closeStart - s.start - (pair.contact.contains(section) ? sectionRaw.length : 0);
              value = value.slice(0, at) + sectionRaw + value.slice(at);
            }
          }
        }
        return value;
      }
      const gaps = pairs.slice(1).map((p, i) => ({raw:xml.slice(spans.get(pairs[i].contact).end, spans.get(p.p).start),
        nodes:children.slice(pairs[i].index + 2, p.index)}));
      const pieces = [];
      lawyers.forEach((l, i) => {
        if (i) pieces.push(gaps[i - 1]?.raw || serialize(makeParagraph(spacer || last.p, '')));
        const source = originalById.get(l.id), pair = source?.pair || last;
        const untouched = source && ['name','directPhone','subPhone','email'].every(k => source.person[k] === l[k]);
        pieces.push(untouched ? raw(pair.p) : serialize(makeParagraph(pair.p, '담당변호사   ' + G.spaceName(l.name))));
        pieces.push(contactXml(l, i === lawyers.length - 1));
      });
      // Keep non-text range markers from any unused original spacing slots.
      gaps.slice(Math.max(0, lawyers.length - 1)).forEach(gap => gap.nodes.filter(n => !isW(n, 'p')).forEach(n => pieces.push(raw(n))));
      if (!lawyers.length && section) {
        const empty = makeParagraph(last.contact, ''); empty.firstElementChild.append(section.cloneNode(true)); pieces.push(serialize(empty));
      }
      const begin = spans.get(pairs[0].p).start, end = spans.get(pairs.at(-1).contact).end;
      const updated = xml.slice(0, begin) + pieces.join('') + xml.slice(end);
      parseXml(updated);
      return replaceMember(zip, 'word/document.xml', updated);
    }
    return {filename, existing, warnings, add, save, hasEdits, emptySignature,
      insertionDescription:emptySignature ? '담당변호사가 없는 표지입니다. 서명부 아래에 명단을 넣을 수 있습니다.' : `기존 ${existing.length}명의 이름·연락처와 순서를 수정하거나 새 변호사를 추가할 수 있습니다.`,
      duplicate:l => duplicate(existing, l)};
  }
  global.GongmunWord = {open, readZip, entryBytes, replaceMember, MAX_FILE, nameKey, duplicate};
})(typeof window !== 'undefined' ? window : globalThis);
