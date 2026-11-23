# "Saintpaulia Hybridizer": local-first PWA for hybridizers (planning 2026-11-17; stage 2 data layer built 2026-11-23, no screens yet)

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
2. Local schema and IndexedDB layer with the fields above. **DONE 2026-11-23** (uncommitted until approved): site/mycrosses/js/core/ (clock, ids, schema, validate, repo, codes, hash, persistence, adapters memory + idb), docs/hybridizer-data-model.md, 29 tests in site/mycrosses/test/ (`node --test site/mycrosses/test/` and test/browser.html on real IndexedDB; both 29/29; four deliberate code breaks were each caught). WAITING for review before stage 3 (sync file).
3. Sync file (zip, manifest, JSONL per table) + dry run + one-transaction import; docs/sync-format.md; test page. Wait for review. **BUILT 2026-11-23** (uncommitted): site/mycrosses/js/sync/ (zip.js writer+central-directory reader with no dependencies, crypto.js passphrase option, format.js, merge.js, export.js, import.js), docs/sync-format.md, test page site/mycrosses/sync-test.html (export Save/Share/Download, import with dry-run summary), and the stage 4 tests in site/mycrosses/test/sync.suite.js: 52 tests in total pass in Node and on real IndexedDB in Edge. Seven deliberate breaks were each caught. A sync file from Python's zipfile reads, and ours passes `zipfile.testzip()`. Scale (3 crosses x 400 seedlings, 402 photos): thumbnails file 0.61 MB, all-photos file 3.5 MB (synthetic 20 KB photos), apply 0.5 s in Node, 4.4 s on IndexedDB. WAITING for review before the app screens.
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
## Stage 1 storage tests: ANDROID results (2026-11-17; Android 10, Chrome 157, 4 GB RAM, 8 cores, live https page, Wi-Fi or mobile data)
- Everything ran to the end at full scale; no crash, no reload. IndexedDB quota 10 GB (same as the PC).
- 1,200 photos made, hashed and stored in 132 s (110 ms each; encoding dominated; average 152 KB and 14 KB, 197 MB stored); records: write 238 ms, read all 29 ms, update all 250 ms.
- Zip: thumbnails 17.2 MB in 4.8 s; all photos 178.3 MB in 7.8 s. Reading back by central directory: 1,200/1,200 verified in 6.6 s, tamper detected, all six bad-file cases refused.
  The streaming reader failed again (4 mismatches and 2 bad names in 1,200): confirms the decision to read by central directory.
- Official database 36.7 MB: download 17.8 s on the phone's connection (!), open 46 ms, a join through id_redirects 3 ms, a recursive ancestor query across official and local data 55 ms, FTS search 21 ms.
  So one sql.js engine for both data sets works on the phone; the download time is what matters: cache the database in the browser (Cache Storage, with a version check against meta.built_at) and
  show progress; "Online only" must mean "download once per update", not once per visit.
- navigator.storage.persist() was NOT granted (persisted false before and after). Chrome decides by engagement (installed to the Home Screen, bookmarked, regular use). Consequence: the app
  asks again after install, explains in plain words, and the backup reminder is essential (a visible "last backup" age on the home screen, as in the preview).
- JS heap reading was flat at 9.5 MB on Android (performance.memory is coarse there), so memory could not be measured precisely; the real evidence is that the 178 MB build and read-back completed.
- STILL MISSING from this paste: the Share / Save / Download results (they appear in the results only after the buttons are pressed), test 9 with real camera photos (rotation, metadata removal),
  the canary check after several days, and an iPhone.

- **Original list of unknowns (kept for reference):** real memory and speed on Android Chrome (and an iPhone, if available), whether navigator.storage.persist() is granted, the Share and Save buttons with a
  large file, real camera photos (orientation, speed), and the canary (open the page again after several days to see whether the stored data survived; mandatory on iPhone).
- Headless Edge: persist() returned false (not granted); normal browsers decide by their own rules (Chrome grants for installed or frequently used sites).

## Android: real photos and sharing (2026-11-17)
- **Picking files:** reading the photos failed with NotReadableError when they were chosen with the GALLERY picker (`<input type=file accept="image/*">`, box A); it WORKED with the system FILE
  BROWSER picker (`<input type=file>` without accept, box B): 9 of 9 copied into memory at selection time. DESIGN CONSEQUENCE: copy a chosen file into memory immediately on the change event
  (never read it later); offer the camera (`capture`, box C, test pending) and the file browser as the ways to add photos; do not rely on the gallery picker on Android 10.
