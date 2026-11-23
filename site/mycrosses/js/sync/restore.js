// Restoring from a backup file. A normal import MERGES: for every value the later edit wins, so it can never bring back an older text
// (an edit made after the backup is "newer than the backup"). A backup is made to go back to, so this module lists every value that
// differs from the file and lets the person bring back the ones they choose. The restored values are written as NEW edits on this
// device: they win over everything older, and they travel to the other devices like any other edit.
//
//   planRestore(repo, parsed)           -> what differs, per record (changes nothing)
//   applyRestore(repo, parsed, picks)   -> normal merge first (new records, photo files), then the chosen values / undeletes
import { SYNC_TABLES } from "../core/schema.js";
import { mergeRecords, canon } from "./merge.js";
import { ownFields } from "./format.js";
import { applyImport } from "./import.js";

const natural = (a, b) => String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });

async function localMaps(repo) {
  const maps = {};
  for (const t of SYNC_TABLES) maps[t] = new Map((await repo.list(t, { state: "all" })).map((r) => [r.id, r]));
  return maps;
}

function titleOf(repo, table, rec, maps) {
  if (table === "seedlings") { const c = maps.crosses.get(rec.cross_id); return `Seedling ${rec.label}${c && !c.erased ? " of " + (c.code || "a cross") : ""}`; }
  if (table === "photos") { const s = maps.seedlings.get(rec.seedling_id); return `Photo of seedling ${s && !s.erased ? s.label : "?"}`; }
  if (table === "traits") { const s = maps.seedlings.get(rec.seedling_id); return `Trait ${rec.trait || ""} of seedling ${s && !s.erased ? s.label : "?"}`; }
  return repo._title(table, rec);
}

/** Nothing is changed. items: one entry per record that differs from the file. */
export async function planRestore(repo, parsed) {
  const maps = await localMaps(repo);
  const items = [], counts = { records: 0, values: 0, undelete: 0, erased_here: 0, deleted_in_backup: 0, missing_here: 0 };
  for (const table of SYNC_TABLES) {
    for (const remote of parsed.tables[table]) {
      const local = maps[table].get(remote.id);
      if (remote.erased) continue;
      if (!local) { counts.missing_here++; continue; }                       // the normal import brings it in
      if (local.erased) { counts.erased_here++; continue; }                  // erased for good: nothing to restore from
      const merged = mergeRecords(table, local, remote).merged;              // what a normal import would leave here
      if (merged.deleted && remote.deleted) continue;                         // in the Trash here and in the backup
      const fields = [];
      for (const f of ownFields(table)) {
        if (!(f in remote._t)) continue;                                      // a field the backup's app version did not have: it knows nothing to restore
        const backup = remote[f] === undefined ? null : remote[f], here = merged[f] === undefined ? null : merged[f];
        if (canon(backup) !== canon(here)) fields.push({ field: f, here, backup });
      }
      const undelete = !!(merged.deleted && !remote.deleted);
      if (!merged.deleted && remote.deleted) counts.deleted_in_backup++;
      if (!fields.length && !undelete) continue;
      counts.records++; counts.values += fields.length; if (undelete) counts.undelete++;
      items.push({ table, id: remote.id, title: titleOf(repo, table, merged, maps), fields, undelete });
    }
  }
  const order = Object.fromEntries(SYNC_TABLES.map((t, i) => [t, i]));
  items.sort((a, b) => order[a.table] - order[b.table] || natural(a.title, b.title) || (a.id < b.id ? -1 : 1));
  return { items, counts };
}

/**
 * picks: [{ table, id, fields: [names] | undefined (all), undelete: bool }]. The normal merge runs first, so records that are only in the file
 * and its photo files arrive too. Then each pick is written as an ordinary edit (validated like any other). Returns what happened.
 */
export async function applyRestore(repo, parsed, picks) {
  const merge = await applyImport(repo, parsed);
  const remoteBy = {};
  for (const t of SYNC_TABLES) remoteBy[t] = new Map(parsed.tables[t].map((r) => [r.id, r]));
  const done = { records: 0, values: 0, undeleted: 0 }, failed = [];
  for (const p of picks) {
    const remote = remoteBy[p.table] && remoteBy[p.table].get(p.id);
    if (!remote || remote.erased) continue;
    const label = `${p.table.replace(/s$/, "")} ${p.id.slice(0, 8)}`;
    try {
      if (p.undelete) { const r = await repo.restore(p.table, p.id); if (r.restored) done.undeleted++; }
      const wanted = (p.fields || ownFields(p.table)).filter((f) => f in remote._t);
      const patch = {};
      for (const f of wanted) patch[f] = remote[f] === undefined ? null : remote[f];
      const res = await repo.update(p.table, p.id, patch);
      if (res.changed.length) { done.records++; done.values += res.changed.length; }
    } catch (e) { failed.push({ id: p.id, table: p.table, message: (e && e.message) || String(e), label }); }
  }
  await repo.cleanOrphanBlobs();
  return { merge, ...done, failed };
}
