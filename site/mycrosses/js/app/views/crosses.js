import { h, showDate } from "../dom.js";
import { STATUSES, STATUS_LABEL, statusChip, crossTitle, photoImg, field, formValues, msgOf } from "./common.js";
import { nextLabel } from "../../core/codes.js";
import { parentPicker } from "../picker.js";
import { thumbUrlOf, snapshotOf, loadOfficial } from "../official.js";
import { refKind } from "../../core/ids.js";

// ---------------------------------------------------------------- list
export async function crossesList(app, parts, query) {
  const { repo } = app;
  const crosses = await repo.list("crosses"), seedlings = await repo.list("seedlings");
  const per = new Map(); for (const s of seedlings) { if (!per.has(s.cross_id)) per.set(s.cross_id, []); per.get(s.cross_id).push(s); }
  const q = (query.get("q") || "").trim().toLowerCase(), status = query.get("status") || "";
  const hay = (c) => [c.code, c.hybridizer, c.seed_parent_name, c.pollen_parent_name, c.notes, c.date_made, ...(per.get(c.id) || []).flatMap((s) => [s.label, s.promoted_name, s.notes, s.description])].filter(Boolean).join(" ").toLowerCase();
  const words = q.split(/\s+x\s+|\s+/).filter(Boolean);                      // "baby pink x rob" or "pink baby": every word must appear, in any order
  let shown = crosses.filter((c) => words.every((w) => hay(c).includes(w)) && (!status || (per.get(c.id) || []).some((s) => s.status === status)));
  shown.sort((a, b) => ((b.date_made || b.created_at) > (a.date_made || a.created_at) ? 1 : -1));

  const root = h("div", {}, h("h1", {}, "Crosses"));
  const form = h("form", { class: "row", role: "search", onsubmit: (e) => { e.preventDefault(); const v = formValues(form); location.hash = "#/crosses?" + new URLSearchParams(Object.entries(v).filter(([, x]) => x)).toString(); } },
    h("input", { type: "search", name: "q", value: query.get("q") || "", placeholder: "Search parents, code, notes, seedlings", "aria-label": "Search crosses" }),
    h("select", { name: "status", "aria-label": "Seedling status" }, h("option", { value: "" }, "Any status"), ...STATUSES.map((s) => h("option", { value: s, selected: s === status }, STATUS_LABEL[s]))),
    h("button", {}, "Search"), h("a", { class: "btn", href: "#/cross/new" }, "New cross"));
  root.append(form);
  if (!crosses.length) { root.append(h("p", { class: "muted" }, "No crosses yet.")); return root; }
  root.append(h("p", { class: "muted" }, `${shown.length} of ${crosses.length} cross${crosses.length === 1 ? "" : "es"}.`));
  const cards = h("div", { class: "cards" });
  for (const c of shown) {
    const ss = per.get(c.id) || [], counts = STATUSES.map((st) => [st, ss.filter((s) => s.status === st).length]).filter(([, n]) => n);
    const thumb = h("div", { class: "thumb" });
    cards.append(h("a", { class: "card", href: "#/cross/" + c.id }, thumb,
      h("div", {}, h("div", { class: "t" }, c.code || "(no code)"), h("div", {}, crossTitle(c)), c.hybridizer ? h("div", { class: "muted" }, "Hybridizer: " + c.hybridizer) : null,
        h("div", { class: "muted" }, c.date_made ? "Made " + showDate(c.date_made) : "date made not entered", c.date_sown ? " · Sown " + showDate(c.date_sown) : "", " · ", `${ss.length} seedling${ss.length === 1 ? "" : "s"}`),
        h("div", {}, ...counts.map(([st, n]) => h("span", {}, statusChip(st), ` ${n} `))))));
    firstPhoto(app, ss).then((p) => { if (p) thumb.replaceWith(photoImg(app, p)); });
  }
  root.append(cards);
  return root;
}

