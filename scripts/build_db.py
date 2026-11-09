"""Build site/avancestry.sqlite from the cleaned CSVs in data/.

The SQLite file is a derived artifact: delete and rebuild at any time.
Usage:  .venv\\Scripts\\python scripts\\build_db.py [--out PATH]

Creates tables (people, cultivars, cultivar_hybridizers, parentage, cultivar_links, images, meta),
an FTS4 index (cultivars_fts), convenience views, and writes site/queries.sql with the
lineage query templates the front end uses. Then validates: foreign keys, integrity, ancestry
cycles, FTS and recursive-query smoke tests.
"""
import argparse
import csv
import datetime
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEFAULT_OUT = ROOT / "site" / "avancestry.sqlite"
# Where the photo files are served from (the separate images repository, through the jsDelivr CDN).
# Override with --image-base-url or the AV_IMAGE_BASE_URL environment variable.
DEFAULT_IMAGE_BASE_URL = "https://cdn.jsdelivr.net/gh/Saintpaulia-Ancestry-Project/AncestrySearch-images@main/"

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE people (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('person','organization','species')),
  country TEXT,
  aliases TEXT
);

CREATE TABLE cultivars (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('cultivar','stub','seedling','species','unknown')),
  sport_of_id         TEXT REFERENCES cultivars(id),
  size_class          TEXT,
  color               TEXT,
  bloom_description   TEXT,
  foliage_description TEXT,
  registration_no     INTEGER UNIQUE,
  registered_year     INTEGER,
  registered_date     TEXT,
  description         TEXT,
  notes               TEXT,
  sources             TEXT,
  source_row          INTEGER,
  added_at            TEXT,
  seed_parent_raw     TEXT,
  pollen_parent_raw   TEXT,
  hybridizer_raw      TEXT,
  source_note         TEXT,
  supplement_year     INTEGER,
  registered_1963     INTEGER NOT NULL DEFAULT 0,  -- 1 = flagged REG. in the 1963 AVSA Master List
  masterlist_1963     TEXT,                        -- where the 1963 Master List lists it, e.g. "main list p. 14"
  CHECK (sport_of_id IS NULL OR sport_of_id <> id)
);

CREATE TABLE cultivar_hybridizers (
  cultivar_id TEXT NOT NULL REFERENCES cultivars(id),
  person_id   TEXT NOT NULL REFERENCES people(id),
  position    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (cultivar_id, person_id)
);

CREATE TABLE parentage (
  child_id  TEXT NOT NULL REFERENCES cultivars(id),
  parent_id TEXT NOT NULL REFERENCES cultivars(id),
  role      TEXT NOT NULL CHECK (role IN ('seed','pollen','unordered')),
  certainty TEXT NOT NULL CHECK (certainty IN ('known','assumed','unsure')),
  raw_text  TEXT,
  PRIMARY KEY (child_id, parent_id, role)
);

CREATE TABLE cultivar_links (
  cultivar_id TEXT NOT NULL REFERENCES cultivars(id),
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'web',
  PRIMARY KEY (cultivar_id, url)
);

-- Photos. The image files live in a separate repository (see meta.image_base_url):
--   <base>photos/<file>  full size    <base>thumbs/<file>  thumbnail
CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  cultivar_id TEXT NOT NULL REFERENCES cultivars(id),
  file        TEXT NOT NULL UNIQUE,
  caption     TEXT,
  credit      TEXT NOT NULL CHECK (length(trim(credit)) > 0),
  sort_order  INTEGER NOT NULL DEFAULT 1,
  width       INTEGER,
  height      INTEGER,
  source_url  TEXT,
  added_at    TEXT
);

CREATE TABLE pages (slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);

CREATE INDEX idx_cultivars_name      ON cultivars(name COLLATE NOCASE);
CREATE INDEX idx_cultivars_kind      ON cultivars(kind);
CREATE INDEX idx_cultivars_sport_of  ON cultivars(sport_of_id);
CREATE INDEX idx_cultivars_year      ON cultivars(registered_year);
CREATE INDEX idx_cultivars_size      ON cultivars(size_class);
CREATE INDEX idx_parentage_parent    ON parentage(parent_id);
CREATE INDEX idx_parentage_child     ON parentage(child_id);
CREATE INDEX idx_hybridizers_person  ON cultivar_hybridizers(person_id);
CREATE INDEX idx_images_cultivar     ON images(cultivar_id);

