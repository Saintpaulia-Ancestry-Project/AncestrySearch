"""ONE-TIME (phase 2): move the undecided rows of reports/review/outstanding_originator_mapping.csv into reports/outstanding_checks.csv
(check_type `originator text vs person`) and file the mapping CSV as history (reports/decision_history/originator_mapping.csv)."""
import subprocess
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
src = ROOT / "reports" / "review" / "outstanding_originator_mapping.csv"
o = pd.read_csv(src, dtype=str, keep_default_na=False, encoding="utf-8-sig")
c = pd.read_csv(ROOT / "reports" / "outstanding_checks.csv", dtype=str, keep_default_na=False, encoding="utf-8-sig")
n = len(c)
rows = []
for _, r in o.iterrows():
    if r["decision"].strip():
        continue                                           # decided rows stay in the history copy
    n += 1
    row = {col: "" for col in c.columns}
    row.update(check_id=f"c{n:05d}", group_id="orig:" + r["originator"], source="originators (text)",
               check_type="originator text vs person", tier="has a proposal" if r["proposed_link"] else "no proposal",
               name=r["originator"], hybridizer=r["final_person(s)"], lists_or_year=r["uses"], proposal=r["proposed_link"],
               detail=f"{r['uses']} cultivars print this originator; kind {r['kind']}; now linked to: {r['final_person(s)']}")
    rows.append(row)
pd.concat([c, pd.DataFrame(rows, columns=c.columns)], ignore_index=True).to_csv(
    ROOT / "reports" / "outstanding_checks.csv", index=False, encoding="utf-8-sig")
dst = ROOT / "reports" / "decision_history" / "originator_mapping.csv"
subprocess.run(["git", "mv", str(src), str(dst)], cwd=ROOT, check=True)
print(len(rows), "rows added to outstanding_checks.csv;", src.name, "moved to decision_history/originator_mapping.csv")
