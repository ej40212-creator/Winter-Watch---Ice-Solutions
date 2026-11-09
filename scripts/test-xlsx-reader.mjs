import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ww-xlsx-'));
const built = spawnSync('python3', ['-c', `
import zipfile, pathlib
root = pathlib.Path(${JSON.stringify(dir)})
content_types = '''<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'''
rels = '''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'''
wb_rels = '''<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'''
wb = '''<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'''
sheet = '''<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="C1" t="inlineStr"><is><t>State</t></is></c><c r="B1" t="inlineStr"><is><t>Store Address</t></is></c><c r="D1" t="inlineStr"><is><t>Classification</t></is></c><c r="A1" t="inlineStr"><is><t>Store #</t></is></c></row>
<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>1 Synthetic Lane, Fictional City, CO 80014</t></is></c><c r="C2" t="inlineStr"><is><t>CO</t></is></c><c r="D2" t="inlineStr"><is><t>Event</t></is></c></row>
</sheetData></worksheet>'''
with zipfile.ZipFile(root / 'sample.xlsx', 'w') as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('xl/workbook.xml', wb)
    z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
    z.writestr('xl/worksheets/sheet1.xml', sheet)
print(root / 'sample.xlsx')
`], { encoding: 'utf8' });
if (built.status !== 0) throw new Error(built.stderr || built.stdout);
const xlsx = built.stdout.trim();
const read = spawnSync('python3', ['scripts/read-xlsx-rows.py', xlsx], { encoding: 'utf8' });
assert.equal(read.status, 0, read.stderr);
const rows = JSON.parse(read.stdout);
assert.equal(rows.length, 1);
assert.equal(rows[0].id, '42');
assert.equal(rows[0].state, 'CO');
assert.equal(rows[0].classification, 'Event');
assert.match(rows[0].address, /Synthetic Lane/);
console.log('Passed: xlsx reader uses header names and inline strings.');
