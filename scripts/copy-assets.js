/**
 * Copies files tsc doesn't touch into dist/ after compilation:
 *   - src/electron/renderer/  -> dist/electron/renderer/  (static HTML/CSS/JS)
 *   - src/config/commands.json -> dist/config/commands.json
 *   - node_modules/three's browser module build -> dist/electron/renderer/vendor/
 *     (both three.module.js AND three.core.js — the module build imports
 *     the core build as a sibling file via a relative specifier, so both
 *     have to land in the same directory or the import fails at runtime.
 *     Checked by grepping three.module.js's own import statement rather
 *     than assuming a single-file bundle.)
 *
 * openApp.ts already resolves commands.json relative to its own __dirname
 * (see the comment there) specifically so this would keep working once a
 * build step existed — this script is that build step's other half.
 *
 * three.js is vendored (copied straight into the renderer) rather than
 * loaded from a CDN — this is a local-first assistant, per CLAUDE.md, so
 * the dashboard shouldn't need internet access just to render its own UI.
 * It's a devDependency (not a runtime Node dependency — no Node code ever
 * requires it) purely so `npm install` fetches this one file for us.
 *
 * Plain Node, no extra deps (e.g. cpx/shx) — this is small enough that
 * pulling in a whole package for "copy some files" isn't worth it.
 */

const fs = require("fs");
const path = require("path");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

const root = path.join(__dirname, "..");

copyRecursive(
  path.join(root, "src", "electron", "renderer"),
  path.join(root, "dist", "electron", "renderer")
);

copyRecursive(
  path.join(root, "src", "config", "commands.json"),
  path.join(root, "dist", "config", "commands.json")
);

const threeBuildDir = path.join(root, "node_modules", "three", "build");
const vendorDir = path.join(root, "dist", "electron", "renderer", "vendor");
for (const file of ["three.module.js", "three.core.js"]) {
  copyRecursive(path.join(threeBuildDir, file), path.join(vendorDir, file));
}

console.log("Copied renderer assets, commands.json, and vendored three.js into dist/");
