// Stage 3/4 tests: the sync file. Runs in Node (memory storage) and in a browser (real IndexedDB), like suite.js.
import { Repo } from "../js/core/repo.js";
import { sha256Hex } from "../js/core/hash.js";
import { newId } from "../js/core/ids.js";
import { ZipWriter, openZip, crc32, deflateRaw, ZipError } from "../js/sync/zip.js";
import { encryptBlob, decryptBlob, isEncrypted, CryptoError } from "../js/sync/crypto.js";
import { exportSync } from "../js/sync/export.js";
import { readSyncFile, planImport, applyImport } from "../js/sync/import.js";
import { SyncFormatError, LIMITS as FORMAT_LIMITS } from "../js/sync/format.js";
import { mergeRecords } from "../js/sync/merge.js";
import { planRestore, applyRestore } from "../js/sync/restore.js";

const START = Date.parse("2026-11-23T10:00:00.000Z");
const jpeg = (seed, len = 64) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = (seed * 31 + i * 7) & 255; b[0] = 0xff; b[1] = 0xd8; return b; };
const enc = new TextEncoder();
const blobBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** Builds a zip by hand, with room for the defects a hostile file could have. */
async function craftZip(entries, { zip64 = false, eocdCount } = {}) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = e.data || new Uint8Array(0);
    const body = e.method === 8 ? await deflateRaw(data) : data;
    const crc = e.crc ?? crc32(data), usize = e.usize ?? data.length, csize = e.csize ?? body.length, off = e.offset ?? offset;
    const h = new Uint8Array(30), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, e.flags ?? 0x0800, true); dv.setUint16(8, e.method ?? 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, csize, true); dv.setUint32(22, usize, true); dv.setUint16(26, nameBytes.length, true);
    if (e.offset === undefined) { parts.push(h, nameBytes, body); offset += 30 + nameBytes.length + body.length; }
    central.push({ nameBytes, e, crc, usize, csize, off });
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const h = new Uint8Array(46), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true); dv.setUint16(8, c.e.flags ?? 0x0800, true); dv.setUint16(10, c.e.method ?? 0, true);
    dv.setUint32(16, c.crc, true); dv.setUint32(20, c.csize, true); dv.setUint32(24, c.usize, true); dv.setUint16(28, c.nameBytes.length, true); dv.setUint32(42, c.off, true);
    parts.push(h, c.nameBytes); cdSize += 46 + c.nameBytes.length;
  }
  const end = new Uint8Array(22), dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, eocdCount ?? entries.length, true); dv.setUint16(10, eocdCount ?? entries.length, true); dv.setUint32(12, cdSize, true); dv.setUint32(16, zip64 ? 0xffffffff : cdStart, true);
  parts.push(end);
  return new Blob(parts);
}

function failingAfter(adapter, n) {
  let puts = 0;
  return { open: () => adapter.open(), close: () => {}, tx: (names, mode, fn) => adapter.tx(names, mode, (t) => fn({ ...t, put: async (s, v) => { if (mode === "readwrite" && ++puts > n) throw new Error("simulated crash"); return t.put(s, v); } })) };
}

