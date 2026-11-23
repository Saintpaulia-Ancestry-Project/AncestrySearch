import { h, daysAgo } from "../dom.js";
import { crossTitle, statusChip, STATUSES } from "./common.js";

export async function home(app) {
  const { repo } = app;
  const [crosses, seedlings, counts, log, lc, dc] = await Promise.all([repo.list("crosses"), repo.list("seedlings"), repo.counts(), repo.syncLog(), repo.labelCollisions(), repo.duplicateCrossCodes()]);
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0])); for (const s of seedlings) by[s.status]++;
  const withSeedlings = new Set(seedlings.map((s) => s.cross_id));
  const sownNoSeedlings = crosses.filter((c) => c.seeds_sown > 0 && !withSeedlings.has(c.id));
  const flowering = seedlings.filter((s) => s.status === "flowering");
  const lastFile = log.filter((e) => e.direction === "export").map((e) => e.at).sort().pop() || null;
  const age = lastFile ? daysAgo(lastFile) : null;
  const p = app.persistence;

  const root = h("div", {}, h("h1", {}, "Home"));
  const empty = !crosses.length;
  if (empty) root.append(h("div", { class: "panel" }, h("p", {}, "Nothing here yet. Start by recording a cross: the two parents and the date. Then add the seedlings that grow from it."), h("a", { class: "btn", href: "#/cross/new" }, "Record your first cross")));
  else root.append(h("div", { class: "row" }, h("a", { class: "btn", href: "#/cross/new" }, "New cross"), h("a", { class: "btn secondary", href: "#/crosses" }, "All crosses")));

  root.append(h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", {}, counts.crosses), "crosses"), h("div", { class: "stat" }, h("b", {}, counts.seedlings), "seedlings"), h("div", { class: "stat" }, h("b", {}, counts.photos), "photos")));
  if (seedlings.length) root.append(h("p", {}, ...STATUSES.flatMap((s) => [statusChip(s), ` ${by[s]}  `])));

  // backup reminder: always visible, because the browser may clear its storage
  const backupText = age === null ? "No sync or backup file has been made on this device yet." : age === 0 ? "A sync or backup file was made today." : `The last sync or backup file was made ${age} day${age === 1 ? "" : "s"} ago.`;
  const stale = age === null ? !empty : age > 14;
  root.append(h("div", { class: stale ? "warn" : "panel" }, h("b", {}, "Backup: "), backupText, " ", h("a", { href: "#/sync" }, "Make a file"),
    p && !p.persisted ? h("div", { class: "muted" }, "This browser has not promised to keep your data, so a backup file matters.") : null));

  if (flowering.length) root.append(h("h2", {}, "Flowering: waiting for a decision"), h("p", {}, `${flowering.length} seedling${flowering.length === 1 ? "" : "s"} in bloom. `, h("a", { href: "#/crosses?status=flowering" }, "Show the crosses")));
  if (sownNoSeedlings.length) root.append(h("h2", {}, "Seeds sown, no seedlings entered"), h("ul", {}, ...sownNoSeedlings.map((c) => h("li", {}, h("a", { href: "#/cross/" + c.id }, c.code || crossTitle(c)), ` (${c.seeds_sown} seeds sown)`))));
  if (lc.length || dc.length) root.append(h("h2", {}, "To tidy up"), h("div", { class: "warn" },
    dc.length ? h("p", {}, `${dc.length} cross code${dc.length === 1 ? " is" : "s are"} used twice (made on two devices): `, ...dc.flatMap((d) => d.ids.map((id, i) => h("a", { href: "#/cross/" + id }, d.code + (i ? " (second)" : " ") + " ")))) : null,
    lc.length ? h("p", {}, `${lc.length} seedling number${lc.length === 1 ? " is" : "s are"} used twice inside one cross. Open the cross and renumber.`) : null));
  return root;
}
