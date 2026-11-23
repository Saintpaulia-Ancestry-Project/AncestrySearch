import { h, showDate } from "../dom.js";
import { msgOf } from "./common.js";

const KIND = { crosses: "Cross", seedlings: "Seedling", photos: "Photo", traits: "Trait" };

export async function trashPage(app) {
  const { repo } = app;
  const items = await repo.trash(), settings = await repo.getSettings();
  const root = h("div", {}, h("h1", {}, "Trash"),
    h("p", { class: "muted" }, settings.trash_days ? `Deleted items wait here for ${settings.trash_days} days, then they are erased for good on this device (you can change this in Settings).` : "Deleted items stay here until you erase them."));
  const err = h("div", { class: "bad", role: "alert" });
  const guard = (fn) => async () => { err.textContent = ""; try { await fn(); app.dirty(); app.rerender(true); } catch (e) { err.textContent = msgOf(e); } };
  if (!items.length) { root.append(h("p", {}, "The Trash is empty.")); return root; }
  root.append(h("table", { class: "t" }, h("tr", {}, h("th", {}, "Item"), h("th", {}, "Deleted"), h("th", {}, "Time left"), h("th", {}, "")),
    ...items.map((it) => h("tr", {}, h("td", {}, KIND[it.table] + ": " + it.title), h("td", {}, showDate(it.deleted_at.slice(0, 10))), h("td", {}, it.days_left === null ? "kept" : it.days_left + " days"),
      h("td", {}, h("button", { class: "secondary", onclick: guard(async () => { await repo.restore(it.table, it.id); app.toast("Restored."); }) }, "Restore"),
        h("button", { class: "danger", onclick: guard(async () => { if (confirm("Erase this for good? It cannot be brought back from this device.")) await repo.erase(it.table, it.id); }) }, "Erase"))))));
  root.append(err, h("button", { class: "danger", onclick: guard(async () => {
    if (confirm("Erase everything in the Trash for good?\n\nBackup and sync files you saved earlier still contain this data.")) { const r = await repo.emptyTrash(); app.toast(`${r.erased} item(s) erased.`); }
  }) }, "Empty the Trash…"));
  return root;
}
