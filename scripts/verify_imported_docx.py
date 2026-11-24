"""Independently verify amended original/edited DOCX without changing source files."""
from pathlib import Path
from zipfile import ZipFile
from copy import deepcopy
import unicodedata
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'build/verification/word-import'
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
Q = lambda name: f'{{{W}}}{name}'
COVERS = ROOT / 'tests' / 'fixtures' / 'covers'
sources = {'reply': COVERS / 'cover-reply.docx', 'additional': COVERS / 'cover-additional.docx', 'empty': COVERS / 'cover-empty.docx'}


def text(p):
    return ''.join(n.text or '' for n in p.findall('.//w:t', NS))


cases = [
    (sources['reply'], 'original-reply-added', ['곽솔', '이희온']),
    (sources['additional'], 'original-additional-added', ['한라다']),
    (OUT / 'original-additional-added.docx', 'original-additional-added-twice', ['정민결']),
    (OUT / 'generated-source.docx', 'generated-added', ['이희온']),
    (sources['empty'], 'empty-cover-added', ['이희온', '한라다']),
    (OUT / 'original-additional-cleared.docx', 'original-additional-refilled', ['한라다']),
]
for original, basename, added in cases:
    with ZipFile(original) as before, ZipFile(OUT / f'{basename}.docx') as after:
        assert after.testzip() is None, 'ZIP CRC mismatch'
        assert set(before.namelist()) == set(after.namelist()), 'package members changed'
        assert before.comment == after.comment, 'ZIP comment changed'
        for name in before.namelist():
            if name != 'word/document.xml':
                assert before.read(name) == after.read(name), f'original member changed: {name}'
        old = ET.fromstring(before.read('word/document.xml'))
        new = ET.fromstring(after.read('word/document.xml'))
        oldbody, newbody = old.find('w:body', NS), new.find('w:body', NS)
        oldpairs = [p for p in oldbody if text(p).startswith('담당변호사')]
        newpairs = [p for p in newbody if text(p).startswith('담당변호사')]
        names = lambda pairs: [text(p).removeprefix('담당변호사').replace(' ', '') for p in pairs]
        assert names(newpairs) == names(oldpairs) + added, 'lawyer order or original people changed'
        original_sections = [ET.tostring(p) for p in old.findall('.//w:sectPr', NS)]
        new_sections = [ET.tostring(p) for p in new.findall('.//w:sectPr', NS)]
        assert original_sections == new_sections, 'section structure/format changed'
        # Remove only appended paragraphs, and restore a relocated section boundary.
        saved_section = None
        if oldpairs:
            lastold = list(oldbody).index(oldpairs[-1])
            original_contact = oldbody[lastold + 1]
            saved_section = original_contact.find('w:pPr/w:sectPr', NS)
        for i, namep in enumerate(newpairs[len(oldpairs):]):
            at = list(newbody).index(namep)
            contact_ind = newbody[at + 1].find('w:pPr/w:ind', NS)
            assert contact_ind is not None and contact_ind.get(Q('right')) == '-170', 'new contact must match preview width'
            assert contact_ind.get(Q('firstLineChars')) == '0' and contact_ind.get(Q('firstLine')) == '0', 'new contact must use fixed indentation'
            assert '\u00a0' in text(newbody[at + 1]) and ' ' not in text(newbody[at + 1]), 'new contact must prevent breaks at spaces'
            remove = list(newbody)[at:at + 2]
            if oldpairs or i:
                empty = list(newbody)[at - 1]
                assert not text(empty), 'added spacing must not replace existing content'
                remove.insert(0, empty)
            for p in remove:
                assert p.find('w:pPr/w:keepLines', NS) is None, 'added paragraph has Windows pagination marker'
                assert p.find('w:pPr/w:keepNext', NS) is None, 'added paragraph has Windows pagination marker'
            for p in remove:
                newbody.remove(p)
        if saved_section is not None:
            at = list(newbody).index(newpairs[len(oldpairs) - 1])
            restored_contact = newbody[at + 1]
            assert restored_contact.find('w:pPr/w:sectPr', NS) is None
            restored_contact.find('w:pPr', NS).append(deepcopy(saved_section))
        assert ET.tostring(old) == ET.tostring(new), 'untouched original document structure or text changed'
        print(f'PASS {basename}: all original members/content/people/sections preserved; added {", ".join(added)}')

full_cases = [
    (OUT / 'empty-cover-added.docx', 'empty-cover-edited', ['한라다', '이희온', '정민결'], {'한라다': '02-1111-2222'}),
    (OUT / 'empty-cover-added.docx', 'empty-cover-cleared', [], {}),
    (sources['reply'], 'original-reply-edited', ['안채유', '한라다', '추호', '곽솔', '이희온'], {'한라다': '02-2222-3333', '곽솔': '02-9999-1234'}),
    (sources['additional'], 'original-additional-reordered', ['임현겸', '신린채', '곽솔'], {'곽솔': 'changed.sol@example.test'}),
    (sources['additional'], 'original-additional-cleared', [], {}),
]
for original, basename, expected_names, edits in full_cases:
    with ZipFile(original) as before, ZipFile(OUT / f'{basename}.docx') as after:
        assert after.testzip() is None
        assert set(before.namelist()) == set(after.namelist())
        for member in before.namelist():
            if member != 'word/document.xml':
                assert before.read(member) == after.read(member), member
        old = ET.fromstring(before.read('word/document.xml'))
        new = ET.fromstring(after.read('word/document.xml'))
        oldbody, newbody = old.find('w:body', NS), new.find('w:body', NS)
        oldpairs = [p for p in oldbody if text(p).startswith('담당변호사')]
        newpairs = [p for p in newbody if text(p).startswith('담당변호사')]
        assert names(newpairs) == expected_names
        prefix_count = list(oldbody).index(oldpairs[0])
        tail = list(oldbody)[list(oldbody).index(oldpairs[-1]) + 2:]
        assert [ET.tostring(p) for p in list(oldbody)[:prefix_count]] == [ET.tostring(p) for p in list(newbody)[:prefix_count]], 'original body/signature changed'
        assert [ET.tostring(p) for p in tail] == [ET.tostring(p) for p in list(newbody)[-len(tail):]], 'original trailing content changed'
        assert [ET.tostring(p) for p in old.findall('.//w:sectPr', NS)] == [ET.tostring(p) for p in new.findall('.//w:sectPr', NS)], 'section formatting changed'
        for namep, name in zip(newpairs, expected_names):
            contact = newbody[list(newbody).index(namep) + 1]
            if name in edits:
                assert edits[name] in text(contact), 'contact edit missing'
        print(f'PASS {basename}: full-list edit/order/delete; original body/signature/members/sections preserved')
