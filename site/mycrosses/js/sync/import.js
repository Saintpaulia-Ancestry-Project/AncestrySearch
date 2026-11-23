// Reading and applying a sync file. Three steps, so nothing is changed until the user has seen the summary:
//   readSyncFile  -> checks the file completely (zip structure, manifest, every record) and changes nothing
//   planImport    -> the dry run: how many records are new / updated / unchanged / in conflict, how many photos would be added (also hashes every photo)
//   applyImport   -> photos first (content-addressed, harmless if the rest fails), then ALL records in one transaction
import { SYNC_TABLES } from "../core/schema.js";
import { parseStamp } from "../core/clock.js";
import { sha256Hex } from "../core/hash.js";
import { openZip, ZipError, DEFAULT_LIMITS } from "./zip.js";
import { isEncrypted, decryptBlob, CryptoError } from "./crypto.js";
import { SyncFormatError, LIMITS, classifyEntry, entryNames, checkManifest, recordProblems } from "./format.js";
import { mergeRecords } from "./merge.js";

const dec = new TextDecoder("utf-8", { fatal: true });

function toSyncError(err) {
  if (err instanceof SyncFormatError) return err;
  if (err instanceof CryptoError) return new SyncFormatError("wrong-passphrase", err.message);
  if (err instanceof ZipError) return new SyncFormatError("not-zip", err.message);
  return err;
}

function parseTable(bytes, table, expected) {
  let text;
  try { text = dec.decode(bytes); } catch (_) { throw new SyncFormatError("invalid", `${table}.jsonl is not valid text.`); }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length > LIMITS.recordsPerTable) throw new SyncFormatError("too-big", `${table}.jsonl has more than ${LIMITS.recordsPerTable} records.`);
  if (lines.length !== expected) throw new SyncFormatError("invalid", `${table}.jsonl has ${lines.length} records but the manifest says ${expected} (the file is damaged or was changed).`);
  const out = [], ids = new Set();
  lines.forEach((line, i) => {
    if (line.length > LIMITS.lineBytes) throw new SyncFormatError("too-big", `${table}.jsonl line ${i + 1} is too long.`);
    let rec;
    try { rec = JSON.parse(line); } catch (_) { throw new SyncFormatError("bad-record", `${table}.jsonl line ${i + 1} is not valid JSON.`); }
    const problems = recordProblems(table, rec);
    if (problems.length) throw new SyncFormatError("bad-record", `${table}.jsonl line ${i + 1} ${problems.slice(0, 3).join("; ")}.`);
    if (ids.has(rec.id)) throw new SyncFormatError("bad-record", `${table}.jsonl lists the id ${rec.id} twice.`);
    ids.add(rec.id);
    out.push(rec);
  });
  return out;
}

/** Opens and checks a sync file (a Blob/File). Throws SyncFormatError (codes: needs-passphrase, wrong-passphrase, not-zip, newer-schema, invalid, too-big, bad-record). */
export async function readSyncFile(blob, { passphrase = null } = {}) {
  try {
    if (await isEncrypted(blob)) {
      if (!passphrase) throw new SyncFormatError("needs-passphrase", "This file is protected by a passphrase. Enter it to open the file.");
      blob = await decryptBlob(blob, passphrase);
    }
    const zip = await openZip(blob, { maxEntryBytes: LIMITS.tableBytes });
    const warnings = [];
    const photoFiles = new Map();
    let unknown = 0;
    for (const name of zip.names) {
      const c = classifyEntry(name);
      if (c.kind === "unknown") { unknown++; continue; }
      if (c.kind === "photo" || c.kind === "thumb") {
        const limit = c.kind === "photo" ? LIMITS.fullPhotoBytes : LIMITS.thumbBytes;
        if (zip.size(name) > limit) throw new SyncFormatError("too-big", `The photo file ${name} is larger than ${limit / 1048576} MB.`);
        if (photoFiles.has(c.sha)) throw new SyncFormatError("invalid", "The same photo appears as both a full file and a thumbnail: " + c.sha.slice(0, 12));
        photoFiles.set(c.sha, { name, kind: c.kind, size: zip.size(name) });
      }
    }
    if (unknown) warnings.push({ kind: "unknown-files", count: unknown, message: `${unknown} file(s) in the zip are not part of the format and were ignored.` });
    if (!zip.has(entryNames.manifest)) throw new SyncFormatError("invalid", "This zip is not a sync file (there is no manifest.json).");
    if (zip.size(entryNames.manifest) > LIMITS.manifestBytes) throw new SyncFormatError("too-big", "The manifest is too large.");
    let manifest;
    try { manifest = JSON.parse(dec.decode(await zip.read(entryNames.manifest))); } catch (e) { if (e instanceof ZipError) throw e; throw new SyncFormatError("invalid", "The manifest is not readable."); }
    checkManifest(manifest);
    const tables = {};
    for (const t of SYNC_TABLES) {
      if (!zip.has(entryNames.table(t))) throw new SyncFormatError("invalid", `The sync file has no ${entryNames.table(t)}.`);
      tables[t] = parseTable(await zip.read(entryNames.table(t)), t, manifest.counts[t]);
    }
    return { manifest, tables, zip, photoFiles, warnings, verified: false };
  } catch (err) { throw toSyncError(err); }
}

