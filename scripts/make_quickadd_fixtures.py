"""Write site/tests/quickadd_roundtrip.json: real records formatted as AVSA-style lines (the parser's expected output
is the record's own fields). Used by site/tests/quickadd-test.html.
    .venv/Scripts/python scripts/make_quickadd_fixtures.py"""
import csv
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
rows = list(csv.DictReader(open(ROOT / "data" / "cultivars.csv", encoding="utf-8-sig")))
cands = []
for r in rows:
    if not (r["registration_no"] and r["registered_date"] and r["hybridizer_raw"] and r["size_class"]
            and r["bloom_description"] and r["foliage_description"]):
        continue
    if any(c in r["name"] + r["hybridizer_raw"] for c in "()/;&") or "." in r["name"]:
        continue
    cands.append(r)
random.Random(7).shuffle(cands)
out = []
for r in cands[:150]:
    y, m, d = r["registered_date"].split("-")
    desc = f"{r['bloom_description'].strip()} {r['foliage_description'].strip()}".strip()
    line = f"{r['name']} ({r['registration_no']}) {int(m):02d}/{int(d):02d}/{y} ({r['hybridizer_raw']}) {desc} {r['size_class']}"
    out.append({"line": line, "name": r["name"], "reg": r["registration_no"], "date": r["registered_date"],
                "hyb_raw": r["hybridizer_raw"], "size": r["size_class"], "desc": desc})
path = ROOT / "site" / "tests" / "quickadd_roundtrip.json"
path.write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"wrote {path} ({len(out)} cases)")
