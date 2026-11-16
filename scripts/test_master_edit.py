"""Tests for scripts/master_edit.py, run on a scratch copy of data/ (never touches the real files):
    .venv/Scripts/python scripts/test_master_edit.py"""
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import master_edit as me  # noqa: E402

REAL = Path(__file__).resolve().parents[1] / "data"
FILES = ["cultivars", "parentage", "people", "cultivar_hybridizers", "cultivar_links", "images", "name_aliases"]


def scratch():
    root = Path(tempfile.mkdtemp(prefix="master_edit_test_"))
    (root / "data").mkdir()
    for f in FILES:
        shutil.copy(REAL / f"{f}.csv", root / "data" / f"{f}.csv")
    return root


def must_fail(fn, *a, **k):
    try:
        fn(*a, **k)
    except me.EditError:
        return True
    raise AssertionError(f"{fn.__name__} should have failed")


def main():
    # 1. load + save without edits changes no byte
    root = scratch()
    m = me.Master(root)
    assert m.validate() == [], m.validate()[:5]
    m.save()
    for f in FILES:
        assert (root / "data" / f"{f}.csv").read_bytes() == (REAL / f"{f}.csv").read_bytes(), f"round trip changed {f}.csv"
    assert not (root / "data" / "id_redirects.csv").exists()
    print("ok  round trip is byte-identical for all", len(FILES), "files; real master is consistent")

    # 2. set a field by name: old value into the notes, history row, registration number stays unique
    m = me.Master(root)
    ids = m.select("Reed's Jackpot")
    assert ids == ["reed-s-jackpot"], ids
    assert m.set_field("Reed's Jackpot", "hybridizer_raw", "Test Hybridizer", "unit test") == 1
    r = m.by_id["reed-s-jackpot"]
    assert r["hybridizer_raw"] == "Test Hybridizer" and "[hybridizer_raw corrected from J. Reed: unit test]" in r["notes"]
    other = next(x for x in m.cultivars.rows if x["registration_no"] and x["id"] != "reed-s-jackpot")
    must_fail(m.set_field, "reed-s-jackpot", "registration_no", other["registration_no"], "dup")
    m.save()
    hist = (root / "reports" / "decision_history" / "master_edits.csv").read_text(encoding="utf-8")
    assert "set,reed-s-jackpot" in hist and "unit test" in hist
    print("ok  set_field by name, note, unique registration number, history")

    # 3. rename keeps the id and notes the old spelling
    m = me.Master(root)
    assert m.rename("spinnaker", "Spinnaker (test)", "unit test")
    assert m.by_id["spinnaker"]["name"] == "Spinnaker (test)" and "[name corrected from Spinnaker" in m.by_id["spinnaker"]["notes"]
    assert {"alias_key": "spinnaker", "canonical_key": "spinnakertest"} in m.aliases.rows, "old spelling must still resolve"
    print("ok  rename")

    # 4. merge re-points parentage, hybridizers, links, images, sports; the dropped id redirects
    m = me.Master(root)
    a = m.add("Merge Keep", "test")
    b = m.add("Merge Drop", "test", kind="stub", description="from the drop", registration_no="")
    p1, c1 = m.add("Merge Parent", "test"), m.add("Merge Child", "test")
    m.parentage.rows += [{"child_id": c1, "parent_id": b, "role": "seed", "certainty": "known", "raw_text": "Merge Drop"},
                         {"child_id": b, "parent_id": p1, "role": "pollen", "certainty": "known", "raw_text": "Merge Parent"},
                         {"child_id": a, "parent_id": p1, "role": "pollen", "certainty": "known", "raw_text": "Merge Parent"}]
    person = m.people.rows[0]["id"]
    m.hyb.rows += [{"cultivar_id": b, "person_id": person, "position": "1"}]
    m.links.rows += [{"cultivar_id": b, "url": "http://example.org/x", "kind": "web"}]
    m.by_id[c1]["sport_of_id"] = b
    m.merge(a, b, "unit test")
    assert b not in m.by_id and m.by_id[a]["description"] == "from the drop"
    assert {(p["child_id"], p["parent_id"], p["role"]) for p in m.parentage.rows if a in (p["child_id"], p["parent_id"])} == \
        {(c1, a, "seed"), (a, p1, "pollen")}, "child re-pointed, duplicate parent row dropped"
    assert any(h["cultivar_id"] == a and h["person_id"] == person for h in m.hyb.rows)
    assert any(x["cultivar_id"] == a and x["url"].endswith("/x") for x in m.links.rows)
    assert m.by_id[c1]["sport_of_id"] == a
    assert m.redirects.rows[-1]["old_id"] == b and m.redirects.rows[-1]["new_id"] == a
    assert {"alias_key": "mergedrop", "canonical_key": "mergekeep"} in m.aliases.rows
    assert m.validate() == []
    m.save()
    assert (root / "data" / "id_redirects.csv").exists()
    print("ok  merge: parentage, hybridizers, links, sport parent, redirect")

    # 5. a merge that would make a record its own ancestor is refused (and leaves nothing half-done); so are two numbers
    m = me.Master(root)
    g, h, o = m.add("Cycle Grand", "t"), m.add("Cycle Child", "t"), m.add("Cycle Other", "t")
    m.parentage.rows.append({"child_id": h, "parent_id": g, "role": "seed", "certainty": "known", "raw_text": "x"})
    m.parentage.rows.append({"child_id": o, "parent_id": h, "role": "seed", "certainty": "known", "raw_text": "x"})
    n_before = len(m.parentage.rows)
    must_fail(m.merge, g, o, "would make Cycle Grand its own ancestor")
    assert o in m.by_id and len(m.parentage.rows) == n_before and m.validate() == [], "failed merge must restore everything"
    x1 = next(r for r in m.cultivars.rows if r["registration_no"])
    x2 = next(r for r in m.cultivars.rows if r["registration_no"] and r["registration_no"] != x1["registration_no"])
    must_fail(m.merge, x1["id"], x2["id"], "different numbers")
    print("ok  refusals: cycle (state restored), different registration numbers")

    # 6. delete refuses a parent, accepts a leaf
    m = me.Master(root)
    leaf = m.add("Delete Leaf", "t")
    m.delete(leaf, "unit test")
    assert leaf not in m.by_id
    parent_id = next(p["parent_id"] for p in m.parentage.rows)
    must_fail(m.delete, parent_id, "is a parent")
    print("ok  delete")

    # 7. save refuses an inconsistent master
    m = me.Master(root)
    m.parentage.rows.append({"child_id": "no-such-id", "parent_id": "spinnaker", "role": "seed", "certainty": "known", "raw_text": "x"})
    must_fail(m.save)
    print("ok  save refuses a dangling relation")
    # 8. relink an originator printed as text: cultivars move to the chosen people, orphans go, aliases kept
    m = me.Master(root)
    names = {p["id"]: p["name"] for p in m.people.rows}
    linked = {}
    for h in m.hyb.rows:
        linked.setdefault(h["cultivar_id"], []).append(names.get(h["person_id"], ""))
    one = {}                                   # a printed text whose cultivars are all linked to exactly one person of that name
    for c_ in m.cultivars.rows:
        t = c_["hybridizer_raw"].strip()
        if t and linked.get(c_["id"]) == [t]:
            one.setdefault(t, []).append(c_["id"])
    text = max(one, key=lambda k: len(one[k]))
    target = next(p["name"] for p in m.people.rows if p["name"] != text and p["kind"] == "person")
    n_moved = m.relink_originator(text, [text], [target], "unit test")
    assert n_moved >= 1, n_moved
    must_fail(m.relink_originator, text, [text], [target], "second time: nothing left to move")
    two = {}                                   # a text of two people ("A / B"): cultivars linked to exactly those two
    for c_ in m.cultivars.rows:
        t = c_["hybridizer_raw"].strip()
        ps = linked.get(c_["id"], [])
        if len(ps) == 2 and ("/" in t or "&" in t):
            two.setdefault((t, tuple(sorted(ps))), []).append(c_["id"])
    if two:
        (t2, ps2), ids2 = next(iter(two.items()))
        k = m.relink_originator(t2, list(ps2), ["Test Person One", "Test Person Two"], "unit test")
        pair = (m._person("Test Person One"), m._person("Test Person Two"))
        rows2 = [h for h in m.hyb.rows if h["person_id"] in pair]
        assert k >= 1 and len(rows2) == 2 * k and {h["position"] for h in rows2} == {"1", "2"}
        m.set_person_kind("Test Person One", "organization", "unit test")
    assert m.validate() == []
    m.save()
    print("ok  relink an originator (one person, several people), kind, refusal of a repeat")
    shutil.rmtree(root, ignore_errors=True)
    print("all tests passed")


if __name__ == "__main__":
    main()