-- Full-text search. FTS4, not FTS5: the sql.js WebAssembly builds (which run this in the browser)
-- include FTS3/FTS4 but not FTS5. `id` and `kind` are stored but not indexed so the UI can filter by them.
CREATE VIRTUAL TABLE cultivars_fts USING fts4(
  id, kind,
  name, hybridizers, size_class, color, bloom_description, foliage_description, description, notes,
  notindexed=id, notindexed=kind,
  tokenize=unicode61 "remove_diacritics=2",
  prefix="2,3,4"
);

-- All lineage edges, parentage plus sport links, in one shape (child -> parent).
CREATE VIEW edges AS
  SELECT child_id, parent_id, role, certainty FROM parentage
  UNION ALL
  SELECT id, sport_of_id, 'sport', 'known' FROM cultivars WHERE sport_of_id IS NOT NULL;

CREATE VIEW cultivar_hybridizer_names AS
  SELECT ch.cultivar_id,
         group_concat(p.name, ' / ') AS hybridizers
  FROM (SELECT * FROM cultivar_hybridizers ORDER BY cultivar_id, position) ch
  JOIN people p ON p.id = ch.person_id
  GROUP BY ch.cultivar_id;

-- One row per cultivar for list/browse pages. Shows which kinds of data exist.
CREATE VIEW v_cultivar_list AS
  SELECT c.id, c.name, c.kind, c.size_class, c.color, c.registration_no, c.registered_year,
         coalesce(h.hybridizers, c.hybridizer_raw) AS hybridizers,
         (c.masterlist_1963 IS NOT NULL) AS in_masterlist_1963,
         (c.sources = 'masterlist1963') AS only_1963,
         c.registered_1963,
         (c.sport_of_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM cultivars s WHERE s.sport_of_id = c.id)) AS is_sport_family,
         (c.sport_of_id IS NOT NULL) AS is_sport,
         EXISTS (SELECT 1 FROM edges e WHERE e.child_id = c.id) AS has_ancestry,
         EXISTS (SELECT 1 FROM edges e WHERE e.parent_id = c.id) AS has_descendants,
         (c.bloom_description IS NOT NULL OR c.foliage_description IS NOT NULL
            OR c.color IS NOT NULL OR c.description IS NOT NULL) AS has_description,
         (SELECT i.file FROM images i WHERE i.cultivar_id = c.id ORDER BY i.sort_order, i.id LIMIT 1) AS photo,
         EXISTS (SELECT 1 FROM images i WHERE i.cultivar_id = c.id) AS has_photo
  FROM cultivars c
  LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id;

-- Direct relatives of a cultivar, for the cultivar page.
CREATE VIEW v_parents AS
  SELECT e.child_id, e.parent_id, p.name AS parent_name, p.kind AS parent_kind, e.role, e.certainty
  FROM edges e JOIN cultivars p ON p.id = e.parent_id;

CREATE VIEW v_children AS
  SELECT e.parent_id, e.child_id, c.name AS child_name, c.kind AS child_kind, e.role, e.certainty
  FROM edges e JOIN cultivars c ON c.id = e.child_id;
"""

QUERIES_SQL = """\
-- Lineage query templates for the front end (sql.js). Named parameters: :id, :max_depth, :q.
-- `edges` is child -> parent, covering seed/pollen/unordered parentage and 'sport' links.

-- 1. Search (FTS4, because sql.js has no FTS5). Build :q from the user's words as prefix terms, e.g.
--    "rob*" "sticky*"  (every word must match). FTS4 has no bm25, so rank names that start with the
--    first word ahead of other matches. :first is the first word, e.g. 'rob'.
SELECT l.id, l.name, l.kind
FROM cultivars_fts f JOIN v_cultivar_list l ON l.id = f.id
WHERE cultivars_fts MATCH :q
ORDER BY CASE WHEN l.name LIKE :first || '%' THEN 0 WHEN l.name LIKE '%' || :first || '%' THEN 1 ELSE 2 END,
         l.name COLLATE NOCASE
