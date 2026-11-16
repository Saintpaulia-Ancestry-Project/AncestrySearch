"""Fingerprint of site/avancestry.sqlite for the phase 2 migration checks (notes/freeze-plan.md): per table the row count and a
SHA-256 over the sorted rows, so two builds can be compared without comparing file bytes (build dates etc. differ).
    python scripts/db_fingerprint.py [DB] [--save FILE] [--compare FILE]
"""
import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path

SKIP = {"meta"}                     # build time, version strings
SKIP_PREFIX = ("cultivars_fts",)    # FTS shadow tables hold index internals


def fingerprint(db):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    out = {}
    for (name,) in con.execute("select name from sqlite_master where type in ('table','view') order by name"):
        if name in SKIP or name.startswith(SKIP_PREFIX):
            continue
        h = hashlib.sha256()
        n = 0
        rows = con.execute(f'select * from "{name}"')
        for r in sorted(rows.fetchall(), key=lambda r: tuple("" if v is None else str(v) for v in r)):
            h.update(repr(r).encode("utf-8"))
            n += 1
        out[name] = {"rows": n, "sha256": h.hexdigest()[:16]}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("db", nargs="?", default=str(Path(__file__).resolve().parents[1] / "site" / "avancestry.sqlite"))
    ap.add_argument("--save")
    ap.add_argument("--compare")
    a = ap.parse_args()
    fp = fingerprint(a.db)
    if a.save:
        Path(a.save).write_text(json.dumps(fp, indent=1, sort_keys=True), encoding="utf-8")
        print(f"saved {len(fp)} tables to {a.save}")
    if a.compare:
        base = json.loads(Path(a.compare).read_text(encoding="utf-8"))
        bad = [t for t in sorted(set(base) | set(fp)) if base.get(t) != fp.get(t)]
        for t in bad:
            print("DIFFERENT", t, base.get(t), fp.get(t))
        print("identical" if not bad else f"{len(bad)} table(s) differ")
        return 1 if bad else 0
    if not (a.save or a.compare):
        for t, v in fp.items():
            print(t, v["rows"], v["sha256"])


if __name__ == "__main__":
    sys.exit(main())
