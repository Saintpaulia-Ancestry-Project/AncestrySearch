"""ONE-TIME migration (notes/freeze-plan.md, phase 1): freeze the AVML supplements 1964-2002 and collect everything that still
needs a person's decision in ONE file.

What it does (run once, after the last run of prep_mvl_supplements.py / split_mvl_descriptions.py / import_excel.py):
  1. data/mvl_supplements.csv gets two new columns and a complete hold_reason, so import_excel.py no longer reads review files:
       join_to / separate_from  existing-record keys decided `join` / `separate` (from mvl_join_matches*.csv)
       hold_reason              spelling near-miss still undecided, same name without hybridizer, or the old hold reason
  2. reports/outstanding_checks.csv: one row per entry still to be checked (spelling near-misses, held plants, shared registration
     numbers, same-name/hybridizer-differs matches, description splits, the 1963 book matches and OCR review).
  3. reports/decision_history/: every decided row of the MVL review files (read-only record; no script reads it).
  4. The MVL review files that are now frozen or moved are deleted from reports/review/.
Afterwards the routine pipeline is: import_excel.py -> import_submissions.py apply -> build_db.py -> export_ancestry_xlsx.py.
New decisions are made in outstanding_checks.csv and applied with scripts/apply_check_decisions.py.
"""
import collections
import csv
import difflib
import re
import shutil
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA, REVIEW, REPORTS = ROOT / "data", ROOT / "reports" / "review", ROOT / "reports"
HIST = REPORTS / "decision_history"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from mvl_lib import hyb_tokens  # noqa: E402

CHECK_COLS = ["check_id", "group_id", "source", "check_type", "tier", "name", "hybridizer", "lists_or_year", "reg_no", "reg_date",
              "mlv_name", "mlv_hybridizer", "mlv_reg", "mlv_date", "description", "detail", "proposal", "target_key",
              "first_class_name", "first_class_hybridizer", "first_class_reg_date", "decision", "note"]


def read(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig").to_dict("records")


def write(path, rows, cols):
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows, columns=cols).to_csv(path, index=False, encoding="utf-8-sig")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("’", "'"))


