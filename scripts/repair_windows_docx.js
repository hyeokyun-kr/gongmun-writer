/* Remove cover pagination flags from an existing DOCX into a separate copy.
 * Preserve all other XML text and compressed package members byte-for-byte. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {inflateRawSync} = require('node:zlib');
require('../src/engine.js');
require('../src/word-import.js');
const Word = globalThis.GongmunWord;

(async () => {
  const [source, output] = process.argv.slice(2);
  if (!source || !output) throw new Error('Usage: node scripts/repair_windows_docx.js source.docx output.docx');
  if (path.resolve(source) === path.resolve(output) || fs.existsSync(output)) throw new Error('Choose a new output file; existing documents are never overwritten.');
  const zip = Word.readZip(fs.readFileSync(source));
  const entry = zip.byName.get('word/document.xml');
  if (!entry) throw new Error('The DOCX does not contain word/document.xml.');
  const compressed = zip.bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
  const data = entry.method === 8 ? inflateRawSync(compressed, {maxOutputLength:8 * 1024 * 1024}) : compressed;
  assert.equal(data.length, entry.length);
  assert.equal(globalThis.Gongmun.crc32(data), entry.crc);
  const xml = new TextDecoder('utf-8', {fatal:true}).decode(data);
  let removed = 0;
  const updated = xml.replace(/<w:(keepNext|keepLines)\b[^>]*\/>|<w:(keepNext|keepLines)\b[^>]*>\s*<\/w:\2\s*>/g, () => {removed++; return '';});
  if (!removed) throw new Error('No cover pagination flags found; no file was written.');
  const bytes = Word.replaceMember(zip, 'word/document.xml', updated), result = Word.readZip(bytes);
  assert.equal(new TextDecoder().decode(await Word.entryBytes(result, 'word/document.xml')), updated);
  for (const e of zip.entries) {
    if (e.name !== 'word/document.xml') assert.deepEqual(result.byName.get(e.name).local, e.local, e.name);
  }
  fs.writeFileSync(output, bytes, {flag:'wx'});
  console.log(`Saved ${output}; removed ${removed} pagination flags; other compressed members preserved.`);
})().catch(e => {console.error(e.message); process.exitCode = 1;});
