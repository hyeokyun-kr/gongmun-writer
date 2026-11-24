"""Build a completely offline, single-file application from the firm profile (firm/: firm.json and two cover templates).

No third-party Python package is required. Word formatting is extracted from the originals;
the browser fills named text slots and repeats the original paragraph structures.
The vendored pdf.js (Apache-2.0) and its Korean CMaps are inlined so PDFs are read locally.
"""
from pathlib import Path
from zipfile import ZipFile
from copy import deepcopy
import base64
import io
import json
import re
import unicodedata
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent          # repository root
PROJECT = ROOT
FIRM_DIR = ROOT / 'firm'
FIRM = json.loads((FIRM_DIR / 'firm.json').read_text(encoding='utf-8'))
TEMPLATE_DIR = FIRM_DIR / 'templates'
OUTPUT = ROOT / 'dist' / 'gongmun-writer.html'
PDFJS = ROOT / 'vendor' / 'pdfjs-3.11.174'

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PR = 'http://schemas.openxmlformats.org/package/2006/relationships'
NS = {'w': W}
XML = 'http://www.w3.org/XML/1998/namespace'


def tag(name):
    return f'{{{W}}}{name}'


def clean(element):
    for node in element.iter():
        for key in list(node.attrib):
            local = key.rsplit('}', 1)[-1]
            if local.startswith('rsid') or local in ('paraId', 'textId', 'anchorId', 'editId', 'Ignorable'):
                del node.attrib[key]
        for child in list(node):
            if child.tag in (tag('bookmarkStart'), tag('bookmarkEnd'), tag('proofErr'),
                             tag('lastRenderedPageBreak')):
                node.remove(child)
    return element


def text_paragraph(original, value):
    """Retain paragraph and run formatting, not old text or source bookmarks."""
    p = deepcopy(original)
    pr = p.find('w:pPr', NS)
    first = p.find('w:r/w:rPr', NS)
    for child in list(p):
        if child.tag != tag('pPr'):
            p.remove(child)
    if pr is None:
        pr = ET.SubElement(p, tag('pPr'))
    nested_section = pr.find('w:sectPr', NS)
    if nested_section is not None:
        pr.remove(nested_section)
    # Match the original cover's ordinary paragraphs. Windows Word can display
    # pagination-property squares beside paragraphs with either keep setting.
    for child in list(pr):
        if child.tag in (tag('keepNext'), tag('keepLines')):
            pr.remove(child)
    r = ET.SubElement(p, tag('r'))
    if first is not None:
        r.append(deepcopy(first))
    t = ET.SubElement(r, tag('t'), {f'{{{XML}}}space': 'preserve'})
    t.text = value
    return clean(p)


def serial(element):
    return ET.tostring(clean(element), encoding='unicode')


# w:rPr children must keep the schema order; highlight follows the size elements.
RPR_AFTER_HIGHLIGHT = ('u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang',
                       'eastAsianLayout', 'specVanish', 'oMath')
RPR_AFTER_SPACING = ('w', 'kern', 'position', 'sz', 'szCs', 'highlight') + RPR_AFTER_HIGHLIGHT


def add_highlight(rpr, color='yellow'):
    assert rpr is not None, 'run properties missing'
    mark = ET.Element(tag('highlight'), {tag('val'): color})
    later = [i for i, child in enumerate(rpr) if child.tag in {tag(n) for n in RPR_AFTER_HIGHLIGHT}]
    rpr.insert(later[0] if later else len(rpr), mark)


def signature_paragraph(original, value, contact=False):
    p = text_paragraph(original, value)
    pr = p.find('w:pPr', NS)
    ind = pr.find('w:ind', NS)
    if ind is None:
        ind = ET.Element(tag('ind'))
        pr.insert(0, ind)
    # Use a fixed left margin, not firstLineChars (font-dependent on Windows).
    left = int(ind.get(tag('left'), '0')) + int(ind.get(tag('firstLine'), '0')) - int(ind.get(tag('hanging'), '0'))
    right = '-170' if contact else ind.get(tag('right'), '0')
    ind.attrib.clear()
    ind.attrib.update({tag('left'): str(left), tag('right'): right,
                       tag('firstLine'): '0', tag('firstLineChars'): '0'})
    return p


