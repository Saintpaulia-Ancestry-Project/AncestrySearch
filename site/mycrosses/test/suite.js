// The stage 2 test suite. It runs unchanged in Node (memory storage, `node --test test/`) and in a browser (real IndexedDB, test/browser.html).
// defineTests({ test, assert, makeAdapter }): test(name, async fn), assert = { equal, deepEqual, ok, notEqual, rejects }, makeAdapter() = a new empty store.
import { Repo, NotFoundError, StateError, SchemaTooNewError, LIMITS } from "../js/core/repo.js";
import { ValidationError } from "../js/core/validate.js";
import { newClockState, tick, observe, parseStamp, compareStamps, stampTime } from "../js/core/clock.js";
import { UUID_RE, newId, refKind, isLocalId } from "../js/core/ids.js";
import { nextCrossCode, nextLabel, compareLabels, initialsFromName } from "../js/core/codes.js";
import { sha256Hex } from "../js/core/hash.js";
import { requestPersistence, describePersistence } from "../js/core/persistence.js";

const START = Date.parse("2026-11-23T10:00:00.000Z");
const bytes = (...n) => Uint8Array.from(n);
const jpeg = (seed, len = 64) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = (seed * 31 + i * 7) & 255; b[0] = 0xff; b[1] = 0xd8; return b; };

/** Wraps an adapter so the Nth put inside a transaction throws: simulates a crash in the middle of an operation. */
function failingAfter(adapter, n) {
  let puts = 0;
  return {
    open: () => adapter.open(), close: () => adapter.close && adapter.close(),
    tx: (names, mode, fn) => adapter.tx(names, mode, (t) => fn({ ...t, put: async (s, v) => { if (mode === "readwrite" && ++puts > n) throw new Error("simulated crash"); return t.put(s, v); } })),
  };
}

