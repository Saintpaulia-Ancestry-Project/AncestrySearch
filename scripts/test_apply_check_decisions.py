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
    chk = pd.read_csv(ROOT / "reports" / "outstanding_checks.csv", dtype=str, keep_default_na=False, encoding="utf-8-sig")
    chk["decision"] = ""          # the real file may hold decisions typed by the user: the tests start without any
    chk.to_csv(r / "reports" / "outstanding_checks.csv", index=False, encoding="utf-8-sig")
    return r


def run(root, write=True):
    cmd = [sys.executable, str(ROOT / "scripts" / "apply_check_decisions.py"), "--root", str(root)] + (["--write"] if write else [])
    out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return (out.stdout or "") + (out.stderr or "")


def rd(p):
    return pd.read_csv(p, dtype=str, keep_default_na=False, encoding="utf-8-sig")


def main():
    root = scratch()
    cv0 = rd(root / "data" / "cultivars.csv")
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
        return g.iloc[0] if len(g) else None

    marks = {}

    def setd(cid, val):
        chk.loc[chk.check_id == cid, "decision"] = val
        marks[cid] = val

    spell = chk[chk.check_type == "spelling near-miss of an MLV name"]
    s1, s2 = spell.iloc[0], spell.iloc[1]
    setd(s1.check_id, "mlv")
    setd(s2.check_id, "keep")
    nohyb = pick("same name as another plant, no hybridizer")
    if nohyb is not None:
        setd(nohyb.check_id, "release")
    # release-unregistered: its own record, WITHOUT the registration number the MLV match gave the plant
    nrs = chk[(chk.check_type == "same name as another plant, no hybridizer") & ~chk.check_id.isin(marks)]
    nr = nrs.iloc[1] if len(nrs) > 1 else None
    if nr is not None:
        setd(nr.check_id, "release-unregistered")
    dropped = chk[(chk.check_type == "same name as another plant, no hybridizer") & ~chk.check_id.isin(marks)]
    if len(dropped) > 1:
        dropped = dropped.iloc[1]
        setd(dropped.check_id, "drop")
    else:
        dropped = []
    stub = chk[(chk.check_type == "book entry vs existing record") & (chk.record_id != "") & (chk.target_key != "")]
    stubrow = None
    for _, rr in stub.iterrows():
        e = cv0[cv0.id == rr.target_key]
        if len(e) and e.iloc[0].kind == "stub":
            stubrow = rr
            break
    if stubrow is not None:
        setd(stubrow.check_id, "join-stub")
    split = pick("description split needs review")
    if split is not None:
        setd(split.check_id, "accept")
    join = pick("same name, hybridizer differs or unknown", record_id="set", target_key="set")
    if join is not None:
        setd(join.check_id, "join")
    shared = chk[(chk.check_type == "registration number shared by several plants") & (chk.record_id != "")].iloc[0]
    setd(shared.check_id, "rename:Test Renamed Cultivar")
    src = chk[(chk.check_type == "source row disagrees with record") & (chk.proposal != "")].iloc[0]
    setd(src.check_id, "source")
    ocr = chk[(chk.check_type == "OCR review") & (chk.record_id != "")]
    if len(ocr) < 2:       # the OCR rows were decided and closed: take any row that has a record id for the set: decision
        ocr = chk[(chk.record_id != "") & ~chk.check_id.isin(marks) & (chk.check_type == "originator text vs person")]
        ocr = ocr if len(ocr) else chk[(chk.record_id != "") & ~chk.check_id.isin(marks)]
    ocr = ocr.iloc[1]
    setd(ocr.check_id, "set:notes=OCR note set by the test")
    bogus = chk[chk.check_type == "spelling near-miss of an MLV name"].iloc[3]
    setd(bogus.check_id, "no such decision")
    # MLV values for an `mlv` decision; typed First Class values for `keep` (not in the MLV)
    import re as _re
    _norm = lambda x: _re.sub(r"[^a-z0-9]", "", x.lower())
    _existing = set(cv0.name.map(_norm))      # an MLV name already in the master is JOINED (existing values win): not what these checks test
    _cand = chk[(chk.check_type == "spelling near-miss of an MLV name") & (chk.mlv_date != "") & (chk.mlv_reg != "")
                & (chk.mlv_size != "") & ~chk.check_id.isin(marks) & ~chk.mlv_name.map(_norm).isin(_existing)]
    withdate = _cand.iloc[0]
    setd(withdate.check_id, "mlv")
    fcrow = chk[(chk.check_type == "spelling near-miss of an MLV name") & ~chk.check_id.isin(marks)].iloc[0]
    setd(fcrow.check_id, "keep")
    # hierarchy: a typed First Class date beats the MLV date; the MLV fills the size First Class did not give
    both = _cand[~_cand.check_id.isin(marks) & (_cand.check_id != withdate.check_id)].iloc[0]
    setd(both.check_id, "mlv")
    chk.loc[chk.check_id == both.check_id, "first_class_reg_date"] = "03/04/1969"
    chk.loc[chk.check_id == fcrow.check_id, "first_class_reg_date"] = "(987654) 01/02/1970"
    chk.loc[chk.check_id == fcrow.check_id, "first_class_size"] = "Miniature"
    ors = chk[chk.check_type == "originator text vs person"]
    one_prop = ors[ors.proposal.map(lambda x: len([y for y in x.split("|") if y.strip()]) == 1)]
    o_link = o_kind = o_two = o_bad = None
    if len(one_prop):
        o_link = one_prop.iloc[0]
        setd(o_link.check_id, "link")
    plain = ors[~ors.check_id.isin(marks) & ~ors.name.str.contains("[/&]")]
    if len(plain) > 1:
        o_kind = plain.iloc[0]
        setd(o_kind.check_id, "kind:organization")
        o_bad = plain.iloc[1]
        setd(o_bad.check_id, "link:No Such Person")
    multi = ors[ors.name.str.contains("[/&]") & ors.hybridizer.str.contains(";") & ~ors.check_id.isin(marks)]
    if len(multi):
        o_two = multi.iloc[0]
        setd(o_two.check_id, "people:Test Person One; Test Person Two")
    chk.to_csv(root / "reports" / "outstanding_checks.csv", index=False, encoding="utf-8-sig")
    out = run(root)
    print(out)
    if o_bad is not None:
        assert f"NOT APPLIED {o_bad.check_id}" in out and "is not an existing person" in out
    assert f"NOT APPLIED {bogus.check_id}" in out
    after = rd(root / "reports" / "outstanding_checks.csv")
    assert len(after) == n0 - (len(marks) - out.count("NOT APPLIED")), (len(after), n0, len(marks))
    assert bogus.check_id in set(after.check_id)
    cv = rd(root / "data" / "cultivars.csv")
    ids = set(cv.id)
    if join is not None:
        assert join.record_id not in ids and join.target_key in ids, "join merges record_id into target_key"
    names = set(cv.name)
    assert "Test Renamed Cultivar" in names or any(norm_eq(n, "Test Renamed Cultivar") for n in names)
    pe = rd(root / "data" / "people.csv")
    if o_two is not None:
        assert "Test Person One" in set(pe.name)
    if o_kind is not None:
        cur = [x.strip() for x in o_kind.hybridizer.split(";")]
        assert all(pe[pe.name == x].iloc[0].kind == "organization" for x in cur if len(pe[pe.name == x]))
    mrow = cv[cv.name == withdate.mlv_name]
    assert len(mrow) and mrow.iloc[0].registered_date == withdate.mlv_date and mrow.iloc[0].registration_no == withdate.mlv_reg,         "an `mlv` decision takes number and date from the MLV"
    if withdate.mlv_size:
        assert mrow.iloc[0].size_class == withdate.mlv_size
    brow = cv[cv.name == both.mlv_name]
    assert len(brow) and brow.iloc[0].registered_date == "1969-03-04", "First Class date beats the MLV date"
    assert brow.iloc[0].size_class == both.mlv_size and brow.iloc[0].registration_no == both.mlv_reg, "the MLV fills what First Class lacks"
    frow = cv[(cv.registration_no == "987654")]
    assert len(frow) == 1 and frow.iloc[0].registered_date == "1970-01-02" and frow.iloc[0].size_class == "Miniature",         "a `keep` decision takes the First Class values typed by the user"
    if len(dropped) if not isinstance(dropped, list) else False:
        assert dropped.plant_key not in set(rd(root / "data" / "mvl_supplements.csv").plant_key), "a dropped plant leaves the frozen file"
        assert (root / "reports" / "decision_history" / "dropped_plants.csv").exists()
    if stubrow is not None:
        k = cv[cv.id == stubrow.target_key].iloc[0]
        assert stubrow.record_id not in set(cv.id) and "by name only" in k.notes, "join-stub merges and notes it"
    if nr is not None:
        made = cv[(cv.name == nr["name"]) & (cv.sources == "mvl_supp") & (cv.registration_no == "")]
        assert len(made) >= 1, "release-unregistered must not carry the MLV number"
    rec = cv[cv.id == ocr.record_id].iloc[0]
    assert "OCR note set by the test" in rec.notes
    sup = rd(root / "data" / "mvl_supplements.csv")
    assert s1.plant_key not in set(sup.plant_key) and s2.plant_key not in set(sup.plant_key)
    if nohyb is not None:
        assert nohyb.plant_key not in set(sup.plant_key)
    if split is not None:
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
