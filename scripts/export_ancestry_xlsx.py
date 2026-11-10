"""Export the ancestry data to an Excel workbook for download.

Reads site/avancestry.sqlite (run build_db.py first) and writes
site/downloads/AfricanVioletAncestry.xlsx with three sheets:
  Ancestry  one row per cultivar with at least one recorded seed/pollen/unordered parent
  Sports    one row per cultivar that is a sport of another
  About     date, row counts, column legend, license (CC BY 4.0)
Needs openpyxl (see requirements.txt).
"""
import argparse
import re
import sqlite3
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
ILLEGAL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
HEAD_FILL = PatternFill("solid", fgColor="DDE8D5")

ANCESTRY_COLS = ["ID", "Name", "Kind", "Seed Parent", "Pollen Parent", "Other Parent(s)",
                 "Hybridizer", "Registered Year", "Registration No.", "Notes"]
SPORT_COLS = ["ID", "Name", "Kind", "Sport Of", "Sport Of ID",
              "Hybridizer", "Registered Year", "Registration No.", "Notes"]

LEGEND = [
    ("ID", "Stable identifier of the cultivar in the database (use it to match records)."),
    ("Name", "Cultivar name as normalized by the project."),
    ("Kind", "cultivar, stub (a parent known only by name), seedling, species or unknown."),
    ("Seed Parent / Pollen Parent", "Parent names. Several parents in one cell are separated by ' ; '. "
     "'(unsure)' or '(assumed)' follows a parent whose role or identity is uncertain."),
    ("Other Parent(s)", "Parents recorded without a seed/pollen role."),
    ("Sport Of", "The cultivar this one is a sport of (Sports sheet)."),
    ("Hybridizer", "Hybridizer(s), 'Surname, Given'. Organizations count as hybridizers too."),
    ("Registered Year / Registration No.", "AVSA registration data, where known."),
]


def clean(v):
    if isinstance(v, str):
        v = ILLEGAL.sub("", v).strip()
        return v or None
    return v


def put(ws, rows, cols):
    ws.append(cols)
    for r in rows:
        ws.append([clean(v) for v in r])
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = HEAD_FILL
        c.alignment = Alignment(vertical="top", wrap_text=True)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            # A name or note starting with = + - @ must stay text, never become a formula.
            if isinstance(c.value, str) and c.value[:1] in "=+-@":
                c.data_type = "s"
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions
    for i, col in enumerate(cols, 1):
        longest = max((len(str(c.value)) for c in ws[get_column_letter(i)][:500] if c.value), default=8)
        ws.column_dimensions[get_column_letter(i)].width = min(max(longest + 2, 10), 45 if col != "Notes" else 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "site" / "avancestry.sqlite"))
    ap.add_argument("--out", default=str(ROOT / "site" / "downloads" / "AfricanVioletAncestry.xlsx"))
    a = ap.parse_args()
    con = sqlite3.connect(a.db)

    # parents grouped per child and role, in a stable order
    par = {}
    for child, role, name, cert in con.execute(
            """SELECT p.child_id, p.role, c.name, p.certainty
               FROM parentage p JOIN cultivars c ON c.id = p.parent_id
               ORDER BY p.child_id, p.role, c.name"""):
        par.setdefault((child, role), []).append(name if cert == "known" else f"{name} ({cert})")

    meta = dict(con.execute("SELECT key, value FROM meta"))
    base = """SELECT c.id, c.name, c.kind, {extra} coalesce(h.hybridizers, c.hybridizer_raw),
                     c.registered_year, c.registration_no, c.notes
              FROM cultivars c LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id
              {join} WHERE {where} ORDER BY c.name COLLATE NOCASE, c.id"""

    anc = []
    for r in con.execute(base.format(extra="", join="",
            where="c.id IN (SELECT child_id FROM parentage)")):
        cid = r[0]
        j = lambda role: " ; ".join(par.get((cid, role), [])) or None
        anc.append((*r[:3], j("seed"), j("pollen"), j("unordered"), *r[3:]))

    sports = list(con.execute(base.format(
        extra="s.name, s.id,", join="JOIN cultivars s ON s.id = c.sport_of_id",
        where="c.sport_of_id IS NOT NULL")))

    wb = Workbook()
    ws = wb.active
    ws.title = "Ancestry"
    put(ws, anc, ANCESTRY_COLS)
    put(wb.create_sheet("Sports"), sports, SPORT_COLS)

    ab = wb.create_sheet("About")
    lines = [
        ("Saintpaulia Ancestry: ancestry data export", None),
        ("Exported", meta.get("built_at", "")[:10]),
        ("Database built", meta.get("built_at", "")),
        ("Ancestry sheet", f"{len(anc)} cultivars with at least one recorded parent"),
        ("Sports sheet", f"{len(sports)} sports"),
        ("License", "This data is exported under the Creative Commons Attribution 4.0 International "
                    "license (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/"),
        ("Credit", "Saintpaulia Ancestry Project, https://github.com/Saintpaulia-Ancestry-Project"),
        (None, None),
        ("Column", "Meaning"),
        *LEGEND,
    ]
    for l in lines:
        ab.append(list(l))
    ab["A1"].font = Font(bold=True, size=14)
    for r in (9,):
        for c in ab[r]:
            c.font = Font(bold=True)
    ab.column_dimensions["A"].width = 32
    ab.column_dimensions["B"].width = 110
    for row in ab.iter_rows():
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    print(f"Wrote {out}  (Ancestry {len(anc)} rows, Sports {len(sports)} rows)")


if __name__ == "__main__":
    sys.exit(main())