async function localMaps(repo) {
  const maps = {};
  for (const t of SYNC_TABLES) maps[t] = new Map((await repo.list(t, { state: "all" })).map((r) => [r.id, r]));
  return maps;
}

/** Photo files the file carries that this device does not have yet, and which of those a photo record actually refers to. */
async function neededPhotoFiles(repo, parsed) {
  const have = new Set(await repo.adapter.tx(["blobs"], "readonly", async (t) => (await t.getAll("blobs")).map((b) => b.key)));
  const referenced = new Set();
  for (const p of parsed.tables.photos) { if (p.erased) continue; referenced.add(p.sha256); if (p.thumb_sha256) referenced.add(p.thumb_sha256); }
  for (const p of await repo.list("photos", { state: "all" })) { if (p.erased) continue; referenced.add(p.sha256); if (p.thumb_sha256) referenced.add(p.thumb_sha256); }
  const toAdd = [], unused = [];
  let already = 0;
  for (const [sha, f] of parsed.photoFiles) {
    if (have.has(sha)) already++;
    else if (!referenced.has(sha)) unused.push(sha);
    else toAdd.push([sha, f]);
  }
  return { toAdd, unused, already };
}

async function verifyFiles(parsed, toAdd) {
  for (const [sha, f] of toAdd) {
    const bytes = await parsed.zip.read(f.name);
    if ((await sha256Hex(bytes)) !== sha) throw new SyncFormatError("bad-photo", `The photo ${sha.slice(0, 12)}... does not match its name (the file was changed or damaged). Nothing was imported.`);
  }
}

function summarize(parsed, maps, lastSync, nowMs) {
  const tables = {}, writes = [], conflicts = [];
  let maxStamp = null, ahead = null;
  for (const t of SYNC_TABLES) {
    const c = { new: 0, updated: 0, unchanged: 0, conflicts: 0 };
    for (const remote of parsed.tables[t]) {
      for (const s of Object.values(remote._t)) {
        if (maxStamp === null || s > maxStamp) maxStamp = s;
        const ms = parseStamp(s).ms;
        if (ms > nowMs + LIMITS.maxFutureMs && (ahead === null || ms > ahead)) ahead = ms;
      }
      const r = mergeRecords(t, maps[t].get(remote.id), remote, { lastSync });
      c[r.status]++;
      if (r.status !== "unchanged") writes.push({ table: t, merged: r.merged });
      for (const k of r.conflicts) { c.conflicts++; conflicts.push({ table: t, id: remote.id, ...k }); }
    }
    tables[t] = c;
  }
  return { tables, writes, conflicts, maxStamp, ahead };
}

/** Records that belong to something erased on another device (kept, flagged: the user decides). */
function countOrphans(maps, writes) {
  const final = {};
  for (const t of SYNC_TABLES) final[t] = new Map(maps[t]);
  for (const w of writes) final[w.table].set(w.merged.id, w.merged);
  let n = 0;
  const gone = (table, id) => { const r = final[table].get(id); return r && r.erased; };
  for (const s of final.seedlings.values()) if (!s.erased && !s.deleted && gone("crosses", s.cross_id)) n++;
  for (const t of ["photos", "traits"]) for (const r of final[t].values()) if (!r.erased && !r.deleted && gone("seedlings", r.seedling_id)) n++;
  return n;
}

