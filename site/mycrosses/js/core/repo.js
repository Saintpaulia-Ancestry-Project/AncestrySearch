// The repository: every read and write of the user's records goes through here.
//
// What it guarantees (the tests check each one):
//  - every record has id (UUID v4), created_at, updated_at, device_id, deleted and per-field stamps (_t) made by a hybrid logical clock;
//  - an edit changes only the fields that really changed, each with its own stamp, so two devices editing different fields both win;
//  - nothing is ever hard-deleted by an edit: deleting moves a record (and what hangs under it) to the Trash, restoring brings it back,
//    erasing removes the content and leaves a small tombstone so the erase reaches the other devices;
//  - one operation = one storage transaction: it all happens or none of it does;
//  - local_seq (this device only) rises on every local change, for incremental sync files (stage 3).
import { SCHEMA_VERSION, TABLES, STORES, SYNC_TABLES, COMMON_MERGEABLE, DEFAULT_SETTINGS, emptyFields } from "./schema.js";
import { newId, isLocalId } from "./ids.js";
import { newClockState, tick, stampTime } from "./clock.js";
import { validateFields, crossDateErrors, checkValue, ValidationError } from "./validate.js";
import { nextCrossCode, nextLabel, findDuplicates, compareLabels, cleanInitials } from "./codes.js";
import { sha256Hex } from "./hash.js";

export class NotFoundError extends Error { constructor(m) { super(m); this.name = "NotFoundError"; } }
export class StateError extends Error { constructor(m) { super(m); this.name = "StateError"; } }
export class SchemaTooNewError extends Error {
  constructor(found) { super(`These records were saved by a newer version of the app (data format ${found}; this version reads ${SCHEMA_VERSION}). Reload the page or update the app.`); this.name = "SchemaTooNewError"; }
}

const DATA_STORES = [...SYNC_TABLES];                 // crosses, seedlings, photos, traits
const WRITE_STORES = ["meta", ...DATA_STORES, "blobs"];
const PARENT = { seedlings: ["crosses", "cross_id"], photos: ["seedlings", "seedling_id"], traits: ["seedlings", "seedling_id"] };
const CHILDREN = { crosses: [["seedlings", "cross_id"]], seedlings: [["photos", "seedling_id"], ["traits", "seedling_id"]] };
const DAY = 86400000;
export const LIMITS = { fullPhotoBytes: 8 * 1024 * 1024, thumbBytes: 1024 * 1024 };

const SETTING_CHECKS = {
  trash_days: (v) => v === null || (Number.isInteger(v) && v >= 7 && v <= 90),
  initials: (v) => typeof v === "string" && cleanInitials(v) === v,
  mode: (v) => ["device", "light", "dark", "hc-light", "hc-dark"].includes(v),
  scheme: (v) => ["violet", "blue", "green", "red", "brown", "grey"].includes(v),
  text_size: (v) => ["small", "normal", "large"].includes(v),
  density: (v) => ["comfortable", "compact"].includes(v),
  reduce_motion: (v) => typeof v === "boolean",
  ancestry_level: (v) => ["online", "data", "images"].includes(v),
  persistence: (v) => v === null || (typeof v === "object" && !Array.isArray(v)),
};

const sameValue = (a, b) => (a ?? null) === (b ?? null);

/** Trim one-line text; empty optional values become null (an empty spreadsheet cell is "nothing", not ""). */
export function normalizeFields(table, fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    const spec = TABLES[table].fields[k];
    if (!spec) { out[k] = v; continue; }
    let x = v;
    if (typeof x === "string") {
      if (spec.kind === "str") x = x.trim();
      if (x === "" && !spec.required) x = null;
      else if (spec.kind === "int" && /^\d+$/.test(x)) x = parseInt(x, 10);
    }
    out[k] = x;
  }
  return out;
}

const localDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export class Repo {
  static async open({ adapter, now = () => Date.now(), idFn = newId } = {}) {
    await adapter.open();
    const repo = new Repo(adapter, now, idFn);
    await repo._init();
    return repo;
  }

  constructor(adapter, now, idFn) { this.adapter = adapter; this.now = now; this.idFn = idFn; this.deviceId = null; }

  async _init() {
    await this.adapter.tx(["meta"], "readwrite", async (t) => {
      const sv = await t.get("meta", "schema_version");
      if (!sv) {
        const dev = this.idFn();
        for (const [key, value] of [["schema_version", SCHEMA_VERSION], ["device_id", dev], ["clock", newClockState()], ["local_seq", 0], ["created_at", new Date(this.now()).toISOString()]]) await t.put("meta", { key, value });
        this.deviceId = dev;
      } else {
        if (sv.value > SCHEMA_VERSION) throw new SchemaTooNewError(sv.value);
        // sv.value < SCHEMA_VERSION: migrations go here, one step per version, inside this transaction (none exist yet).
        this.deviceId = (await t.get("meta", "device_id")).value;
      }
    });
  }

  // ------------------------------------------------------------------ transaction context: one clock reading and one sequence per operation
  async _ctx(t) {
    let clock = (await t.get("meta", "clock")).value, seq = (await t.get("meta", "local_seq")).value;
    const nowMs = this.now();
    return {
      nowMs,
      stamp: () => { const [s, next] = tick(clock, nowMs, this.deviceId); clock = next; return s; },
      seq: () => ++seq,
      flush: async () => { await t.put("meta", { key: "clock", value: clock }); await t.put("meta", { key: "local_seq", value: seq }); },
    };
  }

  _stamped(rec, fieldNames, stamp, ctx) {
    rec._t = { ...rec._t };
    for (const f of fieldNames) rec._t[f] = stamp;
    rec.updated_at = stampTime(stamp);
    rec.device_id = this.deviceId;
    rec.local_seq = ctx.seq();
    return rec;
  }

  // ------------------------------------------------------------------ create / read / update
  async create(table, fields) {
    if (!TABLES[table]) throw new Error("unknown table " + table);
    const clean = { ...emptyFields(table), ...normalizeFields(table, fields) };
    if (table === "seedlings" && clean.date_added == null) clean.date_added = localDate(this.now());
    const errors = validateFields(table, clean);
    if (table === "crosses") errors.push(...crossDateErrors(clean));
    if (errors.length) throw new ValidationError(table, errors);
    return this.adapter.tx(WRITE_STORES.filter((s) => s !== "blobs"), "readwrite", async (t) => {
      const parent = PARENT[table];
      if (parent) {
        const p = await t.get(parent[0], clean[parent[1]]);
        if (!p || p.erased || p.deleted) throw new ValidationError(table, [{ field: parent[1], message: "does not exist (or is in the Trash)" }]);
      }
      const ctx = await this._ctx(t);
      const stamp = ctx.stamp();
      const names = [...Object.keys(TABLES[table].fields), ...COMMON_MERGEABLE];
      const rec = { id: this.idFn(), ...clean, created_at: stampTime(stamp), updated_at: null, device_id: this.deviceId, deleted: 0, deleted_at: null, deleted_via: null, erased: 0, local_seq: 0, _t: {} };
      this._stamped(rec, names, stamp, ctx);
      await t.put(table, rec);
      await ctx.flush();
      return rec;
    });
  }

  /** Many records of one table in ONE transaction ("add 40 seedlings", a pasted block of rows). All are checked first; one bad row stores nothing. */
  async createMany(table, rows) {
    if (!TABLES[table]) throw new Error("unknown table " + table);
    const prepared = rows.map((fields, i) => {
      const clean = { ...emptyFields(table), ...normalizeFields(table, fields) };
      if (table === "seedlings" && clean.date_added == null) clean.date_added = localDate(this.now());
      const errors = validateFields(table, clean);
      if (table === "crosses") errors.push(...crossDateErrors(clean));
      if (errors.length) throw new ValidationError(table, errors.map((e) => ({ field: `row ${i + 1}: ${e.field}`, message: e.message })));
      return clean;
    });
    if (!prepared.length) return [];
    return this.adapter.tx(WRITE_STORES.filter((s) => s !== "blobs"), "readwrite", async (t) => {
      const parent = PARENT[table];
      if (parent) {
        for (const pid of new Set(prepared.map((c) => c[parent[1]]))) {
          const p = await t.get(parent[0], pid);
          if (!p || p.erased || p.deleted) throw new ValidationError(table, [{ field: parent[1], message: "does not exist (or is in the Trash)" }]);
        }
      }
      const ctx = await this._ctx(t);
      const names = [...Object.keys(TABLES[table].fields), ...COMMON_MERGEABLE];
      const out = [];
      for (const clean of prepared) {
        const stamp = ctx.stamp();
        const rec = { id: this.idFn(), ...clean, created_at: stampTime(stamp), updated_at: null, device_id: this.deviceId, deleted: 0, deleted_at: null, deleted_via: null, erased: 0, local_seq: 0, _t: {} };
        this._stamped(rec, names, stamp, ctx);
        await t.put(table, rec);
        out.push(rec);
      }
      await ctx.flush();
      return out;
    });
  }

  async get(table, id) { return this.adapter.tx([table], "readonly", (t) => t.get(table, id)); }

  /** state: "live" (default), "trash" (deleted, not erased), "erased" (tombstones), "all". Sorted by created_at then id. */
  async list(table, { state = "live" } = {}) {
    const all = await this.adapter.tx([table], "readonly", (t) => t.getAll(table));
    const pick = { live: (r) => !r.deleted && !r.erased, trash: (r) => r.deleted && !r.erased, erased: (r) => r.erased, all: () => true }[state];
    return all.filter(pick).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }

  /** patch: { field: value }. Only fields whose value really changes are written and stamped. Returns { record, changed: [fields] }. */
  async update(table, id, patch) {
    if (!TABLES[table]) throw new Error("unknown table " + table);
    const clean = normalizeFields(table, patch);
    const errors = validateFields(table, clean, { partial: true });
    if (errors.length) throw new ValidationError(table, errors);
    return this.adapter.tx(["meta", table], "readwrite", async (t) => {
      const rec = await t.get(table, id);
      if (!rec) throw new NotFoundError(`${table} ${id} does not exist`);
      if (rec.erased) throw new StateError("This record has been erased.");
      if (rec.deleted) throw new StateError("This record is in the Trash: restore it before editing.");
      const changed = Object.keys(clean).filter((k) => !sameValue(rec[k], clean[k]));
      if (!changed.length) return { record: rec, changed: [] };
      const merged = { ...rec, ...clean };
      const after = validateFields(table, Object.fromEntries(Object.keys(TABLES[table].fields).map((k) => [k, merged[k]])));
      if (table === "crosses") after.push(...crossDateErrors(merged));
      if (after.length) throw new ValidationError(table, after);
      const ctx = await this._ctx(t);
      const stamp = ctx.stamp();
      for (const k of changed) rec[k] = clean[k] ?? null;
      this._stamped(rec, changed, stamp, ctx);
      await t.put(table, rec);
      await ctx.flush();
      return { record: rec, changed };
    });
  }

  // ------------------------------------------------------------------ Trash: delete, restore, erase
  async _descendants(t, table, id) {
    const out = [];
    for (const [childTable, fk] of CHILDREN[table] || []) {
      for (const c of await t.getAll(childTable)) if (c[fk] === id) { out.push([childTable, c]); out.push(...(await this._descendants(t, childTable, c.id))); }
    }
    return out;
  }

  /** Move a record, and what hangs under it, to the Trash. Children carry deleted_via = this record's id so restoring brings back exactly them. */
  async softDelete(table, id) {
    return this.adapter.tx(WRITE_STORES.filter((s) => s !== "blobs"), "readwrite", async (t) => {
      const rec = await t.get(table, id);
      if (!rec) throw new NotFoundError(`${table} ${id} does not exist`);
      if (rec.erased) throw new StateError("This record has been erased.");
      if (rec.deleted) return { record: rec, deleted: 0 };
      const ctx = await this._ctx(t);
      const mark = async (tb, r, via) => {
        if (r.deleted || r.erased) return false;
        const stamp = ctx.stamp();
        r.deleted = 1; r.deleted_at = stampTime(stamp); r.deleted_via = via;
        this._stamped(r, COMMON_MERGEABLE, stamp, ctx);
        await t.put(tb, r);
        return true;
      };
      let n = (await mark(table, rec, null)) ? 1 : 0;
      for (const [tb, c] of await this._descendants(t, table, id)) if (await mark(tb, c, id)) n++;
      await ctx.flush();
      return { record: rec, deleted: n };
    });
  }

  /** Bring a record back from the Trash, with the children that were deleted together with it. */
  async restore(table, id) {
    return this.adapter.tx(WRITE_STORES.filter((s) => s !== "blobs"), "readwrite", async (t) => {
      const rec = await t.get(table, id);
      if (!rec) throw new NotFoundError(`${table} ${id} does not exist`);
      if (rec.erased) throw new StateError("This record has been erased and cannot come back.");
      if (!rec.deleted) return { record: rec, restored: 0 };
      const parent = PARENT[table];
      if (parent) {
        const p = await t.get(parent[0], rec[parent[1]]);
        if (!p || p.erased || p.deleted) throw new StateError("Restore the " + parent[0].replace(/s$/, "") + " it belongs to first.");
      }
      const ctx = await this._ctx(t);
      const unmark = async (tb, r) => {
        const stamp = ctx.stamp();
        r.deleted = 0; r.deleted_at = null; r.deleted_via = null;
        this._stamped(r, COMMON_MERGEABLE, stamp, ctx);
        await t.put(tb, r);
      };
      await unmark(table, rec);
      let n = 1;
      for (const [tb, c] of await this._descendants(t, table, id)) if (c.deleted && !c.erased && c.deleted_via === id) { await unmark(tb, c); n++; }
      await ctx.flush();
      return { record: rec, restored: n };
    });
  }

  /** The Trash: what is waiting to be erased. Default: only the records that were deleted themselves (not the ones carried along). */
  async trash({ rootsOnly = true } = {}) {
    const days = (await this.getSettings()).trash_days;
    const nowMs = this.now();
    const out = [];
    for (const table of DATA_STORES) {
      for (const r of await this.list(table, { state: "trash" })) {
        if (rootsOnly && r.deleted_via) continue;
        const expires = days ? Date.parse(r.deleted_at) + days * DAY : null;
        out.push({ table, id: r.id, via: r.deleted_via, deleted_at: r.deleted_at, expires_at: expires ? new Date(expires).toISOString() : null, days_left: expires ? Math.max(0, Math.ceil((expires - nowMs) / DAY)) : null, title: this._title(table, r) });
      }
    }
    return out.sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  }

  _title(table, r) {
    if (table === "crosses") return r.code || [r.seed_parent_name, r.pollen_parent_name].filter(Boolean).join(" x ") || "Cross";
    if (table === "seedlings") return "Seedling " + r.label;
    if (table === "photos") return r.caption || "Photo";
    return (r.trait || "Trait") + (r.value ? ": " + r.value : "");
  }

  /**
   * Erase for good: the content goes, a tombstone (id, updated_at, device_id, deleted, erased) stays so the erase reaches the other devices.
   * Allowed only for what is in the Trash. Erasing a cross erases its seedlings, photos and traits too; photo files nobody else uses are removed.
   */
  async erase(table, id) {
    return this.adapter.tx(WRITE_STORES, "readwrite", async (t) => {
      const rec = await t.get(table, id);
      if (!rec) throw new NotFoundError(`${table} ${id} does not exist`);
      if (rec.erased) return { erased: 0 };
      if (!rec.deleted) throw new StateError("Only records in the Trash can be erased. Delete it first.");
      const ctx = await this._ctx(t);
      const victims = [[table, rec], ...(await this._descendants(t, table, id))].filter(([, r]) => !r.erased);
      const files = new Set();
      for (const [tb, r] of victims) if (tb === "photos") { if (r.sha256) files.add(r.sha256); if (r.thumb_sha256) files.add(r.thumb_sha256); }
      for (const [tb, r] of victims) {
        const stamp = ctx.stamp();
        const tomb = { id: r.id, updated_at: stampTime(stamp), device_id: this.deviceId, deleted: 1, deleted_at: r.deleted_at || stampTime(stamp), deleted_via: null, erased: 1, local_seq: 0, _t: { erased: stamp, deleted: stamp } };
        tomb.local_seq = ctx.seq();
        await t.put(tb, tomb);
      }
      // files still used by another live or trashed photo stay
      if (files.size) {
        for (const p of await t.getAll("photos")) { if (p.erased) continue; files.delete(p.sha256); files.delete(p.thumb_sha256); }
        for (const f of files) await t.del("blobs", f);
      }
      await ctx.flush();
      return { erased: victims.length, files_removed: files.size };
    });
  }

  /** Erase what has been in the Trash longer than the setting (trash_days; null = never). Call when the app starts. */
  async purgeExpired() {
    const days = (await this.getSettings()).trash_days;
    if (!days) return { erased: 0 };
    const limit = this.now() - days * DAY;
    let erased = 0;
    for (const item of await this.trash()) if (Date.parse(item.deleted_at) <= limit) erased += (await this.erase(item.table, item.id)).erased;
    return { erased };
  }

  async emptyTrash() {
    let erased = 0;
    for (const item of await this.trash()) erased += (await this.erase(item.table, item.id)).erased;
    return { erased };
  }

  // ------------------------------------------------------------------ photos
  /** full, thumb: Uint8Array JPEGs already resized and stripped (the browser pipeline does that). Files are stored once per hash. */
  async addPhoto({ seedling_id, full, thumb = null, width = null, height = null, taken_on = null, caption = null }) {
    if (!(full instanceof Uint8Array) || !full.length) throw new ValidationError("photos", [{ field: "full", message: "is empty" }]);
    if (full.length > LIMITS.fullPhotoBytes) throw new ValidationError("photos", [{ field: "full", message: "is larger than " + LIMITS.fullPhotoBytes / 1048576 + " MB" }]);
    if (thumb && thumb.length > LIMITS.thumbBytes) throw new ValidationError("photos", [{ field: "thumb", message: "is larger than " + LIMITS.thumbBytes / 1048576 + " MB" }]);
    const sha256 = await sha256Hex(full);
    const thumb_sha256 = thumb ? await sha256Hex(thumb) : null;
    await this.adapter.tx(["blobs"], "readwrite", async (t) => {
      if (!(await t.get("blobs", sha256))) await t.put("blobs", { key: sha256, kind: "full", bytes: full, size: full.length });
      if (thumb && !(await t.get("blobs", thumb_sha256))) await t.put("blobs", { key: thumb_sha256, kind: "thumb", bytes: thumb, size: thumb.length });
    });
    return this.create("photos", { seedling_id, sha256, thumb_sha256, width, height, taken_on, caption });
  }

  /** { kind, bytes } or null (a device that received only thumbnails has no full file). */
  async getBlob(sha) { const b = await this.adapter.tx(["blobs"], "readonly", (t) => t.get("blobs", sha)); return b ? { kind: b.kind, bytes: b.bytes } : null; }

  /** Hash every stored file again; returns the keys whose content no longer matches (damaged storage). */
  async verifyBlobs() {
    const bad = [];
    for (const b of await this.adapter.tx(["blobs"], "readonly", (t) => t.getAll("blobs"))) if ((await sha256Hex(b.bytes)) !== b.key) bad.push(b.key);
    return bad;
  }

  // ------------------------------------------------------------------ queries the screens need
  async seedlingsOf(crossId) { return (await this.list("seedlings")).filter((s) => s.cross_id === crossId).sort((a, b) => compareLabels(a.label, b.label) || (a.id < b.id ? -1 : 1)); }
  async photosOf(seedlingId) { return (await this.list("photos")).filter((p) => p.seedling_id === seedlingId); }
  async traitsOf(seedlingId) { return (await this.list("traits")).filter((p) => p.seedling_id === seedlingId); }

  /** Two live seedlings of one cross with the same label (two devices picked the same number): both are kept, the user renumbers. */
  async labelCollisions() {
    return findDuplicates(await this.list("seedlings"), (s) => s.cross_id + "\u0000" + s.label).map((g) => ({ cross_id: g.items[0].cross_id, label: g.items[0].label, ids: g.items.map((s) => s.id) }));
  }
  async duplicateCrossCodes() { return findDuplicates(await this.list("crosses"), (c) => c.code).map((g) => ({ code: g.key, ids: g.items.map((c) => c.id) })); }

  async suggestCrossCode() {
    const s = await this.getSettings();
    const codes = [...(await this.list("crosses")), ...(await this.list("crosses", { state: "trash" }))].map((c) => c.code);
    return nextCrossCode(codes, s.initials, new Date(this.now()).getFullYear());
  }
  async suggestLabel(crossId) { return nextLabel((await this.seedlingsOf(crossId)).map((s) => s.label)); }

  async counts() {
    const c = {};
    for (const tb of DATA_STORES) { const all = await this.list(tb, { state: "all" }); c[tb] = all.filter((r) => !r.deleted && !r.erased).length; c[tb + "_trash"] = all.filter((r) => r.deleted && !r.erased).length; }
    return c;
  }

  // ------------------------------------------------------------------ settings (this device only), official snapshots, sync log
  async getSettings() {
    const rows = await this.adapter.tx(["settings"], "readonly", (t) => t.getAll("settings"));
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  }
  async setSetting(key, value) {
    const check = SETTING_CHECKS[key];
    if (!check) throw new Error("unknown setting " + key);
    if (!check(value)) throw new Error(`setting ${key}: value ${JSON.stringify(value)} is not allowed`);
    await this.adapter.tx(["settings"], "readwrite", (t) => t.put("settings", { key, value }));
  }

  /** Keep a small snapshot of an official cultivar the user referenced, so its name and basics show offline. */
  async rememberOfficial(snap) {
    if (!snap || typeof snap.id !== "string" || !snap.id || isLocalId(snap.id)) throw new Error("an official cultivar needs its database id");
    const row = { id: snap.id, name: snap.name ?? null, hybridizer: snap.hybridizer ?? null, size_class: snap.size_class ?? null, description: (snap.description ?? "").slice(0, 400) || null, registration_no: snap.registration_no ?? null, saved_at: new Date(this.now()).toISOString() };
    await this.adapter.tx(["official_cache"], "readwrite", (t) => t.put("official_cache", row));
    return row;
  }
  async getOfficial(id) { return this.adapter.tx(["official_cache"], "readonly", (t) => t.get("official_cache", id)); }

  async logSync({ peer_device_id = null, direction, counts = {} }) {
    if (!["export", "import"].includes(direction)) throw new Error("direction must be export or import");
    return this.adapter.tx(["sync_log"], "readwrite", (t) => t.put("sync_log", { device_id: this.deviceId, peer_device_id, direction, at: new Date(this.now()).toISOString(), counts }));
  }
  async syncLog() { return this.adapter.tx(["sync_log"], "readonly", (t) => t.getAll("sync_log")); }

  /** Every record of every synced table as stored, sorted, WITHOUT local_seq: two devices that agree produce the same snapshot. */
  async snapshot() {
    const out = {};
    for (const tb of DATA_STORES) out[tb] = (await this.list(tb, { state: "all" })).map(({ local_seq, ...r }) => r).sort((a, b) => (a.id < b.id ? -1 : 1));
    return out;
  }
}

export { STORES, SYNC_TABLES, checkValue };
