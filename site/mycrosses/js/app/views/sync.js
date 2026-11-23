import { h } from "../dom.js";
import { field, msgOf } from "./common.js";
import { shortId } from "../../core/ids.js";
import { exportSync } from "../../sync/export.js";
import { readSyncFile, planImport, applyImport } from "../../sync/import.js";

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
  const apply = h("button", { disabled: true }, "Import"), cancel = h("button", { class: "secondary", disabled: true }, "Cancel");
  const fileIn = h("input", { type: "file", id: "i-file" });
  const reset = () => { pending = null; apply.disabled = true; cancel.disabled = true; fileIn.value = ""; };
  async function load() {
    pending = null; apply.disabled = true; cancel.disabled = true; summary.replaceChildren(); inErr.textContent = "";
    const f = fileIn.files[0]; if (!f) return;
    try {
      const copy = new Blob([await f.arrayBuffer()]);                       // copy into memory now: Android can lose access to a picked file later
      const parsed = await readSyncFile(copy, { passphrase: ipass.value || null });
      const plan = await planImport(repo, parsed);
      pending = { parsed, plan }; summary.replaceChildren(planView(plan)); apply.disabled = plan.nothing_to_do; cancel.disabled = false;
    } catch (e) { inErr.textContent = msgOf(e); }
  }
  fileIn.onchange = load; ipass.onchange = () => { if (fileIn.files[0]) load(); };
  cancel.onclick = () => { reset(); summary.replaceChildren(); };
  apply.onclick = async () => {
    if (!pending) return; apply.disabled = true; inErr.textContent = "";
    try { const r = await applyImport(repo, pending.parsed); reset(); summary.replaceChildren(h("p", { class: "ok" }, `Done: ${r.writes} record(s) written, ${r.photos_added} photo file(s) added.`)); app.dirty(); }
    catch (e) { inErr.textContent = msgOf(e); apply.disabled = false; }
  };
  root.append(h("h2", {}, "Read a file"), h("div", { class: "panel" },
    h("p", { class: "muted" }, "Choose a file made by this app on another device (or an earlier backup). You see what would change before anything is written."),
    field("File", fileIn), field("Passphrase (if the file is protected)", ipass), inErr, summary, apply, cancel));
  return root;
}

function planView(p) {
  const t = p.tables, row = (n, label) => h("tr", {}, h("td", {}, label), h("td", {}, t[n].new), h("td", {}, t[n].updated), h("td", {}, t[n].unchanged), h("td", {}, t[n].conflicts));
  return h("div", {}, h("p", {}, "File from device ", h("b", {}, shortId(p.from.device_id)), `, made ${p.from.exported_at.replace("T", " ").slice(0, 16)} UTC (${p.from.mode === "full" ? "everything" : "changes only"}).`),
    h("table", { class: "t" }, h("tr", {}, h("th", {}, ""), h("th", {}, "New"), h("th", {}, "Updated"), h("th", {}, "Unchanged"), h("th", {}, "Conflicts")), row("crosses", "Crosses"), row("seedlings", "Seedlings"), row("photos", "Photos"), row("traits", "Traits")),
    h("p", {}, `Photo files to add: ${p.photos.to_add}.`),
    ...p.warnings.map((w) => h("div", { class: "warn" }, w.message)),
    p.conflicts_total ? h("div", {}, h("p", {}, "Where both devices changed the same thing, the later edit is kept:"), h("ul", {}, ...p.conflicts.slice(0, 10).map((c) => h("li", {}, `${c.table} ${c.field}: here “${c.local ?? ""}”, file “${c.remote ?? ""}” → ${c.winner === "remote" ? "the file's" : "this device's"} value is kept`)))) : null,
    p.nothing_to_do ? h("p", { class: "ok" }, "Nothing to import: this device already has everything in the file.") : null);
}
