# Saintpaulia Ancestry

## Goal
Turn an Excel spreadsheet and a SQLite database of African violet (Saintpaulia)
cultivars into a searchable online database. Others must be able to download the
database and front end, run it locally, and add their own hybridizing projects
and data. The site has two purposes:
1. Heritage search: African violet ancestry, lineage graphs, sports families.
2. Cultivar description list: browse/search cultivars by description,
   registration data, photos.
The core data point is the **cultivar name**.

## Language
- US English everywhere (schema, UI, descriptions): color, hybridizer, etc.
  The AVSA (African Violet Society of America) is the international registry.
- Source data uses UK spellings in places (SQLite columns `Hybridiser`, `Colour`);
  map them to US names on import. Never alter source text values.
- Terminology: **cultivar**, not "plant".

## Architecture decisions
- SQLite file is the single source of truth, built from Git-tracked CSVs in data/.
- Online: static site on GitHub Pages, SQLite in the browser (sql.js, or
  sql.js-httpvfs if the DB grows). Read-only. Images served via jsDelivr.
- Search: SQLite FTS4 (NOT FTS5: no sql.js build includes FTS5) over name, hybridizer,
  descriptions; no bm25, so the UI ranks name matches first; plus filterable
  columns (size class, registration year, sport or not, hybridizer).
  Lineage: recursive CTEs. Graph drawing: Cytoscape.js or D3.
- Front end has two entry points (cultivar browser/search, lineage view) that
  link to one shared cultivar page (description, registration, images,
  ancestry, sports family).
- Local: same front end plus a small launcher. User data lives in a separate
  mydata.sqlite, ATTACHed to the main DB; views union the two. IDs are slugs/UUIDs
  so user records never collide with official ones.
- Contributions: users export CSV and submit by pull request or form. A
  contributed cultivar may have a description with no ancestry, or vice versa.
- Keep it lightweight; no server-side write infrastructure for the hosted site.

## Source data (in source/, read-only, never edit)
### AfricanVioletAncestry.xlsx
- 6 sheets. Verified: `Name`, `Hybridizer`, `Seed Parent`, `Pollen Parent` hold
  identical records (3,025 rows each, only sort order/formatting differ). Import
  only `Name` (columns: Timestamp [hidden], Plant Name, Seed Parent,
  Pollen Parent, Hybridizer, Notes). Timestamps exist on only 67 rows.
- `about Saintpaulia Ancestry Proj`: project history prose; used as the site's
  project-history page.
- `Sports`: OUT OF SCOPE (superseded by the SQLite below).
### AfricanVioletAncestry.sqlite
- `Varieties` (1,298 rows; `SportsVarieties` is a copy): Name, Sport Parent,
  Hybridiser, Variety (size class), Colour, Bloom, Foliage, AVSA Registration,
  Date registered (m/d/yyyy text). Seed/Pollen Parent, Notes, Country,
  Available in are empty. `AVMVarieties`, `cultivar_main` are empty (ignore).
- Source for sports links, registration, size class and descriptions.
- Only ~269 names overlap with the xlsx `Name` sheet: records may have ancestry
  only, description only, or both.

### AV-MasterLIstSupplements/ (added after the above; scope under discussion)
- 2010-2019/: per year a PDF, per-page .txt, and AVML<year>.xlsx with the SAME 14
  columns as SQLite `Varieties`. 1,584 rows, 1,470 distinct names; no seed/pollen
  parents or sport parents. Notes column = provenance ("From the YYYY supplement",
  prefixes like "(Russ/Ukr)", "(DAVS 2010)", "(ANZ 659, 2009)").
- MasterListBook/: 180 OCR .txt pages of the 1963 AVSA "Master List of African
  Violets, 1935 to 1963" (Rector/Wright). Unstructured OCR text: NAME (Hybridizer)
  REG. - description. Needs parsing; not yet decided whether to import.

## Review decisions (reports/review/*.csv, filled in by the user; import must read these)
- sqlite_duplicates.csv: keep NameID 2156, 1732, 1804, 1419, 1518; drop 2157, 2375,
  2477, 1557, 2712. Where sources disagree on sport parent the SQLite wins
  (more recent); keep the xlsx value as a note.