def build_template(path):
    with ZipFile(path) as z:
        raw = z.read('word/document.xml')
        for _, (prefix, uri) in ET.iterparse(io.BytesIO(raw), events=['start-ns']):
            if prefix and not re.fullmatch(r'ns\d+', prefix):
                ET.register_namespace(prefix, uri)
        root = ET.fromstring(raw)
        body = root.find('w:body', NS)
        children = list(body)
        paras = [x for x in children if x.tag == tag('p')]
        table = deepcopy(children[0])
        rows = table.findall('w:tr', NS)
        assignments = [(0, 0, '{{sendDate}}'), (1, 0, FIRM['label'] + ':'),
                       (2, 1, '{{agency}}'), (3, 1, '{{refDept}}'), (4, 1, '{{title}}')]
        for ri, ci, value in assignments:
            cell = rows[ri].findall('w:tc', NS)[ci]
            old = cell.find('w:p', NS)
            cell.remove(old)
            cell.append(text_paragraph(old, value))
        # The 2026 replies mark what is still to be confirmed in yellow: the sending date
        # (filled from the 공문's 제출기한) and the ‘*’ of the management number ‘26-*’.
        date_run = rows[0].find('w:tc/w:p/w:r', NS)
        add_highlight(date_run.find('w:rPr', NS))
        # The firm label (‘예시:’) stays in the narrow label column; the number goes in the wide column, as in the replies.
        label_run = rows[1].findall('w:tc', NS)[0].find('w:p/w:r', NS)
        ref_cell = rows[1].findall('w:tc', NS)[1]
        ref_old = ref_cell.find('w:p', NS)
        ref_cell.remove(ref_old)
        ref_p = text_paragraph(ref_old, '')
        ref_p.remove(ref_p.find('w:r', NS))
        ref_p.append(ET.Element('__FIRM_REF__'))
        ref_cell.append(ref_p)
        firm_run = deepcopy(label_run)
        for child in list(firm_run):
            if child.tag != tag('rPr'):
                firm_run.remove(child)
        ET.SubElement(firm_run, tag('t'), {f'{{{XML}}}space': 'preserve'}).text = '{{text}}'
        firm_mark = deepcopy(firm_run)
        add_highlight(firm_mark.find('w:rPr', NS))
        ref_row = serial(rows[3])
        row_index = list(table).index(rows[3])
        table.remove(rows[3])
        table.insert(row_index, ET.Element('__REF_ROW__'))
        table_xml = serial(table).replace('<__REF_ROW__ />', '{{refRow}}').replace('<__FIRM_REF__ />', '{{firmRef}}')
        assert '{{firmRef}}' in table_xml, 'management number slot missing'
        texts = [''.join(t.text or '' for t in p.findall('.//w:t', NS)) for p in paras]
        greeting = paras[0]
        main = next(p for p, t in zip(paras, texts) if '관련하여' in t)
        attachment = next(p for p, t in zip(paras, texts) if t.startswith('첨부'))
        attachment_continuation = text_paragraph(attachment, '{{text}}')
        # Align subsequent numbers after the 12pt "첨부 " prefix (24pt + 3pt).
        # Use paragraph indentation, not spaces or a tab that is lost when filling text.
        continuation_pr = attachment_continuation.find('w:pPr', NS)
        continuation_ind = continuation_pr.find('w:ind', NS)
        if continuation_ind is None:
            continuation_ind = ET.SubElement(continuation_pr, tag('ind'))
        continuation_ind.attrib.clear()
        continuation_ind.set(tag('left'), '540')
        continuation_ind.set(tag('firstLine'), '0')
        continuation_ind.set(tag('firstLineChars'), '0')
        attachment_first = text_paragraph(attachment, '첨부')
        first_pr = attachment_first.find('w:pPr', NS)
        first_tabs = first_pr.find('w:tabs', NS)
        if first_tabs is None:
            first_tabs = ET.SubElement(first_pr, tag('tabs'))
        first_tabs.clear()
        ET.SubElement(first_tabs, tag('tab'), {tag('val'): 'left', tag('pos'): '540'})
        first_run = attachment_first.find('w:r', NS)
        ET.SubElement(first_run, tag('tab'))
        numbered_run = deepcopy(first_run)
        for child in list(numbered_run):
            if child.tag != tag('rPr'):
                numbered_run.remove(child)
        ET.SubElement(numbered_run, tag('t'), {f'{{{XML}}}space': 'preserve'}).text = '{{text}}'
        attachment_first.append(numbered_run)
        agent = next(p for p, t in zip(paras, texts) if '의 대리인' in t)
        logo = next(p for p in paras if p.find('.//w:drawing', NS) is not None)
        lawyer = next(p for p, t in zip(paras, texts) if t.startswith('담당변호사'))
        contact = next(p for p, t in zip(paras, texts) if t.startswith('T.'))
        contact_template = signature_paragraph(contact, '{{text}}', contact=True)
        contact_pr = contact_template.find('w:pPr', NS)
        contact_ind = contact_pr.find('w:ind', NS)
        if contact_ind is None:
            contact_ind = ET.SubElement(contact_pr, tag('ind'))
        # Match the preview's additional 3mm inside the paper's right margin.
        # Keep the original left/name alignment and 12pt contact text.
        contact_ind.attrib.pop(tag('rightChars'), None)
        contact_ind.set(tag('right'), '-170')
        # Do not let the original East Asian hint choose a wider punctuation font.
        contact_run_pr = contact_template.find('w:r/w:rPr', NS)
        if contact_run_pr is None:
            contact_run_pr = ET.Element(tag('rPr'))
            contact_template.find('w:r', NS).insert(0, contact_run_pr)
        contact_fonts = contact_run_pr.find('w:rFonts', NS)
        if contact_fonts is None:
            contact_fonts = ET.Element(tag('rFonts'))
            contact_run_pr.insert(0, contact_fonts)
        for script in ('ascii', 'hAnsi', 'cs'):
            contact_fonts.set(tag(script), 'Times New Roman')
        contact_fonts.set(tag('hint'), 'default')
        # A contact too wide for one line: the email in its own run at −0.4pt, as in the firm's lawyer list.
        condensed_contact = deepcopy(contact_template)
        email_run = deepcopy(condensed_contact.find('w:r', NS))
        email_pr = email_run.find('w:rPr', NS)
        for old in email_pr.findall('w:spacing', NS):
            email_pr.remove(old)
        later = [i for i, child in enumerate(email_pr) if child.tag in {tag(n) for n in RPR_AFTER_SPACING}]
        email_pr.insert(later[0] if later else len(email_pr), ET.Element(tag('spacing'), {tag('val'): '-8'}))
        email_run.find('w:t', NS).text = '{{email}}'
        condensed_contact.append(email_run)
        logo = clean(deepcopy(logo))
        # Retain the original signature image and its paragraph formatting.
        sec = deepcopy(root.find('.//w:sectPr', NS))
        opening = re.search(r'<w:document\b[^>]*>', raw.decode()).group(0)
        # Namespace declarations on the source root also cover retained drawings.
        shell = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + opening +
                 '<w:body>' + table_xml + serial(text_paragraph(greeting, '{{greeting}}')) +
                 serial(paras[1]) + '{{bodyParagraphs}}' + serial(paras[3]) +
                 '{{attachments}}' + serial(text_paragraph(paras[1], '')) +
                 # 2026 replies date the cover once (top right); the old date line above the agent is blank.
                 serial(text_paragraph(paras[1], '')) +
                 # ‘○○의 대리인’ (회신) or ‘○○ 대리인’ (2026 의견서): the engine writes the whole line.
                 serial(text_paragraph(agent, '{{agent}}')) +
                 serial(logo) + serial(text_paragraph(paras[1], '')) +
                 '{{lawyers}}{{ending}}</w:body></w:document>')
        # Cover and 첨부 body are separate sections, as in the lawyers' replies:
        # the body uses the continuation header and restarts page numbers.
        spacer = text_paragraph(paras[1], '')
        spacer.find('w:pPr', NS).append(deepcopy(sec))
        body_sec = deepcopy(sec)
        for child in list(body_sec):
            if child.tag == tag('titlePg') or (child.tag in (tag('headerReference'), tag('footerReference'))
                                               and child.get(tag('type')) == 'first'):
                body_sec.remove(child)
        styles = ET.fromstring(z.read('word/styles.xml'))
        style_ids = {s.find('w:name', NS).get(tag('val')): s.get(tag('styleId'))
                     for s in styles.findall('w:style', NS) if s.find('w:name', NS) is not None}
        h2, h3 = style_ids['heading 2'], style_ids['heading 3']
        flat = '<w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/></w:pPr>'
        run = lambda props, text: f'<w:r>{props}<w:t xml:space="preserve">{text}</w:t></w:r>'
        # 심사보고서 의견서 (2026 의견서 layout): 공문 표지 → 겉표지 → 목차 → 본문.
        # 겉표지: letterhead, no page number (the template's empty footer). 목차: i, ii … Body: 1, 2 …
        rels = ET.fromstring(z.read('word/_rels/document.xml.rels'))
        targets = {r.get('Id'): r.get('Target') for r in rels}

        def blank_part(target):
            part = ET.fromstring(z.read('word/' + target))
            return (not ''.join(t.text or '' for t in part.iter(tag('t'))).strip() and
                    part.find('.//' + tag('instrText')) is None and part.find('.//' + tag('fldSimple')) is None)
        empty_footer = next((i for i, t in targets.items() if re.fullmatch(r'footer\d+\.xml', t or '') and blank_part(t)), None)
        title_sec = deepcopy(sec)
        for ref in title_sec.findall('w:footerReference', NS):
            ref.set(f'{{{R}}}id', empty_footer or ref.get(f'{{{R}}}id'))
        toc_sec = deepcopy(body_sec)
        toc_sec.find('w:pgNumType', NS).set(tag('fmt'), 'lowerRoman')

        def break_with(section):
            p = text_paragraph(paras[1], '')
            p.find('w:pPr', NS).append(deepcopy(section))
            return serial(p)
        center = lambda line, rule, extra='': (f'<w:pPr><w:spacing {extra}w:line="{line}" w:lineRule="{rule}"/>'
                                               '<w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>')
        bold = lambda size, fonts='': f'<w:rPr>{fonts}<w:b/><w:bCs/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/></w:rPr>'
        gothic = '<w:rFonts w:ascii="맑은 고딕" w:eastAsia="맑은 고딕" w:hAnsi="맑은 고딕"/>'
        after120 = 'w:after="120" '
        sides = lambda kind: ''.join(f'<w:{side} w:val="{kind}" w:sz="4" w:space="0" w:color="auto"/>'
                                     for side in ('top', 'left', 'bottom', 'right'))
        box = lambda kind, height, content: (
            '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>'
            '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
            '</w:tblPr><w:tblGrid><w:gridCol w:w="9060"/></w:tblGrid><w:tr>' +
            (f'<w:trPr><w:trHeight w:val="{height}"/><w:jc w:val="center"/></w:trPr>' if height else '') +
            f'<w:tc><w:tcPr><w:tcW w:w="9060" w:type="dxa"/><w:tcBorders>{sides(kind)}</w:tcBorders>'
            f'<w:vAlign w:val="center"/></w:tcPr>{content}</w:tc></w:tr></w:tbl>')
        spacer_line = f'<w:p>{center(460, "atLeast")}</w:p>'
        opinion, extra_parts = {}, {}
        h1, toc1, toc2 = style_ids.get('heading 1'), style_ids.get('toc 1'), style_ids.get('toc 2')
        if h1 and toc1 and toc2 and empty_footer:
            # 목차 pages are ‘i / ii’: a copy of the page-number footer whose fields are formatted ‘\* roman’, as in the 의견서 sample.
            toc_footer = next(r for r in toc_sec.findall('w:footerReference', NS) if r.get(tag('type')) == 'default')
            roman = ET.fromstring(z.read('word/' + targets[toc_footer.get(f'{{{R}}}id')]))
            for instr in roman.iter(tag('instrText')):
                instr.text = re.sub(r'^\s*(PAGE|SECTIONPAGES)\s*$', r' \1 \\* roman ', instr.text or '')
            for t in roman.iter(tag('t')):
                if (t.text or '').strip().isdigit():
                    t.text = 'i'
            assert sum(' \\* roman ' in (i.text or '') for i in roman.iter(tag('instrText'))) == 2, 'page-number footer fields not found'
            extra_parts['word/footerToc.xml'] = serial(roman).encode()
            toc_footer.set(f'{{{R}}}id', 'rIdTocFooter')
            # 첨부 line of the 의견서 공문: hanging after ‘첨부: ’ and 0.5pt condensed, as the 2026 의견서 samples.
            opinion_attachment = text_paragraph(attachment, '{{text}}')
            ind = opinion_attachment.find('w:pPr/w:ind', NS)
            ind.attrib.clear()
            ind.attrib.update({tag('left'): '610', tag('hangingChars'): '311', tag('hanging'): '610'})
            tabs = opinion_attachment.find('w:pPr/w:tabs', NS)
            if tabs is not None:
                opinion_attachment.find('w:pPr', NS).remove(tabs)
            run_pr = opinion_attachment.find('w:r/w:rPr', NS)
            szcs = run_pr.find('w:szCs', NS)
            run_pr.insert(list(run_pr).index(szcs) if szcs is not None else len(run_pr), ET.Element(tag('spacing'), {tag('val'): '-10'}))
            toc_entry = lambda style: (f'<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr>' + run('', '{{number}}') +
                                       '<w:r><w:tab/></w:r>' + run('', '{{text}}') + '</w:p>')
            opinion = {
                'opinionAttachment': serial(opinion_attachment),
                'opinionCover': (spacer_line * 5 + box('double', 2692,
                    f'<w:p>{center(600, "exact", after120)}' + run(bold(48), '심사보고서에 대한 의견서') + '</w:p>' +
                    f'<w:p>{center(520, "exact")}' + run(bold(32), '- {{caseName}} -') + '</w:p>' +
                    f'<w:p>{center(600, "exact")}' + run(bold(28), '{{caseNo}}') + '</w:p>') + spacer_line * 11 +
                    f'<w:p>{center(520, "exact")}' + run(bold(28), '{{party}}') + '</w:p>' +
                    f'<w:p>{center(520, "exact")}' + run(bold(28), '대리인 ' + FIRM['name'].replace('&', '&amp;').replace('<', '&lt;')) + '</w:p>'),
                'opinionCoverBreak': break_with(title_sec),
                'tocTitle': (f'<w:p>{flat}</w:p><w:p><w:pPr><w:spacing w:after="235" w:line="240" w:lineRule="auto"/>'
                             '<w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
                             run(bold(32, gothic), '목  차') + '</w:p>'),
                # A Word table of contents (levels 1-4, as in the lawyers' 의견서), marked for updating when opened.
                'tocBegin': (f'<w:p><w:pPr><w:pStyle w:val="{toc1}"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
                             '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-4" \\h \\z \\u </w:instrText></w:r>'
                             '<w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>'),
                'tocEntry1': toc_entry(toc1),
                'tocEntry2': toc_entry(toc2),
                'tocEnd': '<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
                'tocBreak': break_with(toc_sec),
                'opinionTitle': ('<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
                                 run(f'<w:rPr>{gothic}<w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="40"/><w:u w:val="single"/></w:rPr>', '{{text}}') + '</w:p>'),
                'opinionHeading1': f'<w:p><w:pPr><w:pStyle w:val="{h1}"/><w:jc w:val="both"/></w:pPr>' + run('', '{{text}}') + '</w:p>',
                'confidentialBox': box('single', 0, '<w:p><w:pPr><w:spacing w:line="480" w:lineRule="exact"/>'
                                       '<w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="both"/></w:pPr>' +
                                       run(bold(22, gothic), '{{text}}') + '</w:p>'),
            }
        note = lambda left: (f'<w:p><w:pPr><w:ind w:left="{left}" w:firstLineChars="0" w:firstLine="0"/></w:pPr>' +
                             run('<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>', '{{text}}') + '</w:p>')
        templates = {
            'document': shell,
            'refRow': ref_row,
            'bodyParagraph': serial(text_paragraph(main, '{{text}}')),
            'attachment': serial(text_paragraph(attachment, '{{text}}')),
            'attachmentFirst': serial(attachment_first),
            'attachmentContinuation': serial(attachment_continuation),
            'lawyerName': serial(signature_paragraph(lawyer, '{{text}}')),
            'lawyerContact': serial(contact_template),
            'lawyerContactCondensed': serial(condensed_contact),
            'lawyerSpacer': serial(text_paragraph(paras[1], '')),
            'coverSectPr': serial(deepcopy(sec)),
            'sectionBreak': serial(spacer),
            'bodySectPr': serial(body_sec),
            'bodyMarker': f'<w:p>{flat}' + run('', '&lt;첨부&gt;') + '</w:p>',
            'bodyTitle': ('<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
                          run('<w:rPr><w:b/><w:bCs/><w:sz w:val="36"/><w:szCs w:val="40"/><w:u w:val="single"/></w:rPr>', '{{text}}') + '</w:p>'),
            'blank': f'<w:p>{flat}</w:p>',
            # The heading styles have no alignment of their own (left); the request text is justified.
            'heading1': f'<w:p><w:pPr><w:pStyle w:val="{h2}"/><w:jc w:val="both"/></w:pPr>' + run('', '{{text}}') + '</w:p>',
            'heading2': f'<w:p><w:pPr><w:pStyle w:val="{h3}"/><w:jc w:val="both"/></w:pPr>' + run('', '{{text}}') + '</w:p>',
            'note1': note(425),
            'note2': note(964),
            'answer': '<w:p/>',
            # A manual page break (Ctrl+Enter), so the 첨부서류 list starts on its own page.
            'pageBreak': f'<w:p>{flat}<w:r><w:br w:type="page"/></w:r></w:p>',
            'firmRefRun': serial(firm_run),
            'firmRefMark': serial(firm_mark),
            'refHeading': ('<w:p><w:pPr><w:ind w:firstLineChars="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
                           run('<w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>', '첨  부  서  류') + '</w:p>'),
            'refMaterialRow': ('<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="3686"/></w:tabs>'
                       '<w:ind w:left="216" w:firstLineChars="0" w:firstLine="0"/></w:pPr>' +
                       run('', '{{lead}}') + '<w:r><w:tab/></w:r>' + run('', '{{text}}') + '</w:p>'),
        }
        templates.update(opinion)
        assert '{{refDept}}' in templates['refRow'], 'cover reference row slot missing'
        kept = {}
        for name in z.namelist():
            if name.startswith('word/') and name != 'word/document.xml' and not name.endswith('/'):
                if name in ('word/settings.xml', 'word/webSettings.xml'):
                    continue
                if name.endswith('.rels'):
                    rel = ET.fromstring(z.read(name))
                    for item in list(rel):
                        if item.get('TargetMode') == 'External' or item.get('Type', '').endswith(('/customXml', '/webSettings')):
                            rel.remove(item)
                    if name == 'word/_rels/document.xml.rels' and extra_parts:
                        ET.SubElement(rel, f'{{{PR}}}Relationship', {'Id': 'rIdTocFooter', 'Type': f'{R}/footer', 'Target': 'footerToc.xml'})
                    data = ET.tostring(rel, encoding='utf-8', xml_declaration=True)
                elif name.startswith('word/footer') and name.endswith('.xml'):
                    f = ET.fromstring(z.read(name))
                    # These are field caches, not fixed page numbers; Word updates them.
                    for t in f.findall('.//w:t', NS):
                        if (t.text or '').strip().isdigit():
                            t.text = '1'
                    data = serial(f).encode()
                elif name.startswith('word/header') and name.endswith('.xml'):
                    # The reference contains a lone accidental backtick in its running header.
                    hraw = z.read(name).decode()
                    hraw = re.sub(r'<w:t(?:\s[^>]*)?>`</w:t>', '<w:t></w:t>', hraw)
                    data = hraw.encode()
                elif name == 'word/numbering.xml':
                    # num 1: cover paragraphs (1. 2.); num 2: heading styles (1. / 가.) of the 첨부 body.
                    n = ET.fromstring(z.read(name))
                    nums = [x for x in n.findall('w:num', NS) if x.get(tag('numId')) in ('1', '2')]
                    aids = [x.find('w:abstractNumId', NS).get(tag('val')) for x in nums]
                    abstracts = [x for x in n.findall('w:abstractNum', NS) if x.get(tag('abstractNumId')) in aids]
                    assert len(nums) == 2 and len(abstracts) == 2, 'expected numbering 1 and 2 in the template'
                    nr = ET.Element(tag('numbering'))
                    nr.extend(abstracts + nums)
                    data = serial(nr).encode()
                else:
                    data = z.read(name)
                kept[name] = base64.b64encode(data).decode()
        # The template's own settings, without editing history, document identity, attached templates or custom data.
        # Its compatibility options must stay: without balanceSingleByteDoubleByteWidth and useFELayout Word sets a space
        # next to Korean 3pt instead of 6pt wide, so 담당변호사 names and body lines come out narrower than the firm's 양식.
        settings = z.read('word/settings.xml').decode()
        for pattern in (r'<w:rsids>.*?</w:rsids>', r'<w:attachedTemplate\b[^>]*/>', r'<w:docVars>.*?</w:docVars>',
                        r'<w:mailMerge>.*?</w:mailMerge>', r'<w:documentProtection\b[^>]*/>', r'<w:writeProtection\b[^>]*/>',
                        r'<w:proofState\b[^>]*/>', r'<w14:docId\b[^>]*/>', r'<w15:docId\b[^>]*/>'):
            settings = re.sub(pattern, '', settings, flags=re.S)
        # The 의견서 목차 is a field: Word offers to update it when the file opens (CT_Settings order: before hdrShapeDefaults).
        settings, n = re.subn(r'(?=<w:(?:hdrShapeDefaults|footnotePr|endnotePr|compat)\b)', '<w:updateFields w:val="true"/>', settings, count=1)
        assert n == 1 and '<w:balanceSingleByteDoubleByteWidth/>' in settings and '<w:themeFontLang ' in settings, 'template settings changed'
        kept['word/settings.xml'] = base64.b64encode(settings.encode()).decode()
        relroot = (f'<Relationships xmlns="{PR}"><Relationship Id="rId1" '
                   f'Type="{R}/officeDocument" Target="word/document.xml"/>'
                   f'<Relationship Id="rId2" Type="{PR}/metadata/core-properties" '
                   'Target="docProps/core.xml"/></Relationships>')
        kept['_rels/.rels'] = base64.b64encode(relroot.encode()).decode()
        for name, data in extra_parts.items():
            kept[name] = base64.b64encode(data).decode()
        types = ET.fromstring(z.read('[Content_Types].xml'))
        included = set(kept) | {'word/document.xml', 'docProps/core.xml'}
        for t in list(types):
            if 'PartName' in t.attrib and t.get('PartName').lstrip('/') not in included:
                types.remove(t)
        CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
        for name in extra_parts:
            ET.SubElement(types, f'{{{CT}}}Override', {'PartName': '/' + name,
                          'ContentType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'})
        kept['[Content_Types].xml'] = base64.b64encode(ET.tostring(types, encoding='utf-8', xml_declaration=True)).decode()
        return {'snippets': templates, 'parts': kept}, {
            'header': 'data:image/jpeg;base64,' + base64.b64encode(z.read('word/media/image3.jpeg')).decode(),
            'continuation': 'data:image/jpeg;base64,' + base64.b64encode(z.read('word/media/image2.jpg')).decode(),
            'signature': 'data:image/jpeg;base64,' + base64.b64encode(z.read('word/media/image1.jpg')).decode(),
        }


