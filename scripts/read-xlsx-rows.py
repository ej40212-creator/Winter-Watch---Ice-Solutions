#!/usr/bin/env python3
"""Read a lineage workbook into contract rows. Prints JSON only. Does not log addresses."""
import json
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REQUIRED = {
    "store #": "id",
    "store address": "address",
    "state": "state",
    "classification": "classification",
}


def cell_value(cell, strings):
    kind = cell.attrib.get("t")
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//m:t", NS))
    node = cell.find("m:v", NS)
    if node is None or node.text is None:
        return ""
    if kind == "s":
        return strings[int(node.text)]
    return node.text


def canonical_id(raw):
    text = str(raw).strip()
    if re.fullmatch(r"\d+\.0", text):
        return str(int(float(text)))
    return text


def main():
    path = sys.argv[1]
    with zipfile.ZipFile(path) as workbook:
        strings = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", NS):
                strings.append("".join(node.text or "" for node in item.findall(".//m:t", NS)))
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
    rows = list(sheet.findall("m:sheetData/m:row", NS))
    if not rows:
        print("Workbook has no rows.", file=sys.stderr)
        sys.exit(2)
    header_cells = {}
    for cell in rows[0].findall("m:c", NS):
        column = re.match(r"[A-Z]+", cell.attrib["r"]).group(0)
        header_cells[column] = cell_value(cell, strings).strip().lower()
    fields = {}
    for column, label in header_cells.items():
        if label in REQUIRED:
            fields[REQUIRED[label]] = column
    missing = [name for name in REQUIRED.values() if name not in fields]
    if missing:
        print("Workbook header is missing: " + ", ".join(missing), file=sys.stderr)
        sys.exit(2)
    output = []
    for row in rows[1:]:
        excel_row = int(row.attrib["r"])
        values = {}
        for cell in row.findall("m:c", NS):
            column = re.match(r"[A-Z]+", cell.attrib["r"]).group(0)
            values[column] = cell_value(cell, strings)
        if not any(str(values.get(column, "")).strip() for column in fields.values()):
            continue
        state = str(values.get(fields["state"], "")).strip()
        source_id = canonical_id(values.get(fields["id"], ""))
        output.append({
            "key": f"sheet1-r{excel_row}",
            "id": source_id,
            "region": state,
            "address": str(values.get(fields["address"], "")),
            "state": state,
            "classification": str(values.get(fields["classification"], "")),
        })
    json.dump(output, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