- hybridizer_mapping.csv: `decision` column overrides `proposed_person(s)`.
  Organizations (e.g. Guelph University, Dibleys Nurseries) are people rows with
  the same registration rights as persons. "Species" stays as is (species get their
  own classification system later).

## Schema (starting point)
- people (id, name, country, aliases)
- cultivars (id slug, name, kind, sport_of_id, size_class, color, bloom_description,
  foliage_description, registration_no [unique when not null], registered_date
  [ISO], description, notes, source [xlsx|sqlite|both], source_row, added_at)
  - kind: cultivar | stub | seedling | species | unknown. The cultivar list
    shows kind=cultivar by default; the lineage graph shows all kinds.
  - color/bloom/foliage stay free text for now (structured fields later).
  - Names are not unique; slug gets a disambiguator when needed.
- cultivar_hybridizers (cultivar_id, person_id): many-to-many for co-hybridizers.
- parentage (child_id, parent_id, role seed|pollen|unordered, certainty
  known|assumed|unsure, raw_text). Placeholders produce no row; the original
  cell text is kept in raw_text.
- cultivar_links (cultivar_id, url, kind) for photo folders and web pages.
- images (cultivar_id, file, caption, credit NOT NULL, sort_order, width, height, source_url, added_at):
  metadata only. The files live in a separate repository (see Photos below).
- Parents with no row of their own become stub cultivars.
- Sports use `sport_of_id` (single parent, no seed/pollen split).

## Import rules
- Trim and normalise names (whitespace, NBSP, curly vs straight apostrophes,
  case); flag near-duplicates for human approval (never auto-merge fuzzy matches).
- Treat blank, "?", "—", "unknown", "(unreadable)", "(not listed)",
  "? (lost info)" as no parent, not as a cultivar.
- Numbered/named seedlings ("Seedling 136B") are kept as kind=seedling records.
- Short code names used as plant names in the Name sheet (2F, 3A, 69K, EW-7, FP8Y8, MB5) stay
  kind=cultivar (user decision); only n-nn-n codes and names starting "Seedling" become seedlings.
- Chiffon Prince and Chiffon Princess are separate cultivars (user decision).
- "Species" hybridizer stays as a people row for now (user will edit later).
- The 10 exact-duplicate xlsx records collapse to one each. Names that repeat
  with differing content are flagged for review.
- Pollen cell "sport of" and "X Sport" parents -> sport_of_id; cross-check
  against the SQLite Sport Parent column. (Confirm with user before relying on it.)
- Flag hybridizer spelling variants (e.g. Lebetskaia/Lebetskaya, Rienhardt forms).
  SQLite uses "Surname, Initial"; xlsx uses "Surname, Given".
- Embedded crosses in parent cells ("[A x B]") are kept as raw_text; decide
  handling after review.
- Keep Notes as free text until patterns deserve their own columns. Links in
  Notes go to cultivar_links.

## Repo layout
data/ (cleaned CSVs), scripts/ (inspect_excel.py, import_excel.py, build_db.py),
reports/ (generated inspection reports), site/ (front end, built .sqlite,
images/), source/ (originals), notes/, README.md. `.venv/` is local only.

