import { h, blobUrl } from "../dom.js";
import { STATUSES } from "../../core/schema.js";

export const STATUS_LABEL = { growing: "Growing", flowering: "Flowering", culled: "Culled", keeping: "Keeping", released: "Released" };
export const STATUS_ICON = { growing: "•", flowering: "✿", culled: "✕", keeping: "★", released: "✓" };   // never color alone
export { STATUSES };

export const statusChip = (st) => h("span", { class: "chip st-" + st }, STATUS_ICON[st] || "", " ", STATUS_LABEL[st] || st);

export const parentText = (name) => name || "unknown";
export const crossTitle = (c) => `${parentText(c.seed_parent_name)} × ${parentText(c.pollen_parent_name)}`;

/** An <img> that fills in from the stored thumbnail (or full photo) after the page is drawn. */
export function photoImg(app, photo, { cls = "thumb", full = false, alt = "" } = {}) {
  const img = h("img", { class: cls, alt, loading: "lazy" });
  (async () => {
    let b = full ? await app.repo.getBlob(photo.sha256) : null;
    if (!b) b = await app.repo.getBlob(photo.thumb_sha256 || photo.sha256);
    if (!b) b = await app.repo.getBlob(photo.sha256);
    if (b) img.src = blobUrl(b.bytes);
  })().catch(() => {});
  return img;
}

export function field(label, input, hint, wide = false) { return h("label", { class: wide ? "f wide" : "f" }, label, input, hint ? h("span", { class: "hint" }, hint) : null); }

/** Read a form's named inputs into a plain object (empty text stays "", the repo turns it into null). */
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return out;
}

export const msgOf = (e) => (e && e.errors ? e.errors.map((x) => `${x.field.replace(/_/g, " ")} ${x.message}`).join("; ") : (e && e.message) || String(e));

export function confirmDialog(text, okLabel = "OK") { return Promise.resolve(window.confirm(text)); }

export function openPhoto(app, photo) {
  const dlg = h("dialog", {}, h("div", {}, h("p", { class: "muted" }, photo.caption || "")), h("form", { method: "dialog" }, h("button", {}, "Close")));
  const img = photoImg(app, photo, { cls: "big", full: true });
  dlg.insertBefore(img, dlg.firstChild);
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
