import { h } from "../dom.js";
import { field, msgOf } from "./common.js";
import { describePersistence, requestPersistence } from "../../core/persistence.js";
import { cleanInitials } from "../../core/codes.js";

const MODE_LABEL = { device: "Match this device", light: "Light", dark: "Dark", "hc-light": "High contrast (black on white)", "hc-dark": "High contrast (white on black)" };
const SCHEME_LABEL = { violet: "Violet", blue: "Blue", green: "Green", red: "Red", brown: "Brown", grey: "Grey" };

export async function settingsPage(app) {
  const { repo } = app, s = await repo.getSettings(), err = h("div", { class: "bad", role: "alert" });
  const save = (key, parse = (v) => v) => async (e) => {
    err.textContent = "";
    try { await repo.setSetting(key, parse(e.target.type === "checkbox" ? e.target.checked : e.target.value)); await app.reloadSettings(); app.toast("Saved."); }
    catch (ex) { err.textContent = msgOf(ex); }
  };
  const sel = (key, labels, parse) => h("select", { onchange: save(key, parse) }, ...Object.entries(labels).map(([v, l]) => h("option", { value: v, selected: String(s[key]) === v }, l)));
  const persist = h("p", {}, describePersistence(app.persistence));
  const root = h("div", {}, h("h1", {}, "Settings"), h("p", { class: "muted" }, "These apply to this device only; they are not part of sync files."),
    h("h2", {}, "Look"),
    h("div", { class: "grid2" }, field("Mode", sel("mode", MODE_LABEL)), field("Color scheme", sel("scheme", SCHEME_LABEL)),
      field("Text size", sel("text_size", { small: "Small", normal: "Normal", large: "Large" })), field("Density", sel("density", { comfortable: "Comfortable", compact: "Compact" }))),
    h("label", { class: "f" }, h("input", { type: "checkbox", checked: s.reduce_motion, onchange: save("reduce_motion") }), " Reduce motion"),
    h("h2", {}, "Cross codes"),
    field("Your initials", h("input", { type: "text", value: s.initials, maxlength: 6, onchange: (e) => { e.target.value = cleanInitials(e.target.value); return save("initials")(e); } }), "Used to suggest codes such as GG-26-014."),
    h("h2", {}, "Trash"),
    field("Erase deleted items after", h("select", { onchange: save("trash_days", (v) => (v === "never" ? null : parseInt(v, 10))) }, ...[["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["60", "60 days"], ["90", "90 days"], ["never", "Never (only when I empty the Trash)"]].map(([v, l]) => h("option", { value: v, selected: (s.trash_days === null ? "never" : String(s.trash_days)) === v }, l)))),
    h("h2", {}, "Storage"), persist,
    h("button", { class: "secondary", onclick: async () => { app.persistence = await requestPersistence(); persist.textContent = describePersistence(app.persistence); } }, "Ask the browser to keep my data"),
    h("p", { class: "muted" }, app.persistence && app.persistence.quota ? `This browser allows about ${(app.persistence.quota / 1048576).toFixed(0)} MB; this app uses about ${((app.persistence.usage || 0) / 1048576).toFixed(1)} MB (all sites on this address share it).` : ""),
    err,
    h("h2", {}, "Privacy"),
    h("p", {}, "Your crosses, seedlings and photos stay on this device. The app has no accounts, no analytics and cannot contact any other website: its security policy blocks it. Nothing leaves the device unless you save or share a sync file yourself."),
    h("p", { class: "muted" }, "One limit: this app lives at the same web address as the public African violet ancestry site, so both share the browser's storage quota. The two never read each other's data."),
    h("p", { class: "muted" }, "Not built yet: linking parents to the official database, the spreadsheet view, the family tree, installing as an app, working offline."));
  return root;
}
