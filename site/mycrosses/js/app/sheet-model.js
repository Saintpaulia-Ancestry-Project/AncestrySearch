// The spreadsheet view's logic, with no DOM so Node tests can run it: rows, filter, sort, grouping, pasting, CSV, undo.
import { STATUSES } from "../core/schema.js";
import { compareLabels } from "../core/codes.js";
import { isRealDate } from "../core/validate.js";

export const STATUS_NAMES = { growing: "Growing", flowering: "Flowering", culled: "Culled", keeping: "Keeping", released: "Released" };

/** kind: how the cell is shown and edited. field: the seedling field it edits (none = read only). */
export const COLUMNS = [
  { id: "label", title: "No.", kind: "text", field: "label", width: 96, required: true },
  { id: "cross", title: "Cross", kind: "cross", width: 120 },
  { id: "seed_parent", title: "Seed parent", kind: "parent", width: 210, cross: true, nameField: "seed_parent_name", refField: "seed_parent_ref" },
  { id: "pollen_parent", title: "Pollen parent", kind: "parent", width: 210, cross: true, nameField: "pollen_parent_name", refField: "pollen_parent_ref" },
  { id: "photo", title: "Photo", kind: "photo", width: 84 },
  { id: "status", title: "Status", kind: "status", field: "status", width: 130 },
  { id: "description", title: "Description", kind: "text", field: "description", width: 280, long: true },
  { id: "traits", title: "Traits", kind: "traits", width: 200 },
  { id: "date_added", title: "Date added", kind: "date", field: "date_added", width: 140 },
  { id: "promoted_name", title: "Name", kind: "text", field: "promoted_name", width: 190 },
  { id: "notes", title: "Notes", kind: "text", field: "notes", width: 280, long: true },
];
export const COLUMN_IDS = COLUMNS.map((c) => c.id);
export const colById = (id) => COLUMNS.find((c) => c.id === id);
/** A column is editable when it edits a seedling field, or (parents) a field of the seedling's cross: every seedling of that cross shows the change. */
export const isEditable = (col) => !!(col && (col.field || col.cross));

/** One entry per live seedling, with its cross, photos and traits at hand. */
export function buildRows(crosses, seedlings, photos, traits) {
  const crossBy = new Map(crosses.map((c) => [c.id, c]));
  const photosBy = new Map(), traitsBy = new Map();
  for (const p of photos) { if (!photosBy.has(p.seedling_id)) photosBy.set(p.seedling_id, []); photosBy.get(p.seedling_id).push(p); }
  for (const t of traits) { if (!traitsBy.has(t.seedling_id)) traitsBy.set(t.seedling_id, []); traitsBy.get(t.seedling_id).push(t); }
  const out = [];
  for (const s of seedlings) {
    const cross = crossBy.get(s.cross_id);
    if (!cross) continue;                                       // its cross is in the Trash or erased
    out.push({ id: s.id, rec: s, cross, photos: photosBy.get(s.id) || [], traits: traitsBy.get(s.id) || [] });
  }
  return out;
}

export const crossLabel = (c) => c.code || [c.seed_parent_name, c.pollen_parent_name].filter(Boolean).join(" x ") || "(no code)";
export const traitsText = (row) => row.traits.map((t) => (t.value ? `${t.trait}: ${t.value}` : t.trait)).join("; ");

/** The text a cell shows (also what is searched, sorted and exported). */
export function cellText(row, colId) {
  const r = row.rec;
  switch (colId) {
    case "cross": return crossLabel(row.cross);
    case "seed_parent": case "pollen_parent": return row.cross[colById(colId).nameField] || "";
    case "photo": return row.photos.length ? String(row.photos.length) : "";
    case "traits": return traitsText(row);
    case "status": return STATUS_NAMES[r.status] || r.status || "";
    default: return r[colId] == null ? "" : String(r[colId]);
  }
}