async function firstPhoto(app, seedlings) {
  const ids = new Set(seedlings.map((s) => s.id));
  if (!ids.size) return null;
  if (!app._photoIndex || app._photoIndexAt !== app.dataVersion) { app._photoIndex = await app.repo.list("photos"); app._photoIndexAt = app.dataVersion; }
  return app._photoIndex.find((p) => ids.has(p.seedling_id)) || null;
}

// ---------------------------------------------------------------- form (new and edit)
export async function crossForm(app, parts) {
  const { repo } = app;
  const id = parts[1] === "new" ? null : parts[1];
  const c = id ? await repo.get("crosses", id) : null;
  if (id && (!c || c.erased)) return h("p", {}, "That cross does not exist.");
  const settings = await repo.getSettings();
  const v = c || { code: await repo.suggestCrossCode(), seed_stored: null, hybridizer: settings.hybridizer_name || "" };
  const others = (await repo.list("crosses")).filter((x) => !id || x.id !== id);
  const err = h("div", { class: "bad", role: "alert" });
  const inp = (name, type = "text", extra = {}) => h("input", { type, name, value: v[name] ?? "", ...extra });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const x = formValues(form); x.seed_stored = x.seed_stored === "" ? null : Number(x.seed_stored); x.remake_of = x.remake_of || null;
    x.seeds_sown = x.seeds_sown === "" ? null : x.seeds_sown;
    try {
      if (id) await repo.update("crosses", id, x); else { const rec = await repo.create("crosses", x); location.hash = "#/cross/" + rec.id; app.dirty(); return; }
      app.dirty(); app.toast("Saved."); location.hash = "#/cross/" + id;
    } catch (ex) { err.textContent = msgOf(ex); }
  } },
    h("div", { class: "fgrid" },
      field("Cross code", inp("code"), "Suggested from your initials, the year and a running number."),
      field("Date made", inp("date_made", "date")),
      parentPicker(app, { label: "Seed parent (the mother)", hint: "Type a name to search the official database and your own seedlings.", nameField: "seed_parent_name", refField: "seed_parent_ref", name: v.seed_parent_name ?? "", ref: v.seed_parent_ref ?? "", excludeCrossId: id }),
      parentPicker(app, { label: "Pollen parent (the father)", hint: "The same: pick from the list, or use the name as typed.", nameField: "pollen_parent_name", refField: "pollen_parent_ref", name: v.pollen_parent_name ?? "", ref: v.pollen_parent_ref ?? "", excludeCrossId: id }),
      field("Hybridizer", inp("hybridizer", "text", { required: true, maxlength: 200, value: v.hybridizer || settings.hybridizer_name || "" }), settings.hybridizer_name ? "Who made the cross. Filled in with your name from Settings; change it when the seeds came from someone else." : h("span", {}, "Who made the cross. Your own name goes here: set it once in ", h("a", { href: "#/settings" }, "Settings"), " and it is filled in for you.")),
      h("div", {}),
      field("Date seed harvested", inp("date_harvested", "date")),
      field("Seed stored?", h("select", { name: "seed_stored" }, h("option", { value: "" }, "Not recorded"), h("option", { value: "1", selected: v.seed_stored === 1 }, "Yes"), h("option", { value: "0", selected: v.seed_stored === 0 }, "No"))),
      field("Stored from", inp("stored_from", "date")),
      field("Stored until", inp("stored_to", "date")),
      field("How it was stored", inp("storage_notes"), "For example: in the refrigerator.", true),
      field("Date seed sown", inp("date_sown", "date")),
      field("Number of seeds sown", inp("seeds_sown", "number", { min: 0 })),
      field("Notes", h("textarea", { name: "notes" }, v.notes ?? ""), null, true),
      others.length ? field("This cross repeats an earlier one", h("select", { name: "remake_of" }, h("option", { value: "" }, "No"), ...others.map((o) => h("option", { value: o.id, selected: o.id === v.remake_of }, `${o.code || "(no code)"}: ${crossTitle(o)}`))), null, true) : null),
    err, h("button", {}, "Save"), h("a", { class: "btn secondary", href: id ? "#/cross/" + id : "#/crosses" }, "Cancel"));
  return h("div", {}, h("h1", {}, id ? "Edit cross" : "New cross"), form);
}


