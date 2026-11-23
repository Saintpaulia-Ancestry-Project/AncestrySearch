"""Tests for the quick-add side of the submission pipeline (description split, listing_text column, ingest).
    .venv/Scripts/python scripts/test_submissions_quick.py"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_submissions as imp  # noqa: E402
import submissions_lib as sl  # noqa: E402


def check(label, got, want):
    assert got == want, f"{label}: got {got!r}, want {want!r}"


def test_split():
    check("simple", sl.split_description("Semidouble pink. Plain, quilted."), ("Pink", "Semidouble.", "Plain, quilted."))
    check("color first", sl.split_description("Pink double blossom. Girl foliage."), ("Pink", "Double blossom.", "Girl foliage."))
    check("two colors", sl.split_description("Semidouble pink/white star. Ruffled."), ("Pink/white", "Semidouble star.", "Ruffled."))
    check("modifier", sl.split_description("Single dark blue with white edge."), ("Dark blue", "Single with white edge.", ""))
    check("no color", sl.split_description("Double fringed."), ("", "Double fringed.", ""))
    check("empty", sl.split_description(""), ("", "", ""))
    check("only the color word", sl.split_description("Pink."), ("Pink", "Pink.", ""))


def test_columns():
    assert "listing_text" in sl.FIELDS and "listing_text" in sl.PUBLIC_COLS
    assert "corrected_listing_text" not in sl.SHEET_COLUMNS
    i = sl.SHEET_COLUMNS.index("listing_text")
    assert sl.SHEET_COLUMNS[i - 1] == "photo_permission" and sl.SHEET_COLUMNS[i + 1] == "decision"
    code = (Path(__file__).resolve().parents[1] / "apps_script" / "Code.gs").read_text(encoding="utf-8")
    for c in sl.SHEET_COLUMNS:
        assert f"'{c}'" in code, f"Code.gs COLUMNS lacks {c}"


def test_ingest_fills_split():
    tmp = Path(tempfile.mkdtemp(prefix="quick_ingest_"))
    old, old_root = sl.SUBDIR, sl.ROOT
    sl.SUBDIR = tmp
    sl.ROOT = tmp   # ingest prints paths relative to ROOT
    try:
        row = {c: "" for c in sl.SHEET_COLUMNS}
        row.update(submission_id="s-test-quick", entry_no="1", submitter_name="Test Person", agreed_license="yes", action="new",
                   name="Quick Test", kind="cultivar", description="Semidouble pink. Plain, quilted.", decision="accept",
                   listing_text="Quick Test Semidouble pink. Plain, quilted.")
        manual = dict(row, entry_no="2", name="Manual Test", listing_text="", decision="accept")
        fixed = dict(row, entry_no="3", name="Fixed Test", corrected_color="Rose", decision="accept")
        src = tmp / "export.csv"
        sl.write_csv(src, [row, manual, fixed], sl.SHEET_COLUMNS)
        imp.ingest(src)
        got = {r["name"]: r for r in sl.read_csv(tmp / "s-test-quick.csv")}
        check("quick color", got["Quick Test"]["color"], "Pink")
        check("quick bloom", got["Quick Test"]["bloom_description"], "Semidouble.")
        check("quick foliage", got["Quick Test"]["foliage_description"], "Plain, quilted.")
        check("description kept", got["Quick Test"]["description"], "Semidouble pink. Plain, quilted.")
        check("listing kept", got["Quick Test"]["listing_text"], "Quick Test Semidouble pink. Plain, quilted.")
        check("full-form row untouched", got["Manual Test"]["color"], "")
        check("reviewer's color wins", got["Fixed Test"]["color"], "Rose")
    finally:
        sl.SUBDIR, sl.ROOT = old, old_root


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
    print("All quick-add tests passed.")
