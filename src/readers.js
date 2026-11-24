/* Local document readers for the request documents (HWP, HWPX, DOCX, PDF, text).
   Everything runs in the browser; no file leaves the PC. Each reader returns
   {kind, paragraphs:[{text, table, auto?}], lines?, tables, warnings}. */
(function (global) {
  'use strict';
  const MAX_FILE = 30 * 1024 * 1024, MAX_PART = 40 * 1024 * 1024;
  const fail = message => {throw new Error(message);};
  // Raw DEFLATE (RFC 1951). HWP streams carry 8 extra bytes after the final block, which the
  // browser's DecompressionStream rejects; this decoder stops at the final block instead.
  const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  function huffman(lengths) {
    const counts = new Uint16Array(16), offsets = new Uint16Array(16), symbols = new Uint16Array(lengths.length);
    for (const l of lengths) counts[l]++;
    counts[0] = 0;
    for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
    lengths.forEach((l, i) => {if (l) symbols[offsets[l]++] = i;});
    return {counts, symbols};
  }
  const fixedLit = huffman(Array.from({length: 288}, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
  const fixedDist = huffman(new Array(30).fill(5));
  function inflate(data, limit = MAX_PART) {
    let pos = 0, buf = 0, cnt = 0, out = new Uint8Array(Math.max(1024, data.length * 4)), len = 0;
    const bad = () => fail('압축된 문서 내용을 풀 수 없습니다. 파일이 손상되었는지 확인해 주세요.');
    const ensure = n => {
      if (len + n <= out.length) return;
      if (len + n > limit) fail('문서 내부 내용이 너무 큽니다.');
      let size = out.length * 2; while (size < len + n) size *= 2;
      const next = new Uint8Array(Math.min(size, limit)); next.set(out.subarray(0, len)); out = next;
    };
    const bits = n => {
      while (cnt < n) {if (pos >= data.length) bad(); buf |= data[pos++] << cnt; cnt += 8;}
      const v = buf & ((1 << n) - 1); buf >>>= n; cnt -= n; return v;
    };
    const decode = h => {
      let code = 0, first = 0, index = 0;
      for (let l = 1; l < 16; l++) {
        code |= bits(1);
        const count = h.counts[l];
        if (code - first < count) return h.symbols[index + code - first];
        index += count; first = (first + count) << 1; code <<= 1;
      }
      return bad();
    };
    let last = 0;
    while (!last) {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        buf = 0; cnt = 0;
        if (pos + 4 > data.length) bad();
        const n = data[pos] | data[pos + 1] << 8; pos += 4;
        if (pos + n > data.length) bad();
        ensure(n); out.set(data.subarray(pos, pos + n), len); len += n; pos += n;
        continue;
      }
      let lit = fixedLit, dist = fixedDist;
      if (type === 2) {
        const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, cl = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) cl[ORDER[i]] = bits(3);
        const lc = huffman(cl), lengths = [];
        while (lengths.length < hlit + hdist) {
          const sym = decode(lc);
          if (sym < 16) {lengths.push(sym); continue;}
          let value = 0, repeat;
          if (sym === 16) {if (!lengths.length) bad(); value = lengths[lengths.length - 1]; repeat = 3 + bits(2);}
          else repeat = sym === 17 ? 3 + bits(3) : 11 + bits(7);
          while (repeat--) lengths.push(value);
        }
        lit = huffman(lengths.slice(0, hlit)); dist = huffman(lengths.slice(hlit, hlit + hdist));
      } else if (type !== 1) bad();
      for (;;) {
        const sym = decode(lit);
        if (sym < 256) {ensure(1); out[len++] = sym; continue;}
        if (sym === 256) break;
        const s = sym - 257; if (s >= 29) bad();
        const n = LBASE[s] + bits(LEXT[s]), ds = decode(dist); if (ds >= 30) bad();
        const d = DBASE[ds] + bits(DEXT[ds]); if (d > len) bad();
        ensure(n);
        for (let k = 0; k < n; k++, len++) out[len] = out[len - d];
      }
    }
    return out.slice(0, len);
  }
  let inflater = null;
  function setInflater(fn) {inflater = fn;}
  async function inflateRaw(bytes) {return inflater ? inflater(bytes) : inflate(bytes);}
  const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);
  const clean = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f﻿​]/g, '').replace(/[  - 　]/g, ' ');

  /* ---------- minimal XML tree (HWPX, DOCX) ---------- */
  const entities = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};
  const decodeEntities = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(parseInt(e[1] === 'x' ? e.slice(2) : e.slice(1), e[1] === 'x' ? 16 : 10)) : entities[e] ?? m);
  function parseXml(xml) {
    const root = {name: '#root', attrs: {}, children: []}, stack = [root];
    const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!-{2}[\s\S]*?-{2}>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(xml))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.children.push(m[1]);
      else if (m[6] !== undefined) {if (top !== root) top.children.push(decodeEntities(m[6]));}
      else if (m[3]) {
        if (m[2]) {if (stack.length > 1) stack.pop();}
        else {
          const attrs = {};
          for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[2] ?? a[3]);
          const el = {name: m[3], attrs, children: []};
          top.children.push(el);
          if (!m[5]) stack.push(el);
        }
      }
    }
    return root;
  }
  const local = name => name.slice(name.indexOf(':') + 1);
  function find(el, name) {
    for (const c of el.children) if (typeof c !== 'string') {
      if (local(c.name) === name) return c;
      const hit = find(c, name); if (hit) return hit;
    }
    return null;
  }

  /* ---------- ZIP (stored or deflated members) ---------- */
  function readZip(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) {end = i; break;}
    if (end < 0) fail('압축 문서(HWPX/DOCX)의 구조를 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.');
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014b50) fail('압축 문서의 목록이 손상되었습니다.');
      const method = view.getUint16(at + 10, true), compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true), name = utf8(bytes.subarray(at + 46, at + 46 + nameLength));
      const dataStart = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      entries.set(name, {method, compressed, size, dataStart});
      at += 46 + nameLength + extra + comment;
    }
    return {
      names: [...entries.keys()],
      async read(name) {
        const e = entries.get(name);
        if (!e) return null;
        if (e.size > MAX_PART) fail('문서 내부 내용이 너무 큽니다.');
        const data = bytes.subarray(e.dataStart, e.dataStart + e.compressed);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRaw(data);
        fail('지원하지 않는 압축 방식입니다.');
      },
      async text(name) {const d = await this.read(name); return d && utf8(d);}
    };
  }

  /* ---------- automatic paragraph numbering (HWP/HWPX/DOCX) ---------- */
  const hangul = '가나다라마바사아자차카타파하', circled = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  const roman = n => [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
    .reduce((s, [v, r]) => {while (n >= v) {s += r; n -= v;} return s;}, '');
  function formatNumber(n, format) {
    switch (format) {
      case 'HANGUL_SYLLABLE': case 'ganada': return hangul[(n - 1) % 14];
      case 'CIRCLED_DIGIT': case 'decimalEnclosedCircle': return circled[(n - 1) % 20];
      case 'ROMAN_CAPITAL': case 'upperRoman': return roman(n);
      case 'ROMAN_SMALL': case 'lowerRoman': return roman(n).toLowerCase();
      case 'LATIN_CAPITAL': case 'upperLetter': return String.fromCharCode(64 + (n - 1) % 26 + 1);
      case 'LATIN_SMALL': case 'lowerLetter': return String.fromCharCode(96 + (n - 1) % 26 + 1);
      case 'HANGUL_JAMO': case 'chosung': return 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'[(n - 1) % 14];
      default: return String(n);
    }
  }
  // Hangul's default outline: 1. 가. 1) 가) (1) (가) ①
  const defaultHead = [['^1.', 'DIGIT'], ['^2.', 'HANGUL_SYLLABLE'], ['^3)', 'DIGIT'], ['^4)', 'HANGUL_SYLLABLE'], ['(^5)', 'DIGIT'], ['(^6)', 'HANGUL_SYLLABLE'], ['^7', 'CIRCLED_DIGIT']];
  function counter() {
    const counts = new Map();
    return (key, level, heads) => {
      const c = counts.get(key) || []; counts.set(key, c);
      c[level] = (c[level] || 0) + 1; c.length = level + 1;
      for (let i = 0; i < level; i++) c[i] = c[i] || 1;
      const [pattern, format] = heads[level] || defaultHead[level] || ['^' + (level + 1) + '.', 'DIGIT'];
      return pattern.replace(/\^(\d)|%(\d)/g, (m, a, b) => {const l = +(a || b) - 1; return formatNumber(c[l] || 1, (heads[l] || defaultHead[l] || [])[1]);});
    };
  }

  /* ---------- HWPX ---------- */
  async function readHwpx(bytes) {
    const zip = readZip(bytes);
    const sections = zip.names.filter(n => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    if (!sections.length) fail('HWPX 본문을 찾지 못했습니다. 한글 문서(.hwpx)인지 확인해 주세요.');
    const header = parseXml(await zip.text('Contents/header.xml') || '');
    const paraHeads = new Map(), numberings = new Map();
    (function walk(el) {
      for (const c of el.children) if (typeof c !== 'string') {
        const n = local(c.name);
        if (n === 'paraPr') {const h = find(c, 'heading'); if (h && h.attrs.type && h.attrs.type !== 'NONE') paraHeads.set(c.attrs.id, {type: h.attrs.type, id: h.attrs.idRef, level: +h.attrs.level || 0});}
        else if (n === 'numbering') numberings.set(c.attrs.id, c.children.filter(x => typeof x !== 'string' && local(x.name) === 'paraHead')
          .map(x => [x.children.filter(t => typeof t === 'string').join(''), x.attrs.numFormat]));
        else walk(c);
      }
    })(header);
    const paragraphs = [], next = counter();
    let tables = 0, tableSeq = 0, outlineId = '1';
    for (const name of sections) {
      const root = parseXml(await zip.text(name));
      (function walk(el, ctx) {
        for (const c of el.children) {
          if (typeof c === 'string') continue;
          const n = local(c.name);
          if (n === 'secPr' && c.attrs.outlineShapeIDRef) outlineId = c.attrs.outlineShapeIDRef;
          if (n === 'tc' && ctx.tableId) {
            const addr = c.children.find(x => typeof x !== 'string' && local(x.name) === 'cellAddr');
            walk(c, {...ctx, cell: {t: ctx.tableId, r: +(addr?.attrs.rowAddr || 0), c: +(addr?.attrs.colAddr || 0)}});
            continue;
          }
          if (n === 'p') {
            const p = {text: '', table: ctx.table, other: ctx.other, cell: ctx.cell};
            paragraphs.push(p);
            const head = paraHeads.get(c.attrs.paraPrIDRef);
            (function text(node) {
              for (const t of node.children) {
                if (typeof t === 'string') {if (node.inT) p.text += t; continue;}
                const tn = local(t.name);
                if (tn === 't') {t.inT = true; text(t);}
                else if (tn === 'tab') p.text += '\t';
                else if (tn === 'lineBreak') p.text += '\n';
                else if (tn === 'hyphen' || tn === 'nbSpace' || tn === 'fwSpace') p.text += tn === 'hyphen' ? '-' : ' ';
                else if (tn === 'tbl') {tables += !ctx.table; walk(t, {table: true, other: ctx.other, tableId: ++tableSeq});}
                else if (['header', 'footer', 'footNote', 'endNote', 'memo', 'hiddenComment'].includes(tn)) walk(t, {table: ctx.table, other: true});
                else if (tn === 'p') walk({children: [t]}, ctx);
                else text(t);
              }
            })(c);
            if (head && !p.other) {
              if (head.type === 'BULLET') p.bullet = true;
              else {
                const id = head.type === 'OUTLINE' ? outlineId : head.id;
                p.auto = {level: head.level, label: next('n' + id, head.level, numberings.get(id) || [])};
              }
            }
          } else walk(c, ctx);
        }
      })(root, {table: false, other: false});
    }
    return finish('hwpx', paragraphs, tables);
  }

  /* ---------- DOCX ---------- */
  async function readDocx(bytes) {
    const zip = readZip(bytes);
    const xml = await zip.text('word/document.xml');
    if (!xml) fail('Word 본문을 찾지 못했습니다. .docx 파일인지 확인해 주세요.');
    const numbering = parseXml(await zip.text('word/numbering.xml') || ''), styles = parseXml(await zip.text('word/styles.xml') || '');
    const abstracts = new Map(), nums = new Map(), styleNum = new Map();
    for (const c of find(numbering, 'numbering')?.children || []) {
      if (typeof c === 'string') continue;
      if (local(c.name) === 'abstractNum') abstracts.set(c.attrs['w:abstractNumId'], c.children.filter(x => typeof x !== 'string' && local(x.name) === 'lvl')
        .map(l => {const t = find(l, 'lvlText'), f = find(l, 'numFmt'); return [(t?.attrs['w:val'] || '').replace(/%(\d)/g, '^$1'), f?.attrs['w:val'] || 'decimal'];}));
      if (local(c.name) === 'num') nums.set(c.attrs['w:numId'], find(c, 'abstractNumId')?.attrs['w:val']);
    }
    for (const s of find(styles, 'styles')?.children || []) {
      if (typeof s === 'string' || local(s.name) !== 'style') continue;
      const np = find(s, 'numPr');
      if (np) styleNum.set(s.attrs['w:styleId'], {numId: find(np, 'numId')?.attrs['w:val'], ilvl: +(find(np, 'ilvl')?.attrs['w:val'] || 0)});
    }
    const paragraphs = [], next = counter();
    let tables = 0, tableSeq = 0;
    (function walk(el, ctx) {
      for (const c of el.children) {
        if (typeof c === 'string') continue;
        const n = local(c.name);
        if (n === 'tr' && ctx.tbl) {ctx.tbl.row++; ctx.tbl.col = -1; walk(c, ctx); continue;}
        if (n === 'tc' && ctx.tbl) {ctx.tbl.col++; walk(c, {...ctx, cell: {t: ctx.tbl.id, r: ctx.tbl.row, c: ctx.tbl.col}}); continue;}
        if (n === 'p') {
          const p = {text: '', table: ctx.table, other: ctx.other, cell: ctx.cell};
          paragraphs.push(p);
          (function text(node) {
            for (const t of node.children) {
              if (typeof t === 'string') {if (node.inT) p.text += t; continue;}
              const tn = local(t.name);
              if (tn === 't') {t.inT = true; text(t);}
              else if (tn === 'tab') p.text += '\t';
              else if (tn === 'br' || tn === 'cr') p.text += '\n';
              else if (tn === 'noBreakHyphen') p.text += '-';
              else if (['delText', 'instrText', 'pPr', 'rPr', 'footnoteReference'].includes(tn)) continue;
              else if (tn === 'txbxContent') walk(t, {table: ctx.table, other: true});
              else text(t);
            }
          })(c);
          const pPr = c.children.find(x => typeof x !== 'string' && local(x.name) === 'pPr');
          const np = pPr && find(pPr, 'numPr'), style = pPr && find(pPr, 'pStyle')?.attrs['w:val'];
          const ref = np ? {numId: find(np, 'numId')?.attrs['w:val'], ilvl: +(find(np, 'ilvl')?.attrs['w:val'] || 0)} : styleNum.get(style);
          const abs = ref && ref.numId !== '0' && nums.get(ref.numId);
          if (abs && abstracts.has(abs)) {
            const heads = abstracts.get(abs);
            if (heads[ref.ilvl]?.[1] === 'bullet') p.bullet = true;
            else p.auto = {level: ref.ilvl, label: next('a' + abs, ref.ilvl, heads)};
          }
        } else if (n === 'tbl') {tables += !ctx.table; walk(c, {table: true, other: ctx.other, tbl: {id: ++tableSeq, row: -1, col: -1}});}
        else walk(c, ctx);
      }
    })(find(parseXml(xml), 'body') || {children: []}, {table: false, other: false});
    return finish('docx', paragraphs, tables);
  }

  /* ---------- HWP 5.0 (OLE compound file + record streams) ---------- */
  function readCfb(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (sig.some((b, i) => bytes[i] !== b)) return null;
    const sectorSize = 1 << view.getUint16(0x1e, true), miniSize = 1 << view.getUint16(0x20, true);
    const sector = n => (n + 1) * sectorSize;
    const fatSectors = [];
    for (let i = 0; i < 109; i++) {const s = view.getUint32(0x4c + i * 4, true); if (s < 0xfffffffa) fatSectors.push(s);}
    let difat = view.getUint32(0x44, true), guard = 0;
    while (difat < 0xfffffffa && guard++ < 10000) {
      const at = sector(difat);
      for (let i = 0; i < sectorSize / 4 - 1; i++) {const s = view.getUint32(at + i * 4, true); if (s < 0xfffffffa) fatSectors.push(s);}
      difat = view.getUint32(at + sectorSize - 4, true);
    }
    const fat = [];
    for (const s of fatSectors) for (let i = 0; i < sectorSize / 4; i++) fat.push(view.getUint32(sector(s) + i * 4, true));
    function chain(start, table) {
      const out = []; let s = start, n = 0;
      while (s < 0xfffffffa && n++ < 1e6) {out.push(s); s = table[s]; if (s === undefined) break;}
      return out;
    }
    function read(start, size) {
      const out = new Uint8Array(size); let pos = 0;
      for (const s of chain(start, fat)) {
        const at = sector(s), take = Math.min(sectorSize, size - pos);
        if (take <= 0 || at + take > bytes.length) break;
        out.set(bytes.subarray(at, at + take), pos); pos += take;
      }
      return out;
    }
    const dirStart = view.getUint32(0x30, true);
    const dirBytes = read(dirStart, chain(dirStart, fat).length * sectorSize), dv = new DataView(dirBytes.buffer);
    const entries = [];
    for (let at = 0; at + 128 <= dirBytes.length; at += 128) {
      const len = dv.getUint16(at + 64, true);
      let name = '';
      for (let i = 0; i < Math.max(0, len / 2 - 1); i++) name += String.fromCharCode(dv.getUint16(at + i * 2, true));
      entries.push({name, type: dirBytes[at + 66], left: dv.getUint32(at + 68, true), right: dv.getUint32(at + 72, true),
        child: dv.getUint32(at + 76, true), start: dv.getUint32(at + 116, true), size: dv.getUint32(at + 120, true)});
    }
    const root = entries[0], cutoff = view.getUint32(0x38, true);
    const miniFat = [];
    const mfStart = view.getUint32(0x3c, true);
    if (mfStart < 0xfffffffa) {
      const mf = read(mfStart, chain(mfStart, fat).length * sectorSize), mv = new DataView(mf.buffer);
      for (let i = 0; i < mf.length / 4; i++) miniFat.push(mv.getUint32(i * 4, true));
    }
    const miniStream = root && root.start < 0xfffffffa ? read(root.start, root.size) : new Uint8Array(0);
    const paths = new Map();
    (function walk(index, prefix, depth) {
      if (index >= entries.length || index === 0xffffffff || depth > 64) return;
      const e = entries[index];
      walk(e.left, prefix, depth + 1); walk(e.right, prefix, depth + 1);
      const path = prefix + e.name;
      if (e.type === 2) paths.set(path, e);
      if (e.type === 1) walk(e.child, path + '/', depth + 1);
    })(root ? root.child : 0xffffffff, '', 0);
    return {
      names: [...paths.keys()],
      read(path) {
        const e = paths.get(path);
        if (!e) return null;
        if (e.size < cutoff) {
          const out = new Uint8Array(e.size); let pos = 0;
          for (const s of chain(e.start, miniFat)) {
            const take = Math.min(miniSize, e.size - pos); if (take <= 0) break;
            out.set(miniStream.subarray(s * miniSize, s * miniSize + take), pos); pos += take;
          }
          return out;
        }
        return read(e.start, e.size);
      }
    };
  }
  function* records(data) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    while (at + 4 <= data.length) {
      const h = v.getUint32(at, true); at += 4;
      let size = h >>> 20;
      if (size === 0xfff) {if (at + 4 > data.length) return; size = v.getUint32(at, true); at += 4;}
      if (at + size > data.length) return;
      yield {tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: data.subarray(at, at + size)};
      at += size;
    }
  }
  function paraText(data) {
    let s = '';
    for (let i = 0; i + 1 < data.length; i += 2) {
      const c = data[i] | data[i + 1] << 8;
      if (c >= 32) {s += String.fromCharCode(c); continue;}
      if (c === 9) {s += '\t'; i += 14; continue;}
      if (c === 10) {s += '\n'; continue;}
      if (c === 13) continue;
      if (c === 24) {s += '-'; continue;}
      if (c === 30 || c === 31) {s += ' '; continue;}
      if (c === 0 || (c >= 25 && c <= 29)) continue;
      i += 14; // inline/extended control: 8 WCHARs in total
    }
    return s;
  }
  async function readHwp(bytes) {
    const cfb = readCfb(bytes);
    if (!cfb) fail('한글(HWP) 파일 형식이 아닙니다. 파일을 다시 확인해 주세요.');
    const head = cfb.read('FileHeader');
    if (!head || utf8(head.subarray(0, 17)) !== 'HWP Document File') fail('지원하지 않는 한글 파일입니다. HWP 5.0 이상의 문서인지 확인해 주세요.');
    const flags = new DataView(head.buffer, head.byteOffset).getUint32(36, true);
    if (flags & 2) fail('암호가 걸린 한글 문서는 읽을 수 없습니다. 암호를 해제하거나 PDF로 저장해 올려 주세요.');
    if (flags & 4) fail('배포용(복사 방지) 한글 문서는 읽을 수 없습니다. 한글에서 PDF로 저장해 올리거나 내용을 붙여넣어 주세요.');
    const compressed = !!(flags & 1);
    const stream = async name => {const raw = cfb.read(name); return raw && compressed ? inflateRaw(raw) : raw;};
    const shapes = [], numberings = [];
    const info = await stream('DocInfo');
    if (info) for (const r of records(info)) {
      if (r.tag === 25 && r.data.length >= 32) {
        const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength), p = v.getUint32(0, true);
        shapes.push({head: (p >>> 23) & 3, level: (p >>> 25) & 7, numbering: v.getUint16(30, true)});
      } else if (r.tag === 25) shapes.push({head: 0});
      else if (r.tag === 23) {
        const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength), heads = [];
        let at = 0;
        for (let l = 0; l < 7 && at + 14 <= r.data.length; l++) {
          at += 12; const len = v.getUint16(at, true); at += 2;
          let fmt = '';
          for (let i = 0; i < len && at + 1 < r.data.length; i++, at += 2) fmt += String.fromCharCode(v.getUint16(at, true));
          heads.push([fmt, defaultHead[l]?.[1] || 'DIGIT']);
        }
        numberings.push(heads);
      }
    }
    const sections = cfb.names.filter(n => /^BodyText\/Section\d+$/.test(n)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
    if (!sections.length) fail('한글 문서의 본문을 찾지 못했습니다. PDF로 저장해 올리거나 내용을 붙여넣어 주세요.');
    const paragraphs = [], next = counter();
    let tables = 0, tableSeq = 0;
    for (const name of sections) {
      const data = await stream(name);
      let current = null;
      const ctrl = [];  // open controls: {level, kind}
      for (const r of records(data)) {
        while (ctrl.length && r.level <= ctrl[ctrl.length - 1].level) ctrl.pop();
        if (r.tag === 66) {
          const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
          const shape = shapes[v.getUint16(8, true)];
          const inTable = ctrl.some(c => c.kind === 'tbl '), other = ctrl.some(c => c.kind !== 'tbl ' && c.kind !== 'gso ');
          const tbl = [...ctrl].reverse().find(c => c.kind === 'tbl ');
          current = {text: '', table: inTable, other, level: r.level, cell: tbl && tbl.cell};
          paragraphs.push(current);
          if (shape && shape.head && !other) {
            if (shape.head === 3) current.bullet = true;
            else current.auto = {level: shape.level, label: next('h' + shape.numbering, shape.level, numberings[shape.numbering - 1] || [])};
          }
        } else if (r.tag === 67 && current && r.level === current.level + 1) current.text += paraText(r.data);
        else if (r.tag === 71 && r.data.length >= 4) {
          const id = String.fromCharCode(r.data[3], r.data[2], r.data[1], r.data[0]);
          if (id === 'tbl ' && !ctrl.some(c => c.kind === 'tbl ')) tables++;
          ctrl.push({level: r.level, kind: id, id: id === 'tbl ' ? ++tableSeq : 0});
        } else if (r.tag === 72 && r.data.length >= 12) {
          // A table cell's list header: column and row address follow the 8-byte list header.
          const top = ctrl[ctrl.length - 1];
          if (top && top.kind === 'tbl ' && r.level === top.level + 1) {
            const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
            top.cell = {t: top.id, c: v.getUint16(8, true), r: v.getUint16(10, true)};
          }
        }
      }
    }
    return finish('hwp', paragraphs, tables);
  }

  /* ---------- PDF (pdf.js text layer, rebuilt into lines and paragraphs) ---------- */
  function pdfLines(items) {
    const xs = items.filter(i => i.str && i.str.trim() !== '' || i.str === ' ')
      .map(i => ({s: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || i.height || 10}));
    xs.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of xs) {
      if (!it.s.trim()) {const l = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, l.h * .45)); if (l) l.items.push(it); continue;}
      const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * .45));
      if (line) {line.items.push(it); line.h = Math.max(line.h, it.h);} else lines.push({y: it.y, h: it.h, items: [it]});
    }
    lines.sort((a, b) => b.y - a.y);
    return lines.map(l => {
      l.items.sort((a, b) => a.x - b.x);
      let text = '', end = null;
      for (const it of l.items) {
        if (!it.s.trim()) {if (text && !/\s$/.test(text)) text += ' '; continue;}
        if (end !== null && !/\s$/.test(text) && it.x - end > l.h * .25) text += ' ';
        text += it.s; end = it.x + it.w;
      }
      const real = l.items.filter(i => i.s.trim());
      return {text: clean(text).replace(/[ \t]+/g, ' ').trim(), x0: real[0].x, x1: Math.max(...real.map(i => i.x + i.w)), y: l.y, h: l.h};
    }).filter(l => l.text);
  }
  const pageNumber = /^(?:[-–]\s*\d+\s*[-–]|\d+\s*\/\s*\d+|-?\s*\d+\s*-?|page\s*\d+.*)$/i;
  // Korean wrapped lines often break inside a word; join without a space unless the
  // previous line ends with a particle/ending or punctuation that normally ends a word.
  const wordEnd = /(?:[.,;:!?)\]」』>”’]|[은는을를에의로며고서면도만께게여듯음함임됨었았였겠다요까죠]|[A-Za-z0-9%])$/;
  const startsItem = /^(?:\(?\d{1,2}[.)]|\(\d{1,2}\)|\d{1,2}-\d{1,2}|[가-하][.)]|\([가-하]\)|[①-⑳]|[IVX]{1,4}\.|[*※□■○●◦◎ㅇ•▪·\-–]|\[[^\]]{1,12}\]|<|〈)/;
  function joinLines(a, b) {
    if (/[-‐(/·]$/.test(a)) return a + b;
    return a + (wordEnd.test(a) ? ' ' : '') + b;
  }
  function pdfParagraphs(pages) {
    const out = [];
    for (const lines of pages) {
      const body = lines.filter(l => !pageNumber.test(l.text));
      if (!body.length) continue;
      const right = body.map(l => l.x1).sort((a, b) => b - a)[Math.min(2, body.length - 1)];
      let prev = null;
      for (const l of body) {
        const cont = prev && !startsItem.test(l.text) && prev.x1 >= right - prev.h * 1.6 && l.x0 >= prev.x0 - 2 &&
          Math.abs(l.h - prev.h) < Math.max(1.5, prev.h * .2) && prev.y - l.y < prev.h * 2.6;
        if (cont) {const p = out[out.length - 1]; p.text = joinLines(p.text, l.text); p.lines.push(l);}
        else out.push({text: l.text, table: false, lines: [l]});
        prev = l;
      }
    }
    return out;
  }
  async function readPdf(bytes) {
    const lib = global.pdfjsLib;
    if (!lib) fail('PDF 읽기 기능을 불러오지 못했습니다. 배포된 HTML 파일을 다시 열어 주세요.');
    const options = {data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0};
    if (global.GongmunPdfCMaps) Object.assign(options, global.GongmunPdfCMaps);
    let doc;
    try {doc = await lib.getDocument(options).promise;}
    catch (e) {fail(/password/i.test(e && e.name || '') ? '암호가 걸린 PDF는 읽을 수 없습니다. 암호를 해제한 PDF를 올려 주세요.' : 'PDF를 읽을 수 없습니다. 파일이 손상되었는지 확인해 주세요.');}
    const pages = [];
    try {
      for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
        const page = await doc.getPage(i);
        pages.push(pdfLines((await page.getTextContent()).items));
        page.cleanup();
      }
    } finally {doc.destroy();}
    const result = finish('pdf', pdfParagraphs(pages), 0);
    result.lines = pages;
    if (!pages.some(p => p.length)) result.warnings.push('PDF에서 글자를 찾지 못했습니다. 스캔한 이미지 PDF일 수 있습니다. 내용을 직접 입력하거나 붙여넣어 주세요.');
    return result;
  }

  function readText(text) {
    const paragraphs = clean(text).replace(/\r\n?/g, '\n').split('\n').map(t => ({text: t, table: false}));
    return finish('text', paragraphs, 0);
  }
  function finish(kind, paragraphs, tables) {
    const list = paragraphs.filter(p => !p.other).map(p => {
      const text = clean(p.text).replace(/\t+/g, ' ').replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim();
      const out = {text, table: !!p.table};
      if (p.table && p.cell) out.cell = p.cell;
      if (p.auto) out.auto = p.auto;
      if (p.bullet) out.bullet = true;
      if (p.lines) out.lines = p.lines;
      return out;
    }).filter(p => p.text || p.auto);
    return {kind, paragraphs: list.filter(p => p.text), tables, warnings: []};
  }
  function detectKind(name, bytes) {
    const ext = (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
    const b = bytes.subarray(0, 8);
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b[0] === 0xd0 && b[1] === 0xcf) return ext === 'doc' ? 'doc' : 'hwp';
    if (b[0] === 0x50 && b[1] === 0x4b) return ext === 'docx' ? 'docx' : ext === 'hwpx' ? 'hwpx' : 'zip';
    if (['txt', 'text', 'md'].includes(ext)) return 'text';
    return ext || 'unknown';
  }
  async function read(name, input) {
    const bytes = new Uint8Array(input);  // plain copy (pdf.js rejects Node Buffers and may detach the data)
    if (bytes.length > MAX_FILE) fail('30MB 이하의 파일을 선택해 주세요.');
    let kind = detectKind(name, bytes);
    if (kind === 'zip') {
      const names = readZip(bytes).names;
      kind = names.includes('word/document.xml') ? 'docx' : names.some(n => /^Contents\/section\d+\.xml$/i.test(n)) ? 'hwpx' : 'zip';
    }
    if (kind === 'pdf') return readPdf(bytes);
    if (kind === 'hwp') return readHwp(bytes);
    if (kind === 'hwpx') return readHwpx(bytes);
    if (kind === 'docx') return readDocx(bytes);
    if (kind === 'text') return readText(new TextDecoder('utf-8').decode(bytes));
    if (kind === 'doc') fail('예전 Word(.doc) 형식은 읽을 수 없습니다. Word에서 .docx로 저장해 올려 주세요.');
    fail('PDF, 한글(HWP·HWPX), Word(DOCX), 텍스트 파일을 올려 주세요.');
  }
  global.GongmunReaders = {read, readText, readPdf, readHwp, readHwpx, readDocx, pdfLines, pdfParagraphs, joinLines, parseXml, readZip, readCfb, setInflater, inflate, formatNumber};
})(typeof window !== 'undefined' ? window : globalThis);
