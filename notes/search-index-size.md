# Search index size (2026-11-18)

Why: the site downloads the whole database on every visit that is not served from the browser cache (about 20 s on a slow connection).

Change (build_db.py): the FTS4 table `cultivars_fts` is now **contentless** (`content=""`), has no `id`/`kind` columns and no prefix index.
It answers MATCH and gives the docid (= `cultivar_list.rowid`); the text lives in `cultivars`/`cultivar_list`.

Measured (experiment on the real data, then the real build):

| | database | on the wire (gzip) |
|---|---|---|
| before | 36.7 MB | 10.5 MB |
| after | 22.4 MB | 6.7 MB |

- 290 searches (words, prefixes, column filters, accents) returned identical id lists before and after; 8 searches and the advanced search ran in headless Edge without errors.
- Search time: about 7 ms for ten typical searches in SQLite (was 4 ms); not noticeable.
- Rules for the contentless table: never SELECT a column from `cultivars_fts` (it returns NULL), never UPDATE or DELETE rows in it, count rows through `cultivars_fts_docsize`.
- `PRAGMA integrity_check` cannot validate a contentless index, so build_db.py ignores that one message and checks the row count and the search smoke tests instead.
- Prefix searches (`ba*`) use no prefix index now; at 31,600 records they still take a few milliseconds.

## Split into two files (2026-11-18)
The 19,848 records hidden by default (12,543 only in the 1963 list, 7,305 old unregistered supplement-only names) are no parent, child or
sport of anything, so they live in a second file.
- `site/avancestry.sqlite` = everything else (11.2 MB, 3.4 MB gzip); `site/avancestry-old.sqlite` = those names (11.5 MB, 3.4 MB gzip).
  The page opens on the first file and loads the second in the background (low priority), then ATTACHes it and creates TEMP views with the
  table names (cultivars, cultivar_list, cultivar_hybridizers, cultivar_links, external_photos, images, plus the database's own views), so
  the rest of the code is unchanged. Searches build one subquery per file's index and UNION ALL them.
- A page that needs the old names before they arrive (an old record, a hybridizer page, `old=1` / `supp=1`) shows "Loading the older names" with a bar.
  The file is fetched as `avancestry-old.sqlite?v=<built_at>` so it always matches the main file.
- `python scripts/build_db.py --full` writes ONE complete database instead (the page works with it too: meta `part` is absent).
- `cultivar_list` now has an explicit `rid INTEGER PRIMARY KEY` (the FTS docid); plain rowids can be renumbered by VACUUM.
- Header numbers (cultivars / older names counts) come from meta (stat_*) so they do not depend on the second file.
- Search results are now ordered by name THEN id (ties were unordered, which could repeat or drop a record across pages).
- Tested: counts add up to the full database; 288 index searches identical; 114 pages (searches, filters, advanced, cultivar, hybridizer) in headless Edge
  identical to the full database with the old names loaded; cold path (old record opened before the second file arrived) loads it and shows the page.
- Not covered: the contribution form's parent autocomplete and "name already exists" warning only see old names once the background load finished.
- Time to first page at the speed measured in the office (about 0.7 MB/s on the wire): 10.5 MB -> 3.4 MB, about 15 s -> 5 s.