// ---------------------------------------------------------------- the parents on the cross page
async function parentLine(app, role, name, ref) {
  const kind = refKind(ref);
  const thumb = h("div", { class: "pthumb" }), text = h("div", { class: "grow" }, h("span", { class: "muted" }, role + ": "));
  const li = h("div", { class: "pline" }, thumb, text);
  const showThumb = (url, href) => {
    const img = h("img", { class: "thumb", alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => img.remove());                          // offline, or the photo moved: just no picture
    img.src = url;
    thumb.replaceChildren(href ? h("a", { href, target: href.startsWith("#") ? null : "_blank", rel: "noopener noreferrer", "aria-label": "Open " + (name || role) }, img) : img);
  };
  if (kind === "official") {
    const href = "../#/c/" + encodeURIComponent(ref);
    let snap = await app.repo.getOfficial(ref);
    const fill = () => {
      text.replaceChildren(h("span", { class: "muted" }, role + ": "), h("b", {}, (snap && snap.name) || name || ref), " ", h("a", { href, target: "_blank", rel: "noopener noreferrer" }, "official page"));
      const facts = snap ? [snap.hybridizer, snap.size_class, snap.registration_no ? "reg. " + snap.registration_no : null].filter(Boolean).join(" \u00B7 ") : "";
      if (facts) text.append(h("div", { class: "muted" }, facts));
      const u = thumbUrlOf(snap); if (u) showThumb(u, href);
    };
    fill();
    // a snapshot saved before photos were kept: refresh it once from the database (usually already in the browser's cache)
    if (snap && snap.photo === undefined) {
      loadOfficial().then(async (db) => { const rec = db.get(ref); if (rec) { snap = await app.repo.rememberOfficial(snapshotOf(rec, db.imageBase)); fill(); } }).catch(() => {});
    }
  } else if (kind === "local") {
    const s = await app.repo.get("seedlings", ref);
    if (s && !s.erased && !s.deleted) {
      text.append(h("b", {}, name || "Seedling " + s.label), " ", h("a", { href: "#/seedling/" + ref }, "your seedling"));
      const p = (await app.repo.photosOf(s.id))[0];
      if (p) { thumb.replaceChildren(h("a", { href: "#/seedling/" + ref, "aria-label": "Open " + (name || "seedling") }, photoImg(app, p))); }
    } else text.append(h("b", {}, name || "unknown"), h("span", { class: "muted" }, " (that seedling is no longer available)"));
  } else text.append(h("b", {}, name || "unknown"));
  return li;
}
async function parentsBlock(app, c) {
  return h("div", { class: "panel compact" }, await parentLine(app, "Seed parent", c.seed_parent_name, c.seed_parent_ref), await parentLine(app, "Pollen parent", c.pollen_parent_name, c.pollen_parent_ref),
    h("div", {}, h("span", { class: "muted" }, "Hybridizer: "), c.hybridizer ? h("b", {}, c.hybridizer) : h("span", { class: "muted" }, "not entered")));
}

// ---------------------------------------------------------------- the cross page
export async function crossPage(app, parts) {
  const { repo } = app;
  if (parts[1] === "new" || parts[2] === "edit") return crossForm(app, parts);
  const c = await repo.get("crosses", parts[1]);
  if (!c || c.erased) return h("p", {}, "That cross does not exist. ", h("a", { href: "#/crosses" }, "Back to the list"));
  if (c.deleted) return h("p", {}, "That cross is in the Trash. ", h("a", { href: "#/trash" }, "Open the Trash"));
  const seedlings = await repo.seedlingsOf(c.id), photos = await repo.list("photos");
  const byS = new Map(); for (const p of photos) { if (!byS.has(p.seedling_id)) byS.set(p.seedling_id, []); byS.get(p.seedling_id).push(p); }
  const dupCode = (await repo.duplicateCrossCodes()).find((d) => d.ids.includes(c.id));
  const collisions = (await repo.labelCollisions()).filter((x) => x.cross_id === c.id);
  const remake = c.remake_of ? await repo.get("crosses", c.remake_of) : null;

  const root = h("div", {}, h("p", {}, h("a", { href: "#/crosses" }, "← Crosses")), h("h1", {}, c.code || "(no code)"), await parentsBlock(app, c));
  if (dupCode) root.append(h("div", { class: "warn" }, `Another cross uses the code ${c.code} (probably made on another device). Change one of the codes: `, h("a", { href: `#/cross/${c.id}/edit` }, "edit this cross"), "."));
  const rows = [["Date made", showDate(c.date_made)], ["Date seed harvested", showDate(c.date_harvested)], ["Date seed sown", showDate(c.date_sown) || "not entered"], ["Number of seeds sown", c.seeds_sown], ["Notes", c.notes]].filter(([, x]) => x !== null && x !== "" && x !== undefined);
  root.append(h("dl", { class: "kv" }, ...rows.flatMap(([k, x]) => [h("dt", {}, k), h("dd", {}, String(x))]),
    remake ? [h("dt", {}, "Repeats"), h("dd", {}, h("a", { href: "#/cross/" + remake.id }, remake.code || crossTitle(remake)))] : null));
  root.append(h("div", { class: "row" }, h("a", { class: "btn secondary", href: `#/cross/${c.id}/edit` }, "Edit cross"),
    h("a", { class: "btn secondary", href: "#/sheet?cross=" + c.id }, "Spreadsheet"),
    h("button", { class: "danger", onclick: async () => { if (!confirm("Move this cross, its seedlings and photos to the Trash? You can bring them back from the Trash.")) return; await repo.softDelete("crosses", c.id); app.dirty(); app.toast("Moved to the Trash."); location.hash = "#/crosses"; } }, "Delete…")));

  root.append(h("h2", {}, `Seedlings (${seedlings.length})`));
  if (collisions.length) root.append(h("div", { class: "warn" }, "Some numbers are used twice: " + collisions.map((x) => x.label).join(", ") + ". Open each and change the number."));
  const cards = h("div", { class: "cards" });
  for (const s of seedlings) {
    const first = (byS.get(s.id) || [])[0];
    cards.append(h("div", { class: "card" }, first ? photoImg(app, first) : h("div", { class: "thumb" }),
      h("div", { class: "grow" }, h("a", { class: "t", href: "#/seedling/" + s.id }, "Seedling " + s.label + (s.promoted_name ? ` “${s.promoted_name}”` : "")),
        h("div", { class: "muted" }, (s.description || s.notes || "").slice(0, 80)),
        h("label", { class: "row" }, statusChip(s.status), h("select", { "aria-label": "Status of seedling " + s.label, onchange: async (e) => { await repo.update("seedlings", s.id, { status: e.target.value }); app.dirty(); app.toast(`Seedling ${s.label}: ${STATUS_LABEL[e.target.value]}.`); app.rerender(true); } },
          ...STATUSES.map((st) => h("option", { value: st, selected: st === s.status }, STATUS_LABEL[st])))))));
  }
  root.append(cards);

  const addErr = h("div", { class: "bad", role: "alert" });
  const nInput = h("input", { type: "number", min: 1, max: 500, value: 1, class: "narrow", "aria-label": "How many seedlings" });
  root.append(h("div", { class: "panel" }, h("b", {}, "Add seedlings "),
    h("div", { class: "row" }, nInput, h("button", { onclick: async () => {
      addErr.textContent = "";
      try {
        const n = Math.max(1, Math.min(500, parseInt(nInput.value, 10) || 1));
        const labels = []; let cur = await repo.suggestLabel(c.id);
        for (let i = 0; i < n; i++) { labels.push(cur); cur = nextLabel([...seedlings.map((s) => s.label), ...labels]); }
        await repo.createMany("seedlings", labels.map((label) => ({ cross_id: c.id, label })));
        app.dirty(); app.rerender(true);
      } catch (e) { addErr.textContent = msgOf(e); }
    } }, "Add"), h("span", { class: "muted" }, "Numbered one after another. Open a seedling to add its photo.")), addErr));
  return root;
}
