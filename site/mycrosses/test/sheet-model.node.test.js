import test from "node:test";
import assert from "node:assert/strict";
import { buildRows, filterRows, sortRows, flatten, cellText, coerce, parseDateCell, parseStatusCell, parseTsv, planPaste, toCsv, UndoStack, COLUMNS } from "../js/app/sheet-model.js";

const cross = (id, code, extra = {}) => ({ id, code, seed_parent_name: "Alpha", pollen_parent_name: "Beta", hybridizer: "Me", ...extra });
const seed = (id, cross_id, label, extra = {}) => ({ id, cross_id, label, status: "growing", description: null, notes: null, promoted_name: null, date_added: "2026-11-01", ...extra });
const C1 = cross("c1", "GG-26-001"), C2 = cross("c2", "GG-26-002");
const S = [seed("s10", "c1", "10"), seed("s2", "c1", "2", { status: "flowering", notes: "deep purple" }), seed("s1", "c2", "1", { promoted_name: "Purple Rain", description: "ruffled" }), seed("sx", "gone", "1")];
const rows = () => buildRows([C1, C2], S, [{ seedling_id: "s2" }, { seedling_id: "s2" }], [{ seedling_id: "s2", trait: "bloom size", value: "large" }, { seedling_id: "s1", trait: "variegated", value: null }]);
const ids = (list) => list.map((r) => r.id);

test("rows: a seedling whose cross is gone is left out; photos and traits are attached", () => {
  const r = rows();
  assert.equal(r.length, 3);
  assert.equal(cellText(r.find((x) => x.id === "s2"), "photo"), "2");
  assert.equal(cellText(r.find((x) => x.id === "s2"), "traits"), "bloom size: large");
  assert.equal(cellText(r.find((x) => x.id === "s1"), "traits"), "variegated");
});

test("sort: default is cross then natural number (2 before 10); a column sort keeps that order inside ties; empty cells go last", () => {
  assert.deepEqual(ids(sortRows(rows())), ["s2", "s10", "s1"]);
  assert.deepEqual(ids(sortRows(rows(), { sort: "status" })), ["s10", "s1", "s2"]);
  assert.deepEqual(ids(sortRows(rows(), { sort: "promoted_name", dir: "asc" })), ["s1", "s2", "s10"]);
  assert.deepEqual(ids(sortRows(rows(), { sort: "promoted_name", dir: "desc" })), ["s1", "s2", "s10"], "empty stays last when descending too");
  assert.equal(ids(sortRows(rows(), { sort: "photo", dir: "desc" }))[0], "s2");
});

test("filter: words in any order across cross, parents and every cell; status and cross filters", () => {
  assert.deepEqual(ids(filterRows(rows(), { q: "purple" })).sort(), ["s1", "s2"]);
  assert.deepEqual(ids(filterRows(rows(), { q: "rain purple" })), ["s1"]);
  assert.equal(filterRows(rows(), { q: "alpha" }).length, 3);
  assert.deepEqual(ids(filterRows(rows(), { status: "flowering" })), ["s2"]);
  assert.deepEqual(ids(filterRows(rows(), { cross: "c2" })), ["s1"]);
  assert.equal(filterRows(rows(), { q: "zzz" }).length, 0);
});

test("flatten: group headings with counts", () => {
  const items = flatten(sortRows(rows()), { group: true });
  assert.deepEqual(items.map((i) => i.type), ["group", "row", "row", "group", "row"]);
  assert.equal(items[0].count, 2); assert.equal(items[3].count, 1);
  assert.equal(flatten(sortRows(rows()), { group: false }).length, 3);
});

