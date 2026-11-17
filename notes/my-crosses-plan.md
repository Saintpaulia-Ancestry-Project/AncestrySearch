# "Saintpaulia Hybridizer": local-first PWA for hybridizers (planning, 2026-11-17; NOTHING BUILT YET)

Continuation of a separate planning chat. Its prompt asked for a private PWA that records crosses and seedlings on the user's own device, syncs
between the user's devices by a zip file, and later combines the data with the official read-only database. This note records what was checked
and what was decided with the user. It replaces the old "local mode" idea (mydata.sqlite + launcher) in CLAUDE.md "Next steps" once approved.

## Requirements kept from the prompt
Private by design (no analytics, no accounts, no network calls except loading the app and the official database); static site on GitHub Pages
(no server, no custom headers); same code on PC, macOS, Linux, Android, iPhone; do not break the existing site or scripts/serve.py.

## Checked (evidence)
- SQLite WASM docs (sqlite.org/wasm/doc/trunk/persistence.md): the `opfs-sahpool` VFS does NOT need COOP/COEP; the plain `opfs` VFS does (needs
  SharedArrayBuffer), so plain `opfs` cannot be used on GitHub Pages. sahpool: Worker-only, no concurrent connections (a second tab on the same
  origin fails to initialize), DB not visible as a normal OPFS file (so only an export is a real backup), Safari 16.4+ per the docs, iOS not
  mentioned; the docs also say users report OPFS databases "randomly disappearing". No IndexedDB VFS exists; the only other persistent VFS is
  kvvfs (about 5 MB, main thread only).
- From memory, NOT verified here: iOS Safari clears site storage after about 7 days of non-use unless the PWA is added to the Home Screen.
  Test on a real iPhone before relying on it. The sync zip must therefore double as the backup and the app should nag about it.
- Repo facts: no Node, npm or package.json on this machine; existing tests are Python; deploy workflow publishes only `site/`; serve.py sets
  no COOP/COEP headers (fine); sql.js 1.12.0 is vendored; site/submit.js already resizes photos in the browser (createImageBitmap with
  imageOrientation "from-image", JPEG, 1600 px, no EXIF); official ids are slugs; data/id_redirects.csv (167 renames/merges) is NOT in the shipped
  database.

## Decisions (user, 2026-11-17)
1. **Storage: IndexedDB as the source of truth for the user's records and photo blobs, sql.js in memory for queries.** At startup the user records
   are loaded into a small in-memory sql.js database next to the official one (a second DB or tables in the same engine, to be chosen in the
   spike), so ancestry queries can join both. No sqlite-wasm, no Worker, works on the main thread and in several tabs. Use IndexedDB
   transactions for every write. Call navigator.storage.persist() and show the result.
2. **Placement: subfolder of this repo (site/mycrosses/)** with its own manifest and service worker scope. Known downside accepted: same origin
   as the official site, so browser storage is shared. Mitigations to build in: a Content-Security-Policy meta tag on the app pages
   (`default-src 'self'; connect-src 'self'; img-src 'self' blob: data:`) so the app itself cannot send data anywhere; no third-party scripts
   on the origin; the Contribute form's localStorage keys are separate; the app never reads the official site's storage; state the origin
   limitation plainly in the app's privacy text.
3. **Tests: Node.** The user installs Node LTS (portable or `winget install OpenJS.NodeJS.LTS`). Tests run with the built-in `node --test`
   (no test framework dependency). The merge, validation and zip logic is plain ES modules with no DOM, so Node and the browser run the same code.
4. **Conflicts: per field.** Every mergeable field carries its own timestamp, so notes edited on one device and status edited on another both survive.
   A real conflict (same field changed on both sides after their common sync point) is resolved deterministically (later timestamp, then higher
   device_id) AND listed in the dry run.

## Design points to add to the prompt's schema (my recommendations, unless you object)
- **Clocks:** use a hybrid logical clock for field timestamps (max of device clock and the highest timestamp seen + a counter), so a phone with a
  wrong clock cannot overwrite newer edits silently. The dry run warns when an incoming timestamp is more than a day ahead of this device.
- **Incremental export** must not use updated_at (records relayed A to B to C keep old stamps). Add a local, never-exported `local_seq` that
  increases on every local change and on every import that changes a record; `sync_log` keeps the last local_seq sent to each peer. Importing
  twice is harmless, so exports may overlap.
- **Label collisions:** no stored flag; duplicates are computed (same cross_id and label, different id) and shown for the user to renumber.
- **Photos:** blobs in IndexedDB keyed by sha256 (full 1000 px and 300 px thumb), hash verified on import. A photo with no live seedling
  referencing it can be removed by an explicit "clean up photos" action.
