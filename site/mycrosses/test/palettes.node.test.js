import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCHEMES, MODES, checkPalette, themesCss, contrast, hexToRgb, palette } from "../js/app/palettes.js";

test("every scheme in every mode passes the contrast rules (AA, AAA in high contrast)", () => {
  const bad = [];
  for (const s of Object.keys(SCHEMES)) for (const m of MODES) bad.push(...checkPalette(s, m));
  assert.deepEqual(bad, []);
});

test("the contrast check can fail (sanity)", () => {
  assert.ok(contrast(hexToRgb("#777777"), hexToRgb("#888888")) < 4.5);
  assert.ok(contrast(hexToRgb("#000000"), hexToRgb("#ffffff")) > 20);
});

test("high contrast modes use pure black and white", () => {
  for (const s of Object.keys(SCHEMES)) {
    assert.equal(palette(s, "hc-light").bg, "#ffffff"); assert.equal(palette(s, "hc-light").text, "#000000");
    assert.equal(palette(s, "hc-dark").bg, "#000000"); assert.equal(palette(s, "hc-dark").text, "#ffffff");
  }
});

test("css/themes.css is up to date (run: node site/mycrosses/tools/make-themes.mjs)", () => {
  const file = readFileSync(fileURLToPath(new URL("../css/themes.css", import.meta.url)), "utf8");
  assert.equal(file, themesCss());
});