- **Photo pipeline on real camera photos (9 photos, 0.6 to 2.2 MB, 12 MP class phone):** metadata removed in 9 of 9 (all had EXIF; none left in the output); portraits come out upright (decoded
  as 2085x2794, 2296x4080 and so on, resized to 746x1000, 563x1000); 123 to 218 ms each (average 171 ms); outputs are SMALL: 45 to 91 KB full size and 15 to 31 KB thumbnails, so the real storage need
  is far below the synthetic test (1,200 photos is about 90 MB, not 180 MB; a "large" sync of all photos is about 90 MB).
- **Share of a zip FAILED:** `navigator.share({files:[zip]})` gave NotAllowedError "Permission denied" although canShare() said true. Chrome only allows a short list of file types in the share sheet
  (images, audio, video, text, PDF...), probably not zip. Test page now has variants (octet-stream, no type, text file, photo) to find out what works. If no zip variant works the Share button is replaced
  by Download plus "open your Downloads in the Files app and share from there" (or the passphrase-protected file saved to a cloud folder through the Files app), and the preview text must say so.

## Android: second round (2026-11-17) - supersedes the first-round file picking and share notes
- **Picking photos:** with copy-at-selection (read the file into memory in the `change` event) ALL THREE routes worked: gallery picker (7 of 7), file browser (9 of 9) and camera (1 of 1). The first failure
  was reading the file later, after the picker had given it up. A camera photo (1.5 MB, 2296x4080) came out upright at 563x1000, EXIF removed, in 292 ms.
- **Sharing a zip does not work on Android Chrome:** NotAllowedError "Permission denied" for application/zip, application/octet-stream and an empty type, while a text file and a photo shared fine (so the
  .zip file extension itself is blocked by the browser; canShare() wrongly says true, so it cannot be used to detect this). The File System Access SAVE dialog worked ("saved") and so did Download.
- **DESIGN (supersedes round 6 buttons):** **Save...** (showSaveFilePicker where it exists; the system dialog reaches Drive and other apps) is the main button; **Share...** is shown only where a zip is
  accepted (to be tested on iPhone, Mac, Windows; hide it after the first NotAllowedError and remember that); **Download** is the fallback everywhere. The preview's Sync page now says this.

## Getting data from the phone to the PC without e-mail (discussion and decisions, 2026-11-17)
Principle (user): content added on the phone must be usable on the PC/Mac. Answers: the PC has NO webcam (or none wanted), cloud = Google Drive, phone and PC are normally on the SAME Wi-Fi at
home, PC browser = Chrome or Edge.
- **Route A, main: Google Drive folder.** Phone: Save... (the system save dialog worked on Android and reaches Drive); the file name is stable per device (my-hybridizer-<device>.zip) so each device
  writes its own file and reads the others' (no overwrite conflicts). PC: the app asks for the folder ONCE (showDirectoryPicker, handle kept in IndexedDB, permission re-requested with one click per
  session), then "Sync" reads the newest file of each other device automatically. The PC can use the Drive for desktop folder or any folder. Test page has "Choose folder / Reuse saved folder" to see
  whether Chrome/Edge keep the permission between sessions. Phone cannot pick a folder (no showDirectoryPicker on Android): it uses the save dialog each time.
- **Route B, bonus: direct link over home Wi-Fi (WebRTC data channel, no server, no STUN).** Loopback test: link in 0.2 s, 6 MB/s; each side's connection text is only about 590 characters
  (one mDNS host candidate), small enough for a QR code. With no PC webcam the pairing is: PC shows a QR, the phone scans it (or the text is copied once), the phone shows its answer, which must get
  back to the PC as text (paste or a short typed code). To test on the real devices (test page buttons). May fail on Wi-Fi with client isolation; never the only route.
- **Route C: QR streams** only for text changes (about 2.9 KB per code; a thumbnail would need 6 to 10 codes, so photos cannot travel this way); the PC cannot receive them without a webcam: DROPPED
  as a receiving route; the phone may still scan a code shown on the PC screen (used for pairing in route B).
- **Not chosen:** data hidden in a PNG (looks like noise in the gallery, gets uploaded with photo backups, apps may recompress it); copy and paste through a messenger (only text, and an extra service);
  e-mail. USB cable remains a documented offline fallback.
- **Share of a zip on Android:** extra test "share the zip named .zip.txt as text/plain" (Chrome only allows some file extensions). If it works, Share returns on Android; if not, the plan stands.

## Android: third round (2026-11-17)
- **Sharing works if the zip is named `<name>.zip.txt` and typed `text/plain`** (the earlier refusals were about the .zip extension). So Android gets a working **Share...**: the app shares
  `my-hybridizer-<date>.zip.txt`; the importer accepts both `.zip` and `.zip.txt` (it checks the content, not the name). Not yet tried: what Drive or other apps do with the odd name (they just store it).