- **Purge:** soft delete stays the rule for sync, plus a deliberate "erase permanently" that removes the record's content from this device
  (a tombstone with only id, updated_at, device_id, deleted stays so the erase propagates).
- **Zip handling:** a small vendored library (fflate, MIT) reading and writing entry by entry; JPEGs are stored, not compressed. Limits: max
  entries, max size per entry, total uncompressed size, reject names with `..`, absolute paths or backslashes. Scale test (3 crosses x 400
  seedlings with photos, about 200 MB) must report peak memory on the Android phone, not only in Node. Offer "data only" and "with thumbnails
  only" exports so a phone can sync notes without 200 MB.
- **Official refs:** ship an `id_redirects` table in site/avancestry.sqlite (small build_db.py change) so a saved seed_parent_ref keeps
  resolving after a rename or merge. Local ids are UUIDs (crypto.randomUUID, needs https or localhost).
- **Dependencies (planned):** fflate (MIT) for zip; sql.js (already vendored, MIT). Nothing else.

## Stages (revised; stop after 1 and 3 as in the prompt)
1. Report (this note + the spike): IndexedDB capacity test with 1,200 photos on the user's Android phone and PC; iPhone behavior if available;
   memory of building the zip; whether the in-memory user DB can sit beside the 38 MB official DB. Wait for approval.
2. Local schema and IndexedDB layer with the fields above.
3. Sync file (zip, manifest, JSONL per table) + dry run + one-transaction import; docs/sync-format.md; test page. Wait for review.
4. Tests (idempotence, convergence both ways, per-field conflict, delete propagation, label collision, duplicate photo, tampered photo, bad zips,
   scale report).

## Decisions, round 2 (user, 2026-11-17)
- **Name:** "Saintpaulia Hybridizer" (American spelling). Node LTS 26.13.1 installed with winget (npm 11.20.0); open a new terminal to get it on PATH.
- **Sync files** include THUMBNAILS by default; an option for a large sync includes all photos (full 1000 px). "Data only" stays available.
- **Official photos:** the official site's photos load only when the device is online. For the parents of a local cross the user can choose to keep that
  cultivar's photos on the device (a "keep offline" switch per parent). Those copies belong to the official-data cache, NOT to the user's records, and are
  NOT put in sync zips (the other device can fetch them itself).
- **Erase permanently with a safety net:** deleting moves a record to Trash (deleted=1 plus deleted_at). Trash shows what will be erased and when; Restore works for
  N days (default 30, user can change 7-90 or "never auto-erase"). After N days, or on "Empty trash now" behind a warning, the content is erased on this device and
  its photos are removed unless another record uses them; only a tombstone (id, deleted_at, erased=1) stays so the erase propagates to the other devices (each
  device erases when it receives the tombstone). Warn that backups and sync files saved earlier still contain the data.
- **id_redirects:** explained to the user (see chat); awaiting approval.

## Official (Ancestry) data in the app: three levels (user question Q1)
User data and official data are ALWAYS separate stores: the user's records in their own IndexedDB database; the official database in the browser cache. Nothing is
ever written into the official data, and sync zips contain only the user's data. They are joined only in memory. A setting "Ancestry data on this device":
1. **Online only** (default): nothing stored; the app downloads the database for the session when needed (38 MB, browser HTTP cache helps) or, if we add
   sql.js-httpvfs later, reads only the pages it needs. Offline, the app still shows each parent's name and basic facts, because the app stores a small
   snapshot (id, name, hybridizer, size, a short description, registration number) of every official cultivar the user has referenced. No ancestry graph offline.
2. **Data downloaded** (about 38 MB, no images): the whole database kept for offline use; an "Update available" prompt compares the database's built_at date; the user decides when to update.
3. **Data + images:** adds the photos we host (521 photos plus thumbnails; size to be measured, estimate 100 MB or less), either all of them or only the parents the user marked.
Photos that are only link-outs (AVSA Photo Gallery, Gesneriad Reference Web) can never be downloaded: we link only.

## Views (user question Q2; proposal, to be refined)
1. **Home:** counts by status; seedlings waiting to be evaluated (flowering, no decision); crosses with seeds sown but no seedlings entered; a backup/sync reminder.
2. **Crosses list:** one card or table row per cross: seed parent x pollen parent (names), date made, seeds sown, number of seedlings by status, a few thumbnails.
3. **Cross page:** parents shown with name, photo, link to the official cultivar page (when online) or the offline snapshot; dates and notes; the seedlings as a photo
   grid or as the table below; quick "add seedling" with the camera and "add N seedlings" in bulk; status changes in two taps.
