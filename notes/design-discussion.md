Not automatically, as far as I know. Claude Code in VS Code works from the files in your repo and doesn't pull in your claude.ai chat history. I haven't checked the current docs, so verify that on Anthropic's site if it matters. Either way, the most reliable approach is to put what we've decided into a file in the repo, which Claude Code reads at the start of each session if you name it `CLAUDE.md`. It's also useful for human collaborators.

Here's a draft you can save as `CLAUDE.md` in the repo root:

```markdown
# Saintpaulia Ancestry

## Goal
Turn a complex Excel spreadsheet of African violet (Saintpaulia) hybrids into
a searchable online database. Others must be able to download the database and
front end, run it locally, and add their own hybridising projects and data.
Must support lineage graphs, plant photos, descriptions, registration data.

## Architecture decisions
- SQLite file is the single source of truth, built from Git-tracked CSVs in data/.
- Online: static site on GitHub Pages, SQLite in the browser (sql.js, or
  sql.js-httpvfs if the DB grows). Read-only. Images served via jsDelivr.
- Search: SQLite FTS5. Lineage: recursive CTEs. Graph drawing: Cytoscape.js or D3.
- Local: same front end plus a small launcher. User data lives in a separate
  mydata.sqlite, ATTACHed to the main DB; views union the two. IDs are UUIDs/slugs
  so user records never collide with official ones.
- Contributions: users export CSV and submit by pull request or form.
- Keep it lightweight; no server-side write infrastructure for the hosted site.

## Source spreadsheet
- 4 sheets, same columns, apparently the same records sorted four ways:
  - Name: Plant Name, Seed Parent, Pollen Parent, Hybridizer, Notes
  - Hybridizer / Seed Parent / Pollen Parent sheets: Timestamp + the same columns
- To verify: whether the sheets are identical (compare and report differences).
- Keep the original .xlsx in source/, read-only. Never edit it.

## Schema (starting point)
Tables: people, plants (id, name, hybridizer_id, is_stub, added_at, notes,
description, registration_no, registered_year), parentage (child_id, parent_id,
role seed/pollen, certainty), images (plant_id, url, caption, credit).
Parents that have no row of their own become stub plants.

## Import rules
- Trim and normalise names; flag near-duplicates for human approval.
- Treat blank, "?", "unknown" as no parent, not as a plant.
- Flag hybridizer spelling variants.
- Keep Notes as free text until we see which patterns (sports, registration
  numbers, dates) deserve their own columns.

## Repo layout
data/ (cleaned CSVs), scripts/ (import_excel.py, build_db.py), site/ (front end,
built .sqlite, images/), source/ (original xlsx), README.md

## Next steps
1. Write import_excel.py: compare the 4 sheets, produce a report of differences
   and name/hybridizer variants.
2. Review the report, then generate CSVs.
3. Write build_db.py to create the SQLite file; check it in a SQLite viewer.
4. Prototype the front end: search, plant page, lineage graph.
```

