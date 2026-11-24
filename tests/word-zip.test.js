/* Native ZIP reader/preserving writer checks; no third-party packages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../src/engine.js'); require('../src/readers.js'); require('../src/word-import.js');
const G = globalThis.Gongmun, Word = globalThis.GongmunWord;
const root = path.join(__dirname, '..');
(async () => {
  for (const name of fs.readdirSync(path.join(root, 'tests', 'fixtures', 'covers')).filter(n => /\.docx$/i.test(n))) {
    const input = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'covers', name)), zip = Word.readZip(input);
    const original = await Word.entryBytes(zip, 'word/document.xml');
    assert.equal(zip.byName.get('word/document.xml').method, 8, 'test actual Word compression');
    const edited = new TextDecoder().decode(original).replace('무궁한 발전', '원문 보존 테스트');
    const updated = Word.readZip(Word.replaceMember(zip, 'word/document.xml', edited));
    assert.equal(new TextDecoder().decode(await Word.entryBytes(updated, 'word/document.xml')), edited);
    for (const e of zip.entries) {
      const result = updated.byName.get(e.name); assert.ok(result);
      if (e.name !== 'word/document.xml') {
        assert.deepEqual(result.local, e.local, e.name + ': compressed member must remain byte-identical');
        const central = result.central.slice(); new DataView(central.buffer).setUint32(42, e.offset, true);
        assert.deepEqual(central, e.central, e.name + ': original ZIP metadata must be preserved');
      }
    }
    assert.equal(updated.entries.length, zip.entries.length);
    console.log('PASS compressed source package preservation: ' + name.normalize('NFC'));
  }
  const stored = G.zipStore([['word/document.xml', 'plain XML'], ['test.txt', 'untouched']]);
  assert.equal(new TextDecoder().decode(await Word.entryBytes(Word.readZip(stored), 'word/document.xml')), 'plain XML');
  const broken = stored.slice(); broken[Word.readZip(broken).entries[0].dataStart] ^= 1;
  await assert.rejects(Word.entryBytes(Word.readZip(broken), 'word/document.xml'), /손상/);
  const encrypted = stored.slice(), zip = Word.readZip(encrypted);
  const ev = new DataView(encrypted.buffer);
  ev.setUint16(zip.entries[0].offset + 6, 1, true);
  const cd = ev.getUint32(encrypted.length - 22 + 16, true); ev.setUint16(cd + 8, 1, true);
  assert.throws(() => Word.readZip(encrypted), /손상/);
  assert.throws(() => Word.readZip(stored.slice(0, 30)), /손상/);
  assert.throws(() => Word.readZip(G.zipStore([['../test.txt', 'bad']])), /손상/);
  assert.throws(() => Word.readZip(G.zipStore([['test.txt', 'a'], ['test.txt', 'b']])), /손상/);
  assert.throws(() => Word.readZip(new Uint8Array(Word.MAX_FILE + 1)), /20MB/);
  console.log('PASS stored ZIP, CRC, encryption, truncation, path, duplicate and size rejection');
})().catch(e => {console.error(e); process.exitCode = 1;});
