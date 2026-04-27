// Bundles win95-theme.css into win95-theme.json (the pasteable
// extension blob). If `w95fa.woff2` exists in the repo root it
// gets base64-inlined into the @font-face block; otherwise the
// `__W95FA_PLACEHOLDER__` URL silently 404s and the fallback font
// chain in --font-y2k takes over. CRLF normalization is preserved
// from the prior one-liner so the JSON is byte-stable on Windows.
//
// As of v3.0 the theme is CSS-only — no JS. Earlier versions
// shipped a sizable JS layer (window chrome, pixel-art icon swap,
// boot splash, system sounds, working titlebar buttons, settings
// panel, sparkle stripper, engine-ping suppressor, GIF→PNG logo
// swap). All of that was removed in favor of a leaner pure-CSS
// theme that's simpler to maintain and less likely to break with
// engine updates. Earlier releases live in git history if anyone
// needs to fork the JS layer.
//
// Run from the repo root:  node build.js

const fs = require("fs");
const path = require("path");

const root = __dirname;
const cssPath = path.join(root, "win95-theme.css");
const fontPath = path.join(root, "w95fa.woff2");
const outPath = path.join(root, "win95-theme.json");

const toCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");

let css = fs.readFileSync(cssPath, "utf8");

if (fs.existsSync(fontPath)) {
  const b64 = fs.readFileSync(fontPath).toString("base64");
  // split/join replaces ALL occurrences — the placeholder is also referenced
  // by name in the comment block above the @font-face, and the default
  // String.replace would only swap the first (comment) hit.
  css = css.split("__W95FA_PLACEHOLDER__").join("data:font/woff2;base64," + b64);
  console.log("[build] inlined w95fa.woff2 (" + b64.length + " base64 chars)");
} else {
  console.log("[build] w95fa.woff2 missing — placeholder kept, fallback fonts will be used");
}

css = toCRLF(css);

fs.writeFileSync(
  outPath,
  JSON.stringify({ id: "ext-win95-theme", name: "Win95 Theme", enabled: true, css, js: "" }, null, 2) + "\n",
);
console.log("[build] wrote " + path.relative(root, outPath));