export function defineSyncTests({ test, assert, makeAdapter }) {
  async function device(startMs = START) {
    const adapter = await makeAdapter();
    let ms = startMs;
    const repo = await Repo.open({ adapter, now: () => ms });
    return { repo, adapter, set: (v) => { ms = v; }, adv: (d = 1000) => { ms += d; }, get ms() { return ms; } };
  }
  const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v);
  const snap = async (d) => JSON.stringify(sortDeep(await d.repo.snapshot()));     // same records, whatever order their keys were written in
  const blobCount = (d) => d.adapter.tx(["blobs"], "readonly", (t) => t.count("blobs"));
  const failsWith = async (code, fn) => { let err = null; try { await fn(); } catch (e) { err = e; } assert.ok(err, "expected an error with code " + code); assert.equal(err.code, code, err.message); return err; };

  /** Export from one device and import into another (dry run first, as the app does). */
  async function sync(from, to, exportOpts = {}, { passphrase = null } = {}) {
    const out = await exportSync(from.repo, { photos: "thumbs", ...exportOpts });
    const parsed = await readSyncFile(out.blob, { passphrase });
    const plan = await planImport(to.repo, parsed);
    const result = await applyImport(to.repo, parsed);
    return { out, plan, result };
  }
  async function seeded(a) {
    const c = await a.repo.create("crosses", { code: "GG-26-001", seed_parent_ref: "baby-pink", seed_parent_name: "Baby Pink", pollen_parent_name: "Unknown", date_made: "2026-03-01" });
    const [s1, s2] = await a.repo.createMany("seedlings", [{ cross_id: c.id, label: "1" }, { cross_id: c.id, label: "2" }]);
    return { c, s1, s2 };
  }

  // ------------------------------------------------------------------ zip layer
  test("zip: stored and deflated entries, unicode names, empty and many entries round-trip", async () => {
    const w = new ZipWriter({ timeMs: START });
    const text = enc.encode("hello hello hello hello ".repeat(200));
    await w.add("a.txt", text, { compress: true });
    await w.add("sub/Ñandú-é.bin", jpeg(1, 500));
    await w.add("empty.txt", new Uint8Array(0));
    for (let i = 0; i < 300; i++) await w.add(`many/${i}.dat`, jpeg(i, 10 + (i % 7)));
    const blob = w.finish();
    const z = await openZip(blob);
    assert.equal(z.names.length, 303);
    assert.equal(z.entries.get("a.txt").method, 8, "text is deflated");
    assert.equal(z.entries.get("sub/Ñandú-é.bin").method, 0, "photos are stored");
    assert.deepEqual([...(await z.read("a.txt"))], [...text]);
    assert.deepEqual([...(await z.read("sub/Ñandú-é.bin"))], [...jpeg(1, 500)]);
    assert.equal((await z.read("empty.txt")).length, 0);
    assert.deepEqual([...(await z.read("many/299.dat"))], [...jpeg(299, 10 + (299 % 7))]);
    await assert.rejects(() => z.read("nope"), ZipError);
  });

  test("zip: the writer refuses names the reader would refuse", async () => {
    const w = new ZipWriter();
    for (const bad of ["../x", "/abs", "C:/x", "a\\b", "a/../b", "dir/", "", "a\u0001b"]) await assert.rejects(() => w.add(bad, new Uint8Array(1)), ZipError);
    await w.add("ok", new Uint8Array(1));
    await assert.rejects(() => w.add("ok", new Uint8Array(1)), ZipError);
  });

  test("zip: hostile or damaged files are refused with a clear error", async () => {
    const good = new ZipWriter(); await good.add("a.txt", enc.encode("x".repeat(500)), { compress: true }); const goodBlob = good.finish();
    const bytes = await blobBytes(goodBlob);
    await assert.rejects(() => openZip(new Blob([new Uint8Array(10)])), ZipError);
    await assert.rejects(() => openZip(new Blob([enc.encode("this is just text, not a zip file at all.")])), ZipError);
    await assert.rejects(() => openZip(new Blob([bytes.subarray(0, bytes.length - 30)])), ZipError);            // cut off: no end record
    await assert.rejects(() => openZip(new Blob([bytes.subarray(0, 40)])), ZipError);
    for (const name of ["../evil.txt", "/etc/passwd", "a\\b.txt", "C:/x.txt", "x/../y.txt"]) { const b = await craftZip([{ name, data: enc.encode("x") }]); await assert.rejects(() => openZip(b), ZipError); }
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("1") }, { name: "a", data: enc.encode("2") }])), ZipError);                // same name twice
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("x"), flags: 0x0801 }])), ZipError);                                           // encrypted by zip
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("x"), method: 9 }])), ZipError);                                               // unknown method
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("x") }], { zip64: true })), ZipError);                                         // zip64 marker
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("xxxx") }, { name: "b", data: enc.encode("yyyy"), offset: 0 }])), ZipError);   // overlapping entries
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: enc.encode("x"), usize: 70 * 1024 * 1024 }]), { maxEntryBytes: 60 * 1024 * 1024 }), ZipError); // declared too big
    await assert.rejects(async () => openZip(await craftZip([{ name: "a", data: new Uint8Array(1) }, { name: "b", data: new Uint8Array(1) }, { name: "c", data: new Uint8Array(1) }]), { maxEntries: 2 }), ZipError);
    // a decompression bomb: tiny declared size, huge real content
    const bomb = await craftZip([{ name: "z", data: new Uint8Array(5 * 1024 * 1024), method: 8, usize: 1000 }]);
    const zb = await openZip(bomb);
    await assert.rejects(() => zb.read("z"), ZipError);
    // a wrong checksum
    const bad = await craftZip([{ name: "a", data: enc.encode("hello"), crc: 12345 }]);
    await assert.rejects(async () => (await openZip(bad)).read("a"), ZipError);
    // a changed byte inside a stored entry is caught by the checksum
    const w2 = new ZipWriter(); await w2.add("p.jpg", jpeg(5, 300)); const b2 = await blobBytes(w2.finish()); b2[60] ^= 0xff;
    await assert.rejects(async () => (await openZip(new Blob([b2]))).read("p.jpg"), ZipError);
  });

  // ------------------------------------------------------------------ passphrase
  test("crypto: round trip over several chunks; wrong passphrase, damage, cut-off and reordering are all refused", async () => {
    const plain = new Uint8Array(2.6 * 1024 * 1024).map((_, i) => (i * 13 + (i >> 8)) & 255);
    const blob = await encryptBlob(new Blob([plain]), "correct horse", { iterations: 1000 });
    assert.equal(await isEncrypted(blob), true);
    assert.equal(await isEncrypted(new Blob([plain])), false);
    const back = await decryptBlob(blob, "correct horse");
    assert.equal(back.size, plain.length);
    assert.deepEqual([...(await blobBytes(back)).subarray(0, 100)], [...plain.subarray(0, 100)]);
    assert.equal(await sha256Hex(await blobBytes(back)), await sha256Hex(plain));
    await assert.rejects(() => decryptBlob(blob, "wrong"), CryptoError);
    await assert.rejects(() => decryptBlob(blob, ""), CryptoError);
    const raw = await blobBytes(blob);
    const flipped = raw.slice(); flipped[raw.length - 40] ^= 1;
    await assert.rejects(() => decryptBlob(new Blob([flipped]), "correct horse"), CryptoError);
    await assert.rejects(() => decryptBlob(new Blob([raw.subarray(0, raw.length - 5)]), "correct horse"), CryptoError);
    // cut at a chunk boundary: remove the last chunk entirely
    const first = 36 + 4 + (1024 * 1024 + 16), second = first + 4 + (1024 * 1024 + 16);
    await assert.rejects(() => decryptBlob(new Blob([raw.subarray(0, second)]), "correct horse"), CryptoError);
    // swap chunk 1 and 2
    const swapped = new Uint8Array([...raw.subarray(0, 36), ...raw.subarray(first, second), ...raw.subarray(36, first), ...raw.subarray(second)]);
    await assert.rejects(() => decryptBlob(new Blob([swapped]), "correct horse"), CryptoError);
    const empty = await decryptBlob(await encryptBlob(new Blob([]), "x", { iterations: 1000 }), "x");
    assert.equal(empty.size, 0);
  });

  // ------------------------------------------------------------------ whole files between two devices
  test("sync: a full file gives the other device identical records; thumbnails come, full photos do not", async () => {
    const A = await device(), B = await device(START + 5000);
    const { c, s1 } = await seeded(A);
    await A.repo.addPhoto({ seedling_id: s1.id, full: jpeg(1, 400), thumb: jpeg(2, 40), width: 1000, height: 800 });
    const { plan, result, out } = await sync(A, B);
    assert.equal(plan.totals.new, 4); assert.equal(plan.totals.updated, 0); assert.equal(plan.photos.to_add, 1);
    assert.equal(result.writes, 4); assert.equal(result.photos_added, 1);
    assert.equal(await snap(A), await snap(B));
    assert.equal(out.manifest.counts.seedlings, 2);
    const p = (await B.repo.list("photos"))[0];
    assert.ok(await B.repo.getBlob(p.thumb_sha256), "the thumbnail arrived");
    assert.equal(await B.repo.getBlob(p.sha256), null, "the full photo did not (thumbnails only)");
    assert.equal((await B.repo.get("crosses", c.id)).seed_parent_name, "Baby Pink");
    assert.equal((await B.repo.syncLog()).length, 1);
    assert.equal((await B.repo.syncLog())[0].direction, "import");
  });

  test("sync: data only sends no photo files; 'all' sends the full photos later and only the missing ones are added", async () => {
    const A = await device(), B = await device(START + 5000);
    const { s1 } = await seeded(A);
    await A.repo.addPhoto({ seedling_id: s1.id, full: jpeg(1, 400), thumb: jpeg(2, 40) });
    const none = await sync(A, B, { photos: "none" });
    assert.equal(none.plan.photos.to_add, 0); assert.equal(await blobCount(B), 0);
    const thumbs = await sync(A, B, { photos: "thumbs" });
    assert.equal(thumbs.plan.totals.new, 0); assert.equal(thumbs.plan.photos.to_add, 1);
    const all = await sync(A, B, { photos: "all" });
    assert.equal(all.plan.photos.to_add, 1); assert.equal(all.plan.photos.already_here, 1);
    assert.equal(await blobCount(B), 2);
    const again = await sync(A, B, { photos: "all" });
    assert.equal(again.plan.photos.to_add, 0);
  });

  test("idempotence: importing the same file twice changes nothing the second time", async () => {
    const A = await device(), B = await device(START + 5000);
    const { s1 } = await seeded(A);
    await A.repo.addPhoto({ seedling_id: s1.id, full: jpeg(1, 400), thumb: jpeg(2, 40) });
    const out = await exportSync(A.repo, { photos: "all" });
    const first = await applyImport(B.repo, await readSyncFile(out.blob));
    assert.ok(first.writes > 0);
    const before = await snap(B);
    const seqBefore = await B.adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq"));
    const parsed = await readSyncFile(out.blob);
    const plan = await planImport(B.repo, parsed);
    assert.equal(plan.totals.new + plan.totals.updated, 0); assert.equal(plan.nothing_to_do, true);
    const second = await applyImport(B.repo, parsed);
    assert.equal(second.writes, 0); assert.equal(second.photos_added, 0);
    assert.equal(await snap(B), before);
    assert.deepEqual(await B.adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq")), seqBefore);
  });

  test("convergence: edits on both devices (different fields and new records), merged both ways, end identical and keep both edits", async () => {
    const A = await device(), B = await device(START + 777);
    const { c, s1, s2 } = await seeded(A);
    await sync(A, B);
    A.adv(); B.adv(1500);
    await A.repo.update("seedlings", s1.id, { notes: "note from A" });
    await B.repo.update("seedlings", s1.id, { description: "description from B" });
    await B.repo.update("seedlings", s2.id, { status: "flowering" });
    await A.repo.create("seedlings", { cross_id: c.id, label: "3" });
    await B.repo.create("seedlings", { cross_id: c.id, label: "4" });
    await sync(A, B); await sync(B, A);
    assert.equal(await snap(A), await snap(B));
    const merged = await A.repo.get("seedlings", s1.id);
    assert.equal(merged.notes, "note from A"); assert.equal(merged.description, "description from B");
    assert.equal((await A.repo.get("seedlings", s2.id)).status, "flowering");
    assert.equal((await A.repo.list("seedlings")).length, 4);
    await sync(A, B); await sync(B, A);
    assert.equal(await snap(A), await snap(B), "a second round changes nothing");
  });

  test("conflict: the same field edited on both devices: the later edit wins on both, and the dry run lists it", async () => {
    const A = await device(), B = await device(START + 10);
    const { s1 } = await seeded(A);
    await sync(A, B);
    A.adv(2000); B.adv(3000);
    await A.repo.update("seedlings", s1.id, { description: "A's wording" });
    await B.repo.update("seedlings", s1.id, { description: "B's wording" });
    const toA = await sync(B, A);
    assert.equal(toA.plan.totals.conflicts, 1);
    assert.equal(toA.plan.conflicts[0].field, "description"); assert.equal(toA.plan.conflicts[0].winner, "remote");
    const toB = await sync(A, B);
    assert.equal(toB.plan.totals.conflicts, 0, "after B's version reached A, both hold the same value: nothing left to conflict");
    assert.equal((await A.repo.get("seedlings", s1.id)).description, "B's wording");
    assert.equal(await snap(A), await snap(B));
  });

  test("conflict: edits stamped in the very same millisecond are decided by the device id, the same way on both devices", async () => {
    const A = await device(), B = await device(START);
    const { s1 } = await seeded(A);
    await sync(A, B);
    A.set(START + 60000); B.set(START + 60000);
    await A.repo.update("seedlings", s1.id, { notes: "from A" });
    await B.repo.update("seedlings", s1.id, { notes: "from B" });
    await sync(A, B); await sync(B, A);
    assert.equal(await snap(A), await snap(B));
    const winner = A.repo.deviceId > B.repo.deviceId ? "from A" : "from B";
    assert.equal((await A.repo.get("seedlings", s1.id)).notes, winner);
  });

  test("clock: a device whose clock runs behind still has its later edit win after it has received newer ones", async () => {
    const A = await device(START), B = await device(START - 10 * 60000);     // B is ten minutes behind
    const { s1 } = await seeded(A);
    await sync(A, B);
    A.adv(5000);
    await A.repo.update("seedlings", s1.id, { notes: "A edits first" });
    await sync(A, B);                                                          // B now knows A's stamp
    B.adv(1000);
    await B.repo.update("seedlings", s1.id, { notes: "B edits second (by the real clock too)" });
    await sync(B, A);
    assert.equal((await A.repo.get("seedlings", s1.id)).notes, "B edits second (by the real clock too)");
    assert.equal(await snap(A), await snap(B));
  });

  test("clock: a sending device whose clock is more than a day ahead is reported in the dry run", async () => {
    const A = await device(START + 3 * 86400000), B = await device(START);
    await seeded(A);
    const parsed = await readSyncFile((await exportSync(A.repo)).blob);
    const plan = await planImport(B.repo, parsed);
    assert.ok(plan.warnings.some((w) => w.kind === "clock-ahead"));
    const same = await planImport(A.repo, parsed);
    assert.ok(same.warnings.some((w) => w.kind === "own-file"));
  });

  test("delete: a delete reaches the other device; a stale edit does not resurrect it, a newer restore does", async () => {
    const A = await device(), B = await device(START + 1);
    const { s1 } = await seeded(A);
    await sync(A, B);
    A.adv(10000); B.adv(2000);
    await B.repo.update("seedlings", s1.id, { notes: "stale edit on B (older than the delete)" });
    await A.repo.softDelete("seedlings", s1.id);
    await sync(B, A); await sync(A, B);
    for (const d of [A, B]) { const r = await d.repo.get("seedlings", s1.id); assert.equal(r.deleted, 1); assert.equal(r.notes, "stale edit on B (older than the delete)"); }
    assert.equal(await snap(A), await snap(B));
    B.adv(60000);
    await B.repo.restore("seedlings", s1.id);                                  // a newer restore on B
    await sync(B, A);
    assert.equal((await A.repo.get("seedlings", s1.id)).deleted, 0);
    assert.equal(await snap(A), await snap(B));
  });

  test("erase: an erase reaches the other device for good: content and photo files go, later edits cannot bring it back", async () => {
    const A = await device(), B = await device(START + 1);
    const { c, s1 } = await seeded(A);
    await A.repo.addPhoto({ seedling_id: s1.id, full: jpeg(1, 300), thumb: jpeg(2, 30) });
    await sync(A, B, { photos: "all" });
    assert.equal(await blobCount(B), 2);
    A.adv(5000); B.adv(9000);
    await B.repo.update("crosses", c.id, { notes: "B edits after A erased (by the clock: later)" });
    await A.repo.softDelete("crosses", c.id); await A.repo.erase("crosses", c.id);
    await sync(A, B); await sync(B, A);
    for (const d of [A, B]) {
      const r = await d.repo.get("crosses", c.id);
      assert.equal(r.erased, 1); assert.equal(r.notes, undefined);
      assert.equal((await d.repo.get("seedlings", s1.id)).erased, 1);
      assert.equal(await blobCount(d), 0);
    }
    assert.equal(await snap(A), await snap(B));
  });

  test("collisions: both devices add seedling 12 to the same cross: both are kept and flagged, never overwritten", async () => {
    const A = await device(), B = await device(START + 3);
    const { c } = await seeded(A);
    await sync(A, B);
    const a12 = await A.repo.create("seedlings", { cross_id: c.id, label: "12", description: "from A" });
    A.adv(); B.adv();
    const b12 = await B.repo.create("seedlings", { cross_id: c.id, label: "12", description: "from B" });
    const c2 = await B.repo.create("crosses", { code: "GG-26-001" });          // the same cross code picked on both devices
    await sync(A, B); await sync(B, A);
    for (const d of [A, B]) {
      const lc = await d.repo.labelCollisions();
      assert.equal(lc.length, 1); assert.deepEqual(lc[0].ids.sort(), [a12.id, b12.id].sort());
      assert.equal((await d.repo.get("seedlings", a12.id)).description, "from A");
      assert.equal((await d.repo.get("seedlings", b12.id)).description, "from B");
      assert.equal((await d.repo.duplicateCrossCodes()).length, 1);
    }
    assert.ok(c2);
    assert.equal(await snap(A), await snap(B));
  });

  test("photos: the same picture on two devices is stored once; a photo changed inside the file is refused and nothing is imported", async () => {
    const A = await device(), B = await device(START + 4);
    const { s1, s2 } = await seeded(A);
    const same = jpeg(9, 500);
    await A.repo.addPhoto({ seedling_id: s1.id, full: same, thumb: jpeg(10, 30) });
    await A.repo.addPhoto({ seedling_id: s2.id, full: same, thumb: jpeg(10, 30) });
    const out = await exportSync(A.repo, { photos: "all" });
    assert.equal(out.manifest.files.photos, 1, "one full file for two records");
    // tamper: rebuild the zip with one photo's bytes changed under the same name
    const z = await openZip(out.blob);
    const w = new ZipWriter({ timeMs: START });
    for (const name of z.names) {
      let data = await z.read(name);
      if (name.startsWith("photos/")) { data = data.slice(); data[100] ^= 0x55; }
      await w.add(name, data, { compress: name.endsWith(".jsonl") });
    }
    const before = await snap(B), blobsBefore = await blobCount(B);
    await failsWith("bad-photo", async () => planImport(B.repo, await readSyncFile(w.finish())));
    await failsWith("bad-photo", async () => applyImport(B.repo, await readSyncFile(w.finish())));
    assert.equal(await snap(B), before); assert.equal(await blobCount(B), blobsBefore);
    await sync(A, B, { photos: "all" });
    assert.equal(await blobCount(B), 2);
  });

  test("incremental: only what changed since the last file for that device, including records relayed from a third device", async () => {
    const A = await device(), B = await device(START + 1), C = await device(START + 2);
    const { s1, s2 } = await seeded(A);
    const first = await sync(A, B, { mode: "incremental", peerDeviceId: B.repo.deviceId });
    assert.equal(first.out.counts.crosses + first.out.counts.seedlings, 3);
    A.adv();
    await A.repo.update("seedlings", s1.id, { notes: "only this changed" });
    const second = await sync(A, B, { mode: "incremental", peerDeviceId: B.repo.deviceId });
    assert.equal(second.out.counts.seedlings, 1); assert.equal(second.out.counts.crosses, 0);
    assert.equal(second.out.manifest.since.peer_device_id, B.repo.deviceId);
    assert.equal(await snap(A), await snap(B));
    const nothing = await exportSync(A.repo, { mode: "incremental", peerDeviceId: B.repo.deviceId });
    assert.equal(nothing.counts.seedlings + nothing.counts.crosses, 0);
    // B relays to C what it got from A
    const relay = await sync(B, C, { mode: "incremental", peerDeviceId: C.repo.deviceId });
    assert.equal(relay.out.counts.seedlings, 2);
    assert.equal(await snap(C), await snap(A));
    assert.ok(s2);
    await assert.rejects(() => exportSync(A.repo, { mode: "incremental" }));
  });

  test("passphrase: a protected file needs it; the wrong one is refused; the right one gives the same result as an open file", async () => {
    const A = await device(), B = await device(START + 1), C = await device(START + 2);
    await seeded(A);
    const protectedOut = await exportSync(A.repo, { passphrase: "tomato", iterations: 1000 });
    assert.equal(protectedOut.encrypted, true);
    assert.equal(await isEncrypted(protectedOut.blob), true);
    await failsWith("needs-passphrase", () => readSyncFile(protectedOut.blob));
    await failsWith("wrong-passphrase", () => readSyncFile(protectedOut.blob, { passphrase: "potato" }));
    const parsed = await readSyncFile(protectedOut.blob, { passphrase: "tomato" });
    await applyImport(B.repo, parsed);
    await sync(A, C);
    assert.equal(await snap(B), await snap(C));
  });

  // ------------------------------------------------------------------ bad files
  async function goodParts(A) {
    const out = await exportSync(A.repo, { photos: "none" });
    const z = await openZip(out.blob);
    const parts = {};
    for (const n of z.names) parts[n] = await z.read(n);
    return parts;
  }
  async function build(parts, { compressJsonl = true } = {}) {
    const w = new ZipWriter({ timeMs: START });
    for (const [n, d] of Object.entries(parts)) await w.add(n, d, { compress: compressJsonl && n.endsWith(".jsonl") });
    return w.finish();
  }
  const withManifest = (parts, change) => { const m = JSON.parse(new TextDecoder().decode(parts["manifest.json"])); change(m); return { ...parts, "manifest.json": enc.encode(JSON.stringify(m)) }; };

  test("bad files: not a zip, truncated, newer schema, wrong format, damaged manifest or records are refused before anything changes", async () => {
    const A = await device(), B = await device(START + 1);
    await seeded(A);
    const parts = await goodParts(A);
    const before = await snap(B);
    const good = await build(parts);
    assert.equal((await readSyncFile(good)).manifest.counts.crosses, 1);
    await failsWith("not-zip", () => readSyncFile(new Blob([enc.encode("hello")])));
    const bytes = await blobBytes(good);
    await failsWith("not-zip", () => readSyncFile(new Blob([bytes.subarray(0, bytes.length - 50)])));
    await failsWith("newer-schema", async () => readSyncFile(await build(withManifest(parts, (m) => { m.schema_version = 99; }))));
    await failsWith("newer-schema", async () => readSyncFile(await build(withManifest(parts, (m) => { m.format_version = 2; }))));
    await failsWith("invalid", async () => readSyncFile(await build(withManifest(parts, (m) => { m.format = "something-else"; }))));
    await failsWith("invalid", async () => readSyncFile(await build(withManifest(parts, (m) => { m.counts.crosses = 7; }))));
    await failsWith("invalid", async () => readSyncFile(await build(withManifest(parts, (m) => { m.device_id = "nope"; }))));
    const noManifest = { ...parts }; delete noManifest["manifest.json"];
    await failsWith("invalid", async () => readSyncFile(await build(noManifest)));
    const noTable = { ...parts }; delete noTable["traits.jsonl"];
    await failsWith("invalid", async () => readSyncFile(await build(noTable)));
    const line = new TextDecoder().decode(parts["crosses.jsonl"]).trim();
    const tamper = (change) => { const r = JSON.parse(line); change(r); return { ...parts, "crosses.jsonl": enc.encode(JSON.stringify(r) + "\n") }; };
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { r.surprise = 1; }))));
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { r.id = "../../etc"; }))));
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { r.date_made = "2026-13-45"; }))));
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { delete r._t.notes; }))));
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { r._t.notes = "yesterday"; }))));
    await failsWith("bad-record", async () => readSyncFile(await build(tamper((r) => { r.seeds_sown = "many"; }))));
    await failsWith("bad-record", async () => readSyncFile(await build({ ...parts, "crosses.jsonl": enc.encode("{not json}\n") })));
    await failsWith("bad-record", async () => readSyncFile(await build({ ...withManifest(parts, (m) => { m.counts.crosses = 2; }), "crosses.jsonl": enc.encode(line + "\n" + line + "\n") })));  // the same id twice
    await failsWith("too-big", async () => readSyncFile(await build({ ...parts, [`photos/${"a".repeat(64)}.jpg`]: new Uint8Array(FORMAT_LIMITS.fullPhotoBytes + 1) })));
    await failsWith("not-zip", async () => readSyncFile(await craftZip([{ name: "../../evil", data: enc.encode("x") }])));
    assert.equal(await snap(B), before, "nothing was imported");
    const extra = await readSyncFile(await build({ ...parts, "README.txt": enc.encode("hello"), "photos/not-a-hash.jpg": enc.encode("x") }));
    assert.equal(extra.warnings[0].count, 2, "unknown but harmless files are ignored and reported");
  });

  test("atomic import: a crash in the middle of applying a file leaves the records exactly as they were", async () => {
    const A = await device(), B = await device(START + 1);
    const { c } = await seeded(A);
    await B.repo.create("crosses", { code: "B-own" });
    await sync(A, B);
    A.adv();
    await A.repo.create("seedlings", { cross_id: c.id, label: "9" });
    await A.repo.update("crosses", c.id, { notes: "changed" });
    const out = await exportSync(A.repo, { photos: "none" });
    const before = await snap(B), seqBefore = await B.adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq")), logBefore = (await B.repo.syncLog()).length;
    for (const n of [0, 1, 2]) {
      const broken = await Repo.open({ adapter: failingAfter(B.adapter, n), now: () => B.ms });
      await assert.rejects(async () => applyImport(broken, await readSyncFile(out.blob)), /simulated crash/);
    }
    assert.equal(await snap(B), before);
    assert.deepEqual(await B.adapter.tx(["meta"], "readonly", (t) => t.get("meta", "local_seq")), seqBefore);
    assert.equal((await B.repo.syncLog()).length, logBefore);
    await applyImport(B.repo, await readSyncFile(out.blob));
    assert.equal((await B.repo.get("crosses", c.id)).notes, "changed");
    assert.equal((await B.repo.list("seedlings")).length, 3);
    assert.equal((await B.repo.list("crosses")).length, 2, "B's own cross is untouched");
  });

  test("merge: orphans are flagged, not deleted: a seedling added on one device to a cross erased on another", async () => {
    const A = await device(), B = await device(START + 1);
    const { c } = await seeded(A);
    await sync(A, B);
    A.adv(5000); B.adv(2000);
    await A.repo.softDelete("crosses", c.id); await A.repo.erase("crosses", c.id);
    const late = await B.repo.create("seedlings", { cross_id: c.id, label: "7" });
    const out = await exportSync(A.repo, { photos: "none" });
    const plan = await planImport(B.repo, await readSyncFile(out.blob));
    assert.equal(plan.orphans, 1);
    assert.ok(plan.warnings.some((w) => w.kind === "orphans"));
    assert.ok(late);
  });

  test("merge: the merge itself is symmetric (a into b equals b into a) for random edits", async () => {
    const A = await device(), B = await device(START + 1);
    const { c, s1, s2 } = await seeded(A);
    await sync(A, B);
    const fields = ["notes", "description", "promoted_name", "status"];
    const values = { notes: ["x", "y", null], description: ["d1", "d2", null], promoted_name: ["P", "Q", null], status: ["growing", "flowering", "culled"] };
    let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 40; i++) {
      const dev = rnd(2) ? A : B, target = [s1, s2][rnd(2)], f = fields[rnd(4)];
      dev.adv(rnd(3) * 400);
      await dev.repo.update("seedlings", target.id, { [f]: values[f][rnd(values[f].length)] });
      if (rnd(7) === 0) await dev.repo.create("seedlings", { cross_id: c.id, label: String(100 + i) });
    }
    const ra = await A.repo.list("seedlings", { state: "all" }), rb = await B.repo.list("seedlings", { state: "all" });
    const byId = (list) => new Map(list.map((r) => [r.id, r]));
    const mb = byId(rb);
    for (const x of ra) {
      const y = mb.get(x.id);
      if (!y) continue;
      const xy = mergeRecords("seedlings", x, y).merged, yx = mergeRecords("seedlings", y, x).merged;
      assert.equal(JSON.stringify(xy, Object.keys(xy).sort()), JSON.stringify(yx, Object.keys(yx).sort()).replace(/\s/g, ""));
    }
    await sync(A, B); await sync(B, A);
    assert.equal(await snap(A), await snap(B));
  });

  test("scale: 3 crosses of 400 seedlings with photos: size of the file, time to import, and identical result", async () => {
    const A = await device(), B = await device(START + 1);
    for (let k = 0; k < 3; k++) {
      const c = await A.repo.create("crosses", { code: "SC-" + k, date_made: "2026-02-0" + (k + 1) });
      const made = await A.repo.createMany("seedlings", Array.from({ length: 400 }, (_, i) => ({ cross_id: c.id, label: String(i + 1), description: "Pink double, ruffled edge; seedling " + i })));
      for (let i = 0; i < 400; i += 3) await A.repo.addPhoto({ seedling_id: made[i].id, full: jpeg(k * 1000 + i, 20000), thumb: jpeg(k * 1000 + i + 1, 3000) });
    }
    const mem0 = typeof process !== "undefined" ? process.memoryUsage().rss : (performance.memory ? performance.memory.usedJSHeapSize : 0);
    const t0 = Date.now();
    const thumbs = await exportSync(A.repo, { photos: "thumbs" });
    const t1 = Date.now();
    const all = await exportSync(A.repo, { photos: "all" });
    const t2 = Date.now();
    const parsed = await readSyncFile(all.blob);
    const plan = await planImport(B.repo, parsed);
    const t3 = Date.now();
    await applyImport(B.repo, parsed);
    const t4 = Date.now();
    const mem1 = typeof process !== "undefined" ? process.memoryUsage().rss : (performance.memory ? performance.memory.usedJSHeapSize : 0);
    assert.equal(plan.totals.new, 3 + 1200 + 402, "3 crosses, 1,200 seedlings, 402 photo records");
    assert.equal(await snap(A), await snap(B));
    assert.deepEqual(await B.repo.verifyBlobs(), []);
    const note = `scale report: thumbnails file ${(thumbs.blob.size / 1048576).toFixed(2)} MB (${t1 - t0} ms), all-photos file ${(all.blob.size / 1048576).toFixed(2)} MB (${t2 - t1} ms), read+dry run ${t3 - t2} ms, apply ${t4 - t3} ms, memory ${(mem0 / 1048576).toFixed(0)} -> ${(mem1 / 1048576).toFixed(0)} MB`;
    globalThis.__scaleReport = note;
    console.log(note);
  });
  // ------------------------------------------------------------------ restoring from a backup (a normal import keeps the newer edit; restore goes back)
  async function backupOf(d, photos = "none") { const out = await exportSync(d.repo, { photos }); return readSyncFile(out.blob); }

  test("restore: a normal import cannot bring back older text, restore can, and it reaches other devices as a new edit", async () => {
    const A = await device(), B = await device(START + 7000);
    const c = await A.repo.create("crosses", { code: "R-1" });
    const [s] = await A.repo.createMany("seedlings", [{ cross_id: c.id, label: "1", description: "original text" }]);
    await sync(A, B);                                                           // B knows the same
    const backup = await backupOf(A);
    A.adv(60000); await A.repo.update("seedlings", s.id, { description: "edited later" });
    const plain = await planImport(A.repo, backup);
    assert.equal(plain.nothing_to_do, true, "the merge import changes nothing: the edit is newer than the backup " + JSON.stringify(plain.totals) + JSON.stringify(plain.tables));
    const plan = await planRestore(A.repo, backup);
    assert.equal(plan.items.length, 1); assert.equal(plan.counts.values, 1);
    assert.deepEqual(plan.items[0].fields, [{ field: "description", here: "edited later", backup: "original text" }]);
    A.adv(600000);                                                             // the restore happens well after everything else in this story
    const res = await applyRestore(A.repo, backup, [{ table: "seedlings", id: s.id }]);
    assert.equal(res.values, 1); assert.deepEqual(res.failed, []);
    assert.equal((await A.repo.get("seedlings", s.id)).description, "original text");
    assert.equal((await planRestore(A.repo, backup)).items.length, 0, "nothing left to restore");
    // the other device had "edited later" only after a sync; give it that, then let it receive the restored value
    B.adv(120000); await B.repo.update("seedlings", s.id, { description: "edited later" });
    A.adv(60000);
    const back = await sync(A, B);
    assert.equal(back.plan.totals.updated >= 1, true);
    assert.equal((await B.repo.get("seedlings", s.id)).description, "original text");
  });

  test("restore: only the chosen values come back; the rest stays as it is", async () => {
    const A = await device();
    const c = await A.repo.create("crosses", { code: "R-2" });
    const [s] = await A.repo.createMany("seedlings", [{ cross_id: c.id, label: "1", description: "d0", notes: "n0" }]);
    const backup = await backupOf(A);
    A.adv(5000); await A.repo.update("seedlings", s.id, { description: "d1", notes: "n1", status: "culled" });
    const plan = await planRestore(A.repo, backup);
    assert.deepEqual(plan.items[0].fields.map((f) => f.field).sort(), ["description", "notes", "status"]);
    A.adv(5000);
    await applyRestore(A.repo, backup, [{ table: "seedlings", id: s.id, fields: ["notes"] }]);
    const now = await A.repo.get("seedlings", s.id);
    assert.deepEqual([now.description, now.notes, now.status], ["d1", "n0", "culled"]);
  });

  test("restore: a record moved to the Trash since the backup comes back with its values; an erased one is reported, a missing one is imported", async () => {
    const A = await device();
    const c = await A.repo.create("crosses", { code: "R-3" });
    const [keep, trashed, gone] = await A.repo.createMany("seedlings", [{ cross_id: c.id, label: "1", notes: "keep" }, { cross_id: c.id, label: "2", notes: "to trash" }, { cross_id: c.id, label: "3", notes: "to erase" }]);
    const backup = await backupOf(A);
    A.adv(5000);
    await A.repo.softDelete("seedlings", trashed.id); await A.repo.softDelete("seedlings", gone.id); await A.repo.erase("seedlings", gone.id);
    const plan = await planRestore(A.repo, backup);
    assert.equal(plan.counts.undelete, 1); assert.equal(plan.counts.erased_here, 1);
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].undelete, true);
    A.adv(5000);
    const res = await applyRestore(A.repo, backup, [{ table: "seedlings", id: trashed.id, undelete: true }]);
    assert.equal(res.undeleted, 1);
    assert.equal((await A.repo.get("seedlings", trashed.id)).deleted, 0);
    assert.equal((await A.repo.get("seedlings", gone.id)).erased, 1, "erased stays erased");
    assert.equal((await A.repo.get("seedlings", keep.id)).notes, "keep");
    // a record the device never had arrives through the merge that restore starts with
    const C = await device(START + 9000);
    const r = await applyRestore(C.repo, backup, []);
    assert.equal(r.merge.writes >= 2, true);
    assert.equal((await C.repo.list("seedlings")).length, 3, "all three were alive when the backup was made");
  });

  test("restore: a value the repository refuses is reported, not thrown, and the others still restore", async () => {
    const A = await device();
    const c = await A.repo.create("crosses", { code: "R-4", date_made: "2026-01-01", date_harvested: "2026-02-01" });
    const backup = await backupOf(A);
    A.adv(5000);
    await A.repo.update("crosses", c.id, { date_harvested: "2026-03-01" });
    // later, the date of making moves after the restored harvest date, so restoring only the harvest date is refused by the date-order rule
    A.adv(5000); await A.repo.update("crosses", c.id, { date_made: "2026-02-15", date_harvested: "2026-04-01" });
    const plan = await planRestore(A.repo, backup);
    assert.equal(plan.items.length, 1);
    A.adv(5000);
    const res = await applyRestore(A.repo, backup, [{ table: "crosses", id: c.id, fields: ["date_harvested"] }]);
    assert.equal(res.failed.length, 1);
    assert.match(res.failed[0].message, /date/i);
    assert.equal((await A.repo.get("crosses", c.id)).date_harvested, "2026-04-01", "unchanged after the refusal");
    const all = await applyRestore(A.repo, backup, [{ table: "crosses", id: c.id }]);
    assert.deepEqual(all.failed, []);
    assert.deepEqual([(await A.repo.get("crosses", c.id)).date_made, (await A.repo.get("crosses", c.id)).date_harvested], ["2026-01-01", "2026-02-01"]);
  });

  test("restore: a backup from before a field existed does not blank that field", async () => {
    const A = await device();
    const c = await A.repo.create("crosses", { code: "R-5", hybridizer: "Rob" });
    const out = await exportSync(A.repo, { photos: "none" });
    const parsed = await readSyncFile(out.blob);
    for (const r of parsed.tables.crosses) { delete r.hybridizer; delete r._t.hybridizer; }       // what a version-1 backup looks like
    A.adv(5000);
    const plan = await planRestore(A.repo, parsed);
    assert.equal(plan.items.length, 0);
    assert.equal((await A.repo.get("crosses", c.id)).hybridizer, "Rob");
  });

  // ------------------------------------------------------------------ schema version 1 -> 2 (crosses.hybridizer was added)
  test("schema 1 data: opening migrates, old records without hybridizer export, import and then merge normally", async () => {
    const A = await device(), B = await device(START + 5000);
    const c = await A.repo.create("crosses", { code: "OLD-1", seed_parent_name: "X" });
    // make the stored record look like one written by version 1: no hybridizer value, no stamp for it, and the old version number
    await A.adapter.tx(["crosses", "meta"], "readwrite", async (t) => {
      const r = await t.get("crosses", c.id); delete r.hybridizer; delete r._t.hybridizer; await t.put("crosses", r);
      await t.put("meta", { key: "schema_version", value: 1 });
    });
    const again = await Repo.open({ adapter: A.adapter, now: () => A.ms });
    assert.equal((await A.adapter.tx(["meta"], "readonly", (t) => t.get("meta", "schema_version"))).value, 2);
    A.repo = again;
    const first = await sync(A, B);
    assert.equal(first.plan.totals.new, 1);
    const onB = await B.repo.get("crosses", c.id);
    assert.equal(onB.hybridizer ?? null, null);
    B.adv(); await B.repo.update("crosses", c.id, { hybridizer: "Rob Boolgooroo" });
    A.adv(60000);
    const back = await sync(B, A);
    assert.equal(back.plan.totals.updated, 1);
    assert.equal((await A.repo.get("crosses", c.id)).hybridizer, "Rob Boolgooroo");
  });
}
