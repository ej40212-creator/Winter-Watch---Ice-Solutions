#!/usr/bin/env python3
"""Read the lineage workbook into contract rows. Prints JSON only. Does not log addresses."""
import json
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def cell_value(cell, strings):
    kind = cell.attrib.get("t")
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
    rows = []
    for row in sheet.findall("m:sheetData/m:row", NS):
        excel_row = int(row.attrib["r"])
        values = {}
        for cell in row.findall("m:c", NS):
            column = re.match(r"[A-Z]+", cell.attrib["r"]).group(0)
            values[column] = cell_value(cell, strings)
        if excel_row == 1:
            continue
        if not any(str(values.get(column, "")).strip() for column in "ABCDE"):
            continue
        source_id = canonical_id(values.get("A", ""))
        state = str(values.get("C", "")).strip()
        rows.append({
            "key": f"sheet1-r{excel_row}",
            "id": source_id,
            "region": state,
            "address": str(values.get("B", "")),
            "state": state,
            "classification": str(values.get("D", "")),
        })
    json.dump(rows, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