- **showDirectoryPicker EXISTS on Android Chrome 157**: the phone chose a folder ("Hybridzer"), wrote a file into it and saved the handle. So the phone can also use the "remembered folder" route
  (open question: is the permission kept after the browser is closed? "Reuse saved folder" must be tried on the phone and on the PC after a restart).
- **Direct link works on the user's home Wi-Fi:** the phone produced an answer of 567 characters with a real LAN address (192.168.0.121, not an mDNS name), and the connection reached
  `connected`, ICE `connected`, data channel `open`. Throughput not yet measured on real devices (loopback was 6 MB/s).
- The gallery picker works with copy-at-selection (3 of 3); real photos again upright, metadata removed (228 ms each).
- STILL NEEDED: the PC side results (folder reuse after a browser restart, direct link throughput "Send 20 MB" in both directions), the canary after several days, an iPhone.

## PC results (2026-11-17)
- **Remembered folder: WORKS in Chrome on the PC** (user report: the folder handle saved in IndexedDB was reused after restarting the browser). Route A is confirmed for the PC side.
  (Exact permission prompt behavior to be written down when the app is built.)
- **Direct link, big send: nothing visible happened from either side** although both reported "connected". The old test page logged only at the END of a transfer, so a stall looked like "nothing".
  Test page updated: progress lines every 2 MB, a 3-second no-progress watchdog, a "Send hello" ping with round-trip time, "Send 5 MB", "Link info" (nominated candidate pair, RTT, bytes) and
  channel open/close/error logs; "PC: connect" now refuses to run on the wrong device. Needs a retest on the real devices.

## Direct link: measured results and what we learned (2026-11-17, evening)
- **Pairing, simplified and working:** PC shows a QR code (the offer, about 590-700 characters, readable with BarcodeDetector or the vendored jsQR); the phone scans it, makes the answer and
  opens the share sheet; the user sends it to themselves in WhatsApp; on the PC the text is pasted or the file loaded and the link connects by itself (about 0.2 s once the answer is applied).
  The return leg stays manual because the PC has no camera. A short typed code (8 digits) would need a rendezvous service (PeerJS public server, or our own small Cloudflare Worker): explained
  to the user, NOT built; only worth doing if throughput proves good.
- **The PC hides its address behind a `.local` (mDNS) name** unless the page holds microphone permission; the phone often cannot resolve it. The test page now asks for microphone permission once
  (nothing is recorded) before it makes an offer or answer; after that the offer carries the real address (192.168.0.x) and the link connects. One earlier failed pairing (connecting then failed after
  15 s) was probably this.
- **Browser cache trap:** GitHub Pages sends `Cache-Control: max-age=600`, so a new tab or normal reload can serve a page up to 10 minutes old. Hard reload (Ctrl+Shift+R) or a new `?v=N` address.
  The test page shows "(page build N ...)" next to the "Quick pairing" heading. The real app must version its files (service worker with a version, or hashed file names).
- **Throughput, PC to phone, 5 MB sends:** 0.12 to 0.55 MB/s for EVERY combination of message size (16, 64, 256 KB) and send buffer (1, 4, 16 MB); ping round trip 30 ms. Earlier: phone received 5 MB at
  0.37 MB/s, phone sent 20 MB at 0.19 MB/s. The page hands the browser all 5 MB within about a second and the buffer then drains at a steady 0.2 to 0.5 MB/s, so the limit is BELOW the page. Loopback
  on the same PC: 6 MB/s.
- **Likely cause: the office PC's Wi-Fi.** It has only a TP-Link Wireless Nano USB adapter (802.11n, 2.4 GHz, 45 to 60 Mbit/s link, 59% signal, USB 3 port and 3 m cable) at the far end from the router,
  in a room with several other devices and many neighboring networks. The router's 2.4 GHz channel was 3 (overlaps the neighbors on 1 and 6); the user moved it to channel 6 with a 20 MHz width
  (confirmed: link rate fell from 60 to 28.9 Mbit/s as expected for 20 MHz). Result: slightly better (0.2 to 0.55 MB/s), same ceiling.
- **Not yet tested (decides whether the direct link is kept):** a PC close to the router or on Ethernet (the user will try a PC inside the house). Expect several MB/s if the office adapter was the
  limit. Windows also marks the home network "Public" (blocks incoming connections by default); WebRTC does not need that, but a plain local web server does.
