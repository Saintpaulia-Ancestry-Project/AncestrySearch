"""Write human-review files to reports/review/ (read-only on source/).

  sqlite_duplicates.csv   - duplicate cultivar names in the SQLite, side by side;
                            fill in the `decision` column.
  hybridizer_mapping.csv  - proposed mapping of every hybridizer string (xlsx and
                            SQLite) to a canonical person; edit `proposed_person`
                            or `action` where wrong.
Usage: .venv\\Scripts\\python scripts\\propose_review.py
"""
import collections
import re
import sqlite3
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "source" / "AfricanVioletAncestry.xlsx"
SQLITE = ROOT / "source" / "AfricanVioletAncestry.sqlite"
OUT = ROOT / "reports" / "review"
OUT.mkdir(parents=True, exist_ok=True)


def clean(s):
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


con = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
v = pd.read_sql("select * from Varieties", con)
con.close()
x = pd.read_excel(XLSX, sheet_name="Name", usecols=range(6), dtype=object, keep_default_na=False)

# ------------------------------------------------------------ duplicates
v["_k"] = v["Name"].map(lambda s: norm(s) if isinstance(s, str) else None)
d = v[v["_k"].notna() & v["_k"].duplicated(keep=False)].sort_values(["_k", "NameID"])
fields = ["NameID", "Name", "Sport Parent", "Hybridiser", "Variety", "Colour", "Bloom", "Foliage",
          "AVSA Registration", "Date registered"]
d = d[fields].copy()
d.insert(0, "group", d["Name"].map(norm).factorize()[0] + 1)
d["decision"] = ""
d["notes"] = ""
d.to_csv(OUT / "sqlite_duplicates.csv", index=False, encoding="utf-8-sig")
print("sqlite_duplicates.csv:", len(d), "rows in", d["group"].nunique(), "groups")

# ------------------------------------------------------------ hybridizers
xl_counts = collections.Counter(clean(h) for h in x["Hybridizer"] if clean(h))
sq_counts = collections.Counter(clean(h) for h in v["Hybridiser"].dropna() if clean(h))


def split_people(s):
    s = s.strip().rstrip(",").strip()
    # "A, B / C, D" and "A/B" co-hybridizers; keep 'Surname, Given' commas intact
    parts = re.split(r"\s*/\s*", s)
    return [p.strip().rstrip(",") for p in parts if p.strip().rstrip(",")]


def key(p):
    m = re.match(r"^([^,]+),\s*([A-Za-z])", p)
    return (norm(m.group(1)), m.group(2).lower()) if m else (norm(p), "")


# canonical people = xlsx single-person strings (fuller names), then SQLite-only
canon = {}
for h in xl_counts:
    for p in split_people(h):
        canon.setdefault(key(p), set()).add(p)
canon_pick = {k: max(vs, key=lambda p: (len(p), xl_counts.get(p, 0))) for k, vs in canon.items()}
# surname-only xlsx forms (e.g. "Rienhardt") match any initial for that surname
by_surname = collections.defaultdict(set)
for (sn, _), p in canon_pick.items():
    by_surname[sn].add(p)

rows = []
for src, counts in (("xlsx", xl_counts), ("sqlite", sq_counts)):
    for h, n in sorted(counts.items()):
        people = split_people(h)
        proposed, notes, status = [], [], []
        for p in people:
            k = key(p)
            if k in canon_pick:
                proposed.append(canon_pick[k])
                status.append("map" if canon_pick[k] != p else "same")
                if len(canon[k]) > 1:
                    notes.append("variants: " + " | ".join(sorted(canon[k])))
            else:
                # initial missing/different but surname unique -> suggest, flag
                cands = [c for sn_, c in ((s, c) for s in [k[0]] for c in by_surname.get(s, []))]
                if len(cands) == 1 and not k[1]:
                    proposed.append(cands[0]); status.append("review")
                    notes.append("surname-only; assumed " + cands[0])
                elif cands:
                    proposed.append(p); status.append("review")
                    notes.append("same surname, other first name: " + " | ".join(sorted(cands)))
                else:
                    proposed.append(p); status.append("new")
        if len(people) > 1:
            notes.append(f"co-hybridizers x{len(people)}")
        # merge same-surname-different-initial variants of one person is a human call
        action = "review" if "review" in status else ("map" if "map" in status else
                  ("new" if "new" in status else "keep"))
        if re.search(r"nurser|univers|college|society|species", h, re.I):
            action = "review"; notes.append("organization or non-person?")
        rows.append({"source": src, "source_value": h, "uses": n, "proposed_person(s)": " ; ".join(proposed),
                     "action": action, "notes": "; ".join(dict.fromkeys(notes)), "decision": ""})

m = pd.DataFrame(rows)
m.to_csv(OUT / "hybridizer_mapping.csv", index=False, encoding="utf-8-sig")
print("hybridizer_mapping.csv:", len(m), "rows")
print(m.groupby(["source", "action"]).size().to_string())
