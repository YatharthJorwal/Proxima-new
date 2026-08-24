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
 *   - node_modules/@mediapipe/tasks-vision's JS bundle + WASM runtime ->
 *     dist/electron/renderer/vendor/mediapipe/ (Milestone 7, CV). Only the
 *     SIMD wasm variant is vendored (vision_wasm_internal.*, ~12MB) — the
 *     package also ships a nosimd fallback and a third "module_internal"
 *     variant (~34MB total for all three), but Electron's bundled Chromium
 *     is always recent enough to support WASM SIMD, so shipping the other
 *     two would just be dead weight for this Electron-only app. Confirmed
 *     by reading FilesetResolver.forVisionTasks()'s source: it requests
 *     the SIMD variant by default and only falls back on an explicit
 *     `useNoSimd` flag we never pass.
 *   - models/hand_landmarker.task -> dist/.../vendor/mediapipe/ (COPIED
 *     ONLY IF PRESENT). This is a ~7-10MB model file hosted on Google's
 *     model CDN, not bundled in the npm package, and not something this
 *     build script can fetch itself (no network access to
 *     storage.googleapis.com in a locked-down build environment). Run
 *     `npm run setup:cv` once to download it — see scripts/download-hand-model.js.
 *     If it's missing, the build still succeeds (just warns) rather than
 *     hard-failing — CV is an optional/additive feature, not required for
 *     the rest of the dashboard to work.
 *
 * openApp.ts already resolves commands.json relative to its own __dirname
 * (see the comment there) specifically so this would keep working once a
 * build step existed — this script is that build step's other half.
 *
 * three.js and MediaPipe are vendored (copied straight into the renderer)
 * rather than loaded from a CDN — this is a local-first assistant, per
 * CLAUDE.md, so the dashboard shouldn't need internet access just to
 * render its own UI. Both are devDependencies (not runtime Node
 * dependencies — no Node code ever requires() them) purely so
 * `npm install` fetches these files for us.
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

const mediapipeDir = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
const mediapipeVendorDir = path.join(vendorDir, "mediapipe");
copyRecursive(
  path.join(mediapipeDir, "vision_bundle.mjs"),
  path.join(mediapipeVendorDir, "vision_bundle.mjs")
);
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  copyRecursive(path.join(mediapipeDir, "wasm", file), path.join(mediapipeVendorDir, "wasm", file));
}

const modelSrc = path.join(root, "models", "hand_landmarker.task");
if (fs.existsSync(modelSrc)) {
  copyRecursive(modelSrc, path.join(mediapipeVendorDir, "hand_landmarker.task"));
} else {
  console.warn(
    "\n[copy-assets] models/hand_landmarker.task not found — the dashboard's " +
      "Camera card will show a 'run npm run setup:cv' message instead of " +
      "tracking hands. Run `npm run setup:cv` once to fix this.\n"
  );
}

console.log("Copied renderer assets, commands.json, vendored three.js, and vendored MediaPipe into dist/");
