// Writes css/themes.css from js/app/palettes.js:   node site/mycrosses/tools/make-themes.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themesCss } from "../js/app/palettes.js";

const out = fileURLToPath(new URL("../css/themes.css", import.meta.url));
writeFileSync(out, themesCss());
console.log("wrote", out);