KOREAN_CMAP = re.compile(r'^(?:Adobe-Korea1-(?:0|1|2|UCS2)|KSC-(?:H|EUC-H|Johab-H)|KSCms-UHC-(?:H|HW-H)|KSCpc-EUC-H|UniKS-(?:UCS2|UTF16|UTF32|UTF8)-H)\.bcmap$')


def inline_script(path):
    code = path.read_text(encoding='utf-8')
    assert '</script' not in code.lower() and '<!--' not in code, f'unsafe inline script: {path.name}'
    return code


def pdf_scripts():
    cmaps = {}
    cmap_dir = PDFJS / 'cmaps'
    for p in sorted(cmap_dir.glob('*.bcmap')):
        if KOREAN_CMAP.match(p.name):
            cmaps[p.stem] = base64.b64encode(p.read_bytes()).decode()
    assert len(cmaps) >= 10, 'Korean CMaps missing from the vendored pdf.js'
    factory = ('(function(){const data=' + json.dumps(cmaps) + ';'
               'class EmbeddedCMapReaderFactory{constructor(){}async fetch({name}){const b=data[name];'
               'if(!b)throw new Error("CMap not embedded: "+name);'
               'return{cMapData:Uint8Array.from(atob(b),c=>c.charCodeAt(0)),compressionType:1};}}'
               'window.GongmunPdfCMaps={CMapReaderFactory:EmbeddedCMapReaderFactory,cMapUrl:"embedded/",cMapPacked:true,useWorkerFetch:false};})();')
    return inline_script(PDFJS / 'pdf.min.js'), inline_script(PDFJS / 'pdf.worker.min.js'), factory


