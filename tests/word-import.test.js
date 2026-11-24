/* End-to-end offline DOCX amendment using original Word files and edited cases. */
const {chromium} = require(process.argv[2] || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.join(__dirname, '..'), out = path.join(root, 'build/verification/word-import');
fs.mkdirSync(out, {recursive:true});
fs.mkdirSync(path.join(out, 'word-preview'), {recursive:true});
const covers = path.join(root, 'tests', 'fixtures', 'covers');
const sourceFor = name => path.join(covers, name);
fs.copyFileSync(sourceFor('cover-additional.docx'), path.join(out, 'original-additional-source.docx'));

(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true,
    args:['--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check']});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1080}, acceptDownloads:true, bypassCSP:true}), requests = [], errors = [];
    await context.route(/^https?:/, r => {requests.push(r.request().url()); return r.abort();});
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'dist', 'gongmun-writer.html')).href);
    await page.evaluate(() => {document.querySelector('.more-tools').open = true;});
    await page.locator('#sample-reply').click(); await page.waitForTimeout(200);
    const currentSubmitter = await page.locator('#submitter').inputValue();
    await page.locator('#existing-word-open').click();
    assert.ok(await page.locator('#existing-word-export').isDisabled());
    await page.locator('#existing-word-file').setInputFiles(sourceFor('cover-empty.docx'));
    await page.locator('#existing-word-summary').waitFor({state:'visible'});
    assert.match(await page.locator('#existing-word-count').innerText(), /0명/);
    assert.match(await page.locator('#existing-word-status').innerText(), /서명부 아래/);
    assert.ok(await page.locator('#existing-word-export').isDisabled());
    await page.locator('#existing-word-results').getByRole('button', {name:'한라다 변호사 추가'}).click();
    await page.locator('#existing-word-results').getByRole('button', {name:'이희온 변호사 추가'}).click();
    await page.locator('#existing-word-selected').getByLabel('2번째 항목 위로').click();
    let [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    await download.saveAs(path.join(out, 'empty-cover-added.docx'));
    await page.locator('#existing-word-file').setInputFiles(path.join(out, 'empty-cover-added.docx'));
    await page.waitForFunction(() => document.getElementById('existing-word-count').textContent.includes('2명'));
    assert.equal(await page.locator('#existing-word-selected strong').count(), 2);
    await page.locator('#existing-word-selected').getByLabel('2번째 항목 수정').click();
    await page.locator('#contact-phone').fill('02-1111-2222'); await page.locator('#contact-form button[type="submit"]').click();
    await page.locator('#existing-word-selected').getByLabel('2번째 항목 위로').click();
    await page.locator('#existing-word-results').getByRole('button', {name:'정민결 변호사 추가'}).click();
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    assert.match(download.suggestedFilename(), /_변호사수정본\.docx$/);
    await download.saveAs(path.join(out, 'empty-cover-edited.docx'));
    console.log('PASS supplied zero-lawyer cover, append, re-import, existing contact edit and mixed ordering');

    await page.locator('#existing-word-file').setInputFiles(sourceFor('cover-reply.docx'));
    await page.waitForFunction(() => document.getElementById('existing-word-count').textContent.includes('4명'));
    assert.match(await page.locator('#existing-word-count').innerText(), /4명/);
    assert.match(await page.locator('#existing-word-people').innerText(), /안채유/);
    assert.ok(await page.locator('#existing-word-results').getByRole('button', {name:'한라다 이미 포함'}).isDisabled());
    await page.locator('#existing-word-results').getByRole('button', {name:'이희온 변호사 추가'}).click();
    await page.locator('#existing-word-results').getByRole('button', {name:'곽솔 변호사 추가'}).click();
    await page.locator('#existing-word-selected').getByLabel('6번째 항목 위로').click();
    assert.equal(await page.locator('#existing-word-selected strong').nth(4).innerText(), '곽솔');
    await page.locator('#existing-word-selected').getByLabel('5번째 항목 수정').click();
    await page.locator('#contact-phone').fill('02-9999-1234'); await page.locator('#contact-form button[type="submit"]').click();
    assert.match(await page.locator('#existing-word-selected').innerText(), /02-9999-1234/);
    assert.ok(await page.locator('#existing-word-export').isEnabled());
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    assert.match(download.suggestedFilename(), /_변호사추가본\.docx$/);
    await download.saveAs(path.join(out, 'original-reply-added.docx'));
    for (const i of [4,3,2]) await page.locator('#existing-word-selected').getByLabel(`${i}번째 항목 위로`).click();
    await page.locator('#existing-word-selected').getByLabel('2번째 항목 수정').click();
    await page.locator('#contact-phone').fill('02-2222-3333'); await page.locator('#contact-form button[type="submit"]').click();
    await page.locator('#existing-word-selected').getByLabel('3번째 항목 삭제').click();
    await page.locator('#confirm-no').click();
    assert.equal(await page.locator('#existing-word-selected strong').count(), 6);
    await page.locator('#existing-word-selected').getByLabel('3번째 항목 삭제').click();
    await page.locator('#confirm-yes').click();
    assert.equal(await page.locator('#existing-word-selected strong').count(), 5);
    assert.equal(await page.locator('#existing-word-selected strong').first().innerText(), '안채유');
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    await download.saveAs(path.join(out, 'original-reply-edited.docx'));
    await page.screenshot({path:path.join(out, 'dialog-desktop.png'), fullPage:true});
    await page.locator('#existing-word-dialog [data-close]').first().click();
    assert.equal(await page.locator('#submitter').inputValue(), currentSubmitter);
    assert.equal(await page.locator('#selected-lawyers .ordered-item').count(), 4);
    console.log('PASS original compressed reply, full-list ordering/edit/deletion confirmation, isolated download');

    await page.locator('#existing-word-open').click();
    await page.locator('#existing-word-file').setInputFiles(sourceFor('cover-additional.docx'));
    await page.waitForFunction(() => document.getElementById('existing-word-people').textContent.includes('임현겸'));
    assert.match(await page.locator('#existing-word-warnings').innerText(), /구역 나눔/);
    await page.locator('#existing-word-search').fill('ㅎㄹㄷ');
    await page.locator('#existing-word-results').getByRole('button', {name:'한라다 변호사 추가'}).click();
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    await download.saveAs(path.join(out, 'original-additional-added.docx'));
    console.log('PASS additional cover section-boundary document and initial-consonant search');

    // Re-importing an amended file detects the added lawyer and uses their styles.
    await page.locator('#existing-word-file').setInputFiles(path.join(out, 'original-additional-added.docx'));
    await page.waitForFunction(() => document.getElementById('existing-word-count').textContent.includes('5명'));
    assert.ok(await page.locator('#existing-word-results').getByRole('button', {name:'한라다 이미 포함'}).isDisabled());
    await page.locator('#existing-word-search').fill('정민결');
    await page.locator('#existing-word-results').getByRole('button', {name:'정민결 변호사 추가'}).click();
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#existing-word-export').click()]);
    await download.saveAs(path.join(out, 'original-additional-added-twice.docx'));
    console.log('PASS amended file re-import and second append');

    // A pending choice is retained when file replacement is cancelled.
    await page.locator('#existing-word-search').fill('설우나');
    await page.locator('#existing-word-results').getByRole('button', {name:'설우나 변호사 추가'}).click();
    await page.locator('#existing-word-file').setInputFiles(sourceFor('cover-reply.docx'));
    await page.locator('#confirm-no').click();
    assert.equal(await page.locator('#existing-word-selected strong').count(), 7);
    assert.match(await page.locator('#existing-word-people').innerText(), /한라다/);
    assert.match(await page.locator('#existing-word-status').innerText(), /파일 변경을 취소/);
    assert.match(await page.locator('#existing-word-filename').innerText(), /original-additional-added\.docx/);
    console.log('PASS non-destructive imported-file replacement cancellation');

    // Master management is shared, without overwriting selected contact snapshots.
    await page.locator('#existing-word-manage').click();
    await page.locator('#lawyer-name').fill('추가테스트'); await page.locator('#lawyer-phone').fill('02-8888-1111');
    await page.locator('#lawyer-email').fill('append@example.test'); await page.locator('#lawyer-form button[type="submit"]').click();
    await page.locator('#lawyer-dialog [data-close]').click(); await page.locator('#existing-word-search').fill('추가테스트');
    assert.equal(await page.locator('#existing-word-results .lawyer-result').count(), 1);
    await page.locator('#existing-word-selected').getByLabel('6번째 항목 수정').click();
    await page.locator('#contact-name').fill('한 라 다'); await page.locator('#contact-email').fill('changed@example.test');
    await page.locator('#contact-form button[type="submit"]').click();
    assert.ok(await page.locator('#existing-word-export').isDisabled());
    assert.match(await page.locator('#existing-word-check').innerText(), /중복/);
    console.log('PASS shared master management and name-normalized duplicate prevention after edits');
    await page.setViewportSize({width:390,height:844});
    const horizontal = await page.locator('#existing-word-dialog').evaluate(e => e.scrollWidth - e.clientWidth);
    assert.ok(horizontal <= 2, 'dialog horizontal overflow: ' + horizontal);
    await page.screenshot({path:path.join(out, 'dialog-mobile.png'), fullPage:false});
    console.log('PASS mobile dialog layout');

    // APIs test XML/format guardrails and byte-preserving insertion against generated
    // documents. All document processing still executes inside the offline browser.
    const result = await page.evaluate(async () => {
      const G = Gongmun, Word = GongmunWord, bundle = GONGMUN_TEMPLATES;
      const c = G.sample('reply'); c.bodyOverride = 'Word에서 직접 작성한 문장 & <특수문자>를 보존합니다.';
      const original = G.docx(c, bundle), pkg = await Word.open(original, 'edited.docx');
      const added = pkg.add([G.lawyerDefaults.find(l => l.name === '이희온')]), before = Word.readZip(original), after = Word.readZip(added);
      const unchanged = pkg.save(G.clone(pkg.existing));
      if (unchanged.length !== original.length || unchanged.some((b,i) => b !== original[i])) throw new Error('no-op save must retain the exact source ZIP');
      const all = G.clone(pkg.existing), changed = [{...all[3]}, {...all[0],name:'한라다수정',directPhone:'02-1234-5678'}, G.clone(G.lawyerDefaults.find(l => l.name === '이희온'))];
      const edited = pkg.save(changed), editedPackage = await Word.open(edited, 'edited-people.docx');
      if (editedPackage.existing.map(p => p.name).join(',') !== '안채유,한라다수정,이희온') throw new Error('mixed edit/order/delete result incorrect');
      if (editedPackage.existing[1].directPhone !== '02-1234-5678') throw new Error('phone edit did not survive');
      if (!(await Word.open(pkg.save([]), 'all-removed.docx')).emptySignature) throw new Error('zero-lawyer re-import failed');
      const text = bytes => new TextDecoder().decode(bytes);
      const beforeXml = text(await Word.entryBytes(before, 'word/document.xml'));
      const afterXml = text(await Word.entryBytes(after, 'word/document.xml'));
      const dom = new DOMParser().parseFromString(afterXml, 'application/xml');
      const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const paragraphs = [...dom.getElementsByTagNameNS(W, 'body')[0].children];
      const nameP = paragraphs.find(p => p.textContent.includes('담당변호사   이  희  온'));
      const contactP = nameP.nextElementSibling;
      const contactInd = contactP.getElementsByTagNameNS(W,'ind')[0];
      if (contactInd.getAttributeNS(W,'firstLineChars') !== '0' || contactInd.getAttributeNS(W,'firstLine') !== '0') throw new Error('contact still uses font-dependent first-line indentation');
      if (!contactP.textContent.includes('\u00a0') || contactP.textContent.includes(' ')) throw new Error('new contact must use nonbreaking spaces');
      const serializer = new XMLSerializer();
      const inserted = [nameP.previousElementSibling, nameP, nameP.nextElementSibling].map(n => serializer.serializeToString(n)).join('');
      if (afterXml.replace(inserted, '') !== beforeXml) throw new Error('untouched source XML must remain exactly identical');
      const untouched = before.entries.every(e => e.name === 'word/document.xml' ||
        after.byName.get(e.name).local.every((b,i) => b === e.local[i]) && after.byName.get(e.name).local.length === e.local.length);
      if (!untouched) throw new Error('original compressed members changed');
      const otherPrefix = beforeXml.replace(/xmlns:w=/g, 'xmlns:q=').replace(/\bw:/g, 'q:');
      const otherPackage = await Word.open(Word.replaceMember(before, 'word/document.xml', otherPrefix), 'other-prefix.docx');
      const prefixAdded = otherPackage.add([G.lawyerDefaults.find(l => l.name === '이희온')]);
      if ((await Word.open(prefixAdded, 'other-prefix-added.docx')).existing.length !== 5) throw new Error('alternate XML prefix support failed');
      const bomPackage = await Word.open(Word.replaceMember(before, 'word/document.xml', '\uFEFF' + beforeXml), 'bom.docx');
      const bomXml = await Word.entryBytes(Word.readZip(bomPackage.add([G.lawyerDefaults.find(l => l.name === '이희온')])), 'word/document.xml');
      if (bomXml[0] !== 0xef || bomXml[1] !== 0xbb || bomXml[2] !== 0xbf) throw new Error('original UTF-8 BOM must be preserved');
      const rejection = async (bytes, filename, pattern) => {
        try {await Word.open(bytes, filename);} catch (e) {if (pattern.test(e.message)) return e.message; throw e;}
        throw new Error('expected refusal: ' + filename);
      };
      const checks = [];
      checks.push(await rejection(original, 'wrong.doc', /\.docx/));
      checks.push(await rejection(new Uint8Array([1,2,3]), 'broken.docx', /손상/));
      for (const [xml, pattern] of [
        [beforeXml.replace(/담당변호사/g, '작성자'), /영역을 찾지/],
        [beforeXml.replace('예시:', '다른법인:'), /양식을 확인하지/],
        [beforeXml.replace(/T\.\s0000-6055/, '연락처 없음'), /이름·전화번호·이메일/],
        [beforeXml.replace('<w:t xml:space="preserve">담당변호사   한  라  다</w:t>', '<w:t xml:space="preserve">담당변호사</w:t>'), /이름과 연락처/],
        [beforeXml.replace('</w:body>', '<w:p><w:r><w:t>변호사 뒤 다른 내용</w:t></w:r></w:p></w:body>'), /뒤에 다른 내용/],
        [beforeXml.replace('</w:body>', '<w:ins w:id="1"><w:p/></w:ins></w:body>'), /변경 내용 추적/],
        [beforeXml.replace('</w:document>', ''), /XML이 손상/],
        [beforeXml.replace('1.0', '1.0') + '<!DOCTYPE test>', /지원하지 않는 XML/]
      ]) checks.push(await rejection(Word.replaceMember(before, 'word/document.xml', xml), 'unsafe.docx', pattern));
      const settings = '<w:settings xmlns:w="' + W + '"><w:documentProtection w:edit="readOnly" w:enforcement="1"/></w:settings>';
      checks.push(await rejection(Word.replaceMember(before, 'word/settings.xml', settings), 'protected.docx', /편집 보호/));
      const entries = [];
      for (const e of before.entries) entries.push([e.name, await Word.entryBytes(before, e.name)]);
      entries.push(['word/vbaProject.bin', new Uint8Array([1])]);
      checks.push(await rejection(G.zipStore(entries), 'macro.docx', /매크로/));
      entries.pop(); entries.push(['_xmlsignatures/sig1.xml', '<signature/>']);
      checks.push(await rejection(G.zipStore(entries), 'signed.docx', /전자서명/));
      try {pkg.add([G.lawyerDefaults.find(l => l.name === '한라다')]); throw new Error('duplicate not rejected');} catch (e) {if (!/중복/.test(e.message)) throw e;}
      return {added:[...added], original:[...original], checks};
    });
    fs.writeFileSync(path.join(out, 'generated-source.docx'), Buffer.from(result.original));
    fs.writeFileSync(path.join(out, 'generated-added.docx'), Buffer.from(result.added));
    assert.ok(result.checks.length >= 10);
    console.log('PASS exact original XML/member preservation and unsupported/unsafe document guardrails');

    // Last-contact section boundaries must survive arbitrary reordering/deletion,
    // including moving the original last lawyer away from the last position.
    const boundaryResult = await page.evaluate(async bytes => {
      const G = Gongmun, Word = GongmunWord, source = new Uint8Array(bytes), pkg = await Word.open(source, 'additional.docx');
      const original = G.clone(pkg.existing);
      const reordered = pkg.save([original[3], original[0], {...original[1], email:'changed.sol@example.test'}]);
      const people = (await Word.open(reordered, 'additional-reordered.docx')).existing;
      if (people.map(p => p.name).join(',') !== '임현겸,신린채,곽솔' || people[2].email !== 'changed.sol@example.test') throw new Error('가나다 reorder/edit failed');
      const cleared = pkg.save([]), empty = await Word.open(cleared, 'additional-cleared.docx');
      if (empty.existing.length) throw new Error('cleared file still has lawyers');
      const refilled = empty.save([G.lawyerDefaults.find(l => l.name === '한라다')]);
      if ((await Word.open(refilled, 'additional-refilled.docx')).existing[0].name !== '한라다') throw new Error('section-boundary zero-lawyer append failed');
      return {reordered:[...reordered], cleared:[...cleared], refilled:[...refilled]};
    }, [...fs.readFileSync(sourceFor('cover-additional.docx'))]);
    for (const [name, bytes] of Object.entries(boundaryResult)) fs.writeFileSync(path.join(out, 'original-additional-' + name + '.docx'), Buffer.from(bytes));
    console.log('PASS last-contact section preservation during reorder/edit/delete/all-clear/refill');

    await page.locator('#existing-word-file').setInputFiles(path.join(out, 'empty-cover-added.docx'));
    await page.locator('#confirm-yes').click();
    await page.waitForFunction(() => document.getElementById('existing-word-count').textContent.includes('2명'));
    for (let i = 0; i < 2; i++) {
      await page.locator('#existing-word-selected').getByLabel('1번째 항목 삭제').click();
      await page.locator('#confirm-yes').click();
    }
    assert.equal(await page.locator('#existing-word-selected strong').count(), 0);
    await page.locator('#existing-word-export').click(); await page.locator('#confirm-no').click();
    assert.equal(await page.locator('#existing-word-selected strong').count(), 0);
    await page.locator('#existing-word-export').click();
    [download] = await Promise.all([page.waitForEvent('download'), page.locator('#confirm-yes').click()]);
    await download.saveAs(path.join(out, 'empty-cover-cleared.docx'));
    await page.locator('#existing-word-file').setInputFiles(path.join(out, 'empty-cover-cleared.docx'));
    await page.waitForFunction(() => document.getElementById('existing-word-count').textContent.includes('0명'));
    await page.locator('#existing-word-results').getByRole('button', {name:'한라다 변호사 추가'}).click();
    console.log('PASS all-lawyer removal confirmations, empty output re-import, and re-selection');

    // Older exports can contain keep flags. New rows must not inherit them,
    // while the older document's untouched paragraphs remain verbatim.
    const legacyResult = await page.evaluate(async () => {
      const G = window.Gongmun, Word = window.GongmunWord;
      const source = G.docx(G.sample('reply'), window.GONGMUN_TEMPLATES);
      const zip = Word.readZip(source), decode = new TextDecoder();
      const xml = decode.decode(await Word.entryBytes(zip, 'word/document.xml'));
      const legacyXml = xml.replace(/<w:pPr>/g, '<w:pPr><w:keepNext/><w:keepLines/>');
      const legacy = Word.replaceMember(zip, 'word/document.xml', legacyXml);
      const opened = await Word.open(legacy, 'legacy.docx');
      const saved = opened.save([...opened.existing, G.lawyerDefaults.find(l => l.name === '이희온')]);
      const doc = new DOMParser().parseFromString(decode.decode(await Word.entryBytes(Word.readZip(saved), 'word/document.xml')), 'application/xml');
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
      const names = [...doc.getElementsByTagNameNS(ns, 'p')].filter(p => p.textContent.startsWith('담당변호사'));
      const addedName = names[names.length - 1];
      const added = [addedName.previousElementSibling, addedName, addedName.nextElementSibling];
      return {existing: names[0].getElementsByTagNameNS(ns, 'keepNext').length,
        added: added.map(p => p.getElementsByTagNameNS(ns, 'keepNext').length + p.getElementsByTagNameNS(ns, 'keepLines').length)};
    });
    assert.equal(legacyResult.existing, 1, 'untouched source paragraph must retain its formatting');
    assert.deepEqual(legacyResult.added, [0, 0, 0]);
    console.log('PASS new lawyer rows do not inherit Windows pagination markers from older exports');

    await page.locator('#existing-word-file').setInputFiles({name:'broken.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('not a ZIP')});
    await page.locator('#confirm-yes').click();
    await page.waitForFunction(() => document.getElementById('existing-word-status').classList.contains('error'));
    assert.ok(await page.locator('#existing-word-export').isDisabled());
    assert.ok(await page.locator('#existing-word-summary').isHidden());
    assert.match(await page.locator('#existing-word-status').innerText(), /손상/);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    console.log('PASS failed replacement cannot export stale document; zero external requests and JS errors');
    await context.close();
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode = 1;});
