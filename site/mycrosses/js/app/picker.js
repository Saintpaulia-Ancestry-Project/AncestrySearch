// Parent picker: a combobox (ARIA 1.2 pattern) that fills two form values, the parent's NAME and its REF.
//   ref = official cultivar id (a slug)  |  one of the user's own seedlings (a UUID)  |  empty (typed name only, or unknown)
// Suggestions: the user's own seedlings, then the official database (loaded on first use, with progress), the names kept offline from
// earlier picks when the database cannot be reached, and always "use what I typed" and "unknown".
import { h } from "./dom.js";
import { searchWords, snapshotOf, describeCultivar, loadOfficial, loadOfficialOld } from "./official.js";
import { refKind } from "../core/ids.js";

let uid = 0;

export function parentPicker(app, { label, hint, nameField, refField, name = "", ref = "", excludeCrossId = null }) {
  const id = "pp" + ++uid;
  let chosen = ref ? { ref, name } : null, official = app.officialDb || null, loadErr = null, progress = null, loadingOld = false, token = 0, timer = null, active = -1, options = [], local = null;
  const input = h("input", { type: "text", name: nameField, value: name, role: "combobox", autocomplete: "off", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": id + "-list", maxlength: 200 });
  const hidden = h("input", { type: "hidden", name: refField, value: ref || "" });
  const list = h("ul", { id: id + "-list", role: "listbox", class: "pick-list", hidden: true, "aria-label": label + " suggestions" });
  const status = h("div", { class: "hint", role: "status" });
  const box = h("label", { class: "f" }, label, input, hidden);
  const wrap = h("div", { class: "pick" }, box, list, status);

  const setChosen = (c) => { chosen = c; hidden.value = c ? c.ref : ""; showStatus(); };
  async function showStatus() {
    const t = input.value.trim();
    const parts = [];
    if (chosen && refKind(chosen.ref) === "official") {
      const snap = await app.repo.getOfficial(chosen.ref);
      parts.push("Linked to the official database", snap && (snap.hybridizer || snap.size_class) ? ": " + [snap.hybridizer, snap.size_class].filter(Boolean).join(" · ") : "", " ",
        h("a", { href: "../#/c/" + encodeURIComponent(chosen.ref), target: "_blank", rel: "noopener noreferrer" }, "view"), ".");
    } else if (chosen) parts.push("Linked to one of your seedlings.");
    else if (t) parts.push("Not linked: the name is kept as you typed it.");
    else parts.push(hint || "Unknown parent.");
    status.replaceChildren(...parts);
  }

  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
  function render() {
    list.replaceChildren();
    options.forEach((o, i) => {
      const li = h("li", { id: `${id}-o${i}`, role: "option", class: "opt" + (o.kind === "info" ? " info" : "") + (o.kind === "action" ? " action" : ""), "aria-selected": String(i === active), "aria-disabled": o.kind === "info" ? "true" : null },
        h("span", {}, o.text), o.sub ? h("span", { class: "muted sub" }, o.sub) : null);
      li.addEventListener("pointerdown", (e) => e.preventDefault());     // keep focus in the input
      li.addEventListener("click", () => choose(i));
      list.append(li);
    });
    list.hidden = !options.length; input.setAttribute("aria-expanded", String(!!options.length));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${id}-o${active}`); else input.removeAttribute("aria-activedescendant");
  }

  async function ownSeedlings(words) {
    if (!local) { const [ss, cs] = await Promise.all([app.repo.list("seedlings"), app.repo.list("crosses")]); local = ss.map((s) => ({ s, c: cs.find((c) => c.id === s.cross_id) })).filter((x) => x.c); }
    return local.filter(({ s, c }) => c.id !== excludeCrossId && words.every((w) => `${c.code || ""} ${s.label} ${s.promoted_name || ""}`.toLowerCase().includes(w.toLowerCase())))
      .sort((a, b) => (b.s.promoted_name ? 1 : 0) - (a.s.promoted_name ? 1 : 0)).slice(0, 6)
      .map(({ s, c }) => {
        const tag = `${c.code || "cross"} #${s.label}`;
        return { kind: "pick", ref: s.id, pickName: s.promoted_name || tag, text: s.promoted_name || tag, sub: "your seedling" + (s.promoted_name ? " " + tag : "") };
      });
  }

  async function refresh() {
    const my = ++token, text = input.value.trim(), words = searchWords(text);
    const opts = [];
    if (words.length) {
      opts.push(...await ownSeedlings(words));
      if (official) {
        for (const r of official.search(text, { limit: 12 })) opts.push({ kind: "pick", ref: r.id, pickName: r.name, text: r.name + (r.kind !== "cultivar" ? ` (${r.kind})` : ""), sub: describeCultivar(r) + (r.in_old ? " · older name" : "") });
        if (!official.hasOld) opts.push({ kind: "action", action: "old", text: loadingOld ? "Loading older names…" : "Also search the older names (1963 list and old supplements; about 11 MB)" });
      } else if (loadErr) {
        const w = words.map((x) => x.toLowerCase());
        for (const o of await app.repo.listOfficial()) if (w.every((x) => (o.name || "").toLowerCase().includes(x))) opts.push({ kind: "pick", ref: o.id, pickName: o.name, text: o.name, sub: "kept on this device" });
        opts.push({ kind: "info", text: "The official database could not be loaded (are you offline?). Names you used before are shown; you can also type a name." });
      } else opts.push({ kind: "info", text: progress ? `Loading the official database… ${(progress / 1048576).toFixed(1)} MB of about 11 MB` : "Loading the official database…" });
    }
    if (my !== token) return;
    if (text) opts.push({ kind: "typed", text: `Use “${text}” as typed (not linked)` });
    if (text || chosen) opts.push({ kind: "unknown", text: "Unknown parent (clear)" });
    options = opts; active = options.findIndex((o) => o.kind === "pick"); render();
  }

  function startLoad() {
    if (official || app._officialLoading || loadErr) return;
    app._officialLoading = loadOfficial((got) => { progress = got; if (!list.hidden) { clearTimeout(timer); timer = setTimeout(refresh, 250); } })
      .then((db) => { official = app.officialDb = db; }, (e) => { loadErr = e; })
      .finally(() => { app._officialLoading = null; refresh(); });
  }

  async function choose(i) {
    const o = options[i]; if (!o || o.kind === "info") return;
    if (o.kind === "action") {
      if (loadingOld) return;
      loadingOld = true; refresh();
      try { await loadOfficialOld(official, () => {}); } catch (e) { /* stays closed; the list says nothing new */ } finally { loadingOld = false; refresh(); }
      return;
    }
    if (o.kind === "pick") {
      input.value = o.pickName; setChosen({ ref: o.ref, name: o.pickName });
      if (refKind(o.ref) === "official") {
        const rec = official && official.get(o.ref);
        try { await app.repo.rememberOfficial(rec ? snapshotOf(rec, official.imageBase) : { id: o.ref, name: o.pickName }); } catch (_) { /* a snapshot is only a convenience */ }
        showStatus();
      }
    } else if (o.kind === "typed") setChosen(null);
    else if (o.kind === "unknown") { input.value = ""; setChosen(null); }
    close();
  }

  input.addEventListener("input", () => {
    const t = input.value.trim();
    if (chosen && t !== chosen.name) setChosen(null); else showStatus();
    clearTimeout(timer);
    if (t.length < 2) { token++; options = []; render(); return; }
    startLoad(); timer = setTimeout(refresh, 120);
  });
  input.addEventListener("focus", () => { local = null; if (input.value.trim().length >= 2 && !chosen) { startLoad(); refresh(); } });
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    const n = options.length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); list.hidden = false; active = (active + 1) % n; render(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); active = (active - 1 + n) % n; render(); }
    else if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape" && !list.hidden) { e.preventDefault(); close(); }
  });
  showStatus();
  return wrap;
}
