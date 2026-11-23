# Saintpaulia Hybridizer: the sync file (format version 1)

A sync file moves one person's own records between that person's devices, and doubles as a full backup. It is a plain zip file. Nothing in it is meant for
anyone else and the app never uploads it: the user saves or shares it themselves (Drive folder, share sheet, download). Code: `site/mycrosses/js/sync/`.
The data model is in `docs/hybridizer-data-model.md`.

## Contents of the zip

| entry | what |
|---|---|
| `manifest.json` | format, versions, the device that made the file, counts (stored, not compressed, so a person can read it) |
| `crosses.jsonl`, `seedlings.jsonl`, `photos.jsonl`, `traits.jsonl` | one JSON record per line (deflated), sorted by id, keys in a fixed order |
| `thumbs/<sha256>.jpg` | 300 px thumbnails (stored, not compressed) |
| `photos/<sha256>.jpg` | 1000 px photos (stored) |

Any other entry name is ignored (and reported). Names with `..`, an absolute path, a backslash, a drive letter, a control character, or a folder entry make the whole file invalid.
Writers use UTF-8 names, no zip64, no encryption flag, no data descriptors. Readers must read the central directory (the list at the end), never scan from the front.

## manifest.json

```json
{ "format": "saintpaulia-hybridizer-sync", "format_version": 1, "schema_version": 1, "app_version": "0.3.0",
  "device_id": "<uuid of the device that made the file>", "exported_at": "2026-11-23T10:00:00.000Z",
  "mode": "full | incremental", "since": null | { "peer_device_id": "<uuid>", "local_seq": 12 },
  "photos": "none | thumbs | all", "counts": { "crosses": 3, "seedlings": 1200, "photos": 402, "traits": 0 },
  "files": { "thumbs": 402, "photos": 0 } }
```
`counts` must equal the number of lines in each `.jsonl`. A file with a higher `format_version` or `schema_version` than the reader knows is refused with a request to update the app.
`mode: "incremental"` holds only the records that changed on the sending device since its last file for that peer. Receiving the same file twice, or files in any order, is harmless.

## Records

Every line is an object. Common fields: `id` (UUID v4), `created_at`, `updated_at` (UTC, `YYYY-MM-DDTHH:MM:SS.mmmZ`), `device_id` (UUID of the device of the newest edit), `deleted` (0/1),
`deleted_at`, `deleted_via` (id of the record whose deletion carried this one into the Trash, or null), `erased` (0/1), and `_t`: an object with the **stamp** of the last edit of every field.
`local_seq` is never exported. The table's own fields are listed in the data model document. Unknown keys, wrong types, bad dates, over-long text, or a missing stamp make the file invalid.

An **erased** record (a tombstone) carries only `id, updated_at, device_id, deleted, deleted_at, deleted_via, erased` and `_t` with `erased` and `deleted` stamps; its content fields must be absent.

### Stamps (hybrid logical clock)
`<ISO time with ms>-<counter, 4 hex>-<device id>`, for example `2026-11-23T10:15:30.123Z-0004-3f2a9c1e-...`. Stamps compare as plain text. A device makes a stamp from the later of its own clock and the
highest stamp it has seen, plus a counter; after importing a file it raises its clock to the highest stamp in it, so a device with a wrong clock cannot make its edits look older than something it has received.

## Merge rules (the heart of the format)
For each record id present in the file:
1. **New** (id unknown here): insert it as it is.
2. **Erased on either side**: the tombstone wins, whatever the stamps. Photo files no remaining photo record uses are removed.
3. Otherwise merge **field by field** (all table fields plus `deleted`, `deleted_at`, `deleted_via`): the version with the larger stamp wins; equal stamps with different values (a damaged file) are decided by the value's text. The result's `_t` holds the winning stamps,
   `updated_at` is the time of the newest stamp, `device_id` its device, `created_at` the earlier of the two. So merging A into B and B into A produces identical records, and importing a file twice changes nothing.
4. A delete wins only if it is the newer edit of `deleted`; a later restore wins over it. A stale edit of another field never resurrects a record.
5. Two devices that added seedlings with the same label to one cross keep both; two crosses with the same code are both kept. The app lists them for the user to renumber.
6. A record that belongs to something erased on another device is kept and flagged; the user decides.
7. Per-field merging may combine values that never existed together (for example a harvest date from one device and a made date from another); the date-order check is not applied to merged records.

## Import steps
1. Open the file; if it starts with `HYBENC01` ask for the passphrase and decrypt. Check the zip structure and limits, the manifest, and every record. Nothing has changed yet.
2. **Dry run**: per table, the number of new, updated, unchanged and conflicting records; the number of photo files that would be added; warnings (a sending clock more than a day ahead, a file made by this device, orphans).
   A *conflict* is a field where both sides hold different values that were each edited after the two devices last met (the stamps still decide the winner; the dry run lists both values).
   Every photo file that would be added is hashed now: a file whose SHA-256 differs from its name refuses the whole import.
3. On confirmation: new photo files are stored (they are named by their content, so extra ones are harmless), then **all records are merged in one storage transaction**: any failure leaves the records exactly as they were.
   Records that changed get a new local `local_seq`, the clock is raised, and the import is written to `sync_log`.

## Limits (a file is treated as hostile)
At most 20,000 zip entries; 60 MB per unpacked entry (manifest 256 KB, photos 8 MB, thumbnails 1 MB); 2 GB unpacked in total; 200,000 records per table; 1 MB per line. The unpacked size of each entry is checked
against its declared size while it is being unpacked, every entry's CRC-32 is checked, entries may not overlap or reach into the central directory.

## Passphrase protection (optional, off by default)
The whole zip is encrypted in the browser (WebCrypto). Layout, all numbers big-endian: `HYBENC01` (8 bytes), PBKDF2-SHA-256 iterations (4 bytes, 600000 written; 1,000 to 10,000,000 accepted),
salt (16), nonce prefix (8), then chunks of up to 1 MiB of plaintext, each stored as length (4) + AES-256-GCM ciphertext with its 16-byte tag. Chunk *i* uses nonce = prefix + *i* (4 bytes);
its additional authenticated data is the 36 header bytes plus one byte (1 for the last chunk, else 0), so cutting, reordering or extending the file is detected. A wrong passphrase fails on the first chunk.
A lost passphrase means the file cannot be opened. Backups and files made earlier without a passphrase stay readable by anyone who has them.

## Versions
`format_version` changes when the file layout changes; `schema_version` when the record fields change. A reader refuses newer versions and migrates older ones (none exist yet).