def main():
    reply, assets = build_template(TEMPLATE_DIR / 'reply.docx')
    assert 'opinionCover' in reply['snippets'], '심사보고서 의견서 양식(heading 1·toc 1·toc 2 스타일)이 표지 양식에 없습니다'
    additional, _ = build_template(TEMPLATE_DIR / 'additional.docx')
    payload = {'templates': {'reply': reply, 'additional': additional}, 'assets': assets}
    data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    src = ROOT / 'src'
    esc = lambda v: v.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    html = (src / 'index.html').read_text().replace('__FIRM_NAME__', esc(FIRM['name'])).replace('__FIRM_MARK__', esc(FIRM['brandMark']))
    html = html.replace('/* APP_STYLES */', (src / 'styles.css').read_text())
    pdf_lib, pdf_worker, cmap_factory = pdf_scripts()
    # Separate script elements: a library error cannot stop the document writer itself.
    html = html.replace('/* PDFJS_LIB */', pdf_lib).replace('/* PDFJS_WORKER */', pdf_worker).replace('/* PDFJS_CMAPS */', cmap_factory)
    firm = json.dumps(FIRM, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    scripts = ('window.GONGMUN_FIRM=' + firm + ';\nwindow.GONGMUN_TEMPLATES=' + data + ';\n' +
               '\n'.join(inline_script(src / name) for name in ('engine.js', 'readers.js', 'analyze.js', 'word-import.js', 'app.js')))
    html = html.replace('/* APP_SCRIPTS */', scripts)
    output = OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html)
    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'template-data.json').write_text(data)
    for key, uri in assets.items():
        (build / f'{key}.jpg').write_bytes(base64.b64decode(uri.split(',')[1]))
    print(f'Built {output.relative_to(ROOT)}: {output.stat().st_size:,} bytes; network dependencies: 0')


if __name__ == '__main__':
    main()
