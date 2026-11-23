// Spreadsheet view: one row per seedling, editable in place. Only the rows on screen are built (thousands of seedlings stay fast).
// Click or tap a cell and type, Enter / Tab / arrows move, Esc cancels, Delete clears, paste a block copied from a spreadsheet, Ctrl+Z undoes.
// Every edit is a normal per-field edit of the record (stamped, synced). Logic that needs no DOM lives in ../sheet-model.js.
import { h, showDate, blobUrl } from "../dom.js";
import { statusChip, STATUSES, STATUS_LABEL, msgOf } from "./common.js";
import { preparePhoto } from "../photos.js";
import { parentPicker } from "../picker.js";
import { refKind } from "../../core/ids.js";
import { compareLabels } from "../../core/codes.js";
import { COLUMNS, COLUMN_IDS, buildRows, filterRows, sortRows, flatten, cellText, coerce, parseTsv, planPaste, toCsv, UndoStack, crossLabel, isEditable } from "../sheet-model.js";

const COLS_KEY = "hybridizer-sheet-cols";
const OPEN_W = 64;
let gridId = 0;

function loadCols() {
  try { const a = JSON.parse(localStorage.getItem(COLS_KEY)); if (Array.isArray(a)) { const ok = COLUMN_IDS.filter((id) => a.includes(id)); if (ok.length) return ok.includes("label") ? ok : ["label", ...ok]; } } catch (_) { /* default */ }
  return COLUMN_IDS.slice();
}
const saveCols = (ids) => { try { localStorage.setItem(COLS_KEY, JSON.stringify(ids)); } catch (_) { /* not remembered */ } };