/** The dry run. Changes nothing. Hashes every photo that would be added, so a damaged photo is found now. */
export async function planImport(repo, parsed, { verifyPhotos = true } = {}) {
  const maps = await localMaps(repo);
  const { stamp: lastSync } = await repo.lastSync(parsed.manifest.device_id);
  const nowMs = repo.now();
  const s = summarize(parsed, maps, lastSync, nowMs);
  const files = await neededPhotoFiles(repo, parsed);
  if (verifyPhotos) { try { await verifyFiles(parsed, files.toAdd); } catch (e) { throw toSyncError(e); } parsed.verified = true; }
  const warnings = [...parsed.warnings];
  if (parsed.manifest.device_id === repo.deviceId) warnings.push({ kind: "own-file", message: "This file was made by this device, so it can only contain what is already here." });
  if (s.ahead) warnings.push({ kind: "clock-ahead", message: `The sending device's clock is ahead of this device by more than a day (${new Date(s.ahead).toISOString().slice(0, 10)}). Its edits will count as newer than anything you change before then.` });
  const orphans = countOrphans(maps, s.writes);
  if (orphans) warnings.push({ kind: "orphans", count: orphans, message: `${orphans} record(s) belong to something that was erased on another device. They are kept; move them to the Trash if you do not need them.` });
  const total = (k) => SYNC_TABLES.reduce((n, t) => n + s.tables[t][k], 0);
  return {
    from: { device_id: parsed.manifest.device_id, exported_at: parsed.manifest.exported_at, mode: parsed.manifest.mode, photos: parsed.manifest.photos },
    tables: s.tables,
    totals: { new: total("new"), updated: total("updated"), unchanged: total("unchanged"), conflicts: total("conflicts") },
    photos: { to_add: files.toAdd.length, already_here: files.already, ignored: files.unused.length },
    conflicts: s.conflicts.slice(0, 200), conflicts_total: s.conflicts.length,
    warnings, orphans,
    nothing_to_do: s.writes.length === 0 && files.toAdd.length === 0,
  };
}

/** Applies the file. Either everything in it is merged or the records stay exactly as they were. */
export async function applyImport(repo, parsed) {
  try {
    const files = await neededPhotoFiles(repo, parsed);
    if (!parsed.verified) await verifyFiles(parsed, files.toAdd);
    // photo files first: they are named by their content, so extra ones are harmless if the record step fails
    let photosAdded = 0;
    for (const [sha, f] of files.toAdd) {
      const bytes = await parsed.zip.read(f.name);
      await repo.adapter.tx(["blobs"], "readwrite", async (t) => { if (!(await t.get("blobs", sha))) await t.put("blobs", { key: sha, kind: f.kind === "photo" ? "full" : "thumb", bytes, size: bytes.length }); });
      photosAdded++;
    }
    const result = await repo.adapter.tx(["meta", ...SYNC_TABLES, "sync_log"], "readwrite", async (t) => {
      const maps = {};
      for (const tb of SYNC_TABLES) maps[tb] = new Map((await t.getAll(tb)).map((r) => [r.id, r]));
      const lastSyncRows = (await t.getAll("sync_log")).filter((e) => e.peer_device_id === parsed.manifest.device_id && e.stamp);
      const lastSync = lastSyncRows.reduce((a, e) => (a === null || e.stamp > a ? e.stamp : a), null);
      const s = summarize(parsed, maps, lastSync, repo.now());
      const ctx = await repo._ctx(t);
      for (const w of s.writes) await t.put(w.table, { ...w.merged, local_seq: ctx.seq() });
      if (s.maxStamp) ctx.observe(s.maxStamp);
      const counts = Object.fromEntries(SYNC_TABLES.map((tb) => [tb, s.tables[tb]]));
      await t.put("sync_log", { device_id: repo.deviceId, peer_device_id: parsed.manifest.device_id, direction: "import", at: new Date(repo.now()).toISOString(), counts: { ...Object.fromEntries(SYNC_TABLES.map((tb) => [tb, s.tables[tb].new + s.tables[tb].updated])), photo_files: photosAdded }, stamp: s.maxStamp });
      await ctx.flush();
      return { tables: counts, conflicts: s.conflicts, writes: s.writes.length };
    });
    await repo.cleanOrphanBlobs();           // files of records that were erased by this import, or left over from an earlier failure
    return { ...result, photos_added: photosAdded };
  } catch (err) {
    try { await repo.cleanOrphanBlobs(); } catch (_) { /* best effort */ }
    throw toSyncError(err);
  }
}

export { DEFAULT_LIMITS };
