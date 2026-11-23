import { h } from "../dom.js";
import { field, msgOf } from "./common.js";
import { shortId } from "../../core/ids.js";
import { exportSync } from "../../sync/export.js";
import { readSyncFile, planImport, applyImport } from "../../sync/import.js";
import { planRestore, applyRestore } from "../../sync/restore.js";

export async function syncPage(app) {
  const { repo } = app;
  const peers = [...new Set((await repo.syncLog()).map((e) => e.peer_device_id).filter(Boolean))];
  const root = h("div", {}, h("h1", {}, "Sync and backup"),
    h("p", {}, "A sync file holds all your crosses, seedlings and photos in one zip file. It moves your records between your own devices and is also your backup. The app never sends it anywhere: you save or share it yourself."),
    h("p", { class: "muted" }, "This device is ", h("code", {}, shortId(repo.deviceId)), "."));

  // ----- export
  const out = h("div", { class: "muted", role: "status" }), exErr = h("div", { class: "bad", role: "alert" });
  const mode = h("select", { id: "x-mode", onchange: () => { peerWrap.hidden = mode.value !== "incremental"; } }, h("option", { value: "full" }, "Everything (also a full backup)"), h("option", { value: "incremental" }, "Only changes since the last file for another device"));
  const peer = h("select", { id: "x-peer" }, ...(peers.length ? peers.map((p) => h("option", { value: p }, shortId(p))) : [h("option", { value: "" }, "(no other device yet: import a file from one first)")]));
  const peerWrap = h("label", { class: "f", hidden: true }, "For device", peer);
  const photos = h("select", { id: "x-photos" }, h("option", { value: "none" }, "Data only"), h("option", { value: "thumbs", selected: true }, "Thumbnails (small)"), h("option", { value: "all" }, "All photos (large)"));
  const pass = h("input", { type: "password", autocomplete: "new-password", id: "x-pass" });
  async function make() {
    exErr.textContent = "";
    const o = await exportSync(repo, { mode: mode.value, photos: photos.value, passphrase: pass.value || null, peerDeviceId: mode.value === "incremental" ? peer.value || null : null });
    out.textContent = `${o.name}: ${(o.blob.size / 1048576).toFixed(2)} MB, ${o.counts.crosses} crosses, ${o.counts.seedlings} seedlings, ${o.counts.photos} photos${o.encrypted ? ", protected by the passphrase" : ""}.`;
    return o;
  }
  const g = (fn) => async () => { try { await fn(); } catch (e) { if (e && e.name === "AbortError") return; exErr.textContent = msgOf(e); } };
  const buttons = [
    window.showSaveFilePicker ? h("button", { onclick: g(async () => { const o = await make(); const fh = await showSaveFilePicker({ suggestedName: o.name, types: [{ description: "Sync file", accept: { "application/zip": [".zip"] } }] }); const w = await fh.createWritable(); await w.write(o.blob); await w.close(); out.textContent += " Saved."; app.dirty(); }) }, "Choose where to save…") : null,
    navigator.share ? h("button", { onclick: g(async () => {
      const o = await make();
      const f = new File([o.blob], o.name + ".txt", { type: "text/plain" });      // Android Chrome only shares text types; the importer checks the content, not the name
      if (navigator.canShare && !navigator.canShare({ files: [f] })) throw new Error("This browser would not share the file. Use Download instead.");
      await navigator.share({ files: [f], title: o.name }); out.textContent += " Shared."; app.dirty();
    }) }, "Share…") : null,
    h("button", { class: "secondary", onclick: g(async () => { const o = await make(); const a = h("a", { href: URL.createObjectURL(o.blob), download: o.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); app.dirty(); }) }, "Download"),
  ];
  root.append(h("h2", {}, "Make a file"), h("div", { class: "panel" },
    field("Contents", mode), peerWrap, field("Photos", photos),
    field("Passphrase (optional)", pass, "Protects the file. If you lose the passphrase the file cannot be opened. Files without one can be read by anyone who gets them."),
    h("div", {}, ...buttons), out, exErr));

  // ----- import
  const summary = h("div", {}), inErr = h("div", { class: "bad", role: "alert" });
  const ipass = h("input", { type: "password", autocomplete: "off" });
  let pending = null;
  const apply = h("button", { disabled: true }, "Import (keep the newer edits)"), cancel = h("button", { class: "secondary", disabled: true }, "Cancel");
  const restoreBtn = h("button", { class: "secondary", disabled: true, onclick: () => showRestore() }, "Restore from this file\u2026");
  const restoreBox = h("div", {});
  const fileIn = h("input", { type: "file", id: "i-file" });
  const reset = () => { pending = null; apply.disabled = true; cancel.disabled = true; restoreBtn.disabled = true; restoreBox.replaceChildren(); fileIn.value = ""; };
  async function load() {
    pending = null; apply.disabled = true; cancel.disabled = true; restoreBtn.disabled = true; restoreBox.replaceChildren(); summary.replaceChildren(); inErr.textContent = "";
    const f = fileIn.files[0]; if (!f) return;
    try {
      const copy = new Blob([await f.arrayBuffer()]);                       // copy into memory now: Android can lose access to a picked file later
      const parsed = await readSyncFile(copy, { passphrase: ipass.value || null });
      const plan = await planImport(repo, parsed);
      pending = { parsed, plan }; summary.replaceChildren(planView(plan)); apply.disabled = plan.nothing_to_do; cancel.disabled = false; restoreBtn.disabled = false;
    } catch (e) { inErr.textContent = msgOf(e); }
  }
  fileIn.onchange = load; ipass.onchange = () => { if (fileIn.files[0]) load(); };
  cancel.onclick = () => { reset(); summary.replaceChildren(); };
  apply.onclick = async () => {
    if (!pending) return; apply.disabled = true; inErr.textContent = "";
    try { const r = await applyImport(repo, pending.parsed); reset(); summary.replaceChildren(h("p", { class: "ok" }, `Done: ${r.writes} record(s) written, ${r.photos_added} photo file(s) added.`)); app.dirty(); }
    catch (e) { inErr.textContent = msgOf(e); apply.disabled = false; }
  };

  // ----- restore: bring back values from the file, even where this device has newer edits
  const clip = (v) => { const t = v === null || v === undefined || v === "" ? "(empty)" : String(v).replace(/\s+/g, " "); return t.length > 160 ? t.slice(0, 160) + "\u2026" : t; };
  async function showRestore() {
    if (!pending) return;
    inErr.textContent = ""; restoreBox.replaceChildren(h("p", { class: "muted" }, "Comparing\u2026"));
    let rp;
    try { rp = await planRestore(repo, pending.parsed); } catch (e) { restoreBox.replaceChildren(); inErr.textContent = msgOf(e); return; }
    const c = rp.counts, picked = new Set();
    const keyOf = (it, f) => `${it.table}|${it.id}|${f}`;
    for (const it of rp.items) { for (const f of it.fields) picked.add(keyOf(it, f.field)); if (it.undelete) picked.add(keyOf(it, "(undelete)")); }
    const notes = [];
    if (c.erased_here) notes.push(`${c.erased_here} record(s) were erased for good on this device and cannot be brought back.`);
    if (c.deleted_in_backup) notes.push(`${c.deleted_in_backup} record(s) are in the Trash in the file but alive here: they are left alone.`);
    if (c.missing_here) notes.push(`${c.missing_here} record(s) in the file are not on this device at all; they are added.`);
    const head = h("div", {}, h("h3", {}, "Restore from this file"),
      h("p", {}, "Importing keeps whichever edit is newer, so it never brings back older text. Here you choose what to take from the file instead. The chosen values replace what is on this device and count as new edits, so they also reach your other devices."),
      c.records ? h("p", {}, h("b", {}, `${c.values} value(s) in ${c.records} record(s)`), " differ from the file and are newer here.") : h("p", { class: "ok" }, "Nothing differs: every value here already matches the file, or is older than it."),
      ...notes.map((t) => h("div", { class: "muted" }, t)));
    if (!c.records && !c.missing_here) { restoreBox.replaceChildren(head, h("button", { class: "secondary", onclick: () => restoreBox.replaceChildren() }, "Close")); return; }
    const boxes = new Map(), list = h("div", { class: "restore-list" });
    const countSel = () => picked.size;
    const goBtn = h("button", {}, "Restore");
    const updateGo = () => { goBtn.textContent = `Restore ${countSel()} selected value${countSel() === 1 ? "" : "s"}`; goBtn.disabled = !countSel() && !c.missing_here; };
    for (const it of rp.items.slice(0, 300)) {
      const rows = [];
      if (it.undelete) rows.push(restoreRow(it, "(undelete)", "In the Trash here. Bring it back."));
      for (const f of it.fields) rows.push(restoreRow(it, f.field, null, f));
      list.append(h("div", { class: "restore-item" }, h("div", { class: "t" }, it.title), ...rows));
    }
    function restoreRow(it, field, text, f) {
      const k = keyOf(it, field);
      const cb = h("input", { type: "checkbox", checked: true, "aria-label": f ? `${field.replace(/_/g, " ")} of ${it.title}` : "Bring back from the Trash", onchange: (e) => { if (e.target.checked) picked.add(k); else picked.delete(k); updateGo(); } });
      boxes.set(k, cb);
      return h("label", { class: "restore-row" }, cb, h("span", {}, f ? [h("b", {}, field.replace(/_/g, " ") + ": "), h("span", { class: "muted", title: String(f.here ?? "") }, "here "), h("span", { class: "was" }, "\u201C" + clip(f.here) + "\u201D"), h("span", { class: "muted" }, "  file "), h("span", { class: "willbe" }, "\u201C" + clip(f.backup) + "\u201D")] : text));
    }
    const setAll = (on) => { picked.clear(); if (on) for (const it of rp.items) { for (const f of it.fields) picked.add(keyOf(it, f.field)); if (it.undelete) picked.add(keyOf(it, "(undelete)")); } for (const [k, cb] of boxes) cb.checked = picked.has(k); updateGo(); };
    const safety = h("input", { type: "checkbox", checked: true });
    const result = h("div", { role: "status" });
    goBtn.onclick = async () => {
      if (!confirm(`Replace ${countSel()} value(s) on this device with the ones in the file? ${safety.checked ? "A safety copy of what is here now will be downloaded first." : "No safety copy will be made."}`)) return;
      goBtn.disabled = true; inErr.textContent = "";
      try {
        if (safety.checked) { const o = await exportSync(repo, { mode: "full", photos: "thumbs" }); const a = h("a", { href: URL.createObjectURL(o.blob), download: "before-restore-" + o.name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); }
        const by = new Map();
        for (const k of picked) { const [table, id, field] = k.split("|"); const key = table + "|" + id; if (!by.has(key)) by.set(key, { table, id, fields: [], undelete: false }); const p = by.get(key); if (field === "(undelete)") p.undelete = true; else p.fields.push(field); }
        const res = await applyRestore(repo, pending.parsed, [...by.values()]);
        app.dirty();
        const done = h("div", {}, h("p", { class: "ok" }, `Restored ${res.values} value(s) in ${res.records} record(s)${res.undeleted ? `, ${res.undeleted} brought back from the Trash` : ""}${res.merge.writes ? `; ${res.merge.writes} other record(s) merged from the file` : ""}.`),
          ...res.failed.map((f) => h("div", { class: "warn" }, `${f.label}: ${f.message}`)));
        reset(); summary.replaceChildren(); restoreBox.replaceChildren(done);
      } catch (e) { inErr.textContent = msgOf(e); goBtn.disabled = false; }
    };
    updateGo();
    restoreBox.replaceChildren(...[head, h("div", { class: "row" }, h("button", { class: "secondary", onclick: () => setAll(true) }, "Select all"), h("button", { class: "secondary", onclick: () => setAll(false) }, "Select none")),
      list, rp.items.length > 300 ? h("p", { class: "muted" }, `Showing the first 300 of ${rp.items.length} records. "Select all" covers all of them.`) : null,
      h("label", { class: "inline" }, safety, " Download a safety copy of what is on this device first (recommended)"), h("div", {}, goBtn, h("button", { class: "secondary", onclick: () => restoreBox.replaceChildren() }, "Close")), result].filter(Boolean));
  }
  root.append(h("h2", {}, "Read a file"), h("div", { class: "panel" },
    h("p", { class: "muted" }, "Choose a file made by this app on another device (or an earlier backup). You see what would change before anything is written."),
    field("File", fileIn), field("Passphrase (if the file is protected)", ipass), inErr, summary, apply, restoreBtn, cancel, restoreBox));
  return root;
}

function planView(p) {
  const t = p.tables, row = (n, label) => h("tr", {}, h("td", {}, label), h("td", {}, t[n].new), h("td", {}, t[n].updated), h("td", {}, t[n].unchanged), h("td", {}, t[n].conflicts));
  return h("div", {}, h("p", {}, "File from device ", h("b", {}, shortId(p.from.device_id)), `, made ${p.from.exported_at.replace("T", " ").slice(0, 16)} UTC (${p.from.mode === "full" ? "everything" : "changes only"}).`),
    h("table", { class: "t" }, h("tr", {}, h("th", {}, ""), h("th", {}, "New"), h("th", {}, "Updated"), h("th", {}, "Unchanged"), h("th", {}, "Conflicts")), row("crosses", "Crosses"), row("seedlings", "Seedlings"), row("photos", "Photos"), row("traits", "Traits")),
    h("p", {}, `Photo files to add: ${p.photos.to_add}.`),
    ...p.warnings.map((w) => h("div", { class: "warn" }, w.message)),
    p.conflicts_total ? h("div", {}, h("p", {}, "Where both devices changed the same thing, the later edit is kept:"), h("ul", {}, ...p.conflicts.slice(0, 10).map((c) => h("li", {}, `${c.table} ${c.field}: here “${c.local ?? ""}”, file “${c.remote ?? ""}” → ${c.winner === "remote" ? "the file's" : "this device's"} value is kept`)))) : null,
    p.nothing_to_do ? h("p", { class: "ok" }, "Nothing to import: this device already has everything in the file, or has newer edits of it.") : null,
    h("p", { class: "muted" }, "Importing keeps whichever edit is newer. To go back to older values in this file, use \u201CRestore from this file\u201D."));
}
