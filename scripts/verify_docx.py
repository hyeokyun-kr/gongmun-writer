"""Check generated DOCX packages, XML, relationships and preservation of source assets."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import xml.etree.ElementTree as ET
import hashlib
import posixpath
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
original = ROOT / 'firm' / 'templates' / 'reply.docx'
with ZipFile(original) as source:
    media = {n: hashlib.sha256(source.read(n)).hexdigest() for n in source.namelist() if n.startswith('word/media/')}

files = (sorted((ROOT / 'build/verification').glob('*.docx')) + sorted((ROOT / 'build/verification/v3').glob('*.docx')) +
         sorted((ROOT / 'build/verification/opinion').glob('*.docx')) + sorted((ROOT / 'build/verification/extension').glob('*.docx')))
for file in files:
    with ZipFile(file) as z:
        assert z.testzip() is None, f'{file}: CRC mismatch'
        names = set(z.namelist())
        assert len(names) == len(z.namelist()), 'duplicate ZIP entries'
        for n in names:
            if n.endswith(('.xml', '.rels')) or n == '[Content_Types].xml':
                ET.fromstring(z.read(n))
            if n.endswith('.rels'):
                relroot = ET.fromstring(z.read(n))
                base = '' if n == '_rels/.rels' else str(PurePosixPath(n).parent.parent)
                for rel in relroot:
                    assert rel.get('TargetMode') != 'External', (file, n, 'external relationship')
                    resolved = posixpath.normpath(posixpath.join(base, rel.get('Target')))
                    assert resolved in names, (file, n, resolved, 'unresolved relationship')
        doc = ET.fromstring(z.read('word/document.xml'))
        text = ''.join(e.text or '' for e in doc.findall('.//w:t', NS))
        assert '{{' not in z.read('word/document.xml').decode(), 'unfilled slot'
        assert doc.find('.//w:tbl', NS) is not None, 'source metadata table missing'
        sections = doc.findall('.//w:sectPr', NS)
        opinion = file.parent.name == 'opinion'
        has_body = '<첨부>' in text or opinion
        # Cover only: one section. Cover + 첨부 body: the cover's break plus the body's final section.
        # 심사보고서 의견서: 공문 표지, 겉표지, 목차, 본문.
        assert len(sections) == (4 if opinion else 2 if has_body else 1), 'unexpected section count'
        doc_rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('word/_rels/document.xml.rels'))}
        R_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
        used_ids = {e.get(R_ID) for e in doc.iter() if e.get(R_ID)}
        assert used_ids <= set(doc_rels), ('document refers to missing relationships', used_ids - set(doc_rels))
        if opinion:
            title_footers = {f.get(R_ID) for f in sections[1].findall('w:footerReference', NS)}
            for rid in title_footers:
                footer = ET.fromstring(z.read('word/' + doc_rels[rid]))
                assert not ''.join(t.text or '' for t in footer.iter(f'{{{W}}}t')).strip() and footer.find('.//w:instrText', NS) is None, '겉표지 has no page number'
            assert sections[2].find('w:pgNumType', NS).get(f'{{{W}}}fmt') == 'lowerRoman', '목차 pages are i, ii'
            toc_footer = next(f.get(R_ID) for f in sections[2].findall('w:footerReference', NS) if f.get(f'{{{W}}}type') == 'default')
            assert z.read('word/' + doc_rels[toc_footer]).decode().count('\\* roman') == 2, '목차 footer counts pages in roman (i / ii)'
            assert '심사보고서에 대한 의견서' in text and ' TOC ' in z.read('word/document.xml').decode(), '의견서 title and table of contents'
        sec = sections[0]
        if has_body:
            body_sec = doc.find('w:body/w:sectPr', NS)
            assert body_sec is not None and body_sec is sections[-1], 'body section must be the final section'
            assert body_sec.find('w:titlePg', NS) is None, 'body pages use the continuation header'
            assert body_sec.find('w:pgNumType', NS).get(f'{{{W}}}start') == '1', 'body page numbers restart'
            styles = ET.fromstring(z.read('word/styles.xml'))
            style_ids = {e.get(f'{{{W}}}styleId') for e in styles.findall('w:style', NS)}
            used = {e.get(f'{{{W}}}val') for e in doc.findall('.//w:pStyle', NS)}
            assert used <= style_ids, ('undefined paragraph style', used - style_ids)
            numbering = ET.fromstring(z.read('word/numbering.xml'))
            num_ids = {e.get(f'{{{W}}}numId') for e in numbering.findall('w:num', NS)}
            refs = {e.get(f'{{{W}}}val') for e in doc.findall('.//w:numPr/w:numId', NS)}
            for st in styles.findall('w:style', NS):
                if st.get(f'{{{W}}}styleId') in used:
                    refs |= {e.get(f'{{{W}}}val') for e in st.findall('.//w:numPr/w:numId', NS)}
            assert refs <= num_ids, ('undefined numbering', refs - num_ids)
            abstract_ids = {e.get(f'{{{W}}}abstractNumId') for e in numbering.findall('w:abstractNum', NS)}
            assert {e.find('w:abstractNumId', NS).get(f'{{{W}}}val') for e in numbering.findall('w:num', NS)} <= abstract_ids
        margins = sec.find('w:pgMar', NS)
        assert margins.get(f'{{{W}}}top') == '2268', 'source margins changed'
        assert sec.find('w:headerReference', NS) is not None
        assert sec.find('w:footerReference', NS) is not None
        for name, digest in media.items():
            assert hashlib.sha256(z.read(name)).hexdigest() == digest, 'original image changed'
        assert 'SECTIONPAGES' in z.read('word/footer3.xml').decode()
        assert 'updateFields' in z.read('word/settings.xml').decode()
        for name in names:
            if name.startswith('word/header') and name.endswith('.xml'):
                header = ET.fromstring(z.read(name))
                assert not any((e.text or '') == '`' for e in header.findall('.//w:t', NS))
        assert 'lastModifiedBy' not in z.read('docProps/core.xml').decode()
        assert not any(n.startswith('customXml') for n in names)
        assert not any('custom-properties' in z.read(n).decode() for n in names if n.endswith('.rels'))
        if file.stem == 'reply':
            assert '2026. 1. 5.' in text and '서비스업감시과장' in text
            assert '한  라  다' in text and '안  채  유' in text
            assert '추가 설명자료' not in text
        if file.stem == 'additional':
            assert '2025. 12. 1.' in text and '기업집단정책과-000' in text
            assert '기업집단 가나다 동일인(홍길동)의 대리인' in text
            assert '신  린  채' in text and '임  현  겸' in text
            assert '가나다 주식회사' not in text
        if file.stem == 'escaped':
            assert '문자열 </w:t><w:p> & <script>' in text
        if file.stem in ('reply', 'browser-reply', 'attachments-reply', 'attachments-additional'):
            paragraphs = doc.findall('w:body/w:p', NS)
            start = next(i for i, p in enumerate(paragraphs)
                         if ''.join(t.text or '' for t in p.findall('.//w:t', NS)).startswith('첨부1.'))
            count = 3 if file.stem.startswith('attachments-') else 2
            first_indent = paragraphs[start].find('w:pPr/w:ind', NS)
            assert first_indent.get(f'{{{W}}}left', '0') == '0', 'first attachment must stay at left margin'
            tab = paragraphs[start].find('w:pPr/w:tabs/w:tab', NS)
            assert tab.get(f'{{{W}}}pos') == '540', 'first attachment number must align with subsequent numbers'
            for i in range(1, count):
                p = paragraphs[start + i]
                indent = p.find('w:pPr/w:ind', NS)
                assert indent.get(f'{{{W}}}left') == '540', 'continuation attachment indentation missing'
                assert indent.get(f'{{{W}}}firstLineChars') == '0', 'inherited first-line character indentation must be overridden'
                assert ''.join(t.text or '' for t in p.findall('.//w:t', NS)).startswith(f'{i + 1}.'), 'number must not rely on leading spaces'
        print(f'PASS {file.relative_to(ROOT / "build/verification")}: ZIP/XML/relationships, original images, page layout'
              f'{", 의견서 겉표지·목차·본문 sections" if opinion else ", 첨부 body section/styles/numbering" if has_body else ""}, {len(names)} parts')
