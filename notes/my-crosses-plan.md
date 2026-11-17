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

## Decisions, round 5 (user, 2026-11-17, from the first preview review)
- **Themes change the whole look (backgrounds, panels, text, borders, accent, status colors), not only text colors.** Default "Match site" (follows the device light/dark) plus SIX
  themes: Light, Dark, High contrast, Paper (warm cream, brown), Garden (pale green), Midnight (deep blue, dark). The separate Accent picker is dropped. Contrast of text, muted
  text, links and buttons passes WCAG AA (4.5:1) in every theme; status chip colors were adjusted until they passed on each theme's panels. A Node test will re-check the palettes.
- **Spreadsheet shows a thumbnail** of each seedling's first photo (a count badge; "+" opens the camera when there is none). Thumbnails load lazily and only the visible
  rows are rendered (virtual rows) so thousands of rows stay fast on a phone. Compact density uses smaller thumbnails.
- **Cross picker with search:** a plain list up to 20 crosses, a type-to-filter box above 20 (matches code, either parent, year; recent crosses first; shows seedling count). Used
  in Family mode and in "remake of". Needs full keyboard and screen-reader support (combobox pattern).
- **No "open from a web address".** Decided against it: it would force the app to be allowed to contact any site (weakening the "cannot send data anywhere" policy) and Google Drive,
  Dropbox and OneDrive links cannot be fetched by a web page anyway. Instead: the file chooser (which reaches Drive, Dropbox, OneDrive, iCloud and Downloads on phones) and, on Android,
  Web Share Target (installed PWA appears in the Share menu; needs the manifest `share_target` and a service worker; NOT available on iPhone).
- **Optional passphrase for sync files** (off by default): the zip is encrypted in the browser (WebCrypto AES-GCM, key from the passphrase with PBKDF2 or Argon2-class derivation,
  random salt and nonce stored in the file header, manifest format_version says "encrypted"). A lost passphrase means the file cannot be opened. To specify in docs/sync-format.md.

## Decisions, round 6 (user, 2026-11-17) - supersedes the theme list of round 5
- **Two separate choices:** **Mode** = Match device (default), Light, Dark, High contrast light (black on white), High contrast dark (white on black); and **Color scheme** =
  Violet (the site's own palette, default), Blue, Green, Red, Brown, Grey. Each scheme has a light and a dark version that change backgrounds, panels, text, borders and
  accent: Red is pinks for light and dark maroon for dark; Brown is cream/tan and deep brown; Grey is neutral; Blue is pale blue and navy; Green is pale green and deep green.
  High contrast uses the scheme only for its accent hue (in colors that pass 7:1). 24 palettes, all generated from one table and checked: AA 4.5:1 for light and dark,
  AAA 7:1 for both high contrast modes, covering text, muted text, links, button text and every status chip color on the scheme's background and panels. The check script
  (palettes.py in the preview work) becomes a Node test in the app. Implemented in the page as data-mode + data-scheme attributes on the root element.
- **Saving a sync file:** three buttons, each shown only if the device supports it, and the app itself never contacts any online service:
  1. "Save to..." = Web Share API with the file (phones; Windows and Mac Chrome/Edge/Safari): the OS share sheet lets the user pick Drive, Dropbox, OneDrive, iCloud, email.
  2. "Choose where to save..." = File System Access API showSaveFilePicker (Chrome and Edge on a computer; picks any folder, including a synced cloud folder).
  3. "Download" = plain download (works everywhere, the fallback).
  Using option 1 without a passphrase shows a warning that the file leaves the device; the passphrase checkbox sits just above the buttons. Share-sheet file size limits and phone memory
  must be tested in the storage tests (a 200 MB file may fail to share on some phones).

## Stage 1 storage tests: PC results (2026-11-17; Edge 157 on Windows, localhost, synthetic data)
Test page: site/spike-hybridizer/index.html (temporary, untracked; fflate 0.8.2 MIT vendored in site/spike-hybridizer/vendor/). Driven by notes-free Node script over the DevTools
protocol (headless Edge dump-dom cannot wait for IndexedDB; use CDP). Scale: 3 crosses, 1,200 seedlings, 1,200 photos (1000 px JPEG q0.82 + 300 px thumbnail).
- **IndexedDB:** 1,200 photos (178 MB full + 17 MB thumbnails, average 152 KB and 15 KB) stored in 4.2 s; 1,200 records written in 117 ms, all read in 21 ms, all updated in 123 ms.
  Quota was 10 GB, usage 198 MB. JS heap peaked at 47 MB (blobs live outside the JS heap). Making the photos took 58 ms each (dominated by JPEG encoding, synthetic images).
- **Sync zip (fflate, streamed, photos stored not compressed):** thumbnails-only 17.4 MB in 1.4 s (heap peak 20 MB); all photos 178.8 MB in 5.9 s (heap peak 53 MB). The zip is built from
  8 MB Blob parts so it never sits whole in JS memory.
- **Reading a zip back:** FINDING: fflate's streaming Unzip is NOT reliable for stored photos (it scans for a data-descriptor marker that can occur inside JPEG bytes): 2 hash mismatches
  and 1 garbage name in 1,200 photos, reproducibly. DECISION: read zips with a small central-directory reader (end record, then each entry by exact offset): 1,200/1,200 photos verified
  in 2.2 s, heap peak 65 MB; a flipped byte was detected; refused with clear messages: truncated file, not a zip, `../` names, absolute paths, backslash names, an entry bigger than the
  limit. Limits used: 20,000 entries, 60 MB per entry, 2 GB unpacked; zip64 refused. This code is the base for the real importer and its tests.
- **Official database and user data in ONE sql.js engine: works.** Official DB 36.7 MB: download 0.2 s (localhost), open 21 ms; user tables created inside the same in-memory database,
  1,203 rows inserted in 12 ms; a join resolving parents through `id_redirects` (an old id resolved correctly) in 1 ms; a recursive ancestor query across official and local edges in 26 ms;
  the existing FTS name search 8 ms; extra JS heap 42 MB. So the plan "user records live in IndexedDB, loaded into the same sql.js database as the official data" is confirmed on the PC.
- **Photo pipeline (self-test with a synthetic JPEG carrying an injected EXIF/GPS segment):** output has no EXIF/XMP/IPTC/comment segments (5 of 5). Rotation from the EXIF orientation tag still needs
  real phone photos (test 9 on the phone).
- **Not yet known (needs the phone):** real memory and speed on Android Chrome (and an iPhone, if available), whether navigator.storage.persist() is granted, the Share and Save buttons with a
  large file, real camera photos (orientation, speed), and the canary (open the page again after several days to see whether the stored data survived; mandatory on iPhone).
- Headless Edge: persist() returned false (not granted); normal browsers decide by their own rules (Chrome grants for installed or frequently used sites).

## Open questions (waiting on the user)
- How to run the phone tests (see chat). 
