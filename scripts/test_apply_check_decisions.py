"""Tests for apply_check_decisions.py on a scratch copy (never touches the real files):
    .venv/Scripts/python scripts/test_apply_check_decisions.py"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MASTER = ["cultivars", "parentage", "people", "cultivar_hybridizers", "cultivar_links", "images", "name_aliases"]
FROZEN = ["mvl_supplements", "mvl_description_split", "mvl_crossrefs"]


def scratch():
    r = Path(tempfile.mkdtemp(prefix="apply_test_"))
    (r / "data").mkdir()
    (r / "reports").mkdir()
    for f in MASTER + FROZEN:
        if (ROOT / "data" / f"{f}.csv").exists():
            shutil.copy(ROOT / "data" / f"{f}.csv", r / "data" / f"{f}.csv")
    shutil.copy(ROOT / "reports" / "outstanding_checks.csv", r / "reports" / "outstanding_checks.csv")
    return r


def run(root, write=True):
    cmd = [sys.executable, str(ROOT / "scripts" / "apply_check_decisions.py"), "--root", str(root)] + (["--write"] if write else [])
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return out.stdout + out.stderr


def rd(p):
    return pd.read_csv(p, dtype=str, keep_default_na=False, encoding="utf-8-sig")


def main():
    root = scratch()
    chk = rd(root / "reports" / "outstanding_checks.csv")
    n0 = len(chk)
    # 0. no decisions: nothing changes, byte for byte
    out = run(root)
    assert "no decisions to apply" in out, out
    for f in MASTER:
        assert (root / "data" / f"{f}.csv").read_bytes() == (ROOT / "data" / f"{f}.csv").read_bytes(), f
    print("ok  no decisions: master unchanged byte for byte")

    def pick(t, **cond):
        g = chk[chk.check_type == t]
        for k, v in cond.items():
            g = g[g[k] != ""] if v == "set" else g[g[k] == ""]
        return g.iloc[0]

    marks = {}

    def setd(cid, val):
        chk.loc[chk.check_id == cid, "decision"] = val
        marks[cid] = val

    spell = chk[chk.check_type == "spelling near-miss of an MLV name"]
    s1, s2 = spell.iloc[0], spell.iloc[1]
    setd(s1.check_id, "mlv")
    setd(s2.check_id, "keep")
    nohyb = pick("same name as another plant, no hybridizer")
    setd(nohyb.check_id, "release")
    split = pick("description split needs review")
    setd(split.check_id, "accept")
    join = pick("same name, hybridizer differs or unknown", record_id="set", target_key="set")
    setd(join.check_id, "join")
    shared = chk[(chk.check_type == "registration number shared by several plants") & (chk.record_id != "")].iloc[0]
    setd(shared.check_id, "rename:Test Renamed Cultivar")
    src = chk[(chk.check_type == "source row disagrees with record") & (chk.proposal != "")].iloc[0]
    setd(src.check_id, "source")
    ocr = chk[(chk.check_type == "OCR review") & (chk.record_id != "")].iloc[1]
    setd(ocr.check_id, "set:notes=OCR note set by the test")
    bogus = chk[chk.check_type == "spelling near-miss of an MLV name"].iloc[3]
    setd(bogus.check_id, "no such decision")
    # MLV values for an `mlv` decision; typed First Class values for `keep` (not in the MLV)
    withdate = chk[(chk.check_type == "spelling near-miss of an MLV name") & (chk.mlv_date != "") & (chk.mlv_reg != "")
                   & ~chk.check_id.isin(marks)].iloc[0]
    setd(withdate.check_id, "mlv")
    fcrow = chk[(chk.check_type == "spelling near-miss of an MLV name") & ~chk.check_id.isin(marks)].iloc[0]
    setd(fcrow.check_id, "keep")
    # hierarchy: a typed First Class date beats the MLV date; the MLV fills the size First Class did not give
    both = chk[(chk.check_type == "spelling near-miss of an MLV name") & (chk.mlv_date != "") & (chk.mlv_size != "") & (chk.mlv_reg != "")
               & ~chk.check_id.isin(marks)].iloc[0]
    setd(both.check_id, "mlv")
    chk.loc[chk.check_id == both.check_id, "first_class_reg_date"] = "03/04/1969"
    chk.loc[chk.check_id == fcrow.check_id, "first_class_reg_date"] = "(987654) 01/02/1970"
    chk.loc[chk.check_id == fcrow.check_id, "first_class_size"] = "Miniature"
    ors = chk[chk.check_type == "originator text vs person"]
    o_link = ors[(ors.name == "Arndt")].iloc[0]
    setd(o_link.check_id, "link")
    o_kind = ors[(ors.name == "Tonkadale")].iloc[0]
    setd(o_kind.check_id, "kind:organization")
    o_two = ors[ors.name == "Sidney & Paul Sorano"].iloc[0]
    setd(o_two.check_id, "people:Test Person One; Test Person Two")
    o_bad = ors[ors.name == "Madison"].iloc[0]
    setd(o_bad.check_id, "link:No Such Person")
    chk.to_csv(root / "reports" / "outstanding_checks.csv", index=False, encoding="utf-8-sig")
    out = run(root)
    print(out)
    assert f"NOT APPLIED {o_bad.check_id}" in out and "is not an existing person" in out
    assert f"NOT APPLIED {bogus.check_id}" in out
    after = rd(root / "reports" / "outstanding_checks.csv")
    assert len(after) == n0 - (len(marks) - out.count("NOT APPLIED")), (len(after), n0, len(marks))
    assert bogus.check_id in set(after.check_id)
    cv = rd(root / "data" / "cultivars.csv")
    ids = set(cv.id)
    assert join.record_id not in ids and join.target_key in ids, "join merges record_id into target_key"
    names = set(cv.name)
    assert "Test Renamed Cultivar" in names or any(norm_eq(n, "Test Renamed Cultivar") for n in names)
    pe = rd(root / "data" / "people.csv")
    assert "Test Person One" in set(pe.name) and pe[pe.name == "Tonkadale"].iloc[0].kind == "organization"
    mrow = cv[cv.name == withdate.mlv_name]
    assert len(mrow) and mrow.iloc[0].registered_date == withdate.mlv_date and mrow.iloc[0].registration_no == withdate.mlv_reg,         "an `mlv` decision takes number and date from the MLV"
    if withdate.mlv_size:
        assert mrow.iloc[0].size_class == withdate.mlv_size
    brow = cv[cv.name == both.mlv_name]
    assert len(brow) and brow.iloc[0].registered_date == "1969-03-04", "First Class date beats the MLV date"
    assert brow.iloc[0].size_class == both.mlv_size and brow.iloc[0].registration_no == both.mlv_reg, "the MLV fills what First Class lacks"
    frow = cv[(cv.registration_no == "987654")]
    assert len(frow) == 1 and frow.iloc[0].registered_date == "1970-01-02" and frow.iloc[0].size_class == "Miniature",         "a `keep` decision takes the First Class values typed by the user"
    rec = cv[cv.id == ocr.record_id].iloc[0]
    assert "OCR note set by the test" in rec.notes
    sup = rd(root / "data" / "mvl_supplements.csv")
    assert s1.plant_key not in set(sup.plant_key) and s2.plant_key not in set(sup.plant_key) and nohyb.plant_key not in set(sup.plant_key)
    assert split.plant_key not in set(sup.plant_key)
    assert (root / "reports" / "decision_history" / "applied_checks.csv").exists()
    assert (root / "reports" / "decision_history" / "master_edits.csv").exists()
    sys.path.insert(0, str(ROOT / "scripts"))
    import master_edit as me
    assert me.Master(root).validate() == []
    print("ok  decisions applied: held plants imported, join merged, rename, source value, set:, invalid decision kept; master consistent")
    shutil.rmtree(root, ignore_errors=True)
    print("all tests passed")


def norm_eq(a, b):
    import re
    return re.sub(r"[^a-z0-9]", "", a.lower()) == re.sub(r"[^a-z0-9]", "", b.lower())


if __name__ == "__main__":
    main()
