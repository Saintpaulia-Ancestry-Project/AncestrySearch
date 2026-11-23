// Saintpaulia Hybridizer: start-up, hash routing, toast. The records live in IndexedDB (database "hybridizer"); nothing is sent anywhere.
import { Repo } from "../core/repo.js";
import { IdbAdapter } from "../core/adapters/idb.js";
import { requestPersistence } from "../core/persistence.js";
import { h, clear, revokeUrls } from "./dom.js";
import { home } from "./views/home.js";
import { crossesList, crossPage } from "./views/crosses.js";
import { seedlingPage } from "./views/seedling.js";
import { trashPage } from "./views/trash.js";
import { syncPage } from "./views/sync.js";
import { settingsPage } from "./views/settings.js";
import { sheetPage } from "./views/sheet.js";

const params = new URLSearchParams(location.search);
// ?db=name opens a separate database (for testing); the real one is "hybridizer"
const DB_NAME = params.get("db") ? "hybridizer-" + params.get("db").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) : "hybridizer";

const NAV = [["#/", "Home", "home"], ["#/crosses", "Crosses", "crosses"], ["#/sheet", "Spreadsheet", "sheet"], ["#/sync", "Sync", "sync"], ["#/trash", "Trash", "trash"], ["#/settings", "Settings", "settings"]];
const ROUTES = { "": home, crosses: crossesList, sheet: sheetPage, cross: crossPage, seedling: seedlingPage, trash: trashPage, sync: syncPage, settings: settingsPage };
const main = document.getElementById("main");

const app = {
  repo: null, persistence: null, dataVersion: 0,
  dirty() { this.dataVersion++; },
  /** A short message. action = { label, onclick } adds one button (for example Undo) and keeps the message a little longer. */
  toast(msg, isError = false, action = null) {
    const t = document.getElementById("toast"); t.textContent = msg; t.className = isError ? "err" : ""; t.hidden = false;
    if (action) { const b = document.createElement("button"); b.type = "button"; b.textContent = action.label; b.addEventListener("click", () => { t.hidden = true; clearTimeout(app._toastTimer); action.onclick(); }); t.append(" ", b); }
    clearTimeout(app._toastTimer); app._toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 7000 : action ? 7000 : 2500);
  },
  async reloadSettings() { const s = await this.repo.getSettings(); applyLook(s); },
  rerender(keepScroll) { return route(keepScroll); },
};

function applyLook(s) {
  const r = document.documentElement;
  r.setAttribute("data-mode", s.mode); r.setAttribute("data-scheme", s.scheme); r.setAttribute("data-text", s.text_size); r.setAttribute("data-density", s.density);
  if (s.reduce_motion) r.setAttribute("data-motion", "reduce"); else r.removeAttribute("data-motion");
  try { localStorage.setItem("hybridizer-look", JSON.stringify({ mode: s.mode, scheme: s.scheme, text_size: s.text_size, density: s.density, reduce_motion: s.reduce_motion })); } catch (_) { /* private window: the look just is not remembered for first paint */ }
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ""), [path, qs = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

let token = 0;
async function route(keepScroll = false) {
  const my = ++token, { parts, query } = parseHash(), key = parts[0] || "";
  const view = ROUTES[key];
  const nav = document.getElementById("nav");
  clear(nav).append(...NAV.map(([href, label, k]) => h("a", { href, ...(k === (key || "home") || (k === "crosses" && (key === "cross" || key === "seedling")) ? { "aria-current": "page" } : {}) }, label)));
  const y = window.scrollY;
  try {
    const node = view ? await view(app, parts, query) : h("p", {}, "That page does not exist. ", h("a", { href: "#/" }, "Home"));
    if (my !== token) return;                                  // a newer navigation won
    revokeUrls(); clear(main).append(node);
    document.title = (node.querySelector && node.querySelector("h1") ? node.querySelector("h1").textContent + " - " : "") + "Saintpaulia Hybridizer";
    if (keepScroll) window.scrollTo(0, y); else { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  } catch (e) {
    if (my !== token) return;
    clear(main).append(h("div", { class: "warn" }, h("p", {}, h("b", {}, "Something went wrong: "), (e && e.message) || String(e)), h("a", { href: "#/" }, "Back to Home")));
    console.error(e);
  }
}

async function boot() {
  try {
    app.repo = await Repo.open({ adapter: new IdbAdapter({ name: DB_NAME }) });
    await app.reloadSettings();
    window.__hyb = { repo: app.repo };
    try { await app.repo.purgeExpired(); } catch (e) { console.error("purge failed", e); }
    window.addEventListener("hashchange", () => route());
    await route();
    requestPersistence().then(async (p) => { app.persistence = p; try { await app.repo.setSetting("persistence", p); } catch (_) {} if (!p.persisted && /^#\/?(settings|)$/.test(location.hash)) route(true); });
  } catch (e) {
    clear(main).append(h("div", { class: "warn" }, h("p", {}, h("b", {}, "The app could not open its storage. "), (e && e.message) || String(e)),
      h("p", {}, "Private browsing windows and some locked-down browsers do not allow it. Try a normal window.")));
    console.error(e);
  }
}
boot();
