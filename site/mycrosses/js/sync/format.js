// The sync file format: names, limits, the manifest and the checks every incoming record must pass. docs/sync-format.md describes it for other developers.
import { SCHEMA_VERSION, TABLES, SYNC_TABLES, COMMON_MERGEABLE, ADDED_LATER } from "../core/schema.js";
import { validateFields } from "../core/validate.js";
import { UUID_RE } from "../core/ids.js";
import { HLC_RE, parseStamp } from "../core/clock.js";

export const FORMAT = "saintpaulia-hybridizer-sync";
export const FORMAT_VERSION = 1;
export const APP_VERSION = "0.3.0";

export const LIMITS = {
  manifestBytes: 256 * 1024,
  tableBytes: 60 * 1024 * 1024,        // one JSONL file, unpacked
  recordsPerTable: 200000,
  lineBytes: 1024 * 1024,
  fullPhotoBytes: 8 * 1024 * 1024,
  thumbBytes: 1024 * 1024,
  maxFutureMs: 24 * 3600 * 1000,       // a stamp more than a day ahead of this device's clock is reported in the dry run
};

export class SyncFormatError extends Error {
  /** code: not-zip | needs-passphrase | newer-schema | invalid | too-big | bad-photo | bad-record */
  constructor(code, message) { super(message); this.name = "SyncFormatError"; this.code = code; }
}

export const entryNames = {
  manifest: "manifest.json",
  table: (t) => `${t}.jsonl`,
  photo: (sha) => `photos/${sha}.jpg`,
  thumb: (sha) => `thumbs/${sha}.jpg`,
};
const HASH_PATH_RE = /^(photos|thumbs)\/([0-9a-f]{64})\.jpg$/;
const TABLE_FILE_RE = new RegExp(`^(${SYNC_TABLES.join("|")})\\.jsonl$`);

/** What an entry name means: { kind: "manifest" | "table" | "photo" | "thumb" | "unknown", table?, sha? }. */
export function classifyEntry(name) {
  if (name === entryNames.manifest) return { kind: "manifest" };
  const t = TABLE_FILE_RE.exec(name);
  if (t) return { kind: "table", table: t[1] };
  const p = HASH_PATH_RE.exec(name);
  if (p) return { kind: p[1] === "photos" ? "photo" : "thumb", sha: p[2] };
  return { kind: "unknown" };
}

export function buildManifest({ deviceId, exportedAt, mode, since = null, photos, counts, files }) {
  return { format: FORMAT, format_version: FORMAT_VERSION, schema_version: SCHEMA_VERSION, app_version: APP_VERSION, device_id: deviceId, exported_at: exportedAt, mode, since, photos, counts, files };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isIso = (s) => typeof s === "string" && ISO_RE.test(s) && !Number.isNaN(Date.parse(s)) && Date.parse(s) > Date.parse("2020-01-01T00:00:00Z") && Date.parse(s) < Date.parse("2100-01-01T00:00:00Z");

/** Throws SyncFormatError for a manifest this app cannot or should not read. Returns the manifest. */
export function checkManifest(m) {
  const bad = (msg) => { throw new SyncFormatError("invalid", "The manifest is not valid: " + msg); };
  if (!m || typeof m !== "object" || Array.isArray(m)) bad("it is not an object");
  if (m.format !== FORMAT) throw new SyncFormatError("invalid", "This file is not a Saintpaulia Hybridizer sync file.");
  if (!Number.isInteger(m.format_version) || m.format_version < 1) bad("format_version");
  if (m.format_version > FORMAT_VERSION) throw new SyncFormatError("newer-schema", "This file was made by a newer version of the app (file format " + m.format_version + "). Update or reload the app, then try again.");
  if (!Number.isInteger(m.schema_version) || m.schema_version < 1) bad("schema_version");
  if (m.schema_version > SCHEMA_VERSION) throw new SyncFormatError("newer-schema", "This file holds data in a newer format (" + m.schema_version + ") than this app reads (" + SCHEMA_VERSION + "). Update or reload the app, then try again.");
  if (typeof m.device_id !== "string" || !UUID_RE.test(m.device_id)) bad("device_id");
  if (!isIso(m.exported_at)) bad("exported_at");
  if (!["full", "incremental"].includes(m.mode)) bad("mode");
  if (!["none", "thumbs", "all"].includes(m.photos)) bad("photos");
  if (!m.counts || typeof m.counts !== "object") bad("counts");
  for (const t of SYNC_TABLES) if (!Number.isInteger(m.counts[t]) || m.counts[t] < 0 || m.counts[t] > LIMITS.recordsPerTable) bad("counts." + t);
  return m;
}

const OWN = (t) => Object.keys(TABLES[t].fields);
const mergeable = (t) => [...OWN(t), ...COMMON_MERGEABLE];

/** Returns a list of problems with one incoming record (empty when fine). Never trusts the file. */
export function recordProblems(table, r) {
  const out = [];
  if (!r || typeof r !== "object" || Array.isArray(r)) return ["is not an object"];
  const allowed = new Set(["id", "created_at", "updated_at", "device_id", "deleted", "deleted_at", "deleted_via", "erased", "_t", ...OWN(table)]);
  for (const k of Object.keys(r)) if (!allowed.has(k)) out.push(`has an unknown field ${k}`);
  if (typeof r.id !== "string" || !UUID_RE.test(r.id)) out.push("has no valid id");
  if (!isIso(r.updated_at)) out.push("has no valid updated_at");
  if (typeof r.device_id !== "string" || !UUID_RE.test(r.device_id)) out.push("has no valid device_id");
  if (r.deleted !== 0 && r.deleted !== 1) out.push("deleted must be 0 or 1");
  if (r.erased !== 0 && r.erased !== 1) out.push("erased must be 0 or 1");
  if (!r._t || typeof r._t !== "object" || Array.isArray(r._t)) { out.push("has no _t stamps"); return out; }
  for (const [f, s] of Object.entries(r._t)) {
    if (typeof s !== "string" || !HLC_RE.test(s)) { out.push(`stamp of ${f} is not valid`); continue; }
    const p = parseStamp(s);
    if (!isIso(p.iso)) out.push(`stamp of ${f} has an impossible time`);
  }
  if (r.erased === 1) {
    for (const k of OWN(table)) if (k in r) out.push(`an erased record must not carry ${k}`);
    if (!r._t.erased || !r._t.deleted) out.push("an erased record needs stamps for erased and deleted");
    return out;
  }
  if (!isIso(r.created_at)) out.push("has no valid created_at");
  if (r.deleted_at !== null && !isIso(r.deleted_at)) out.push("deleted_at must be a time or null");
  if (r.deleted_via !== null && !(typeof r.deleted_via === "string" && UUID_RE.test(r.deleted_via))) out.push("deleted_via must be an id or null");
  const own = {};
  for (const k of OWN(table)) own[k] = r[k] === undefined ? undefined : r[k];
  for (const e of validateFields(table, own)) out.push(`${e.field} ${e.message}`);
  for (const f of mergeable(table)) if (!(f in r._t) && !(ADDED_LATER[table] || []).includes(f)) out.push(`has no stamp for ${f}`);
  for (const f of Object.keys(r._t)) if (!mergeable(table).includes(f)) out.push(`has a stamp for an unknown field ${f}`);
  return out;
}

export { OWN as ownFields, mergeable as mergeableFieldsOf };
