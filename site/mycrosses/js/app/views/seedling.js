import { h, showDate } from "../dom.js";
import { STATUSES, STATUS_LABEL, statusChip, crossTitle, photoImg, field, formValues, msgOf, openPhoto } from "./common.js";
import { preparePhoto } from "../photos.js";

export async function seedlingPage(app, parts) {
  const { repo } = app;
  const s = await repo.get("seedlings", parts[1]);
  if (!s || s.erased) return h("p", {}, "That seedling does not exist. ", h("a", { href: "#/crosses" }, "Back to the crosses"));
  if (s.deleted) return h("p", {}, "That seedling is in the Trash. ", h("a", { href: "#/trash" }, "Open the Trash"));
  const cross = await repo.get("crosses", s.cross_id);
  const photos = await repo.photosOf(s.id), traits = await repo.traitsOf(s.id);
  const err = h("div", { class: "bad", role: "alert" });

  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    try { const r = await repo.update("seedlings", s.id, formValues(form)); app.dirty(); app.toast(r.changed.length ? "Saved." : "Nothing changed."); app.rerender(true); }
    catch (ex) { err.textContent = msgOf(ex); }
  } },
    h("div", { class: "fgrid" },
      field("Number in this cross", h("input", { type: "text", name: "label", value: s.label, required: true, maxlength: 20 })),
      field("Status", h("select", { name: "status" }, ...STATUSES.map((st) => h("option", { value: st, selected: st === s.status }, STATUS_LABEL[st])))),
      field("Description", h("textarea", { name: "description" }, s.description ?? ""), "Color, form, foliage, growth habit.", true),
      field("Notes", h("textarea", { name: "notes" }, s.notes ?? ""), null, true),
      field("Name (when kept or released)", h("input", { type: "text", name: "promoted_name", value: s.promoted_name ?? "" })),
      field("Date added", h("input", { type: "date", name: "date_added", value: s.date_added ?? "" }))),
    err, h("button", {}, "Save"));

  const root = h("div", {}, h("p", {}, cross ? h("a", { href: "#/cross/" + cross.id }, `← ${cross.code || crossTitle(cross)}`) : null),
    h("h1", {}, "Seedling " + s.label, " ", statusChip(s.status)), cross ? h("p", { class: "muted" }, crossTitle(cross)) : null, form);

  // photos
  root.append(h("h2", {}, `Photos (${photos.length})`));
  const grid = h("div", { class: "photos" });
  for (const p of photos) {
    grid.append(h("figure", {}, h("div", { onclick: () => openPhoto(app, p) }, photoImg(app, p, { cls: "", alt: p.caption || "Seedling " + s.label })),
      h("figcaption", { class: "muted" }, p.caption || p.taken_on || "", " ",
        h("button", { class: "danger", onclick: async () => { if (!confirm("Move this photo to the Trash?")) return; await repo.softDelete("photos", p.id); app.dirty(); app.rerender(true); } }, "Delete"))));
  }
  root.append(grid);
  const pErr = h("div", { class: "bad", role: "alert" });
  const take = async (e) => {
    pErr.textContent = "";
    try {
      for (const f of e.target.files) { const x = await preparePhoto(f); await repo.addPhoto({ seedling_id: s.id, full: x.full, thumb: x.thumb, width: x.width, height: x.height }); }
      e.target.value = ""; app.dirty(); app.rerender(true);
    } catch (ex) { pErr.textContent = msgOf(ex); }
  };
  root.append(h("div", { class: "panel" },
    h("label", { class: "btn" }, "Take a photo", h("input", { type: "file", accept: "image/*", capture: "environment", class: "sr", onchange: take })),
    h("label", { class: "btn secondary" }, "Choose photos…", h("input", { type: "file", accept: "image/*", multiple: true, class: "sr", onchange: take })),
    h("div", { class: "muted" }, "Photos are shrunk on this device (1000 px) and their location data is removed."), pErr));

  // traits
  root.append(h("h2", {}, "Traits"));
  if (traits.length) root.append(h("table", { class: "t" }, ...traits.map((t) => h("tr", {}, h("td", {}, t.trait), h("td", {}, t.value || ""), h("td", {}, h("button", { class: "secondary", onclick: async () => { await repo.softDelete("traits", t.id); app.dirty(); app.rerender(true); } }, "Remove"))))));
  const tErr = h("div", { class: "bad", role: "alert" });
  const tForm = h("form", { class: "row", onsubmit: async (e) => {
    e.preventDefault(); tErr.textContent = "";
    try { await repo.create("traits", { seedling_id: s.id, ...formValues(tForm) }); app.dirty(); app.rerender(true); } catch (ex) { tErr.textContent = msgOf(ex); }
  } }, h("input", { type: "text", name: "trait", placeholder: "Trait (for example bloom size)", "aria-label": "Trait", required: true, class: "mid" }), h("input", { type: "text", name: "value", placeholder: "Value", "aria-label": "Value", class: "mid" }), h("button", {}, "Add trait"));
  root.append(tForm, tErr);

  root.append(h("h2", {}, "Delete"), h("button", { class: "danger", onclick: async () => {
    if (!confirm("Move this seedling and its photos to the Trash? You can bring them back from the Trash.")) return;
    await repo.softDelete("seedlings", s.id); app.dirty(); app.toast("Moved to the Trash."); location.hash = cross ? "#/cross/" + cross.id : "#/crosses";
  } }, "Delete seedling…"));
  return root;
}