- **What the plan assumes until then:** the direct link is a bonus for text changes and thumbnails (a 1,200-seedling text sync is about 0.3 MB, a couple of seconds even at 0.2 MB/s); big photo syncs go
  through the Drive folder (route A). If a good PC also shows under about 1 MB/s, drop route B from the app.
- **Later the same evening (decisive):** (1) office PC to its router: ping 1 to 3 ms, 0% loss; internet download 1.8 to 2.1 MB/s; 1,400-byte pings average 8 ms. So the office PC's Wi-Fi is NOT the limit;
  the USB 2 port made no difference (0.3 to 0.38 MB/s). (2) Laptop in the house to the SAME Android phone: 0.55 to 0.58 MB/s, ping 44 ms. (3) **Laptop in the house to an iPad: 1.8 to 4.2 MB/s for 5 MB, and
  20 MB in 3.8 s = 5.3 MB/s** (64 KB messages, 4 MB buffer). **Conclusion: the direct link is fast; the Android 10 phone (Chrome 157) is the slow end** (ping always 30 to 44 ms, Wi-Fi power saving
  probably); nothing the page can fix. DECISION: route B (direct link) STAYS as the optional quick route. Phone to PC direction on a good network and the Android phone sending to the laptop in the
  house are still unmeasured (the earlier 0.19 MB/s was on the office setup).
- **iPad to PC (2026-11-18): the direction users will use works fast.** iPad (iPadOS, Chrome for iOS = WebKit) as ANSWERER, sending to the PC: 5 MB at 1.75 MB/s (first send), then 5.8 MB/s;
  20 MB in 3.5 s = 5.8 MB/s (64 KB messages, 4 MB buffer). Estimates: thumbnails (about 17 MB) about 3 s, all photos (about 90 MB) about 16 s. The QR code (766 characters) was read at once by the
  iPad camera page. So the Android 10 phone really is the slow end (same Wi-Fi, same PC).
  **iOS limits:** a 16 MB send buffer fails with "OperationError: Trying to send too much data" (at about 14 to 16 MB queued), same family as Chrome's "send queue is full": keep `bufferedAmount` at 4 MB or less.
  **Share sheet:** `navigator.share` right after the scan fails with NotAllowedError (needs a tap); the manual "Send my answer" button worked. The real app must show that button, never auto-share.
  **Answerer timeout:** the answerer's link went to `failed` 15 s after the answer was made (the PC had not received it yet: the WhatsApp round trip took about 15 s) and recovered by itself when the PC connected
  (connected at 99 s). The app must treat `failed` on the answerer as "still waiting", keep the screen saying "waiting for the PC", and not give up for several minutes. (This probably explains some earlier failed pairings.)
- **Sender rules learned for the real app:** 64 KB messages; keep `bufferedAmount` at 4 MB or less and wait for `bufferedamountlow` (256 KB messages with a 16 MB buffer failed at 14 MB with
  "RTCDataChannel send queue is full"); send zip entries in 64 KB pieces with a length header; show progress and a cancel button; a first connection can take about 12 s (answer 628 to 766 characters).
- **Pairing note:** an iPad could scan/answer (answer 628 characters); the PC still needs microphone permission to expose its real address.
- Test page extras still on the live site until the Stage 1 report: speed-test server was local only (stopped, nothing left running, no firewall rule added).

## Open questions (waiting on the user)
- How to run the phone tests (see chat). 

## Stage 5, first slice of the app screens (built 2026-11-23, uncommitted)
App at site/mycrosses/index.html (CSP meta: scripts, styles and images from 'self' only, no inline style or script). Sync test round trip PC<->Android passed first (2026-11-23: new records, edits, Trash, incremental import).
- Built: theme system (6 schemes x Match device/Light/Dark/High contrast light/dark, generated css/themes.css from js/app/palettes.js; 4 Node contrast tests: AA, AAA in high contrast; text size, density, reduce motion; first paint from localStorage), Home (counts, status chips, backup age warning, flowering list, seeds-sown-without-seedlings, duplicate code/label warnings), Crosses list (search in any word order, status filter, thumbnails), Cross form and page (all date/seed-storage fields, remake_of, add N seedlings, quick status change, delete to Trash), Seedling page (edit, photos with the 1000/300 px pipeline, traits, delete), Trash (restore, erase, empty), Sync (export Save/Share/Download with optional passphrase, import with dry run), Settings (look, initials, trash days, storage, privacy text).
- Tested: site/mycrosses/tools/app-e2e.mjs drives headless Edge through the whole flow (25 checks, no console or CSP errors); node --test: 56 tests.
- NOT built yet: parent picker and official database (parents are typed names, refs stay null), lineage graph, spreadsheet view (editable), Family view, service worker and install (offline), Web Share Target, 8-digit pairing. Next slice proposal: parent picker + official snapshot, then the spreadsheet view.

