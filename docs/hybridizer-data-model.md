# Saintpaulia Hybridizer: the local data model (stage 2)

Code: `site/mycrosses/js/core/` (plain ES modules, no dependencies, no screen code). Tests: `node --test site/mycrosses/test/` (memory storage) and
`site/mycrosses/test/browser.html` (real IndexedDB). The sync file (stage 3) will be described in `docs/sync-format.md`.

## Where the data lives
- The user's records and photo files are stored in the browser's IndexedDB (database `saintpaulia-hybridizer`). The official Ancestry database is separate and read-only.
- Every operation is ONE storage transaction: all of it happens or none of it. Adapters: `adapters/idb.js` (browser) and `adapters/memory.js` (tests); same interface.

## Records (the four synced tables)
Every record has: `id` (UUID v4 made on the device), `created_at`, `updated_at` (UTC ISO with milliseconds), `device_id` (the device that last edited it),
`deleted` (0/1), `deleted_at`, `deleted_via`, `erased` (0/1), `local_seq` (this device only, never exported) and `_t`, the stamp of the last edit of each field.

| table | own fields |
|---|---|
| crosses | code, hybridizer (v2), seed_parent_ref, seed_parent_name, pollen_parent_ref, pollen_parent_name, date_made, date_harvested, seed_stored (0/1/null), stored_from, stored_to, storage_notes, date_sown, seeds_sown, notes, remake_of |
| seedlings | cross_id, label, description, status (growing, flowering, culled, keeping, released), notes, date_added, promoted_name, official_plant_ref |
| photos | seedling_id, sha256 (1000 px file), thumb_sha256 (300 px file), width, height, taken_on, caption |
| traits | seedling_id, trait, value |

- Dates are plain `YYYY-MM-DD` (no time zone). A cross made again is a NEW cross (its own id); `remake_of` points at the earlier one.
- `*_ref` is an official cultivar id (a slug such as `baby-pink`), a local seedling id (a UUID) or null. `ids.refKind()` tells them apart. The parent's name is stored beside the ref so it shows offline.
- `label` is only a display number. Two devices can pick the same one; both records are kept and `labelCollisions()` lists them. Same for cross codes (`duplicateCrossCodes()`).
- Empty text is stored as null. Text limits and the date order of a cross (made, harvested, sown; stored from, to) are checked on every write.

## Per-field stamps (hybrid logical clock)
A stamp looks like `2026-11-23T10:15:30.123Z-0004-<device id>` and sorts correctly as text. It is the later of the device clock and the highest stamp seen,
plus a counter, so a phone with a wrong clock cannot make its edits look older than something it has already received. An edit writes and stamps ONLY
the fields whose value really changed. Stage 3 merges two versions of a record field by field: the newer stamp wins; equal stamps are decided by the higher device id.

## Trash, restore, erase
- Delete moves a record to the Trash (`deleted` = 1, `deleted_at`). Deleting a cross also moves its seedlings, photos and traits (they carry `deleted_via` = the cross id).
  Restore brings back exactly the records that were carried along, not ones deleted separately earlier. A child cannot be restored before its parent.
- Records in the Trash cannot be edited. Trash shows each item with the days left (setting `trash_days`, 7 to 90, default 30; null = never auto-erase).
- Erase (from the Trash only, or automatically after `trash_days`, or "Empty trash") removes the content and leaves a tombstone: `id, updated_at, device_id, deleted, deleted_at, erased`.
  Erasing a cross erases everything under it. Photo files used by no remaining photo are removed. Backups and sync files made earlier still contain the data.

## Photos
Files are stored once per SHA-256 in the `blobs` store (full and thumbnail separately), outside the records. `addPhoto()` hashes and stores the files and creates the record;
`verifyBlobs()` re-hashes everything and lists damaged files. Limits: 8 MB per full file, 1 MB per thumbnail. A device that received only thumbnails has no full file: `getBlob()` returns null.
(Resizing and removing camera metadata is a browser step that comes with the screens; the proven pipeline is in the Stage 1 test page.)

## Device-only stores (never synced)
`settings` (theme mode and color scheme, text size, density, reduce motion, cross-code initials, trash days, Ancestry data level, the persistence answer), `official_cache` (a small snapshot of
official cultivars the user referenced: id, name, hybridizer, size class, a short description, registration number), `sync_log` (each export and import), `meta`
(schema version, device id, clock, local_seq).

## Schema versions
`meta.schema_version` is 2. A store written by a newer schema is refused with a clear message; migrations for older stores run inside the opening transaction.
- 1 -> 2 (2026-11-23): `crosses.hybridizer` (who made the cross; empty = the user, for seed received from someone else). Old records simply lack it and read as empty; only the version number changes. `ADDED_LATER` in schema.js lists such fields: a record or file without them (and without their stamps) is valid.

## Persistence status
`requestPersistence()` asks the browser to keep the data, with a 3-second limit (Stage 1: `persist()` can hang and is usually not granted on a fresh site) and `describePersistence()` gives the plain sentence for the status area.
