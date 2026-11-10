"""Check contributor submissions against the current database and write the flag columns for the review Sheet.

    python scripts/check_submissions.py submissions/inbox/export.csv

Reads a CSV exported from the review Sheet (or the form's own CSV download). Writes
<input>.flags.csv with submission_id, entry_no, name, flag_name_match, flag_parents, flag_other: paste the
three flag columns back into the Sheet (matching rows). Never changes data/. Run it after import_excel.py so
the checks see the same records the import will.
"""
import argparse
from pathlib import Path

import submissions_lib as sl
from submissions_lib import ie


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", type=Path)
    args = ap.parse_args()
    rows = sl.read_csv(args.csv)
    if not rows:
        print("No rows.")
        return
    base = sl.Base()
    by_sub = {}
    for r in rows:
        by_sub.setdefault(r.get("submission_id", ""), []).append(r)
    out, problems = [], 0
    for sid, group in by_sub.items():
        names = [ie.K(sl.effective(r)["name"]) for r in group]
        for r in group:
            res = sl.check_row(r, base, names)
            other = list(res["other"])
            if not sl.SID_RE.match(sid or ""):
                other.append("submission_id missing or has unusual characters")
            if (r.get("agreed_license") or "").strip().lower() != "yes":
                other.append("license not agreed: row will be refused at ingest")
            bad = any(x.startswith(("EXISTS", "CYCLE", "no name")) or "AMBIGUOUS" in x for x in
                      res["name_match"] + res["parents"] + other)
            problems += bad
            out.append({"submission_id": sid, "entry_no": r.get("entry_no", ""), "name": sl.effective(r)["name"],
                        "flag_name_match": " | ".join(res["name_match"]), "flag_parents": " | ".join(res["parents"]),
                        "flag_other": " | ".join(other)})
    dest = args.csv.with_name(args.csv.stem + ".flags.csv")
    sl.write_csv(dest, out, ["submission_id", "entry_no", "name", "flag_name_match", "flag_parents", "flag_other"], bom=True)
    print(f"{len(out)} rows checked, {problems} need a decision before import. Wrote {dest}")


if __name__ == "__main__":
    main()
