"""Convert the Contempra tab of a Workorder Books .xlsx export into the JSON shape the
Google Sheets API returns (valueRenderOption=UNFORMATTED_VALUE, dateTimeRenderOption=SERIAL_NUMBER).

Usage: python -I scripts/xlsx_to_values.py "<path to xlsx>" fixtures/local/contempra-values.json
"""

import datetime
import json
import os
import sys
import warnings

import openpyxl

COLUMNS = 16  # A..P
EPOCH = datetime.datetime(1899, 12, 30)


def to_cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return v
    if isinstance(v, datetime.datetime):
        return (v - EPOCH).total_seconds() / 86400
    if isinstance(v, datetime.date):
        return (datetime.datetime(v.year, v.month, v.day) - EPOCH).days
    if isinstance(v, datetime.time):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def main(src, dest):
    warnings.simplefilter("ignore")
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    ws = wb["Contempra"]
    values = []
    for row in ws.iter_rows(min_row=1, max_col=COLUMNS, values_only=True):
        cells = [to_cell(v) for v in row]
        while cells and cells[-1] == "":
            cells.pop()
        values.append(cells)
    while values and not values[-1]:
        values.pop()
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({"values": values}, f)
    print(f"wrote {len(values) - 1} rows to {dest}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
