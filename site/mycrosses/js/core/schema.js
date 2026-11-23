// The local data model of the Saintpaulia Hybridizer. One place that says what every table holds.
// docs/hybridizer-data-model.md explains it in prose; the sync file (stage 3) uses the same field lists.

export const SCHEMA_VERSION = 1;

export const STATUSES = ["growing", "flowering", "culled", "keeping", "released"];

// Field kinds: str (single line), text (many lines), date (YYYY-MM-DD, a plain local date), int, bool3 (0, 1 or null = not known),
// enum, ref (id of an official cultivar or of a local seedling, or null), uuid, hex64 (a SHA-256 in hex).
const str = (max, o = {}) => ({ kind: "str", max, ...o });
const text = (max, o = {}) => ({ kind: "text", max, ...o });
const date = (o = {}) => ({ kind: "date", ...o });
const int = (min, max, o = {}) => ({ kind: "int", min, max, ...o });

export const TABLES = {
  crosses: {
    fields: {
      code: str(40),                       // user-facing code, for example GG-26-014 (suggested, editable, duplicates are flagged)
      seed_parent_ref: { kind: "ref" },    // official cultivar id, local seedling id, or null (unknown)
      seed_parent_name: str(200),          // the name as it was when chosen (shown offline, and when the parent is not in the database)
      pollen_parent_ref: { kind: "ref" },
      pollen_parent_name: str(200),
      date_made: date(),
      date_harvested: date(),
      seed_stored: { kind: "bool3" },
      stored_from: date(),
      stored_to: date(),
      storage_notes: text(2000),
      date_sown: date(),
      seeds_sown: int(0, 1000000),
      notes: text(10000),
      remake_of: { kind: "uuid" },         // the earlier cross this one repeats (a cross made again is a NEW cross)
    },
  },
  seedlings: {
    fields: {
      cross_id: { kind: "uuid", required: true },
      label: str(20, { required: true }),  // display number within the cross; NOT unique (two devices may pick the same one)
      description: text(5000),
      status: { kind: "enum", values: STATUSES, default: "growing", required: true },
      notes: text(10000),
      date_added: date(),
      promoted_name: str(200),             // the name given when the seedling is kept or released
      official_plant_ref: { kind: "ref" }, // the official cultivar once it is registered or listed
    },
  },
  photos: {
    fields: {
      seedling_id: { kind: "uuid", required: true },
      sha256: { kind: "hex64", required: true },        // the 1000 px JPEG
      thumb_sha256: { kind: "hex64" },                  // the 300 px thumbnail
      width: int(1, 20000),
      height: int(1, 20000),
      taken_on: date(),
      caption: str(500),
    },
  },
  traits: {
    fields: {
      seedling_id: { kind: "uuid", required: true },
      trait: str(100, { required: true }),
      value: str(500),
    },
  },
};

// Fields every synced record has, besides the table's own. All of them travel in the sync file except local_seq.
//   id, created_at, updated_at (time part of the newest field stamp), device_id (last editor),
//   deleted (0/1), deleted_at (ISO time or null), deleted_via (id of the record whose deletion carried this one into the Trash, or null),
//   erased (0/1: content removed, only the tombstone is left), local_seq (this device only, never exported),
//   _t = { field: stamp } the hybrid-logical-clock stamp of the last edit of each mergeable field.
export const COMMON_MERGEABLE = ["deleted", "deleted_at", "deleted_via"];
export const SYNC_TABLES = Object.keys(TABLES);

export const mergeableFields = (table) => [...Object.keys(TABLES[table].fields), ...COMMON_MERGEABLE];

// Stores in the browser database (IndexedDB): the four synced tables plus device-only stores.
export const STORES = {
  crosses: { keyPath: "id" },
  seedlings: { keyPath: "id" },
  photos: { keyPath: "id" },
  traits: { keyPath: "id" },
  blobs: { keyPath: "key" },          // photo files by sha256: { key, kind: "full"|"thumb", bytes, size }
  sync_log: { keyPath: "n", autoIncrement: true },
  meta: { keyPath: "key" },           // schema_version, device_id, clock, local_seq, created_at
  settings: { keyPath: "key" },       // per device, never synced: theme, initials, trash days, ancestry level, persistence result
  official_cache: { keyPath: "id" },  // small snapshot of official cultivars the user referenced, for offline display
};

export const DEFAULT_SETTINGS = { trash_days: 30, initials: "", mode: "device", scheme: "violet", text_size: "normal", density: "comfortable", reduce_motion: false, ancestry_level: "online" };

/** A new, empty set of the table's own fields (everything null except defaults). */
export function emptyFields(table) {
  const out = {};
  for (const [k, spec] of Object.entries(TABLES[table].fields)) out[k] = spec.default !== undefined ? spec.default : null;
  return out;
}
