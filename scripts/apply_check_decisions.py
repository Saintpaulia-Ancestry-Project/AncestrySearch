"""Apply the decisions typed in reports/outstanding_checks.csv (notes/freeze-plan.md).

The supplements 1964-2002 are FROZEN data (data/mvl_supplements.csv, data/mvl_description_split.csv, data/mvl_crossrefs.csv):
nothing regenerates them. A decision in the `decision` column edits those files directly; every applied row is then appended to
reports/decision_history/applied_checks.csv and removed from reports/outstanding_checks.csv. Rows without a decision, and rows
whose decision this script does not understand, stay in the outstanding file.

Decisions by check_type (case-insensitive):
  spelling near-miss of an MLV name    mlv        rename the plant to `mlv_name` (and set its registration number from `mlv_reg`),
                                                  merge it with a plant that already has that name
                                       keep | different   release the hold; the supplement spelling stays
  same name as another plant, no hybridizer   separate | release   release the hold (the plant stays its own record)
  same name, hybridizer differs or unknown    join | separate       the plant joins / never joins the existing record `target_key`
  description split needs review       accept     split_status = accepted
  registration number shared by several plants   rename:<Name>   rename the plant to <Name> (merged with that name's plant)
                                       different | keep   nothing to change (the group is only closed)
  1963 book (book entry vs existing record)  join | separate | <text>   written into reports/review/masterlist_matches.csv
  1963 book (OCR review)               keep | drop | use text            written into reports/review/masterlist_ocr_review.csv `use`
After a run: .venv\\Scripts\\python scripts\\import_excel.py ... (the usual pipeline).
Usage: python scripts/apply_check_decisions.py [--write] [--root DIR]     (default: a dry run that only reports)
"""
import argparse
import datetime
import re
import sys
from pathlib import Path

import pandas as pd

CHECK_COLS = ["check_id", "group_id", "source", "check_type", "tier", "name", "hybridizer", "lists_or_year", "reg_no", "reg_date",
              "mlv_name", "mlv_hybridizer", "mlv_reg", "mlv_date", "description", "detail", "proposal", "target_key",
              "first_class_name", "first_class_hybridizer", "first_class_reg_date", "decision", "note"]


def rd(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower().replace("’", "'"))


def slug(s):
    import unicodedata
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()).strip("-") or "x"


