// Colors of the app: 6 color schemes x 5 modes. Everything is generated from the small table below and every text/background pair is
// checked by the test (test/palettes.node.test.js): AA 4.5:1 normally, AAA 7:1 in the two high-contrast modes.
// tools/make-themes.mjs writes css/themes.css from this file.

export const SCHEMES = {
  violet: { h: 275, s: 1 }, blue: { h: 215, s: 1 }, green: { h: 140, s: 0.8 }, red: { h: 345, s: 1 }, brown: { h: 30, s: 0.7 }, grey: { h: 0, s: 0 },
};
export const MODES = ["light", "dark", "hc-light", "hc-dark"];       // "device" picks light or dark by the device setting
export const STATUS_HUES = { growing: 140, flowering: 320, culled: 0, keeping: 215, released: 275 };

// ---------------------------------------------------------------- color math (sRGB, WCAG 2.x)
export function hslToRgb(h, s, l) {
  s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}
export const toHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
export function luminance(rgb) {
  const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Move lightness of (h, s) away from the backgrounds until the contrast is at least `min` against ALL of them. */
function ensure(h, s, l, bgs, min, dir) {
  for (let i = 0; i < 100; i++) {
    const rgb = hslToRgb(h, s, l);
    if (bgs.every((b) => contrast(rgb, b) >= min)) return rgb;
    l += dir; if (l < 0 || l > 100) break;
  }
  return hslToRgb(h, s, dir > 0 ? 100 : 0);
}

/** The tokens of one scheme in one mode (all hex strings). */
export function palette(scheme, mode) {
  const { h, s: sf } = SCHEMES[scheme];
  const dark = mode === "dark" || mode === "hc-dark", hc = mode.startsWith("hc"), min = hc ? 7 : 4.5;
  const S = (v) => v * sf;
  let bg, panel, line, text;
  if (mode === "light") { bg = hslToRgb(h, S(scheme === "red" ? 70 : scheme === "brown" ? 55 : 45), scheme === "brown" ? 93 : 98); panel = hslToRgb(h, S(scheme === "red" ? 60 : 38), scheme === "brown" ? 88 : 94); line = hslToRgb(h, S(25), 78); text = hslToRgb(h, S(20), 12); }
  else if (mode === "dark") { bg = hslToRgb(h, S(scheme === "red" ? 55 : 25), scheme === "red" ? 10 : 9); panel = hslToRgb(h, S(scheme === "red" ? 50 : 22), scheme === "red" ? 15 : 14); line = hslToRgb(h, S(20), 28); text = hslToRgb(h, S(15), 92); }
  else if (mode === "hc-light") { bg = [255, 255, 255]; panel = hslToRgb(h, S(15), 95); line = [0, 0, 0]; text = [0, 0, 0]; }
  else { bg = [0, 0, 0]; panel = hslToRgb(h, S(15), 9); line = [255, 255, 255]; text = [255, 255, 255]; }
  const bgs = [bg, panel], dir = dark ? 1 : -1;
  const muted = ensure(h, S(12), dark ? 70 : 38, bgs, min, dir);
  const link = ensure(h, S(70), dark ? 70 : 38, bgs, min, dir);
  const accent = ensure(h, S(60), dark ? 72 : 40, bgs, hc ? 7 : 4.5, dir);              // button background; must stand out from the page too
  const accentFg = dark ? ensure(h, S(30), 8, [accent], min, -1) : ensure(h, 0, 100, [accent], min, 1);
  const ok = ensure(140, 60, dark ? 65 : 30, bgs, min, dir), bad = ensure(5, 70, dark ? 70 : 38, bgs, min, dir);
  const tokens = { bg, panel, line, text, muted, link, accent, "accent-fg": accentFg, ok, bad };
  for (const [name, sh] of Object.entries(STATUS_HUES)) {
    const chipBg = hslToRgb(sh, scheme === "grey" ? 0 : 45, dark ? 20 : 90);
    tokens["st-" + name + "-bg"] = chipBg;
    tokens["st-" + name] = ensure(sh, scheme === "grey" ? 0 : 60, dark ? 75 : 25, [chipBg], min, dark ? 1 : -1);
  }
  const out = {}; for (const [k, v] of Object.entries(tokens)) out[k] = toHex(v);
  return out;
}

/** Every pair that must be readable: [foreground token, background token]. */
export const PAIRS = [["text", "bg"], ["text", "panel"], ["muted", "bg"], ["muted", "panel"], ["link", "bg"], ["link", "panel"], ["accent-fg", "accent"], ["accent", "bg"], ["accent", "panel"], ["ok", "panel"], ["bad", "panel"], ["ok", "bg"], ["bad", "bg"],
  ...Object.keys(STATUS_HUES).map((n) => ["st-" + n, "st-" + n + "-bg"])];

export function checkPalette(scheme, mode) {
  const p = palette(scheme, mode), min = mode.startsWith("hc") ? 7 : 4.5, bad = [];
  for (const [f, b] of PAIRS) {
    const c = contrast(hexToRgb(p[f]), hexToRgb(p[b]));
    // the accent only has to be visible against the page (3:1 non-text rule, 7 in high contrast), its text must meet the full ratio
    const need = f === "accent" ? (mode.startsWith("hc") ? 7 : 4.5) : min;
    if (c < need) bad.push({ scheme, mode, f, b, ratio: Math.round(c * 100) / 100, need });
  }
  return bad;
}

const block = (sel, p) => `${sel} {\n${Object.entries(p).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}\n`;

/** The text of css/themes.css. */
export function themesCss() {
  let css = "/* GENERATED by tools/make-themes.mjs from js/app/palettes.js. Do not edit by hand. */\n";
  for (const scheme of Object.keys(SCHEMES)) {
    const light = palette(scheme, "light"), dark = palette(scheme, "dark");
    const sel = (m) => (m === "device" ? `:root[data-mode="device"][data-scheme="${scheme}"]` : `:root[data-mode="${m}"][data-scheme="${scheme}"]`);
    css += block(sel("device") + (scheme === "violet" ? `, :root:not([data-mode])` : ""), light);
    css += `@media (prefers-color-scheme: dark) {\n${block("  " + sel("device") + (scheme === "violet" ? `, :root:not([data-mode])` : ""), dark).replace(/^(  --)/gm, "  $1")}}\n`;
    for (const m of MODES) css += block(sel(m), palette(scheme, m));
  }
  return css;
}