LIMIT 50;

-- 2. Ancestor graph: every edge reachable upward from :id (use :max_depth ~ 8 for drawing).
WITH RECURSIVE anc(child_id, parent_id, role, certainty, depth) AS (
  SELECT child_id, parent_id, role, certainty, 1 FROM edges WHERE child_id = :id
  UNION
  SELECT e.child_id, e.parent_id, e.role, e.certainty, anc.depth + 1
  FROM edges e JOIN anc ON e.child_id = anc.parent_id
  WHERE anc.depth < :max_depth
)
SELECT child_id, parent_id, role, certainty, MIN(depth) AS depth FROM anc
GROUP BY child_id, parent_id, role;

-- 3. Descendant graph: every edge reachable downward from :id.
WITH RECURSIVE dec(child_id, parent_id, role, certainty, depth) AS (
  SELECT child_id, parent_id, role, certainty, 1 FROM edges WHERE parent_id = :id
  UNION
  SELECT e.child_id, e.parent_id, e.role, e.certainty, dec.depth + 1
  FROM edges e JOIN dec ON e.parent_id = dec.child_id
  WHERE dec.depth < :max_depth
)
SELECT child_id, parent_id, role, certainty, MIN(depth) AS depth FROM dec
GROUP BY child_id, parent_id, role;

-- 4. Sport family: walk up from :id to the original cultivar, then list it and every sport beneath it.
WITH RECURSIVE up(id) AS (
  SELECT :id
  UNION
  SELECT c.sport_of_id FROM cultivars c JOIN up ON c.id = up.id WHERE c.sport_of_id IS NOT NULL
), fam(id, depth) AS (
  SELECT c.id, 0 FROM up JOIN cultivars c ON c.id = up.id WHERE c.sport_of_id IS NULL
  UNION
  SELECT c.id, fam.depth + 1 FROM cultivars c JOIN fam ON c.sport_of_id = fam.id
)
SELECT c.id, c.name, c.sport_of_id, fam.depth FROM fam JOIN cultivars c ON c.id = fam.id
ORDER BY fam.depth, c.name;

-- 5. Nodes for drawing: after running query 2 or 3, fetch details for the ids it returned
--    (:id plus every child_id / parent_id in the edge list), e.g. with a prepared IN (...) list:
--    SELECT id, name, kind, registration_no, sport_of_id FROM cultivars WHERE id IN (...);