## Stage 5, parent picker (built 2026-11-23, uncommitted)
- New cross / Edit cross: the two parent fields are comboboxes (js/app/picker.js, ARIA combobox pattern, keyboard and touch). Suggestions: the user's own seedlings (by name, cross code or number; not the cross being edited), the official database, then "Use what I typed (not linked)" and "Unknown parent". Choosing fills the parent NAME and the REF (official slug or seedling UUID); editing the text afterwards drops the link.
- Official database (js/app/official.js): loaded on first use only, with progress (about 11 MB, browser cache helps), read only, shared by both pickers. Name search = FTS prefix over the name column, every word must match, any order, exact name first. The 1963/old-supplement names are a second file loaded only on request ("Also search the older names"). id_redirects are followed by `get`.
- Offline: each pick stores a small snapshot (name, hybridizer, size, short description, registration no) in the user's own database (`official_cache`, device only, not synced); if the database cannot be loaded the picker offers those names and says so; typed names always work.
- Cross page: parents shown with links (official page on the main site, or the user's own seedling) and the snapshot facts.
- CSP now allows 'wasm-unsafe-eval' (needed by sql.js); still no inline script/style, connect-src 'self'.
- Tests: official.node.test.js (6, on the committed database files), tools/picker-e2e.mjs (14 checks in headless Edge incl. offline fallback via a blocked database URL); node --test: 63 tests.
- Not done yet: refresh of a stale snapshot after a database update, lineage graph, spreadsheet view, Family view.


- Cross page (2026-11-23): parents shown once with a thumbnail (official: the project photo through jsDelivr, address kept in the offline snapshot and only used when it starts with the allowed host; own seedling: its first photo), hybridizer under the parents, seed storage no longer in the summary (still in the form). CSP img-src now also allows https://cdn.jsdelivr.net/gh/Saintpaulia-Ancestry-Project/ (GET of images only). tools/thumbs-e2e.mjs; 64 Node tests.

- Hybridizer (2026-11-23): Settings has "Your name" (device setting hybridizer_name; also suggests the initials); every new cross is pre-filled with it and the form requires a hybridizer (stored in the cross, so it syncs); Settings offers to fill it for old crosses that have none. tools/name-e2e.mjs.

## Stage 5, spreadsheet view (first version built 2026-11-23, uncommitted until approved)
- Menu "Spreadsheet" (#/sheet; #/sheet?cross=<id> from a cross page): one row per seedling; columns No., Cross, Photo, Status, Description, Traits, Date added, Name, Notes (column chooser, remembered per device). Search over every cell, cross and status filters, click-a-header sorting (empty cells last), "group by cross" headings (default order only). Sticky header and first column, horizontal scroll, only the rows on screen are built (3,000 seedlings: 25 DOM rows, page built in about 0.5 s).
- Editing in place: click or tap a cell and type; Enter/Tab/arrows move, Esc cancels, Delete clears, F2 or double-click edits, date and status pickers; every edit is an ordinary per-field edit (stamped, synced, validated: bad values refused with a message). Paste a block from a spreadsheet (tab-separated, quoted cells ok; dates as 2026-11-23 or 23 Nov 2026, other spellings refused because 3/4/26 is ambiguous; nothing is written if any cell is bad); Ctrl+Z undoes edits, whole pastes and added rows (an added row goes to the Trash). Add seedling to a chosen cross (next free number). "+" in the Photo column adds a photo (camera on phones). Export CSV of the current view (formula-looking text is prefixed with an apostrophe).
- Logic without a DOM in js/app/sheet-model.js (9 Node tests); tools/sheet-e2e.mjs drives headless Edge (keyboard edit, validation, paste, undo, add, filters, sort, columns, CSV, 3,000-row virtualization); node --test: 73 tests.
- Not done: selecting a range of cells (copy copies the current cell only), editing traits in the grid (read only, edit on the seedling page), Family mode with a generation column, delete rows from the grid, redo, a larger-screen layout for the toolbar.


- Spreadsheet parents (2026-11-23): columns "Seed parent" and "Pollen parent" show the cross parents on every seedling row (a small arrow links to the official page or your own seedling) and are edited with the same parent picker as the cross form, in a pop-up inside the cell (official database, own seedlings, "as typed"). The change is made on the CROSS, so all its seedling rows update; undo restores name and link. Paste into a parent column sets typed (unlinked) names, one edit per cross. Delete clears. 75 Node tests; tools/sheet-e2e.mjs extended.