## Status
- scripts/inspect_excel.py, scripts/propose_review.py: done (reports/).
- scripts/import_excel.py: done; writes data/*.csv + reports/import_flags.csv and
  import_summary.md. Reads reviewer decisions from reports/review/ (re-runnable;
  hybridizer_mapping.csv gets a `final_person(s)` column; name_near_misses.csv
  `merge` decisions are applied on the next run).
- Raw PDFs and OCR page text are git-ignored; cleaned data derived from them is not.
- Site text pages live in data/pages/<slug>.md (first line `# Title`, then paragraphs, `## ` headings,
  `- ` lists, **bold**, `code`, [links](url)); build_db.py loads them into the `pages` table. The
  Project history page (about.md) was rewritten by hand; it is NOT generated from the source xlsx.
- Site icon: cropped from source/lf3h_chlv_161216.jpg, a free-to-use illustration by brgfx from
  Magnific free vectors (https://www.magnific.com/free-vector). No attribution required (per user).
  Regenerate with scripts/make_icons.py (needs Pillow).
- Photos (decided with the user): files are hosted in a SEPARATE public repo
  Saintpaulia-Ancestry-Project/AncestrySearch-images, served through the jsDelivr CDN (base URL stored
  in the DB as meta.image_base_url; override with build_db.py --image-base-url). Layout there:
  photos/<cultivar-id>-<n>.webp (longest side 1600) and thumbs/<same name> (longest side 400).
  Metadata is data/images.csv (single source of truth; credit is REQUIRED on every photo).
  scripts/add_images.py FOLDER --credit NAME matches filenames to cultivars (exact name after
  normalising; never guesses), resizes, strips EXIF/GPS, skips duplicates, writes images.csv.
  Sources expected: user's own collection, contributors, hybridizers' Drive folders (19 cultivars
  currently link to Drive photo albums; they stay plain links until imported). First batch < 500.
  The images repo does not exist yet: the user creates it; clone it next to this folder (or set
  AV_IMAGES_REPO). jsDelivr caches @main for hours: purge via cdn.jsdelivr.net/gh/... if needed.
  Front end: gallery + enlarge viewer on the cultivar page, thumbnails and a Has photo filter in search.
- 1963 Master List (decided with the user). TWO independent OCRs: OCR 1 = HathiTrust page text in
  source/AV-MasterLIstSupplements/MasterListBook (raw, git-ignored; parsed by parse_masterlist1963.py, whose
  descriptions are often scrambled); OCR 2 = source/AVML1963_import.csv (re-read from the page images by the user;
  structured, with descriptions, intro year, HathiTrust page links). scripts/merge_masterlist1963.py uses OCR 2 as the
  primary text and OCR 1 as the cross-check, writes data/masterlist1963.csv (name, originator, REG., section, page,
  description, kind, ocr_check) and reports/masterlist1963_ocr_merge.md. A description is published only when the OCRs
  agree (verified / ocr1 incomplete / ocr1 had neighbour text) or a person corrected it in the review file. The
  source CSV's ocr_reviewed flag was set by a Claude session, NOT a person, and earns no shortcut. ~170 'unresolved'
  ones are WITHHELD and listed in reports/review/masterlist_ocr_review.csv with a page-scan link (also name,
  originator and registered-flag disagreements and entries found in only one OCR). Fill corrected_* or use=drop/keep
  there and re-run the merge. Names/descriptions inside the book's series lists and the 'No Description Available'
  lists come from OCR 1 only (names, no description). Scan sequence on HathiTrust = printed page + 2.
  IMAGE CHECK (done by Claude, source/PageImages = 175 page scans, git-ignored, 889 MB): every row of the review
  file was resolved by reading the scan (or by a mechanical rule). reports/review/masterlist_ocr_review.csv now has
  row_id (n<j> = entry j of AVML1963_import.csv, o<i> = OCR 1-only entry), corrected_name / _originator /
  _description / _registered, use, and check_status (claude: image agrees with OCR 1/2 | transcribed from image,
  please check | resolved by rule). Rows whose status says "please check" (36) are listed with scan links in
  reports/masterlist1963_needs_human.md: a person should verify those. Final ocr_check values in
  data/masterlist1963.csv: verified / ocr1 incomplete / ocr1 had neighbour text (OCRs agree), image-checked,
  image-transcribed (please check), series member (name only), ocr2 only, name list.
  HUMAN REVIEW (done by the user in reports/masterlist1963_human-review.md, applied with check_status
  "human: reviewed by the user"): all 36 "please check" rows are resolved. Decisions: (1) the user's wording is used
  AS WRITTEN even where it differs from the printed book (e.g. 'Pink double blossom', 'Girl foliage' for AVON,
  BEHNKE'S DOLLY MADISON, BEHNKE'S MARTHA WASHINGTON, BURGUNDY VELVET, DOLLY VARDEN (Hammond); the printed text is
  shorter, so those descriptions intentionally differ from the scan); (2) the originator is NOT part of the
  description text (BLUE CHARM: 'An improved Blue Delight.', originator Ulery); (3) the 11 LONGIFOLIA series names are
  left out (no description); (4) obvious typos (folliage, Redish) are fixed; (5) REG. printed on the page = registered
  (DOLLY MADISON, MARTHA WASHINGTON, LOLLIPOP).
  Lesson: the new OCR sometimes merged two entries (e.g. GYPSY MAIDEN + GYPSY MISS) and swapped descriptions
  between same-name entries (SNOWFLAKE x6, DOLLY VARDEN x3); same-name entries must be checked individually.
  import_excel.py then adds each plant as its own record: the same name+originator is one plant only when the
  descriptions agree (five different Amour plants), shown with everything else (user choice). A book entry joins an
  existing record automatically only when the originator agrees (28); every other name match is in
  reports/review/masterlist_matches.csv (decision column: `join`; includes the 1963 description). Book originators
  are kept as text (hybridizer_raw), not people. Species (16) become kind=species. Record ids for reused names carry
  the originator (stardust-madison). Columns: registered_1963, masterlist_1963, description.
  ORIGINATORS GIVEN AS TEXT (decided with the user): (1) a parent cell written 'Name (Originator)' (and
  'Sport of 'Name' (Originator)') is read as a name plus an originator: it is the existing record when the
  originators agree, else a separate parent record carrying the originator; a name match with no known hybridizer
  goes to reports/review/parent_originator_matches.csv (decision `join`). (2) The 1963 book's 509 originator strings
  (and bracketed parent originators) become people exactly as printed, so hybridizer pages exist; they are linked to
  an existing person ONLY where reports/review/originator_mapping.csv says so (decision `link`, or type the
  person's name(s) separated by ;), because a 1960s originator and a modern hybridizer can share a surname. The `kind`
  column there (person/organization) is editable. 'A & B' / 'A and B' split into two people; 'A&R' does not.
  Pipeline order: parse (cross-check only) -> merge_masterlist1963.py -> import_excel.py -> build_db.py.
  Search page: the checkbox "Exclude names found only in the 1963 Master List" is ON by default (URL param
  old=1 turns it off). It hides records whose only source is the 1963 list (view column only_1963), not the
  28 that joined other records. A hint offers the hidden matches when a search finds some.

- scripts/build_db.py: done; builds site/avancestry.sqlite from data/*.csv (tables,
  FTS4 `cultivars_fts`, views `edges`/`v_cultivar_list`/`v_parents`/`v_children`),
  validates (FKs, integrity, ancestry cycles, query templates) and writes
  site/queries.sql (search, ancestors, descendants, sport family, cultivar page).
- Pipeline: `import_excel.py` then `build_db.py`. Review inputs live in reports/review/
  (sqlite_duplicates, hybridizer_mapping, name_near_misses, data_corrections).
- data/description_split.csv (ONE-TIME result, reviewed by the user): color / bloom_description / foliage_description
  split out of the 1963 Master List `description` text (description itself unchanged; ~10,600 cultivars). The script
  that made it was deleted, so this file is now hand-maintained data: edit it directly. build_db.py fills those three
  fields from it only where the cultivar's own field is empty (source/contributor values win).
- Parents named "X Sport" are literal parent names; never infer a sport link or a
  sport's name from them (decision by user). Explicit sport markers only.

- site/ front end prototype: index.html, app.js, style.css, vendor/ (sql.js 1.12.0,
  Cytoscape 3.30.2, dagre, cytoscape-dagre, all vendored so it runs offline). Routes:
  #/ search, #/c/<id> cultivar + lineage graph, #/p/<id> hybridizer, #/about.
  Run locally: `python scripts/serve.py` (the DB cannot load from a file:// page).
  Graph caps fan-out at 8 children per parent ("+N more"); full lists are on the page.
  Tested with headless Edge screenshots only (no automated JS tests, no Node here).

- scripts/export_ancestry_xlsx.py: writes site/downloads/AfricanVioletAncestry.xlsx (COMMITTED so local clones have
  it; the Pages workflow also regenerates it; needs openpyxl. Re-run after every build_db.py that changes data). Sheets: Ancestry (every cultivar with >=1 parentage row; seed/pollen/other
  parent columns, '(unsure)'/'(assumed)' marks uncertain parents), Sports (every sport with its parent), About
  (date, counts, legend, CC BY 4.0). Listed on the #/downloads page (DOWNLOADS array in app.js; intro text in data/pages/downloads.md); the
  button appears only if the file exists.

## Before every push to main (deploy rule)
Pushing to main deploys the site. The Pages workflow rebuilds the database and spreadsheet itself, but local
clones use the COMMITTED copies, so whenever data/, scripts/build_db.py or the export changed, before pushing:
1. `python scripts/build_db.py` (must end with "All checks passed.")
2. `python scripts/export_ancestry_xlsx.py`
3. Commit site/avancestry.sqlite and site/downloads/AfricanVioletAncestry.xlsx with the data change.
Claude: remind the user of these steps (and do them, with approval to commit) whenever they ask to deploy or push.
Never push without being asked.

## To Do
- **Hector Wong archive** (source/Hector Wong Archive - SAP Saintpaulia Ancestry Project/, LOCAL ONLY, git-ignored,
  never published): the contents of Hector Wong's Google Drive for this project (~1,200 files, 275 MB: ~1,035 jpg,
  80 pdf, 31 msg, plus doc/docx/xls/xlsx/htm/png/txt). Top-level folders: Start of the project (1990s);
  CONFIDENTIAL AVSA Registration Applications (no. 9068 2001 to no. 10630 2013); Continuation of the project (2013s);
  Hybridizers participating; In the News; Photo contributions (SAP photos used with permission).
  (1) Go through it and write an index of what is there (folder, file, type, what it holds, usefulness).
  (2) Derive images for cultivars where possible: match photos to cultivars, then import with
  scripts/add_images.py (credit is REQUIRED per photo; "used with permission" must be confirmed per contributor
  before anything is published). Never publish or quote the CONFIDENTIAL registration applications.
  Write the index to reports/ or notes/ without copying confidential content into git-tracked files.

## Contributor submissions (decided with the user; full plan in notes/submission-form-plan.md)
Custom form `#/submit` (multi-cultivar batches) -> Google Apps Script receiver -> private Google Sheet as review inbox
(review is done in the Sheet) -> admin downloads CSV -> scripts/import_submissions.py -> data/submissions/<id>.csv
(tracked, no contact details) -> build_db.py. This Apps Script receiver is the one accepted exception to "no
server-side write infrastructure". Pipeline order: import_excel.py -> import_submissions.py -> build_db.py.
Status: scripts/submissions_lib.py, check_submissions.py and import_submissions.py (ingest | apply) are built and
tested with a sample batch. The #/submit form is built (site/submit.js, route in app.js, text in data/pages/contribute.md,
nav link 'Contribute'): multi-cultivar drafts in localStorage, parent autocomplete against the DB (ambiguous names
are written as id:<slug>), existing-name warning with 'add to this one', CSV download and re-open. Tested with a
headless-Edge script (not kept). The Send button (shown when SUBMIT_URL in submit.js is set) resizes photos
in the browser (JPEG, 1600 px, drops EXIF), POSTs text/plain JSON to the Apps Script receiver
(apps_script/Code.gs, setup in apps_script/README.md) and shows the result; tested with a mocked receiver and the
receiver's pure validation code in headless Edge. Deployed: SUBMIT_URL in submit.js is the live /exec URL; a live Send test
(Sheet row, email) passed.

## Next steps
1. User review of the prototype; decide look/feel and extra filters.
2. Local mode: mydata.sqlite for user data (sql.js cannot ATTACH files: plan a second
   in-memory DB and merge in JS, or load user CSVs).
3. Deploy to GitHub Pages; images via jsDelivr.