4. **Seedling page:** photos, label, description, traits, status, notes, promoted name and the link to the official plant once released. A lineage graph (the
   existing Cytoscape view) that joins the local cross to the official ancestry of both parents.
5. **Parent picker:** search over official cultivars (same FTS search as the main site), the user's own seedlings, or "unknown".
6. **Search and filters:** one search box over crosses and seedlings (notes, description, label, parents' names, promoted name) plus filters: status, year, has photo, parent,
   and "has this cultivar as an ancestor" (a recursive query across the official and local parentage; needs level 2 or 3, or online). The search state lives in the URL hash.
   A cross is found by either parent's name in any order ("Baby Pink x Rob's" and "Rob's x Baby Pink" both find it) or by its own code.
7. **Spreadsheet view:** a table with one row per seedling, columns: cross, label, status, description, traits, date added, notes, promoted name; sortable, filterable,
   column chooser, group by cross, sticky first column and horizontal scroll on phones; a "Family" mode adds descendants (a promoted seedling used as a parent in a later
   cross) with a generation column. CSV export first; editing cells in the grid in a second step.

## Decisions, round 3 (user, 2026-11-17)
- **id_redirects:** approved and DONE in scripts/build_db.py (table `id_redirects(old_id, new_id, reason, date)` from data/id_redirects.csv, 166 rows; build checks:
  target exists, old id is no longer a cultivar, no chains). Not committed yet. The app resolves a saved ref through it and stores the parent's name beside the ref.
- **Cross identity:** every cross has its own unique id; a cross made again months later is a NEW cross with its own id (optional field `remake_of` = the earlier
  cross id, so the history can be shown). Plus a user-facing `code` (for example 26-014) per cross: the app suggests the next free one (year + running number, per
  device a different range is NOT used: duplicates are detected and flagged like label collisions, never overwritten).
- **Cross dates (crosses table):** `date_made` (date of cross), `date_harvested` (date seed harvested), `seed_stored` (0/1/null: the seed was stored; optional
  `storage_notes` for how, for example refrigerated), `date_sown` (date seed sown); plus `seeds_sown`, `notes`. Dates are plain local dates (YYYY-MM-DD), not timestamps.
- **Spreadsheet view is EDITABLE from the start** (hybridizers already keep their records in spreadsheets): click or tap a cell to edit, Tab/Enter move, paste
  from a spreadsheet, undo, add row, date and status pickers, validation. Each edit is a per-field change with its own timestamp (so it syncs like any other edit).
- **Family view** includes later generations: seedlings promoted to parents of new crosses are followed down, with a generation column.
- **Style:** the main site's look is the default; users can change the theme (to be designed, see below).

## Themes (proposal, to discuss)
- The main site already uses CSS custom properties (--bg, --surface, --text, --accent, ...) with a light set, a dark set that follows the device setting, and a manual
  data-theme="light|dark" override. The app reuses exactly these tokens, so every theme is just a set of token values.
- Built-in themes: **Match site (default; follows the device light/dark setting)**, Light, Dark, High contrast, and a few accent palettes (violet = the site, plus for example
  blue, green, rose). Optional: Custom (user picks accent and background; the app checks the contrast ratio and refuses unreadable combinations).
- Separate settings next to the theme: text size (small, normal, large), density (comfortable or compact; compact matters for the spreadsheet view) and "reduce motion".
- Stored per device (not synced; a phone and a PC may want different themes), kept in localStorage with a safe default if it is blocked.
- Applied by setting data-theme and data-accent on the root element before first paint (no flash). Theme definitions live in one themes.css (plain tokens), so a
  new theme is a few lines.
- Accessibility rules: status is never shown by color alone (text or icon in every status chip); every theme passes the WCAG AA contrast check (a Node test checks all
  built-in themes); focus outlines stay visible in all themes.
- Could the main site offer the same picker later? Yes, the tokens are shared (the main site would load the same themes.css). Not planned now.

## Decisions, round 4 (user, 2026-11-17)
- **Themes:** the built-in set is enough (Match site, Light, Dark, High contrast, accent palettes; text size, density, reduce motion). A Custom theme is a possible FUTURE option.
- **Cross code:** the hybridizer's initials, then the year, then a running number (for example GG-26-014); the app suggests the next free one and it stays editable. The
  initials are a setting on the device (default from the user's name, editable). Duplicates across devices are flagged, never overwritten.
- **Seed storage:** `seed_stored` (0/1/null) plus `stored_from` and `stored_to` (dates) and an optional `storage_notes`.

## Open questions (waiting on the user)
- How a promoted seedling becomes an official submission (later; reuse the #/submit CSV format).
- Next step: a revised prompt for Stages 1 to 4 (the other chat's prompt updated with all decisions in this note), then Stage 1 (spike + report).
