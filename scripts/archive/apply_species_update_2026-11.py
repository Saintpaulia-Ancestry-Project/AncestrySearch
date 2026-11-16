"""ONE-TIME (2026-11-16): applies reports/decision_history/species_update_plan.csv to the master through master_edit.py.
Sources: K. Barbi, African Violet Species Identification Guide (2019) and Goretsky/Smith, Gesneriads 68(1), 2018 (CC BY-NC-SA 4.0).
Decisions (user): corrected names, one record per table line, merged descriptions, S. Amaniensis removed, the hybrid renamed and linked
to its two parents. Kept for the record; do not run it again (the plan is applied and the old records are gone).
    python scripts/archive/apply_species_update_2026-11.py [--root DIR]"""
import argparse, csv, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import master_edit as me

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=str(ROOT))
a = ap.parse_args()
root = Path(a.root)
m = me.Master(root)
R = "Species update 2026-11: names and descriptions from the Barbi species guide (2019) / Gesneriads 68(1), 2018; user decisions"
plan = list(csv.DictReader(open(root / "reports" / "decision_history" / "species_update_plan.csv", encoding="utf-8-sig")))
m.delete("s-amaniensis", "S. Amaniensis is in neither source and was removed (user decision)")


def tag(cid):
    r = m.by_id[cid]
    if "species_guide" not in r["sources"].split("+"):
        r["sources"] = (r["sources"] + "+" if r["sources"] else "") + "species_guide"


n_add = n_upd = n_merge = 0
for row in plan:
    name = row["name"]
    if row["action"] == "add":
        cid = m.add(name, R, kind="species", description=row["description"], notes=row["notes"], sources="species_guide")
        n_add += 1
    else:
        cid = row["keep_id"]
        for drop in [x.strip() for x in row["merge_ids"].split(";") if x.strip()]:
            m.merge(cid, drop, R)
            n_merge += 1
        m.rename(cid, name, R)
        if row["description"]:
            m.set_field(cid, "description", row["description"], R, note=False)
        m.set_field(cid, "notes", row["notes"], R)
        tag(cid)
        n_upd += 1
    for old in [x.strip() for x in row["old_names"].split(";") if x.strip()]:
        m.add_alias(old, name)

# the hybrid of two species
H = "s-magungensis-x-s-velutina"
HN = "S. 5b. cl. magungensis x S. 5i. cl. velutinus"
m.rename(H, HN, R)
m.set_field(H, "notes", "Hybrid of two species: S. 5b. cl. magungensis and S. 5i. cl. velutinus. Formerly listed as: S. magungensis x S. velutina.", R)
for pid in ("s-magungensis-e-roberts", "s-velutina-b-burtt"):
    m.parentage.rows.append({"child_id": H, "parent_id": pid, "role": "unordered", "certainty": "known",
                             "raw_text": "S. magungensis x S. velutina"})
m._log("add_parentage", H, HN, "parents", "", "S. 5b. cl. magungensis; S. 5i. cl. velutinus", R)
tag(H)
bad = m.validate()
print("added", n_add, "updated", n_upd, "merged", n_merge, "| validate:", bad)
if bad:
    sys.exit(1)
m.save()
