// Merging two versions of one record, field by field. Pure functions: no storage, no clock, so Node and the browser give identical answers.
//
// Rules (docs/sync-format.md):
//  1. Every field carries the stamp of its last edit. For each field the version with the LATER stamp wins. Stamps compare as text
//     (time, counter, device id), so every device picks the same winner; equal stamps with different values are decided by the value's text.
//  2. `deleted`, `deleted_at` and `deleted_via` are fields like any other: a delete wins only if it is the newer edit, a restore likewise.
//  3. Erase is final: an erased record (a tombstone) beats any version, whatever the stamps.
//  4. updated_at and device_id are DERIVED from the winning stamps (the newest stamp's time and device), created_at is the earlier of the two,
//     so merging A into B and B into A produces identical records.
import { stampTime, parseStamp } from "../core/clock.js";
import { ownFields, mergeableFieldsOf } from "./format.js";

// Text form with the keys sorted, so two records with the same content always compare equal whatever order their keys were written in.
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
export const canon = (v) => JSON.stringify(sorted(v === undefined ? null : v));
const newest = (stamps) => stamps.reduce((a, b) => (a > b ? a : b));

/** A copy without this device's private counter. */
export function publicRecord(r) { const { local_seq, ...rest } = r; return rest; }

function deriveFromStamps(rec) {
  const top = newest(Object.values(rec._t));
  rec.updated_at = stampTime(top);
  rec.device_id = parseStamp(top).device;
  return rec;
}

function pickTombstone(a, b) {
  if (a && a.erased && b && b.erased) {
    const t = { ...a, _t: { ...a._t } };
    for (const [f, s] of Object.entries(b._t)) if (!(f in t._t) || s > t._t[f]) t._t[f] = s;
    t.deleted_at = a.deleted_at && b.deleted_at ? (a.deleted_at < b.deleted_at ? a.deleted_at : b.deleted_at) : a.deleted_at || b.deleted_at;
    return deriveFromStamps(t);
  }
  return a && a.erased ? a : b;
}

/**
 * Merge `remote` into `local` (either can be missing). Returns { merged, status, fromRemote, conflicts }.
 *   status: "new" | "unchanged" | "updated"
 *   conflicts: fields where both sides hold different values that were each edited after the two devices last met (informational; the stamps decide the winner)
 *   lastSync: the stamp of the last meeting with the sending device (null if never): edits older than it cannot be in conflict.
 */
export function mergeRecords(table, local, remote, { lastSync = null } = {}) {
  if (!local) return { merged: publicRecord(remote), status: "new", fromRemote: mergeableFieldsOf(table).filter((f) => f in remote._t), conflicts: [] };
  if (local.erased || remote.erased) {
    const merged = publicRecord(pickTombstone(local, remote));
    return { merged, status: canon(publicRecord(local)) === canon(merged) ? "unchanged" : "updated", fromRemote: [], conflicts: [] };
  }
  const L = publicRecord(local);
  const merged = { id: L.id, ...Object.fromEntries(ownFields(table).map((f) => [f, L[f]])), created_at: L.created_at < remote.created_at ? L.created_at : remote.created_at, updated_at: null, device_id: null, deleted: L.deleted, deleted_at: L.deleted_at, deleted_via: L.deleted_via, erased: 0, _t: {} };
  const fromRemote = [], conflicts = [];
  for (const f of mergeableFieldsOf(table)) {
    const ls = L._t[f], rs = remote._t[f];
    let takeRemote;
    if (rs === undefined) takeRemote = false;
    else if (ls === undefined) takeRemote = true;
    else if (rs !== ls) takeRemote = rs > ls;
    else takeRemote = canon(remote[f]) > canon(L[f]);       // same stamp, different value: only a damaged or forged file; decide by value so both sides agree
    const winnerStamp = takeRemote ? rs : ls;
    if (takeRemote) { merged[f] = remote[f] === undefined ? null : remote[f]; fromRemote.push(f); } else merged[f] = L[f];
    merged._t[f] = winnerStamp;
    if (ls !== undefined && rs !== undefined && ls !== rs && canon(L[f]) !== canon(remote[f])) {
      const edited = (rec, s) => stampTime(s) !== rec.created_at;
      const afterMeeting = (s) => lastSync === null || s > lastSync;
      if (edited(L, ls) && edited(remote, rs) && afterMeeting(ls) && afterMeeting(rs)) conflicts.push({ field: f, local: L[f] ?? null, remote: remote[f] ?? null, winner: takeRemote ? "remote" : "local" });
    }
  }
  deriveFromStamps(merged);
  const changed = canon(publicRecord(local)) !== canon(merged);
  return { merged, status: changed ? "updated" : "unchanged", fromRemote: changed ? fromRemote : [], conflicts };
}