export function filterRows(rows, { q = "", status = "", cross = "" } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (status && row.rec.status !== status) return false;
    if (cross && row.cross.id !== cross) return false;
    if (!words.length) return true;
    const hay = [crossLabel(row.cross), row.cross.seed_parent_name, row.cross.pollen_parent_name, row.cross.hybridizer, ...COLUMN_IDS.filter((c) => c !== "photo").map((c) => cellText(row, c))].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** sort: a column id or "" (cross, then number). Equal values keep the cross-then-number order, so the result is stable and predictable. */
export function sortRows(rows, { sort = "", dir = "asc" } = {}) {
  const base = (a, b) => compareLabels(crossLabel(a.cross), crossLabel(b.cross)) || (a.cross.id < b.cross.id ? -1 : a.cross.id > b.cross.id ? 1 : 0) || compareLabels(a.rec.label, b.rec.label) || (a.id < b.id ? -1 : 1);
  const out = [...rows];
  if (!sort || !colById(sort)) return out.sort(base);
  const sign = dir === "desc" ? -1 : 1;
  const key = (row) => (sort === "photo" ? row.photos.length : sort === "status" ? STATUSES.indexOf(row.rec.status) : cellText(row, sort));
  return out.sort((a, b) => {
    const x = key(a), y = key(b);
    if (typeof x === "number") return (x - y) * sign || base(a, b);
    if (x === "" && y !== "") return 1;                          // empty cells go last in either direction
    if (y === "" && x !== "") return -1;
    return compareLabels(x, y) * sign || base(a, b);
  });
}

/** The list the grid shows: rows, with a group heading before each cross when grouping (only meaningful with the default order). */
export function flatten(rows, { group = false } = {}) {
  if (!group) return rows.map((row) => ({ type: "row", row }));
  const out = []; let last = null, count = new Map();
  for (const row of rows) count.set(row.cross.id, (count.get(row.cross.id) || 0) + 1);
  for (const row of rows) {
    if (row.cross.id !== last) { out.push({ type: "group", cross: row.cross, count: count.get(row.cross.id) }); last = row.cross.id; }
    out.push({ type: "row", row });
  }
  return out;
}

// ---------------------------------------------------------------- text cells to values (typing and pasting)
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** "2026-11-23" or "23 Nov 2026" (how the app shows dates). Other spellings are refused rather than guessed (3/4/26 means different days in different countries). */
export function parseDateCell(text) {
  const t = String(text).trim();
  if (isRealDate(t)) return t;
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) { const d = `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (isRealDate(d)) return d; }
  }
  return null;
}

export function parseStatusCell(text) {
  const t = String(text).trim().toLowerCase();
  return STATUSES.find((s) => s === t || STATUS_NAMES[s].toLowerCase() === t) || null;
}

/** Turn the text of a cell into the value to store. Returns { ok: true, value } or { ok: false, error }. */
export function coerce(colId, text) {
  const col = colById(colId);
  if (!isEditable(col)) return { ok: false, error: `${col ? col.title : colId} cannot be edited here.` };
  const t = String(text ?? "");
  if (col.kind === "parent") { const v = t.replace(/[\r\n\t]+/g, " ").trim(); return v.length > 200 ? { ok: false, error: `${col.title} is longer than 200 characters.` } : { ok: true, value: v === "" ? null : v }; }
  if (col.kind === "status") { const s = parseStatusCell(t); return s ? { ok: true, value: s } : { ok: false, error: `"${t.trim()}" is not a status (${STATUSES.map((x) => STATUS_NAMES[x]).join(", ")}).` }; }
  if (col.kind === "date") { if (!t.trim()) return { ok: true, value: null }; const d = parseDateCell(t); return d ? { ok: true, value: d } : { ok: false, error: `"${t.trim()}" is not a date: write it as 2026-11-23 or 23 Nov 2026.` }; }
  const v = col.long ? t.replace(/\r\n?/g, "\n").trim() : t.replace(/[\r\n\t]+/g, " ").trim();
  if (col.required && !v) return { ok: false, error: `${col.title} cannot be empty.` };
  return { ok: true, value: v === "" ? null : v };
}

/** Tab-separated text as copied from a spreadsheet. Cells in double quotes may hold tabs, line breaks and "" for ". Returns a matrix of strings. */
export function parseTsv(text) {
  const s = String(text).replace(/\r\n?/g, "\n");
  const rows = []; let row = [], cell = "", i = 0, quoted = false, atCellStart = true;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; i++; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; atCellStart = true; i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; atCellStart = true; i++; continue; }
    cell += ch; atCellStart = false; i++;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * What a paste would change. rowsFrom: the rows from the selected one downward (group headings already left out); colIds: the visible columns from the
 * selected one to the right. Read-only columns are skipped over (their pasted text is ignored). Nothing is written when any cell is refused.
 * Returns { edits: [{ id, patch: {field: value}, before: {field: old} }], errors: [text], skippedRows, skippedCols }.
 */
export function planPaste(matrix, rowsFrom, colIds) {
  const edits = [], errors = [], crossEdits = new Map();
  const usable = matrix.length === 1 && matrix[0].length === 1 && matrix[0][0] === "" ? [] : matrix;
  const rowsUsed = Math.min(usable.length, rowsFrom.length);
  let skippedCols = 0;
  for (let i = 0; i < rowsUsed; i++) {
    const row = rowsFrom[i], patch = {}, before = {};
    usable[i].forEach((text, j) => {
      const colId = colIds[j];
      if (!colId) { skippedCols++; return; }
      const col = colById(colId);
      if (!isEditable(col)) return;
      const r = coerce(colId, text);
      if (!r.ok) { errors.push(`Row ${i + 1}, ${col.title}: ${r.error}`); return; }
      if (col.cross) {                                            // a parent: the change belongs to the cross (typed text = a name that is not linked)
        const cur = row.cross[col.nameField] ?? null;
        if (cur !== r.value) {
          const e = crossEdits.get(row.cross.id) || { table: "crosses", id: row.cross.id, patch: {}, before: {} };
          e.patch[col.nameField] = r.value; e.patch[col.refField] = null;
          if (!(col.nameField in e.before)) { e.before[col.nameField] = cur; e.before[col.refField] = row.cross[col.refField] ?? null; }
          crossEdits.set(row.cross.id, e);
        }
        return;
      }
      if ((row.rec[col.field] ?? null) !== r.value) { patch[col.field] = r.value; before[col.field] = row.rec[col.field] ?? null; }
    });
    if (Object.keys(patch).length) edits.push({ table: "seedlings", id: row.id, patch, before });
  }
  edits.push(...crossEdits.values());
  return { edits, errors, skippedRows: Math.max(0, usable.length - rowsUsed), skippedCols };
}

// ---------------------------------------------------------------- CSV export
const csvCell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;        // a spreadsheet would run it as a formula
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(rows, colIds) {
  const ids = colIds.includes("cross") ? colIds : ["cross", ...colIds];              // a row is always identified by its cross
  const cols = ids.map(colById).filter(Boolean);
  const lines = [cols.map((c) => csvCell(c.title)).join(",")];
  for (const row of rows) lines.push(cols.map((c) => csvCell(c.id === "cross" ? row.cross.code || crossLabel(row.cross) : cellText(row, c.id))).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- undo
export class UndoStack {
  constructor(limit = 200) { this.items = []; this.limit = limit; }
  push(entry) { this.items.push(entry); if (this.items.length > this.limit) this.items.shift(); }
  pop() { return this.items.pop() || null; }
  peek() { return this.items.length ? this.items[this.items.length - 1] : null; }
  clear() { this.items.length = 0; }
  get size() { return this.items.length; }
}