def merge_into(keep, other):
    """fold plant row `other` into `keep` (both dict rows of mvl_supplements.csv)"""
    lists = sorted({y for y in (keep["lists"] + ";" + other["lists"]).split(";") if y})
    keep["lists"] = ";".join(lists)
    keep["first_list"], keep["last_list"] = lists[0], lists[-1]
    keep["row_ids"] = ";".join(dict.fromkeys(filter(None, (keep["row_ids"] + ";" + other["row_ids"]).split(";"))))
    # the later list's prose description wins, as in the original plant clustering
    if other["desc_source"] == "prose" and (keep["desc_source"] != "prose" or int(other["last_list"] or 0) >= int(keep["last_list"] or 0)):
        for f in ("description", "description_original", "desc_source", "review_status"):
            keep[f] = other[f]
    for f in ("registration_no", "registered_date", "size_class", "hybridizer", "other_registry_code", "species_ref"):
        if not keep[f] and other[f]:
            keep[f] = other[f]
    if other["registered"] == "yes":
        keep["registered"] = "yes"
    keep["earlier_descriptions"] = " || ".join(x for x in (keep["earlier_descriptions"], other["earlier_descriptions"]) if x)
    keep["qa_flags"] = ";".join(sorted(set(filter(None, (keep["qa_flags"] + ";" + other["qa_flags"]).split(";")))))
    if keep["hold_reason"] and not other["hold_reason"]:
        pass
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    a = ap.parse_args()
    root = Path(a.root)
    data, rep, review = root / "data", root / "reports", root / "reports" / "review"
    checks = rd(rep / "outstanding_checks.csv")
    plants = rd(data / "mvl_supplements.csv")
    split = rd(data / "mvl_description_split.csv")
    xrefs = rd(data / "mvl_crossrefs.csv")
    ml_m = rd(review / "masterlist_matches.csv") if (review / "masterlist_matches.csv").exists() else None
    ml_o = rd(review / "masterlist_ocr_review.csv") if (review / "masterlist_ocr_review.csv").exists() else None
    byk = {r["plant_key"]: i for i, r in plants.iterrows()}
    P = {r["plant_key"]: dict(r) for _, r in plants.iterrows()}
    cols = list(plants.columns)
    applied, kept, msgs = [], [], []

    def rename(pk, new_name, reg=""):
        p = P.get(pk)
        if p is None:
            return f"plant {pk} not found"
        old = p["name"]
        twin = next((q for k, q in P.items() if k != pk and norm(q["name"]) == norm(new_name)
                     and (not reg or not q["registration_no"] or q["registration_no"] == reg)), None)
        if twin is not None:
            merge_into(twin, p)
            if reg and not twin["registration_no"]:
                twin["registration_no"] = reg
            twin["supplement_spelling"] = twin["supplement_spelling"] or old
            twin["hold_reason"] = ""
            del P[pk]
            for j, r in xrefs.iterrows():
                if r["target_plant_key"] == pk:
                    xrefs.at[j, "target_plant_key"] = twin["plant_key"]
            split_drop.add(pk)
            return f"{old} merged into {twin['name']} ({twin['plant_key']})"
        p["supplement_spelling"] = p["supplement_spelling"] or old
        p["name"] = new_name
        p["spelling"] = "mlv_corrected"
        if reg:
            p["registration_no"], p["registered"] = reg, "yes"
        p["hold_reason"] = ""
        return f"{old} renamed to {new_name}"

    split_drop = set()
    for _, c in checks.iterrows():
        d, t = c["decision"].strip(), c["check_type"]
        low = d.lower()
        res = None
        if not d:
            kept.append(c)
            continue
        if t == "spelling near-miss of an MLV name":
            if low == "mlv":
                res = rename(c["target_key"], c["mlv_name"], c["mlv_reg"])
            elif low in ("keep", "different"):
                p = P.get(c["target_key"])
                if p is not None:
                    p["hold_reason"] = "; ".join(x for x in p["hold_reason"].split("; ") if x and "near-miss of an MLV name" not in x)
                    res = f"{p['name']}: spelling kept"
        elif t == "same name as another plant, no hybridizer":
            if low in ("separate", "release"):
                p = P.get(c["target_key"])
                if p is not None:
                    p["hold_reason"] = "; ".join(x for x in p["hold_reason"].split("; ") if x and "no hybridizer" not in x)
                    res = f"{p['name']}: released"
        elif t == "same name, hybridizer differs or unknown":
            p = P.get(c["group_id"])
            if p is not None and low in ("join", "separate"):
                col = "join_to" if low == "join" else "separate_from"
                cur = [x for x in p[col].split(";") if x]
                if c["target_key"] not in cur:
                    cur.append(c["target_key"])
                p[col] = ";".join(cur)
                res = f"{p['name']}: {low} {c['target_key']}"
        elif t == "description split needs review":
            if low == "accept":
                j = split.index[split["plant_key"] == c["target_key"]]
                if len(j):
                    split.at[j[0], "split_status"] = "accepted"
                    res = f"{c['name']}: split accepted"
        elif t == "registration number shared by several plants":
            if low.startswith("rename:"):
                res = rename(c["target_key"], d.split(":", 1)[1].strip(), "")
            elif low in ("different", "keep"):
                res = f"{c['name']}: closed (no change)"
        elif c["source"] == "1963 book" and t == "book entry vs existing record" and ml_m is not None:
            m = ml_m[(ml_m["book_name"].map(norm) == norm(c["name"])) & (ml_m["book_originator"].map(norm) == norm(c["hybridizer"]))]
            if len(m):
                ml_m.loc[m.index, "decision"] = d
                res = f"{c['name']}: written to masterlist_matches.csv"
        elif c["source"] == "1963 book" and t == "OCR review" and ml_o is not None:
            m = ml_o[ml_o["row_id"] == c["target_key"].split(":", 1)[-1]]
            if len(m):
                ml_o.loc[m.index, "use"] = d
                res = f"{c['name']}: written to masterlist_ocr_review.csv"
        if res is None:
            kept.append(c)
            msgs.append(f"NOT APPLIED {c['check_id']} {t}: {c['name']} -> {d!r}")
        else:
            applied.append((c, res))
            msgs.append(f"{c['check_id']} {res}")
    print("\n".join(msgs) or "no decisions to apply")
    print(f"{len(applied)} applied, {len(kept)} rows stay in outstanding_checks.csv")
    if not a.write:
        print("(dry run: nothing written; use --write)")
        return
    out = pd.DataFrame(list(P.values()), columns=cols)
    out.to_csv(data / "mvl_supplements.csv", index=False, encoding="utf-8")
    split[~split["plant_key"].isin(split_drop)].to_csv(data / "mvl_description_split.csv", index=False, encoding="utf-8")
    xrefs.to_csv(data / "mvl_crossrefs.csv", index=False, encoding="utf-8")
    if ml_m is not None:
        ml_m.to_csv(review / "masterlist_matches.csv", index=False, encoding="utf-8-sig")
    if ml_o is not None:
        ml_o.to_csv(review / "masterlist_ocr_review.csv", index=False, encoding="utf-8-sig")
    hist = rep / "decision_history" / "applied_checks.csv"
    hist.parent.mkdir(parents=True, exist_ok=True)
    rows = [dict(c, applied=datetime.date.today().isoformat(), result=r) for c, r in applied]
    old = rd(hist) if hist.exists() else pd.DataFrame()
    pd.concat([old, pd.DataFrame(rows)], ignore_index=True).to_csv(hist, index=False, encoding="utf-8-sig")
    pd.DataFrame(kept, columns=CHECK_COLS).to_csv(rep / "outstanding_checks.csv", index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    sys.exit(main())