test("coerce: status names, dates, required label, one-line and long text", () => {
  assert.deepEqual(coerce("status", " FLOWERING "), { ok: true, value: "flowering" });
  assert.equal(coerce("status", "blooming").ok, false);
  assert.deepEqual(coerce("date_added", "2026-02-03"), { ok: true, value: "2026-02-03" });
  assert.deepEqual(coerce("date_added", "3 Feb 2026"), { ok: true, value: "2026-02-03" });
  assert.deepEqual(coerce("date_added", "3 February 2026"), { ok: true, value: "2026-02-03" });
  assert.deepEqual(coerce("date_added", ""), { ok: true, value: null });
  assert.equal(coerce("date_added", "3/2/2026").ok, false, "ambiguous spellings are refused");
  assert.equal(coerce("date_added", "2026-02-30").ok, false);
  assert.equal(coerce("label", "  ").ok, false);
  assert.deepEqual(coerce("label", " 12b "), { ok: true, value: "12b" });
  assert.deepEqual(coerce("promoted_name", "a\tb\nc"), { ok: true, value: "a b c" });
  assert.deepEqual(coerce("notes", "line1\r\nline2 "), { ok: true, value: "line1\nline2" });
  assert.deepEqual(coerce("notes", "   "), { ok: true, value: null });
  assert.equal(coerce("cross", "x").ok, false);
  assert.equal(parseDateCell("31 Apr 2026"), null);
  assert.equal(parseStatusCell("Released"), "released");
});

test("parseTsv: tabs, lines, quoted cells with tabs/newlines/quotes, trailing newline, empty cells", () => {
  assert.deepEqual(parseTsv("a\tb\nc\td\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv('"x\ty"\t"line1\nline2"\t"say ""hi"""'), [["x\ty", "line1\nline2", 'say "hi"']]);
  assert.deepEqual(parseTsv("a\t\tc\r\n\td"), [["a", "", "c"], ["", "d"]]);
  assert.deepEqual(parseTsv("single"), [["single"]]);
  assert.deepEqual(parseTsv(""), []);
  assert.deepEqual(parseTsv('5" pot'), [['5" pot']], "a quote inside a cell is just text");
});

test("planPaste: fills down and right, skips read-only columns, reports bad cells, counts what did not fit", () => {
  const r = sortRows(rows());                                   // s2, s10, s1
  const cols = ["label", "cross", "status", "notes"];
  let p = planPaste([["2a", "ignored", "Culled", "new note"], ["10", "x", "Growing", "n2"]], r, cols);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.edits.map((e) => [e.id, e.patch]), [["s2", { label: "2a", status: "culled", notes: "new note" }], ["s10", { notes: "n2" }]]);
  assert.deepEqual(p.edits[0].before, { label: "2", status: "flowering", notes: "deep purple" });
  p = planPaste([["1", "x", "nonsense", "n"]], r, cols);
  assert.equal(p.errors.length, 1); assert.match(p.errors[0], /Row 1, Status/);
  p = planPaste([["a"], ["b"], ["c"], ["d"]], r, ["label"]);
  assert.equal(p.skippedRows, 1);
  p = planPaste([["a", "b", "c"]], r, ["label", "cross"]);
  assert.equal(p.skippedCols, 1);
  assert.equal(planPaste([[""]], r, ["notes"]).edits.length, 0, "a single empty cell pasted over nothing changes nothing");
});

test("csv: header, quoting, formula text is defused, cross always included", () => {
  const r = rows().map((x) => (x.id === "s1" ? { ...x, rec: { ...x.rec, notes: '=SUM(A1) "x", y' } } : x));
  const lines = toCsv(sortRows(r), ["label", "notes"]).trim().split("\r\n");
  assert.equal(lines[0], "Cross,No.,Notes");
  assert.ok(lines.includes("GG-26-002,1,\"'=SUM(A1) \"\"x\"\", y\""), lines.join(" | "));
  assert.ok(lines.includes("GG-26-001,2,deep purple"));
  assert.equal(toCsv([], ["cross", "label"]), "Cross,No.\r\n");
  assert.equal(COLUMNS.filter((c) => c.field).every((c) => ["text", "status", "date"].includes(c.kind)), true);
});

test("undo stack: last in, first out, bounded", () => {
  const u = new UndoStack(2); u.push(1); u.push(2); u.push(3);
  assert.equal(u.size, 2); assert.equal(u.pop(), 3); assert.equal(u.pop(), 2); assert.equal(u.pop(), null);
});