def main():
    HIST.mkdir(parents=True, exist_ok=True)
    plants = read(DATA / "mvl_supplements.csv")
    cols = list(plants[0].keys())
    byk = {p["plant_key"]: p for p in plants}
    checks = []
    n = collections.Counter()

    def add(**kw):
        row = {c: "" for c in CHECK_COLS}
        row.update(kw)
        n[(row["source"], row["check_type"])] += 1
        row["check_id"] = f"c{len(checks) + 1:05d}"
        checks.append(row)

    # ---- 1a. join / separate decisions into the plant rows
    join_to, sep_from = collections.defaultdict(list), collections.defaultdict(list)
    decided = []
    for f in ("mvl_join_matches_decided.csv", "mvl_join_matches.csv"):
        for r in read(REVIEW / f):
            d = r["decision"].strip().lower()
            if d == "join":
                join_to[r["plant_key"]].append(r["existing_key"])
                decided.append(r)
            elif d == "separate":
                sep_from[r["plant_key"]].append(r["existing_key"])
                decided.append(r)
            else:
                add(group_id=r["plant_key"], source="mvl 1964-2002", check_type="same name, hybridizer differs or unknown",
                    tier=r["reason"], name=r["name"], hybridizer=r["supplement_hybridizer"], lists_or_year=r["supplement_lists"],
                    reg_no=r["supplement_reg"], description=r["supplement_description"], target_key=r["existing_key"],
                    detail=f"existing record: {r['existing_name']} | {r['existing_hybridizer']} | #{r['existing_reg']} | "
                           f"{r['existing_sources']}", proposal="", note=r["decision"])
    write(HIST / "mvl_join_matches_decided.csv", decided,
          ["plant_key", "name", "supplement_hybridizer", "supplement_lists", "supplement_reg", "supplement_description",
           "existing_key", "existing_name", "existing_hybridizer", "existing_reg", "existing_sources", "existing_description",
           "existing_description_from", "reason", "decision"])

    # ---- 1b. hold reasons
    spell = read(REVIEW / "mvl_spelling.csv")
    spell_open = collections.defaultdict(list)
    for r in spell:
        if not r["decision"].strip():
            spell_open[r["supplement_key"]].append(r)
    match_rows = read(REVIEW / "mvl_matches.csv")
    match_open = {r["plant_key"] for r in match_rows if not r["decision"].strip() and not r["hybridizer"].strip()}
    for p in plants:
        reasons = [p["hold_reason"]] if p["hold_reason"] else []
        if norm(p["supplement_spelling"] or p["name"]) in spell_open:
            reasons.append("spelling: near-miss of an MLV name, undecided")
        if p["plant_key"] in match_open:
            reasons.append("same name as another plant and no hybridizer, undecided")
        p["hold_reason"] = "; ".join(reasons)
        p["join_to"] = ";".join(join_to.get(p["plant_key"], []))
        p["separate_from"] = ";".join(sep_from.get(p["plant_key"], []))
    cols += ["join_to", "separate_from"]

    # ---- 2a. spelling near-miss checks (one row per plant; the candidate MLV names listed in detail)
    by_key = collections.defaultdict(list)
    for p in plants:
        by_key[norm(p["supplement_spelling"] or p["name"])].append(p)
    for key, rows in spell_open.items():
        for p in by_key.get(key, [None]):
            r0 = rows[0]
            cand = " | ".join(f"{r['mlv_name']} ({r['mlv_hybridizer']}, #{r['mlv_reg']}, sim {r['similarity']})" for r in rows)
            same_no = any(r["supplement_reg"] and r["supplement_reg"] == r["mlv_reg"] for r in rows)
            add(group_id=f"spell:{key}", source="mvl 1964-2002", check_type="spelling near-miss of an MLV name",
                tier=("same number" if same_no else "different number"), name=r0["supplement_name"],
                hybridizer=r0["supplement_hybridizer"], lists_or_year=r0["lists"], reg_no=r0["supplement_reg"],
                mlv_name=r0["mlv_name"], mlv_hybridizer=r0["mlv_hybridizer"], mlv_reg=r0["mlv_reg"],
                description=(p["description"][:300] if p else ""), detail=cand, target_key=(p["plant_key"] if p else ""))

    # ---- 2b. held plants other than spelling (same name without hybridizer, description split)
    split = {r["plant_key"]: r for r in read(DATA / "mvl_description_split.csv")}
    for p in plants:
        if p["plant_key"] in match_open:
            add(group_id=f"nohyb:{norm(p['name'])}", source="mvl 1964-2002", check_type="same name as another plant, no hybridizer",
                name=p["name"], hybridizer=p["hybridizer"], lists_or_year=p["lists"], reg_no=p["registration_no"],
                description=p["description"][:300], target_key=p["plant_key"])
        if split.get(p["plant_key"], {}).get("split_status", "needs review") == "needs review":
            add(group_id=f"split:{p['plant_key']}", source="mvl 1964-2002", check_type="description split needs review",
                name=p["name"], hybridizer=p["hybridizer"], lists_or_year=p["lists"], description=p["description"][:300],
                target_key=p["plant_key"])

    # ---- 2c. shared registration numbers (groups of plants printing one number; tier like the First Class worksheet)
    sup = {(p["name"], p["lists"]): p for p in plants}
    g = collections.defaultdict(list)
    for r in read(REVIEW / "mvl_regno.csv"):
        if r["reason"].startswith("number shared"):
            g[r["supplement_reg"]].append(r)
    hist_regno = [r for r in read(REVIEW / "mvl_regno.csv") if not r["reason"].startswith("number shared")]
    write(HIST / "mvl_regno_log.csv", hist_regno, ["name", "lists", "supplement_reg", "mlv_reg", "reason", "decision"])
    W = lambda s: set(re.findall(r"[a-z0-9]+", s.lower()))
    for num, rs in sorted(g.items(), key=lambda x: int(re.sub(r"\D", "", x[0]) or 0)):
        ns = [norm(r["name"]) for r in rs]
        if len(set(ns)) == 1:
            tier = "same name apart"
        elif min(difflib.SequenceMatcher(None, a, b).ratio() for a in ns for b in ns if a != b) >= 0.75:
            hy = [sup.get((r["name"], r["lists"]), {}).get("hybridizer", "") for r in rs]
            agree = all(hyb_tokens(hy[0]) & hyb_tokens(h) or not h or not hy[0] for h in hy[1:])
            ws = [W(r["name"]) for r in rs]
            sub = any(a < b or b < a for a in ws for b in ws)
            tier = "similar names C (hybridizer differs)" if not agree else ("similar names B (word added)" if sub else "similar names A")
        else:
            tier = "different names"
        for r in rs:
            p = sup.get((r["name"], r["lists"]), {})
            add(group_id=f"regno:{num}", source="mvl 1964-2002", check_type="registration number shared by several plants", tier=tier,
                name=r["name"], hybridizer=p.get("hybridizer", ""), lists_or_year=r["lists"], reg_no=num,
                description=p.get("description", "")[:300], proposal=("keeps the number" if r["mlv_reg"] else "number cleared"),
                target_key=p.get("plant_key", ""))

    # ---- 2d. the 1963 book
    for r in read(REVIEW / "masterlist_matches.csv"):
        if not r["decision"].strip():
            add(group_id=f"ml63:{norm(r['book_name'])}:{norm(r['book_originator'])}", source="1963 book",
                check_type="book entry vs existing record", tier=r["reason"], name=r["book_name"], hybridizer=r["book_originator"],
                lists_or_year="1963", description=r["book_description"][:300], target_key="masterlist_matches.csv",
                detail=f"existing record: {r['existing_name']} | {r['existing_hybridizer']} | {r['existing_sources']}")
    for r in read(REVIEW / "masterlist_ocr_review.csv"):
        if not r["use"].strip():
            add(group_id=f"ocr:{r['row_id']}", source="1963 book", check_type="OCR review", tier=r["issue"],
                name=r["name_ocr2"] or r["name_ocr1"], hybridizer=r["originator_ocr2"] or r["originator_ocr1"], lists_or_year="1963",
                description=(r["description_ocr2"] or r["description_ocr1"])[:300], target_key="masterlist_ocr_review.csv:" + r["row_id"],
                detail=r["scan_url"])

    # ---- 3. history of the other decided MVL review files
    for f in ("mvl_row_names.csv", "mvl_recent_conflicts.csv", "mvl_split_review.csv"):
        shutil.copy(REVIEW / f, HIST / f)
    decided_sp = [r for r in spell if r["decision"].strip()]
    write(HIST / "mvl_spelling_decided.csv", decided_sp, list(spell[0].keys()))
    joined = [r for r in match_rows if r["decision"].strip()]
    write(HIST / "mvl_matches_decided.csv", joined, list(match_rows[0].keys()))

    # ---- write
    write(DATA / "mvl_supplements.csv", plants, cols)
    write(REPORTS / "outstanding_checks.csv", checks, CHECK_COLS)
    lines = ["# Outstanding checks", "", f"Generated by scripts/freeze_mvl_supplements.py. {len(checks)} rows in reports/outstanding_checks.csv.", ""]
    for (src, typ), c in sorted(n.items()):
        lines.append(f"- {src}: {typ}: {c}")
    (REPORTS / "outstanding_checks.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(len(checks), "outstanding rows")
    for k, v in sorted(n.items()):
        print(" ", k, v)


if __name__ == "__main__":
    main()
