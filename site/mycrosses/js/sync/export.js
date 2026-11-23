// Making a sync file. The file is also a full backup when mode is "full".
import { SYNC_TABLES } from "../core/schema.js";
import { shortId } from "../core/ids.js";
import { ZipWriter } from "./zip.js";
import { encryptBlob } from "./crypto.js";
import { buildManifest, entryNames } from "./format.js";
import { publicRecord } from "./merge.js";

const enc = new TextEncoder();

/** One JSON object per line, keys in a fixed order (id first), so the same data always gives the same bytes. */
function jsonLine(rec) {
  const { id, ...rest } = publicRecord(rec);
  return JSON.stringify({ id, ...Object.fromEntries(Object.keys(rest).sort().map((k) => [k, rest[k]])) });
}

/**
 * options:
 *   mode: "full" (everything: records, Trash, tombstones) or "incremental" (records changed on this device since the last export to peerDeviceId)
 *   peerDeviceId: for incremental mode, the device the file is for
 *   photos: "none" (data only) | "thumbs" (default) | "all" (every photo file this device holds)
 *   passphrase: optional; the whole file is then encrypted
 * Returns { blob, name, manifest, counts, maxSeq, encrypted }.
 */
export async function exportSync(repo, { mode = "full", peerDeviceId = null, photos = "thumbs", passphrase = null, iterations } = {}) {
  if (!["full", "incremental"].includes(mode)) throw new Error("mode must be full or incremental");
  if (!["none", "thumbs", "all"].includes(photos)) throw new Error("photos must be none, thumbs or all");
  let sinceSeq = 0;
  if (mode === "incremental") {
    if (!peerDeviceId) throw new Error("an incremental file is made for one other device: choose it first");
    sinceSeq = (await repo.lastSync(peerDeviceId)).export_seq;
  }
  const exportedAt = new Date(repo.now()).toISOString();
  const zip = new ZipWriter({ timeMs: repo.now() });
  const counts = {}, tables = {};
  let maxSeq = sinceSeq, maxStamp = null;
  for (const t of SYNC_TABLES) {
    const all = await repo.list(t, { state: "all" });
    const chosen = all.filter((r) => r.local_seq > sinceSeq).sort((a, b) => (a.id < b.id ? -1 : 1));
    tables[t] = chosen;
    counts[t] = chosen.length;
    for (const r of chosen) {
      if (r.local_seq > maxSeq) maxSeq = r.local_seq;
      for (const s of Object.values(r._t)) if (maxStamp === null || s > maxStamp) maxStamp = s;
    }
  }
  // photo files: only for photo records in this file that still exist
  const wanted = [];                       // [entry name, sha]
  if (photos !== "none") {
    const seen = new Set();
    for (const p of tables.photos) {
      if (p.erased) continue;
      if (p.thumb_sha256 && !seen.has("t" + p.thumb_sha256)) { seen.add("t" + p.thumb_sha256); wanted.push([entryNames.thumb(p.thumb_sha256), p.thumb_sha256]); }
      if (photos === "all" && !seen.has("f" + p.sha256)) { seen.add("f" + p.sha256); wanted.push([entryNames.photo(p.sha256), p.sha256]); }
    }
  }
  const files = [];
  for (const [name, sha] of wanted) {
    const blob = await repo.getBlob(sha);
    if (blob) files.push([name, blob.bytes]);
  }
  const manifest = buildManifest({
    deviceId: repo.deviceId, exportedAt, mode, photos,
    since: mode === "incremental" ? { peer_device_id: peerDeviceId, local_seq: sinceSeq } : null,
    counts, files: { thumbs: files.filter(([n]) => n.startsWith("thumbs/")).length, photos: files.filter(([n]) => n.startsWith("photos/")).length },
  });
  await zip.add(entryNames.manifest, enc.encode(JSON.stringify(manifest, null, 1)), { compress: false });
  for (const t of SYNC_TABLES) await zip.add(entryNames.table(t), enc.encode(tables[t].map(jsonLine).join("\n") + (tables[t].length ? "\n" : "")), { compress: true });
  for (const [name, bytes] of files) await zip.add(name, bytes, { compress: false });
  let blob = zip.finish();
  const encrypted = !!passphrase;
  if (encrypted) blob = await encryptBlob(blob, passphrase, iterations ? { iterations } : undefined);
  const day = exportedAt.slice(0, 10);
  const name = `my-hybridizer-${shortId(repo.deviceId)}-${day}${mode === "incremental" ? "-changes" : ""}${photos === "all" ? "-photos" : ""}${encrypted ? "-protected" : ""}.zip`;
  await repo.logSync({ peer_device_id: peerDeviceId, direction: "export", counts: { ...counts, photo_files: files.length }, last_seq: maxSeq, stamp: maxStamp });
  return { blob, name, manifest, counts, maxSeq, encrypted };
}