export async function sheetPage(app, parts, query) {
  const { repo } = app, gid = "sg" + ++gridId;
  const [crossesLive, seedlings, photos, traits, settings] = await Promise.all([repo.list("crosses"), repo.list("seedlings"), repo.list("photos"), repo.list("traits"), repo.getSettings()]);
  const crosses = [...crossesLive].sort((a, b) => compareLabels(crossLabel(a), crossLabel(b)));
  const ROW_H = settings.density === "compact" ? 36 : 48, HEAD_H = ROW_H, OVERSCAN = 6;
  const st = { q: (query.get("q") || "").trim(), status: query.get("status") || "", cross: query.get("cross") || "", sort: query.get("sort") || "", dir: query.get("dir") === "desc" ? "desc" : "asc", group: query.get("group") !== "0" };
  const chosen = loadCols(), visCols = COLUMNS.filter((c) => chosen.includes(c.id));
  const grouped = st.group && !st.sort;

  let all = buildRows(crossesLive, seedlings, photos, traits), items = [], rowIndex = new Map();
  const byId = () => new Map(all.map((r) => [r.id, r]));
  const rebuild = () => {
    items = flatten(sortRows(filterRows(all, st), st), { group: grouped });
    rowIndex = new Map(); items.forEach((it, i) => { if (it.type === "row") rowIndex.set(it.row.id, i); });
  };
  rebuild();

  const root = h("div", { class: "sheet" }, h("h1", {}, "Spreadsheet"));
  if (!crossesLive.length) { root.append(h("p", {}, "No crosses yet. ", h("a", { href: "#/cross/new" }, "Record a cross"), " first, then add its seedlings here or on the cross page.")); return root; }

  // ---------------------------------------------------------------- toolbar
  const hashFor = (o) => { const p = new URLSearchParams(); const m = { ...st, group: st.group ? "" : "0", ...o }; for (const k of ["q", "status", "cross", "sort", "dir", "group"]) if (m[k] && !(k === "dir" && !m.sort)) p.set(k, m[k]); const s = p.toString(); return "#/sheet" + (s ? "?" + s : ""); };
  const crossSel = h("select", { name: "cross", "aria-label": "Cross" }, h("option", { value: "" }, "All crosses"), ...crosses.map((c) => h("option", { value: c.id, selected: c.id === st.cross }, crossLabel(c))));
  const statusSel = h("select", { name: "status", "aria-label": "Status" }, h("option", { value: "" }, "Any status"), ...STATUSES.map((s) => h("option", { value: s, selected: s === st.status }, STATUS_LABEL[s])));
  const qInput = h("input", { type: "search", name: "q", value: st.q, placeholder: "Search every cell", "aria-label": "Search" });
  const groupBox = h("input", { type: "checkbox", name: "group", checked: grouped, disabled: !!st.sort });
  const bar = h("form", { class: "sheet-bar", role: "search", onsubmit: (e) => { e.preventDefault(); location.hash = hashFor({ q: qInput.value.trim(), status: statusSel.value, cross: crossSel.value, group: groupBox.checked || st.sort ? "" : "0" }); } },
    qInput, crossSel, statusSel, h("label", { class: "inline" }, groupBox, " Group by cross"), h("button", {}, "Apply"),
    st.sort ? h("a", { class: "btn secondary", href: hashFor({ sort: "", dir: "" }) }, "Clear sort") : null);
  root.append(bar);

  const chooser = h("details", { class: "colpick" }, h("summary", {}, "Columns"),
    h("div", {}, ...COLUMNS.map((c) => h("label", { class: "inline" }, h("input", { type: "checkbox", checked: chosen.includes(c.id), disabled: c.id === "label", onchange: (e) => { const now = new Set(chosen); if (e.target.checked) now.add(c.id); else now.delete(c.id); saveCols(COLUMN_IDS.filter((x) => now.has(x))); app.rerender(true); } }), " " + c.title))));
  const undo = new UndoStack(200), redo = new UndoStack(200);
  const undoBtn = h("button", { class: "secondary", disabled: true, onclick: () => doUndo() }, "Undo");
  const redoBtn = h("button", { class: "secondary", disabled: true, onclick: () => doRedo() }, "Redo");
  const count = h("span", { class: "muted", role: "status" });
  const addCross = h("select", { "aria-label": "Add a seedling to this cross" }, ...crosses.map((c) => h("option", { value: c.id, selected: c.id === (st.cross || crosses[crosses.length - 1].id) }, crossLabel(c))));
  const tools = h("div", { class: "row sheet-tools" }, chooser, undoBtn, redoBtn,
    h("button", { class: "secondary", onclick: exportCsv }, "Export CSV"),
    h("span", { class: "row" }, addCross, h("button", { onclick: () => addRow() }, "Add seedling")), count);
  root.append(tools);
  root.append(h("p", { class: "muted small" }, "Click a cell and type to change it. Enter and Tab move on, Esc cancels, Delete clears. Paste a block copied from a spreadsheet to fill several cells. Ctrl+Z undoes."));

  // ---------------------------------------------------------------- the grid
  const colsAll = [...visCols.map((c) => c.width), OPEN_W], template = colsAll.map((w) => w + "px").join(" "), totalW = colsAll.reduce((a, b) => a + b, 0);
  const scroll = h("div", { class: "sheet-scroll", role: "grid", tabindex: "0", "aria-label": "Seedlings", "aria-rowcount": String(items.length + 1), "aria-colcount": String(visCols.length + 1) });
  const inner = h("div", { class: "sheet-inner" }), body = h("div", { class: "sheet-body" });
  inner.style.width = totalW + "px";
  const head = h("div", { class: "srow shead", role: "row", "aria-rowindex": "1" });
  head.style.gridTemplateColumns = template; head.style.height = HEAD_H + "px";
  visCols.forEach((c, ci) => {
    const active = st.sort === c.id;
    const cell = h("div", { class: "cell hcell" + (ci === 0 ? " first" : ""), role: "columnheader", "aria-colindex": String(ci + 1), "aria-sort": active ? (st.dir === "desc" ? "descending" : "ascending") : "none" },
      h("a", { href: hashFor({ sort: active && st.dir === "desc" ? "" : c.id, dir: active && st.dir === "asc" ? "desc" : "asc" }), title: "Sort by " + c.title }, c.title, active ? (st.dir === "desc" ? " ▼" : " ▲") : ""));
    head.append(cell);
  });
  head.append(h("div", { class: "cell hcell", role: "columnheader", "aria-colindex": String(visCols.length + 1) }, ""));
  inner.append(head, body); scroll.append(inner); root.append(scroll);

  const first = items.find((i) => i.type === "row");
  let sel = { id: first ? first.row.id : null, col: 0 }, editing = null, busy = false, lastPointer = "mouse", lastFirst = -1, lastLast = -1;
  const urlCache = new Map();
  const selIndex = () => (sel.id !== null && rowIndex.has(sel.id) ? rowIndex.get(sel.id) : -1);
  const cellId = (i, ci) => `${gid}-${i}-${ci}`;

  function thumbImg(p) {
    const img = h("img", { class: "thumb sm", alt: "" }), sha = p.thumb_sha256 || p.sha256;
    const u = urlCache.get(sha);
    if (u) img.src = u; else repo.getBlob(sha).then((b) => { if (!b) return; const url = urlCache.get(sha) || blobUrl(b.bytes); urlCache.set(sha, url); img.src = url; }).catch(() => {});
    return img;
  }

  function cellContent(row, col) {
    const r = row.rec;
    switch (col.kind) {
      case "status": return [statusChip(r.status)];
      case "parent": {
        const name = row.cross[col.nameField], ref = row.cross[col.refField], k = refKind(ref);
        if (!name) return [""];
        return [name, k === "official" ? h("a", { class: "plink", href: "../#/c/" + encodeURIComponent(ref), target: "_blank", rel: "noopener noreferrer", title: "Official page", "aria-label": "Official page of " + name }, "\u2197")
          : k === "local" ? h("a", { class: "plink", href: "#/seedling/" + ref, title: "Your own seedling", "aria-label": "Open " + name }, "\u2197") : null];
      }
      case "date": return [showDate(r.date_added)];
      case "cross": return [h("a", { href: "#/cross/" + row.cross.id }, crossLabel(row.cross))];
      case "photo": return [row.photos[0] ? h("a", { href: "#/seedling/" + row.id, "aria-label": "Open seedling " + r.label }, thumbImg(row.photos[0])) : null, row.photos.length > 1 ? h("span", { class: "badge" }, String(row.photos.length)) : null,
        h("button", { class: "plus", "aria-label": "Add a photo to seedling " + r.label, title: "Add a photo", onclick: () => pickPhoto(row.id) }, "+")];
      default: return [cellText(row, col.id)];
    }
  }

  function rowEl(i) {
    const it = items[i], el = h("div", { class: "srow", role: "row", "aria-rowindex": String(i + 2) });
    el.style.gridTemplateColumns = template; el.style.height = ROW_H + "px";
    if (it.type === "group") {
      el.classList.add("sgroup");
      const g = h("div", { class: "gcell", role: "gridcell" }, h("a", { href: "#/cross/" + it.cross.id }, crossLabel(it.cross)), h("span", { class: "muted" }, ` · ${it.cross.seed_parent_name || "unknown"} × ${it.cross.pollen_parent_name || "unknown"} · ${it.count} seedling${it.count === 1 ? "" : "s"}`));
      g.style.gridColumn = "1 / -1"; el.append(g); return el;
    }
    const row = it.row, isSelRow = row.id === sel.id;
    visCols.forEach((col, ci) => {
      const cell = h("div", { class: "cell k-" + col.kind + (ci === 0 ? " first" : "") + (isSelRow && sel.col === ci ? " sel" : "") + (isEditable(col) ? " editable" : ""), role: "gridcell", id: cellId(i, ci), "aria-colindex": String(ci + 1), "aria-selected": String(isSelRow && sel.col === ci), "data-r": row.id, "data-c": String(ci) }, ...cellContent(row, col));
      if (col.kind === "text" || col.kind === "traits" || col.kind === "parent") cell.title = cellText(row, col.id);
      el.append(cell);
    });
    el.append(h("div", { class: "cell k-open", role: "gridcell", "aria-colindex": String(visCols.length + 1) }, h("a", { href: "#/seedling/" + row.id, "aria-label": "Open seedling " + row.rec.label }, "Open")));
    return el;
  }

  function renderWindow(force = false) {
    if (editing) return;
    const viewH = scroll.clientHeight || 600, top = Math.max(0, scroll.scrollTop - HEAD_H);
    const firstI = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN), lastI = Math.min(items.length, firstI + Math.ceil(viewH / ROW_H) + OVERSCAN * 2);
    if (!force && firstI === lastFirst && lastI === lastLast) return;
    lastFirst = firstI; lastLast = lastI;
    body.style.paddingTop = firstI * ROW_H + "px"; body.style.paddingBottom = (items.length - lastI) * ROW_H + "px";
    const frag = document.createDocumentFragment();
    for (let i = firstI; i < lastI; i++) frag.append(rowEl(i));
    body.replaceChildren(frag);
    const si = selIndex(); scroll.setAttribute("aria-activedescendant", si >= 0 ? cellId(si, sel.col) : "");
    count.textContent = `${rowIndex.size} of ${all.length} seedling${all.length === 1 ? "" : "s"}`;
    undoBtn.disabled = !undo.size; redoBtn.disabled = !redo.size;
    undoBtn.textContent = undo.size ? "Undo: " + undo.peek().label : "Undo"; redoBtn.textContent = redo.size ? "Redo: " + redo.peek().label : "Redo";
  }
  const refresh = () => renderWindow(true);

  function ensureVisible(i) {
    const rowTop = HEAD_H + i * ROW_H, viewH = scroll.clientHeight;
    if (rowTop < scroll.scrollTop + HEAD_H) scroll.scrollTop = rowTop - HEAD_H;
    else if (rowTop + ROW_H > scroll.scrollTop + viewH) scroll.scrollTop = rowTop + ROW_H - viewH;
    refresh();
    const el = document.getElementById(cellId(i, sel.col)); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function select(id, col) { sel = { id, col: Math.max(0, Math.min(visCols.length - 1, col)) }; const i = selIndex(); if (i >= 0) ensureVisible(i); }
  function stepRow(from, dir) { let i = from + dir; while (i >= 0 && i < items.length && items[i].type !== "row") i += dir; return i >= 0 && i < items.length ? i : -1; }
  function move(dr, dc) {
    let i = selIndex(), c = sel.col + dc;
    if (i < 0) return;
    if (dr) { const n = stepRow(i, dr); if (n >= 0) i = n; }
    if (c >= visCols.length) { const n = stepRow(i, 1); if (n >= 0) { i = n; c = 0; } else c = visCols.length - 1; }
    if (c < 0) { const n = stepRow(i, -1); if (n >= 0) { i = n; c = visCols.length - 1; } else c = 0; }
    select(items[i].row.id, c);
  }

  // ---------------------------------------------------------------- editing
  const toast = (m, bad, action) => app.toast(m, bad, action);
  /** Remember a change so it can be undone, and tell the person how (the button is on the message, because a phone has no Ctrl+Z). */
  function record(entry, label, msg) { entry.label = label; undo.push(entry); redo.clear(); toast(msg || `Changed ${label}.`, false, { label: "Undo", onclick: () => doUndo() }); }
  function startEdit(typed = null) {
    if (editing || busy) return;
    const i = selIndex(), col = visCols[sel.col]; if (i < 0 || !isEditable(col)) return;
    const row = items[i].row, cell = document.getElementById(cellId(i, sel.col)); if (!cell) return;
    const cur = col.cross ? (row.cross[col.nameField] ?? "") : (row.rec[col.field] ?? "");
    let ed, input = null, hidden = null;
    if (col.kind === "parent") { ed = parentPicker(app, { label: col.title, nameField: "name", refField: "ref", name: cur, ref: row.cross[col.refField] ?? "", excludeCrossId: row.cross.id }); input = ed.querySelector("input[type=text]"); hidden = ed.querySelector("input[type=hidden]"); }
    else if (col.kind === "status") ed = h("select", { "aria-label": col.title }, ...STATUSES.map((s) => h("option", { value: s, selected: s === row.rec.status }, STATUS_LABEL[s])));
    else if (col.kind === "date") ed = h("input", { type: "date", "aria-label": col.title, value: cur });
    else if (col.long) ed = h("textarea", { "aria-label": col.title, rows: 4 });
    else ed = h("input", { type: "text", "aria-label": col.title });
    if (col.kind === "text") ed.value = typed !== null ? typed : cur;
    else if (col.kind === "status" && typed) { const m = STATUSES.find((s) => STATUS_LABEL[s].toLowerCase().startsWith(typed.toLowerCase())); if (m) ed.value = m; }
    editing = { row, col, cell, ed, input, hidden, original: cur, done: false };
    cell.classList.add("editing"); if (col.long || col.kind === "parent") cell.classList.add("pop");
    cell.replaceChildren(ed); (input || ed).focus();
    if (input && typed !== null) { input.value = typed; input.dispatchEvent(new Event("input")); }
    if (col.kind === "text" && ed.setSelectionRange) { const n = ed.value.length; ed.setSelectionRange(typed !== null ? n : 0, n); }
    ed.addEventListener("keydown", (e) => {
      if (col.kind === "parent" && e.defaultPrevented) { e.stopPropagation(); return; }     // the picker used the key (choosing a suggestion, closing its list)
      if (e.key === "Enter" && !(col.long && e.shiftKey)) { e.preventDefault(); finish(true, 1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); finish(true, 0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    if (col.kind === "parent") ed.addEventListener("focusout", (e) => { if (editing && !editing.done && !ed.contains(e.relatedTarget)) setTimeout(() => { if (editing && !editing.done) finish(true, 0, 0, false); }, 200); });
    else ed.addEventListener("blur", () => { if (editing && !editing.done) finish(true, 0, 0, false); });
    if (col.kind === "status" || col.kind === "date") ed.addEventListener("change", () => { if (col.kind === "status") finish(true, 0, 0); });
  }

  async function finish(save, dr = 0, dc = 0, refocus = true) {
    if (!editing || editing.done) return;
    const e = editing; e.done = true;
    const text = e.input ? e.input.value : e.ed.value, linkRef = e.hidden ? e.hidden.value : ""; editing = null;
    let err = null;
    if (save && e.col.cross) {
      const name = text.trim(), c = e.row.cross, col = e.col;
      const patch = { [col.nameField]: name || null, [col.refField]: name && linkRef ? linkRef : null };
      if ((c[col.nameField] ?? null) !== patch[col.nameField] || (c[col.refField] ?? null) !== patch[col.refField]) {
        busy = true;
        try {
          const before = { [col.nameField]: c[col.nameField] ?? null, [col.refField]: c[col.refField] ?? null };
          const res = await repo.update("crosses", c.id, patch);
          setCross(res.record); app.dirty();
          record({ type: "edit", edits: [{ table: "crosses", id: c.id, patch, before }] }, `${col.title} of ${crossLabel(c)}`);
        } catch (ex) { err = msgOf(ex); } finally { busy = false; }
      }
    } else if (save) {
      const r = coerce(e.col.id, text);
      if (!r.ok) err = r.error;
      else if ((e.row.rec[e.col.field] ?? null) !== r.value) {
        busy = true;
        try {
          const before = e.row.rec[e.col.field] ?? null;
          const res = await repo.update("seedlings", e.row.id, { [e.col.field]: r.value });
          e.row.rec = res.record; app.dirty();
          record({ type: "edit", edits: [{ table: "seedlings", id: e.row.id, patch: { [e.col.field]: r.value }, before: { [e.col.field]: before } }] }, `${e.col.title} of seedling ${e.row.rec.label}`);
        } catch (ex) { err = msgOf(ex); } finally { busy = false; }
      }
    }
    refresh();
    if (err) toast(err, true);
    if (refocus) scroll.focus({ preventScroll: true });
    if (dr || dc) move(dr, dc);
  }

  /** A cross changed: every seedling row and group heading of that cross shows the new parents. */
  function setCross(rec) {
    for (const r of all) if (r.cross.id === rec.id) r.cross = rec;
    for (const it of items) if (it.type === "group" && it.cross.id === rec.id) it.cross = rec;
    const k = crossesLive.findIndex((c) => c.id === rec.id); if (k >= 0) crossesLive[k] = rec;
  }

  async function clearCell() {
    const i = selIndex(), col = visCols[sel.col]; if (i < 0 || !isEditable(col) || busy) return;
    const row = items[i].row, r = coerce(col.id, col.kind === "status" ? "" : "");
    if (col.cross) {
      const c = row.cross; if (!c[col.nameField] && !c[col.refField]) return;
      busy = true;
      try { const before = { [col.nameField]: c[col.nameField] ?? null, [col.refField]: c[col.refField] ?? null }, patch = { [col.nameField]: null, [col.refField]: null }; const res = await repo.update("crosses", c.id, patch); setCross(res.record); app.dirty(); record({ type: "edit", edits: [{ table: "crosses", id: c.id, patch, before }] }, `${col.title} of ${crossLabel(c)} cleared`); }
      catch (ex) { toast(msgOf(ex), true); } finally { busy = false; }
      return refresh();
    }
    if (col.kind === "status") return toast("A seedling always has a status: choose one.", true);
    if (!r.ok) return toast(r.error, true);
    if ((row.rec[col.field] ?? null) === null) return;
    busy = true;
    try { const before = row.rec[col.field]; const res = await repo.update("seedlings", row.id, { [col.field]: null }); row.rec = res.record; app.dirty(); record({ type: "edit", edits: [{ table: "seedlings", id: row.id, patch: { [col.field]: null }, before: { [col.field]: before } }] }, `${col.title} of seedling ${row.rec.label} cleared`); }
    catch (ex) { toast(msgOf(ex), true); } finally { busy = false; }
    refresh();
  }

  async function applyEdits(list, key) {                     // key: "patch" (forward) or "before" (undo)
    const rows = byId();
    for (const ed of key === "before" ? [...list].reverse() : list) {
      if (ed.table === "crosses") { const res = await repo.update("crosses", ed.id, ed[key]); setCross(res.record); continue; }
      const row = rows.get(ed.id); if (!row) continue;
      const res = await repo.update("seedlings", ed.id, ed[key]); row.rec = res.record;
    }
    app.dirty();
  }

  async function doUndo() {
    if (editing || busy) return;
    const entry = undo.pop(); if (!entry) return toast("Nothing to undo.");
    busy = true;
    try {
      if (entry.type === "add") { entry.row = all.find((r) => r.id === entry.id) || entry.row; await repo.softDelete("seedlings", entry.id); all = all.filter((r) => r.id !== entry.id); app.dirty(); rebuild(); if (sel.id === entry.id) { const f = items.find((x) => x.type === "row"); sel = { id: f ? f.row.id : null, col: sel.col }; } }
      else await applyEdits(entry.edits, "before");
      redo.push(entry);
      toast(`Undone: ${entry.label}.`, false, { label: "Redo", onclick: () => doRedo() });
    } catch (ex) { undo.push(entry); toast(msgOf(ex), true); } finally { busy = false; }
    refresh();
  }

  async function doRedo() {
    if (editing || busy) return;
    const entry = redo.pop(); if (!entry) return toast("Nothing to redo.");
    busy = true;
    try {
      if (entry.type === "add") { await repo.restore("seedlings", entry.id); entry.row.rec = await repo.get("seedlings", entry.id); all.push(entry.row); app.dirty(); rebuild(); }
      else await applyEdits(entry.edits, "patch");
      undo.push(entry);
      toast(`Redone: ${entry.label}.`, false, { label: "Undo", onclick: () => doUndo() });
    } catch (ex) { redo.push(entry); toast(msgOf(ex), true); } finally { busy = false; }
    refresh();
  }

  // ---------------------------------------------------------------- paste, copy, export, add
  scroll.addEventListener("paste", async (e) => {
    if (editing || busy) return;
    e.preventDefault();
    const i = selIndex(); if (i < 0) return;
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    const plan = planPaste(parseTsv(text), items.slice(i).filter((x) => x.type === "row").map((x) => x.row), visCols.slice(sel.col).map((c) => c.id));
    if (plan.errors.length) return toast(`Nothing pasted. ${plan.errors.slice(0, 3).join(" ")}${plan.errors.length > 3 ? ` (and ${plan.errors.length - 3} more)` : ""}`, true);
    if (!plan.edits.length) return toast("Nothing to change: the pasted text matches what is already there.");
    busy = true;
    try { await applyEdits(plan.edits, "patch"); undo.push({ type: "group", edits: plan.edits, label: `paste into ${plan.edits.length} record${plan.edits.length === 1 ? "" : "s"}` }); redo.clear(); }
    catch (ex) { toast(msgOf(ex), true); } finally { busy = false; }
    refresh();
    const extra = [plan.skippedRows ? `${plan.skippedRows} pasted row${plan.skippedRows === 1 ? "" : "s"} did not fit below` : "", plan.skippedCols ? `${plan.skippedCols} pasted column${plan.skippedCols === 1 ? "" : "s"} did not fit to the right` : ""].filter(Boolean).join("; ");
    toast(`Pasted into ${plan.edits.length} record${plan.edits.length === 1 ? "" : "s"}.${extra ? " " + extra + "." : ""}`, false, { label: "Undo", onclick: () => doUndo() });
  });
  scroll.addEventListener("copy", (e) => {
    if (editing) return;
    const i = selIndex(); if (i < 0) return;
    e.clipboardData.setData("text/plain", cellText(items[i].row, visCols[sel.col].id)); e.preventDefault();
  });

  function exportCsv() {
    const csv = "﻿" + toCsv(items.filter((x) => x.type === "row").map((x) => x.row), visCols.filter((c) => c.kind !== "photo").map((c) => c.id));
    const d = new Date(), name = `hybridizer-seedlings-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
    const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    toast(`${rowIndex.size} seedlings exported.`);
  }

  async function addRow() {
    if (editing || busy) return;
    busy = true;
    try {
      const crossId = addCross.value, cross = crossesLive.find((c) => c.id === crossId);
      const rec = await repo.create("seedlings", { cross_id: crossId, label: await repo.suggestLabel(crossId) });
      const row = { id: rec.id, rec, cross, photos: [], traits: [] };
      all.push(row); app.dirty(); undo.push({ type: "add", id: rec.id, row, label: `added seedling ${rec.label}` }); redo.clear(); rebuild();
      if (rowIndex.has(rec.id)) { select(rec.id, 0); toast(`Added seedling ${rec.label} to ${crossLabel(cross)}.`, false, { label: "Undo", onclick: () => doUndo() }); }
      else { toast(`Added seedling ${rec.label} to ${crossLabel(cross)}. The current search or filter hides it.`); refresh(); }
    } catch (ex) { toast(msgOf(ex), true); } finally { busy = false; }
  }

  const fileIn = h("input", { type: "file", accept: "image/*", capture: "environment", class: "sr", "aria-hidden": "true", tabindex: "-1" });
  let photoFor = null;
  const pickPhoto = (id) => { photoFor = id; fileIn.value = ""; fileIn.click(); };
  fileIn.addEventListener("change", async () => {
    const row = byId().get(photoFor), f = fileIn.files[0]; if (!row || !f) return;
    try { const x = await preparePhoto(f); const rec = await repo.addPhoto({ seedling_id: row.id, full: x.full, thumb: x.thumb, width: x.width, height: x.height }); row.photos.push(rec); app.dirty(); refresh(); toast("Photo added."); }
    catch (ex) { toast(msgOf(ex), true); }
  });
  root.append(fileIn);

  // ---------------------------------------------------------------- events
  scroll.addEventListener("scroll", () => { if (!scroll._raf) scroll._raf = requestAnimationFrame(() => { scroll._raf = 0; renderWindow(); }); });
  scroll.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; });
  scroll.addEventListener("click", (e) => {
    if (editing) return;
    const cell = e.target.closest && e.target.closest(".cell[data-r]");
    if (!cell || e.target.closest("a, button")) return;
    const id = cell.dataset.r, ci = Number(cell.dataset.c), same = sel.id === id && sel.col === ci;
    sel = { id, col: ci }; refresh(); scroll.focus({ preventScroll: true });
    if (same && lastPointer === "touch") startEdit();
  });
  scroll.addEventListener("dblclick", (e) => { const cell = e.target.closest && e.target.closest(".cell[data-r]"); if (cell && !e.target.closest("a, button") && !editing) { sel = { id: cell.dataset.r, col: Number(cell.dataset.c) }; refresh(); startEdit(); } });
  scroll.addEventListener("keydown", (e) => {
    if (editing || busy) return;
    const mod = e.ctrlKey || e.metaKey, page = Math.max(1, Math.floor((scroll.clientHeight - HEAD_H) / ROW_H) - 1);
    if (mod && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (mod && (e.key === "y" || e.key === "Y" || ((e.key === "z" || e.key === "Z") && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
    if (mod && e.key !== "Home" && e.key !== "End") return;                 // copy, paste and the browser's own shortcuts
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1, 0); break;
      case "ArrowUp": e.preventDefault(); move(-1, 0); break;
      case "ArrowRight": e.preventDefault(); move(0, 1); break;
      case "ArrowLeft": e.preventDefault(); move(0, -1); break;
      case "PageDown": e.preventDefault(); for (let k = 0; k < page; k++) move(1, 0); break;
      case "PageUp": e.preventDefault(); for (let k = 0; k < page; k++) move(-1, 0); break;
      case "Home": e.preventDefault(); if (mod) { const f = items.find((x) => x.type === "row"); if (f) select(f.row.id, 0); } else select(sel.id, 0); break;
      case "End": e.preventDefault(); if (mod) { const l = [...items].reverse().find((x) => x.type === "row"); if (l) select(l.row.id, visCols.length - 1); } else select(sel.id, visCols.length - 1); break;
      case "Enter": case "F2": e.preventDefault(); startEdit(); break;
      case "Delete": case "Backspace": e.preventDefault(); clearCell(); break;
      case "Tab": { const i = selIndex(), last = [...items].reverse().find((x) => x.type === "row"); const atEnd = !e.shiftKey && last && items[i] === last && sel.col === visCols.length - 1; const atStart = e.shiftKey && i === items.findIndex((x) => x.type === "row") && sel.col === 0; if (!atEnd && !atStart) { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); } break; }
      default:
        if (e.key.length === 1 && !e.altKey) { const col = visCols[sel.col]; if (isEditable(col)) { e.preventDefault(); startEdit(e.key); } }
    }
  });

  if (window.ResizeObserver) new ResizeObserver(() => renderWindow(true)).observe(scroll); else queueMicrotask(() => renderWindow(true));
  return root;
}
