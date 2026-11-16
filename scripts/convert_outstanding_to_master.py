"""ONE-TIME (phase 2, step 3): give every row of reports/outstanding_checks.csv the id of its record in the master data.

Needs a key map made by one last run of import_excel.py (AV_KEYMAP=file env var instrumentation, see notes/freeze-plan.md):
    kind,key,id    kind `rec` = the importer's internal record key, `plant` = an MVL plant key
New columns: `record_id` (master id of the cultivar the row is about; empty for a held plant that is not in the master yet) and
`plant_key` (the frozen MVL plant, for held plants and plants already imported). `target_key` becomes the OTHER record's master id
where there is one (same-name matches, 1963 book matches).
    python scripts/convert_outstanding_to_master.py KEYMAP.csv
"""
import csv
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from names_lib import norm  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NEW_COLS = ["check_id", "group_id", "source", "check_type", "tier", "name", "hybridizer", "lists_or_year", "record_id", "plant_key",
            "reg_no", "reg_date", "mlv_name", "mlv_hybridizer", "mlv_reg", "mlv_date", "description", "detail", "proposal",
            "target_key", "first_class_name", "first_class_hybridizer", "first_class_reg_date", "decision", "note"]


def main():
    km = pd.read_csv(sys.argv[1], dtype=str, keep_default_na=False)
    rec = dict(zip(km[km.kind == "rec"].key, km[km.kind == "rec"].id))
    plant = dict(zip(km[km.kind == "plant"].key, km[km.kind == "plant"].id))
    master = pd.read_csv(ROOT / "data" / "cultivars.csv", dtype=str, keep_default_na=False)
    ids = set(master.id)
    by_name = {}
    for _, r in master.iterrows():
        by_name.setdefault(norm(r["name"]), []).append(r)
    c = pd.read_csv(ROOT / "reports" / "outstanding_checks.csv", dtype=str, keep_default_na=False, encoding="utf-8-sig")
    out, unresolved = [], []
    for _, r in c.iterrows():
        r = dict(r)
        r["record_id"] = r["plant_key"] = ""
        t, src, tk = r["check_type"], r["source"], r["target_key"]
        if t == "same name, hybridizer differs or unknown":
            r["plant_key"] = r["group_id"]
            r["record_id"] = plant.get(r["group_id"], "")
            r["target_key"] = rec.get(tk, "")
        elif t in ("spelling near-miss of an MLV name", "same name as another plant, no hybridizer", "description split needs review"):
            r["plant_key"] = tk
            r["record_id"] = plant.get(tk, "")            # held plants are not in the master: empty
            r["target_key"] = ""
        elif t == "registration number shared by several plants":
            r["plant_key"] = tk
            r["record_id"] = plant.get(tk, "")
            r["target_key"] = ""
        elif t == "source row disagrees with record":
            r["record_id"] = tk if tk in ids else ""
            r["target_key"] = ""
        elif t == "possible duplicate or misspelled name":
            pass                                         # resolved by name when decided
        elif src == "1963 book":
            cand = [x for x in by_name.get(norm(r["name"]), []) if x["sources"] == "masterlist1963"]
            if len(cand) > 1 and r["hybridizer"]:
                cand = [x for x in cand if norm(x["hybridizer_raw"]) == norm(r["hybridizer"])] or cand
            r["record_id"] = cand[0]["id"] if len(cand) == 1 else ""
            if t == "book entry vs existing record":
                m = re.match(r"existing record: (.*?) \| (.*?) \| ", r["detail"])
                if m:
                    ex = [x for x in by_name.get(norm(m.group(1)), []) if x["sources"] != "masterlist1963" or True]
                    ex = [x for x in ex if x["id"] != r["record_id"] and (not m.group(2) or norm(x["hybridizer_raw"]) == norm(m.group(2)))]
                    r["target_key"] = ex[0]["id"] if len(ex) == 1 else ""
            else:
                r["target_key"] = ""
        if t in ("same name, hybridizer differs or unknown",) and (not r["record_id"] or not r["target_key"]):
            unresolved.append((r["check_id"], t, r["name"]))
        out.append(r)
    pd.DataFrame(out, columns=NEW_COLS).to_csv(ROOT / "reports" / "outstanding_checks.csv", index=False, encoding="utf-8-sig")
    df = pd.DataFrame(out)
    print(len(df), "rows")
    for typ, g in df.groupby("check_type"):
        print(f"  {typ}: {len(g)}  record_id {sum(g.record_id != '')}  target_key {sum(g.target_key != '')}  plant_key {sum(g.plant_key != '')}")
    print("unresolved join rows:", len(unresolved), unresolved[:5])


if __name__ == "__main__":
    main()