-- 6. Cultivar page: the cultivar, its hybridizers, parents and direct children.
SELECT c.*, h.hybridizers FROM cultivars c
LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id WHERE c.id = :id;
SELECT * FROM v_parents WHERE child_id = :id ORDER BY role;
SELECT * FROM v_children WHERE parent_id = :id ORDER BY child_name;
"""


def read(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_pages():
    """data/pages/<slug>.md: first line '# Title', the rest is the body. Returns (slug, title, body) rows."""
    rows = []
    for f in sorted((DATA / "pages").glob("*.md")):
        text = f.read_text(encoding="utf-8").strip()
        m = re.match(r"#\s+(.+?)\s*\n(.*)", text, re.S)
        title, body = (m.group(1), m.group(2).strip()) if m else (f.stem.replace("-", " ").title(), text)
        rows.append((f.stem, title, body))
    return rows


def nz(v):
    v = (v or "").strip()
    return v if v else None


def to_int(v):
    v = nz(v)
    return int(v) if v is not None else None


def find_cycles(con):
    """Iterative DFS over child -> parent edges. Returns a list of cycles (as id lists)."""
    adj = {}
    for c, p in con.execute("SELECT child_id, parent_id FROM edges"):
        adj.setdefault(c, []).append(p)
    WHITE, GREY, BLACK = 0, 1, 2
    color = {}
    cycles = []
    for start in list(adj):
        if color.get(start, WHITE) != WHITE:
            continue
        stack = [(start, iter(adj.get(start, [])))]
        path = [start]
        color[start] = GREY
        while stack:
            node, it = stack[-1]
            for nxt in it:
                st = color.get(nxt, WHITE)
                if st == WHITE:
                    color[nxt] = GREY
                    path.append(nxt)
                    stack.append((nxt, iter(adj.get(nxt, []))))
                    break
                if st == GREY:
                    cycles.append(path[path.index(nxt):] + [nxt])
            else:
                color[node] = BLACK
                path.pop()
                stack.pop()
    return cycles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--image-base-url", default=os.environ.get("AV_IMAGE_BASE_URL", DEFAULT_IMAGE_BASE_URL))
    ap.add_argument("--images-csv", default=str(DATA / "images.csv"))
    args = ap.parse_args()
    out = Path(args.out)
    image_base = args.image_base_url if args.image_base_url.endswith("/") else args.image_base_url + "/"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".building")
    if tmp.exists():
        tmp.unlink()

    con = sqlite3.connect(tmp)
    try:
        con.executescript(SCHEMA)
    except sqlite3.OperationalError as e:
        sys.exit(f"SQLite build lacks FTS4 or schema failed: {e}")

    people = read("people.csv")
    cultivars = read("cultivars.csv")
    ch = read("cultivar_hybridizers.csv")
    par = read("parentage.csv")
    links = read("cultivar_links.csv")

    with con:
        con.executemany("INSERT INTO people VALUES (?,?,?,?,?)",
                        [(p["id"], p["name"], p["kind"], nz(p["country"]), nz(p["aliases"])) for p in people])
        # parents first is not required (FKs are checked at commit, deferred below)
        con.execute("PRAGMA defer_foreign_keys = ON")
        cols = list(cultivars[0].keys())
        int_cols = {"registration_no", "registered_year", "source_row", "supplement_year", "registered_1963"}
        con.executemany(
            f"INSERT INTO cultivars ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [tuple((to_int(c[k]) or 0) if k == "registered_1963" else (to_int(c[k]) if k in int_cols else nz(c[k]))
                   for k in cols) for c in cultivars])
        con.executemany("INSERT INTO cultivar_hybridizers VALUES (?,?,?)",
                        [(r["cultivar_id"], r["person_id"], int(r["position"])) for r in ch])
        con.executemany("INSERT INTO parentage VALUES (?,?,?,?,?)",
                        [(r["child_id"], r["parent_id"], r["role"], r["certainty"], nz(r["raw_text"])) for r in par])
        con.executemany("INSERT INTO pages VALUES (?,?,?)", read_pages())
        images_csv = Path(args.images_csv)
        if images_csv.exists():
            with open(images_csv, newline="", encoding="utf-8") as f:
                rows = list(csv.DictReader(f))
            con.executemany(
                "INSERT INTO images (cultivar_id, file, caption, credit, sort_order, width, height, source_url, added_at)"
                " VALUES (?,?,?,?,?,?,?,?,?)",
                [(r["cultivar_id"], r["file"], nz(r["caption"]), r["credit"], to_int(r["sort_order"]) or 1,
                  to_int(r["width"]), to_int(r["height"]), nz(r["source_url"]), nz(r["added_at"])) for r in rows])
        con.executemany("INSERT INTO cultivar_links VALUES (?,?,?)",
                        [(r["cultivar_id"], r["url"], r["kind"]) for r in links])
        con.execute("""
            INSERT INTO cultivars_fts (id, kind, name, hybridizers, size_class, color, bloom_description,
                                       foliage_description, description, notes)
            SELECT c.id, c.kind, c.name,
                   trim(coalesce(h.hybridizers, c.hybridizer_raw, '') || ' ' || coalesce((
                       SELECT group_concat(p.aliases, ' ') FROM cultivar_hybridizers x
                       JOIN people p ON p.id = x.person_id WHERE x.cultivar_id = c.id AND p.aliases IS NOT NULL), '')),
                   c.size_class, c.color, c.bloom_description, c.foliage_description, c.description, c.notes
            FROM cultivars c LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id""")
        con.execute("INSERT INTO cultivars_fts(cultivars_fts) VALUES ('optimize')")

    # ------------------------------------------------------------ validation
    problems = []
    fk = con.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        problems.append(f"foreign key violations: {len(fk)} (first: {fk[:3]})")
    ic = con.execute("PRAGMA integrity_check").fetchone()[0]
    if ic != "ok":
        problems.append(f"integrity_check: {ic}")
    cycles = find_cycles(con)
    if cycles:
        problems.append(f"{len(cycles)} ancestry cycle(s), e.g. {' -> '.join(cycles[0])}")

    one = lambda sql, *a: con.execute(sql, a).fetchone()[0]
    counts = {t: one(f"SELECT count(*) FROM {t}") for t in
              ("cultivars", "people", "parentage", "cultivar_hybridizers", "cultivar_links", "images", "cultivars_fts")}
    if counts["cultivars_fts"] != counts["cultivars"]:
        problems.append("FTS row count differs from cultivars")
    if counts["cultivars"] != len(cultivars) or counts["parentage"] != len(par):
        problems.append("row counts differ from CSV")

    # smoke tests of the query templates
    sample = con.execute("""
        SELECT child_id FROM edges GROUP BY child_id
        ORDER BY count(*) DESC, child_id LIMIT 1""").fetchone()[0]
    rec_anc = con.execute("""
        WITH RECURSIVE anc(child_id, parent_id, depth) AS (
          SELECT child_id, parent_id, 1 FROM edges WHERE child_id = ?
          UNION SELECT e.child_id, e.parent_id, anc.depth+1 FROM edges e JOIN anc ON e.child_id = anc.parent_id
          WHERE anc.depth < 12)
        SELECT count(*), max(depth) FROM anc""", (sample,)).fetchone()
    deepest = con.execute("""
        WITH RECURSIVE anc(root, id, depth) AS (
          SELECT id, id, 0 FROM cultivars WHERE kind='cultivar'
          UNION ALL SELECT anc.root, e.parent_id, anc.depth+1 FROM anc JOIN edges e ON e.child_id = anc.id
          WHERE anc.depth < 25)
        SELECT root, max(depth) d FROM anc GROUP BY root ORDER BY d DESC LIMIT 1""").fetchone() if not cycles else None
    fts = con.execute("SELECT count(*) FROM cultivars_fts WHERE cultivars_fts MATCH ?", ('"rob*" "sticky*"',)).fetchone()[0]
    fts2 = con.execute("SELECT name FROM cultivars_fts WHERE cultivars_fts MATCH ? ORDER BY name LIMIT 3", ('"lavender*" "ruffled*"',)).fetchall()

    sport_sample = one("SELECT id FROM cultivars WHERE sport_of_id IS NOT NULL ORDER BY id LIMIT 1")
    ran = 0
    for stmt in QUERIES_SQL.split(";"):
        body = " ".join(l for l in stmt.splitlines() if not l.lstrip().startswith("--")).strip()
        if not body:
            continue
        try:
            con.execute(body, {"id": sport_sample if "sport_of_id IS NULL" in body else sample,
                               "max_depth": 8, "q": '"sticky*"', "first": "sticky"}).fetchall()
            ran += 1
        except sqlite3.Error as e:
            problems.append(f"queries.sql template failed: {e}: {body[:60]!r}")

    now = datetime.datetime.now().replace(microsecond=0).isoformat(sep=" ")
    con.executemany("INSERT INTO meta VALUES (?,?)", [
        ("built_at", now), ("schema_version", "3"), ("image_base_url", image_base),
        *[(f"count_{k}", str(v)) for k, v in counts.items()]])
    con.commit()
    con.execute("VACUUM")
    con.close()
    os.replace(tmp, out)
    (out.parent / "queries.sql").write_text(QUERIES_SQL, encoding="utf-8")

    kinds = dict(sqlite3.connect(out).execute("SELECT kind, count(*) FROM cultivars GROUP BY kind").fetchall())
    print(f"Built {out}  ({out.stat().st_size/1024:.0f} KB)")
    print("rows:", counts)
    print("cultivars by kind:", kinds)
    print(f"smoke: ancestors of {sample!r}: {rec_anc[0]} edges, depth {rec_anc[1]}; "
          f"deepest cultivar lineage: {deepest}; fts 'rob* sticky*': {fts} hits; "
          f"'lavender ruffled' first: {[r[0] for r in fts2]}")
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print(" -", p)
        sys.exit(1)
    print(f"query templates executed: {ran}")
    print("All checks passed.")


if __name__ == "__main__":
    main()