export function defineTests({ test, assert, makeAdapter }) {
  let clockMs;
  async function fresh(opts = {}) {
    clockMs = START;
    const adapter = opts.adapter || (await makeAdapter());
    const repo = await Repo.open({ adapter, now: () => clockMs, ...(opts.repo || {}) });
    return { repo, adapter };
  }
  const advance = (ms = 1000) => { clockMs += ms; };

  // ------------------------------------------------------------------ pure helpers
  test("clock: stamps sort as text, stay ordered when the device clock goes backwards, and parse", async () => {
    let st = newClockState();
    const dev = "3f2a9c1e-0000-4000-8000-000000000001";
    const seen = [];
    for (const ms of [START, START, START + 5, START + 2, START - 100000, START + 6]) { const [s, n] = tick(st, ms, dev); st = n; seen.push(s); }
    assert.deepEqual([...seen].sort(), seen);
    assert.equal(new Set(seen).size, seen.length);
    const p = parseStamp(seen[0]);
    assert.equal(p.device, dev);
    assert.equal(stampTime(seen[0]), "2026-11-23T10:00:00.000Z");
    assert.equal(compareStamps(seen[0], seen[1]), -1);
  });

  test("clock: a stamp seen from a device whose clock is ahead keeps later local edits after it", async () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001", b = "bbbbbbbb-0000-4000-8000-000000000002";
    const [far] = tick(newClockState(), START + 3600000, b);
    let st = observe(newClockState(), far, START);
    const [mine] = tick(st, START + 10, a);
    assert.ok(mine > far, "a local edit after receiving the stamp must sort after it");
  });

  test("ids: uuid v4, local versus official refs", async () => {
    assert.ok(UUID_RE.test(newId()));
    assert.equal(refKind(newId()), "local");
    assert.equal(refKind("baby-pink"), "official");
    assert.equal(refKind(null), null);
    assert.equal(isLocalId("baby-pink"), false);
  });

  test("codes: next cross code, next label, natural label order, initials", async () => {
    assert.equal(nextCrossCode([], "gg", 2026), "GG-26-001");
    assert.equal(nextCrossCode(["GG-26-009", "GG-26-014", "GG-25-099", "XX-26-500", "GG-26-abc"], "GG", 2026), "GG-26-015");
    assert.equal(nextCrossCode([], "", 2026), "X-26-001");
    assert.equal(nextLabel([]), "1");
    assert.equal(nextLabel(["1", "2", "12b", "9"]), "10");
    assert.deepEqual(["10", "2", "1", "12b", "12"].sort(compareLabels), ["1", "2", "10", "12", "12b"]);
    assert.equal(initialsFromName("Grace Goode"), "GG");
  });

  // ------------------------------------------------------------------ opening
  test("open: a new store gets a device id and schema version, and keeps them when reopened", async () => {
    const { repo, adapter } = await fresh();
    assert.ok(UUID_RE.test(repo.deviceId));
    const again = await Repo.open({ adapter, now: () => clockMs });
    assert.equal(again.deviceId, repo.deviceId);
  });

  test("open: refuses a store written by a newer schema", async () => {
    const { adapter } = await fresh();
    await adapter.tx(["meta"], "readwrite", (t) => t.put("meta", { key: "schema_version", value: 99 }));
    await assert.rejects(() => Repo.open({ adapter, now: () => clockMs }), SchemaTooNewError);
  });

  // ------------------------------------------------------------------ create and validate
  test("create: a cross gets id, stamps for every field, and a clean shape", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "GG-26-001", seed_parent_ref: "baby-pink", seed_parent_name: "Baby Pink", date_made: "2026-03-01", seeds_sown: 40 });
    assert.ok(UUID_RE.test(c.id));
    assert.equal(c.device_id, repo.deviceId);
    assert.equal(c.deleted, 0); assert.equal(c.erased, 0);
    assert.equal(c.created_at, c.updated_at);
    assert.equal(c.pollen_parent_ref, null);
    for (const f of ["code", "seed_parent_ref", "date_made", "seeds_sown", "notes", "deleted", "deleted_at", "deleted_via"]) assert.ok(c._t[f], "missing stamp for " + f);
    assert.equal(c.local_seq, 1);
    assert.deepEqual(await repo.get("crosses", c.id), c);
  });

  test("create: validation refuses bad dates, numbers, unknown fields, date order and long text", async () => {
    const { repo } = await fresh();
    const bad = async (fields, word) => { await assert.rejects(() => repo.create("crosses", fields), ValidationError); try { await repo.create("crosses", fields); } catch (e) { assert.ok(e.message.includes(word), e.message); } };
    await bad({ date_made: "2026-02-30" }, "date_made");
    await bad({ date_made: "01/03/2026" }, "date_made");
    await bad({ seeds_sown: -1 }, "seeds_sown");
    await bad({ seeds_sown: 1.5 }, "seeds_sown");
    await bad({ color: "red" }, "color");
    await bad({ date_made: "2026-05-01", date_harvested: "2026-04-01" }, "date_harvested");
    await bad({ stored_from: "2026-06-01", stored_to: "2026-05-01" }, "stored_to");
    await bad({ seed_stored: 2 }, "seed_stored");
    await bad({ code: "x".repeat(41) }, "code");
    await bad({ code: "a\nb" }, "code");
    await bad({ remake_of: "not-an-id" }, "remake_of");
  });

  test("create: empty strings become null, numbers typed as text become numbers, text is trimmed", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "  GG-26-002  ", notes: "", seeds_sown: "25", date_made: "" });
    assert.equal(c.code, "GG-26-002"); assert.equal(c.notes, null); assert.equal(c.seeds_sown, 25); assert.equal(c.date_made, null);
  });

  test("create: a seedling needs a live cross, a label and a valid status; defaults are filled", async () => {
    const { repo } = await fresh();
    await assert.rejects(() => repo.create("seedlings", { cross_id: newId(), label: "1" }), ValidationError);
    const c = await repo.create("crosses", { code: "A" });
    await assert.rejects(() => repo.create("seedlings", { cross_id: c.id }), ValidationError);
    await assert.rejects(() => repo.create("seedlings", { cross_id: c.id, label: "1", status: "dead" }), ValidationError);
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    assert.equal(s.status, "growing");
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.date_added));
  });

  test("createMany: 40 seedlings in one transaction; one bad row stores nothing", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "B" });
    const rows = Array.from({ length: 40 }, (_, i) => ({ cross_id: c.id, label: String(i + 1) }));
    const made = await repo.createMany("seedlings", rows);
    assert.equal(made.length, 40);
    assert.equal(new Set(made.map((r) => r.local_seq)).size, 40);
    await assert.rejects(() => repo.createMany("seedlings", [{ cross_id: c.id, label: "41" }, { cross_id: c.id, label: "" }]), ValidationError);
    assert.equal((await repo.list("seedlings")).length, 40);
  });

  // ------------------------------------------------------------------ update, per-field stamps
  test("update: only the fields that really changed are written and stamped; no change writes nothing", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "C", notes: "first" });
    const seqBefore = (await repo.get("crosses", c.id)).local_seq;
    advance();
    const r1 = await repo.update("crosses", c.id, { notes: "first", code: "C" });
    assert.deepEqual(r1.changed, []);
    assert.equal((await repo.get("crosses", c.id)).local_seq, seqBefore);
    const r2 = await repo.update("crosses", c.id, { notes: "second", seeds_sown: 12 });
    assert.deepEqual(r2.changed.sort(), ["notes", "seeds_sown"]);
    const after = await repo.get("crosses", c.id);
    assert.equal(after._t.code, c._t.code, "an untouched field keeps its old stamp");
    assert.ok(after._t.notes > c._t.notes);
    assert.equal(after._t.notes, after._t.seeds_sown);
    assert.ok(after.local_seq > seqBefore);
    assert.equal(after.updated_at, stampTime(after._t.notes));
    assert.equal(after.created_at, c.created_at);
  });

  test("update: validates the whole row (date order against the other dates) and refuses unknown records", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { date_made: "2026-05-01" });
    await assert.rejects(() => repo.update("crosses", c.id, { date_harvested: "2026-04-01" }), ValidationError);
    await assert.rejects(() => repo.update("crosses", newId(), { notes: "x" }), NotFoundError);
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    await assert.rejects(() => repo.update("seedlings", s.id, { label: "" }), ValidationError);
    await assert.rejects(() => repo.update("seedlings", s.id, { status: null }), ValidationError);
  });

  test("update: clearing a value stores null and is stamped", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { notes: "x" });
    advance();
    await repo.update("crosses", c.id, { notes: "" });
    const r = await repo.get("crosses", c.id);
    assert.equal(r.notes, null);
    assert.ok(r._t.notes > c._t.notes);
  });

  test("local_seq rises with every local change and is left out of snapshots", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "S" });
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    await repo.update("seedlings", s.id, { notes: "n" });
    const seqs = [(await repo.get("crosses", c.id)).local_seq, (await repo.get("seedlings", s.id)).local_seq];
    assert.deepEqual(seqs, [1, 3]);
    const snap = await repo.snapshot();
    assert.ok(!("local_seq" in snap.seedlings[0]));
  });

  // ------------------------------------------------------------------ Trash
  test("trash: deleting a cross moves its seedlings, photos and traits too; restore brings back exactly those", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "T" });
    const s1 = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    const s2 = await repo.create("seedlings", { cross_id: c.id, label: "2" });
    const p1 = await repo.addPhoto({ seedling_id: s1.id, full: jpeg(1), thumb: jpeg(2, 16) });
    await repo.create("traits", { seedling_id: s1.id, trait: "bloom", value: "double" });
    advance();
    await repo.softDelete("seedlings", s2.id);                       // deleted on its own earlier
    advance();
    const r = await repo.softDelete("crosses", c.id);
    assert.equal(r.deleted, 4, "cross + seedling 1 + its photo + its trait (seedling 2 was already in the Trash)");
    assert.equal((await repo.list("seedlings")).length, 0);
    const roots = await repo.trash();
    assert.equal(roots.length, 2, "the cross and seedling 2 are the roots; the carried-along ones are not listed");
    await repo.restore("crosses", c.id);
    assert.equal((await repo.list("seedlings")).map((x) => x.id).join(), s1.id);
    assert.equal((await repo.list("photos")).length, 1);
    assert.equal((await repo.get("seedlings", s2.id)).deleted, 1, "the one deleted separately stays in the Trash");
    assert.equal((await repo.get("photos", p1.id)).deleted_via, null);
  });

  test("trash: a record in the Trash cannot be edited, and a child cannot be restored before its parent", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "U" });
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    await repo.softDelete("crosses", c.id);
    await assert.rejects(() => repo.update("seedlings", s.id, { notes: "x" }), StateError);
    await assert.rejects(() => repo.restore("seedlings", s.id), StateError);
    await assert.rejects(() => repo.create("seedlings", { cross_id: c.id, label: "9" }), ValidationError);
  });

  test("trash: deleting twice or restoring a live record changes nothing", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "V" });
    assert.equal((await repo.restore("crosses", c.id)).restored, 0);
    await repo.softDelete("crosses", c.id);
    const seq = (await repo.get("crosses", c.id)).local_seq;
    assert.equal((await repo.softDelete("crosses", c.id)).deleted, 0);
    assert.equal((await repo.get("crosses", c.id)).local_seq, seq);
  });

  test("erase: only from the Trash; content is removed, a tombstone stays; the cross takes its children with it", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "E", notes: "secret" });
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1", description: "pink" });
    await assert.rejects(() => repo.erase("crosses", c.id), StateError);
    await repo.softDelete("crosses", c.id);
    const r = await repo.erase("crosses", c.id);
    assert.equal(r.erased, 2);
    const tomb = await repo.get("crosses", c.id);
    assert.deepEqual(Object.keys(tomb).sort(), ["_t", "deleted", "deleted_at", "deleted_via", "device_id", "erased", "id", "local_seq", "updated_at"]);
    assert.equal(tomb.erased, 1);
    assert.equal((await repo.get("seedlings", s.id)).description, undefined);
    await assert.rejects(() => repo.restore("crosses", c.id), StateError);
    await assert.rejects(() => repo.update("crosses", c.id, { notes: "x" }), StateError);
    assert.equal((await repo.erase("crosses", c.id)).erased, 0, "erasing twice is harmless");
    assert.equal((await repo.list("crosses", { state: "erased" })).length, 1);
  });

  test("erase: photo files nobody else uses are removed; a file two photos share stays until both are gone", async () => {
    const { repo } = await fresh();
    const c = await repo.create("crosses", { code: "F" });
    const s1 = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    const s2 = await repo.create("seedlings", { cross_id: c.id, label: "2" });
    const same = jpeg(7), own = jpeg(8);
    const pa = await repo.addPhoto({ seedling_id: s1.id, full: same });
    const pb = await repo.addPhoto({ seedling_id: s2.id, full: same });
    const pc = await repo.addPhoto({ seedling_id: s1.id, full: own });
    const shaSame = await sha256Hex(same), shaOwn = await sha256Hex(own);
    assert.equal(pa.sha256, pb.sha256);
    await repo.softDelete("seedlings", s1.id);
    const r1 = await repo.erase("seedlings", s1.id);
    assert.equal(r1.erased, 3);
    assert.equal(await repo.getBlob(shaOwn), null, "the file only seedling 1 used is gone");
    assert.ok(await repo.getBlob(shaSame), "the shared file stays: seedling 2 still uses it");
    await repo.softDelete("seedlings", s2.id);
    await repo.erase("seedlings", s2.id);
    assert.equal(await repo.getBlob(shaSame), null);
    assert.ok(pc);
  });

  test("purgeExpired and emptyTrash: after trash_days only; 'never' keeps everything; the setting is limited to 7-90 days", async () => {
    const { repo } = await fresh();
    await assert.rejects(() => repo.setSetting("trash_days", 3));
    await assert.rejects(() => repo.setSetting("trash_days", 91));
    await repo.setSetting("trash_days", 10);
    const a = await repo.create("crosses", { code: "P1" });
    advance(5 * 86400000);
    const b = await repo.create("crosses", { code: "P2" });
    await repo.softDelete("crosses", a.id);
    advance(6 * 86400000);                                    // a: 6 days in the Trash, b still live
    await repo.softDelete("crosses", b.id);
    advance(5 * 86400000);                                    // a: 11 days (expired); b: 5 days
    const t = await repo.trash();
    assert.equal(t.find((x) => x.id === a.id).days_left, 0);
    assert.equal(t.find((x) => x.id === b.id).days_left, 5);
    assert.equal((await repo.purgeExpired()).erased, 1);
    assert.equal((await repo.get("crosses", a.id)).erased, 1);
    assert.equal((await repo.get("crosses", b.id)).erased, 0);
    await repo.setSetting("trash_days", null);
    advance(400 * 86400000);
    assert.equal((await repo.purgeExpired()).erased, 0);
    assert.equal((await repo.emptyTrash()).erased, 1);
  });

  // ------------------------------------------------------------------ photos
  test("photos: stored once per content, found by hash, damaged storage is detected, oversized files refused", async () => {
    const { repo, adapter } = await fresh();
    const c = await repo.create("crosses", { code: "H" });
    const s = await repo.create("seedlings", { cross_id: c.id, label: "1" });
    const full = jpeg(3, 200), thumb = jpeg(4, 40);
    const p = await repo.addPhoto({ seedling_id: s.id, full, thumb, width: 1000, height: 750, caption: "first bloom" });
    await repo.addPhoto({ seedling_id: s.id, full, thumb });
    assert.equal(await adapter.tx(["blobs"], "readonly", (t) => t.count("blobs")), 2, "two files (full + thumb), not four");
    assert.equal(p.sha256, await sha256Hex(full));
    const got = await repo.getBlob(p.sha256);
    assert.equal(got.kind, "full");
    assert.deepEqual([...got.bytes], [...full]);
    assert.deepEqual(await repo.verifyBlobs(), []);
    await adapter.tx(["blobs"], "readwrite", async (t) => { const b = await t.get("blobs", p.thumb_sha256); b.bytes[3] ^= 0xff; await t.put("blobs", b); });
    assert.deepEqual(await repo.verifyBlobs(), [p.thumb_sha256]);
    await assert.rejects(() => repo.addPhoto({ seedling_id: s.id, full: new Uint8Array(LIMITS.fullPhotoBytes + 1) }), ValidationError);
    await assert.rejects(() => repo.addPhoto({ seedling_id: s.id, full: new Uint8Array(0) }), ValidationError);
    await assert.rejects(() => repo.addPhoto({ seedling_id: newId(), full }), ValidationError);
  });

  // ------------------------------------------------------------------ computed checks the screens show
  test("collisions: the same label twice in one cross and the same cross code twice are reported, never merged or overwritten", async () => {
    const { repo } = await fresh();
    const c1 = await repo.create("crosses", { code: "GG-26-001" });
    const c2 = await repo.create("crosses", { code: "GG-26-001" });
    const c3 = await repo.create("crosses", { code: "GG-26-003" });
    const a = await repo.create("seedlings", { cross_id: c1.id, label: "12" });
    const b = await repo.create("seedlings", { cross_id: c1.id, label: "12" });
    await repo.create("seedlings", { cross_id: c2.id, label: "12" });
    const lc = await repo.labelCollisions();
    assert.equal(lc.length, 1);
    assert.deepEqual(lc[0].ids.sort(), [a.id, b.id].sort());
    const dc = await repo.duplicateCrossCodes();
    assert.equal(dc.length, 1);
    assert.equal(dc[0].code, "GG-26-001");
    assert.ok(c3);
    assert.equal(await repo.suggestLabel(c1.id), "13");
  });

  test("suggestions: the next cross code uses the initials setting, the year, and codes in the Trash too", async () => {
    const { repo } = await fresh();
    await repo.setSetting("initials", "GG");
    assert.equal(await repo.suggestCrossCode(), "GG-26-001");
    const c = await repo.create("crosses", { code: "GG-26-001" });
    await repo.create("crosses", { code: "GG-26-004" });
    await repo.softDelete("crosses", c.id);
    assert.equal(await repo.suggestCrossCode(), "GG-26-005");
    await assert.rejects(() => repo.setSetting("initials", "g g!"));
  });

  // ------------------------------------------------------------------ settings, official snapshots, sync log
  test("settings: defaults, validation, and unknown keys refused", async () => {
    const { repo } = await fresh();
    const s0 = await repo.getSettings();
    assert.equal(s0.trash_days, 30); assert.equal(s0.mode, "device"); assert.equal(s0.scheme, "violet");
    await repo.setSetting("scheme", "green");
    await repo.setSetting("mode", "hc-dark");
    assert.equal((await repo.getSettings()).scheme, "green");
    await assert.rejects(() => repo.setSetting("scheme", "pink"));
    await assert.rejects(() => repo.setSetting("nonsense", 1));
  });

  test("official snapshots and the sync log", async () => {
    const { repo } = await fresh();
    const row = await repo.rememberOfficial({ id: "baby-pink", name: "Baby Pink", hybridizer: "Smith", description: "x".repeat(900) });
    assert.equal(row.description.length, 400);
    assert.equal((await repo.getOfficial("baby-pink")).name, "Baby Pink");
    await assert.rejects(() => repo.rememberOfficial({ id: newId(), name: "local" }));
    await repo.logSync({ direction: "export", peer_device_id: null, counts: { crosses: 1 } });
    const log = await repo.syncLog();
    assert.equal(log.length, 1); assert.equal(log[0].direction, "export"); assert.equal(log[0].device_id, repo.deviceId);
    await assert.rejects(() => repo.logSync({ direction: "sideways" }));
  });

  test("persistence: asks once, reports plainly, and never waits forever on a browser that does not answer", async () => {
    const granted = await requestPersistence({ storage: { persisted: async () => false, persist: async () => true, estimate: async () => ({ usage: 5, quota: 100 }) }, now: () => START });
    assert.equal(granted.persisted, true); assert.equal(granted.asked, true); assert.equal(granted.quota, 100);
    const already = await requestPersistence({ storage: { persisted: async () => true, persist: async () => { throw new Error("should not ask again"); } } });
    assert.equal(already.persisted, true); assert.equal(already.asked, false);
    const denied = await requestPersistence({ storage: { persisted: async () => false, persist: async () => false } });
    assert.equal(denied.persisted, false); assert.equal(denied.timed_out, false);
    const hung = await requestPersistence({ storage: { persisted: async () => false, persist: () => new Promise(() => {}) }, timeoutMs: 30 });
    assert.equal(hung.persisted, false); assert.equal(hung.timed_out, true);
    const none = await requestPersistence({ storage: null });
    assert.equal(none.supported, false);
    for (const p of [granted, already, denied, hung, none]) assert.ok(describePersistence(p).length > 20);
    assert.ok(describePersistence(denied).includes("backup"));
  });

  // ------------------------------------------------------------------ safety
  test("transactions: a crash in the middle of an operation leaves the data exactly as it was", async () => {
    const { repo, adapter } = await fresh();
    const c = await repo.create("crosses", { code: "X" });
    await repo.createMany("seedlings", Array.from({ length: 5 }, (_, i) => ({ cross_id: c.id, label: String(i + 1) })));
    const before = JSON.stringify(await repo.snapshot()), seqBefore = await adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq"));
    for (const n of [0, 1, 3]) {
      const broken = await Repo.open({ adapter: failingAfter(adapter, n), now: () => clockMs });
      await assert.rejects(() => broken.softDelete("crosses", c.id), /simulated crash/);
      await assert.rejects(() => broken.createMany("seedlings", [{ cross_id: c.id, label: "20" }, { cross_id: c.id, label: "21" }, { cross_id: c.id, label: "22" }, { cross_id: c.id, label: "23" }]), /simulated crash/);
    }
    assert.equal(JSON.stringify(await repo.snapshot()), before);
    assert.deepEqual(await adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq")), seqBefore);
  });

  test("scale: 3 crosses of 400 seedlings with photos: counts, speed and a clean verify", async () => {
    const { repo } = await fresh();
    const t0 = Date.now();
    let photos = 0;
    for (let k = 0; k < 3; k++) {
      const c = await repo.create("crosses", { code: "SC-" + k });
      const made = await repo.createMany("seedlings", Array.from({ length: 400 }, (_, i) => ({ cross_id: c.id, label: String(i + 1) })));
      for (let i = 0; i < 400; i += 8) { await repo.addPhoto({ seedling_id: made[i].id, full: jpeg(k * 1000 + i, 2048), thumb: jpeg(k * 1000 + i + 1, 256) }); photos++; }
    }
    const counts = await repo.counts();
    assert.equal(counts.crosses, 3); assert.equal(counts.seedlings, 1200); assert.equal(counts.photos, photos);
    assert.deepEqual(await repo.verifyBlobs(), []);
    assert.equal((await repo.list("seedlings")).length, 1200);
    assert.ok(Date.now() - t0 < 60000, "took " + (Date.now() - t0) + " ms");
  });
}
