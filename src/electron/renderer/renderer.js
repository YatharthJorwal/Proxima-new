/**
 * Dashboard renderer — Milestone 6 visual overhaul.
 *
 * ES module (note the <script type="module"> in index.html) so it can
 * `import * as THREE` from the vendored local copy — no CDN, no bundler,
 * since this is a local-first app (three.js is copied into
 * vendor/three.module.js by scripts/copy-assets.js at build time).
 *
 * Everything on screen — the Activity panel's rows, the orb's state, the
 * log — comes straight from window.proxy.on(...), which preload.ts wires
 * to the real ProxyEngine events. The orb's rotation/color/pulse are the
 * one place this file makes an interpretive call (mapping engine events
 * to a visual "mood"), but the mapping is fixed and documented below —
 * it can't drift into showing something that isn't happening.
 *
 * Milestone 9 step 6: the old fixed 5-row PIPELINE card is gone,
 * replaced by the Activity panel (see the section below, and CLAUDE.md's
 * Milestone 9 plan item 7 for the design) — a live, growing list driven
 * by real orchestrator events instead of a fixed skeleton, since the
 * orchestrator's step count is genuinely variable now.
 */

import * as THREE from "./vendor/three.module.js";
import { STLLoader } from "./vendor/loaders/STLLoader.js";
import { OBJLoader } from "./vendor/loaders/OBJLoader.js";
import { TransformControls } from "./vendor/controls/TransformControls.js";
import { RoundedBoxGeometry } from "./vendor/geometries/RoundedBoxGeometry.js";
import { ADDITION, SUBTRACTION, Brush, Evaluator } from "./vendor/three-bvh-csg.js";
// Note: MediaPipe (HandLandmarker) is NOT imported statically here —
// it's dynamic-imported inside setupCameraAndHandTracking() below, on
// purpose. See that function's docblock for why.

// ---------- DOM refs ----------

const statusDot = document.getElementById("statusDot");
const hotkeyLabel = document.getElementById("hotkeyLabel");
const clapStatus = document.getElementById("clapStatus");
const clockEl = document.getElementById("clock");
const log = document.getElementById("log");
const logEmpty = document.getElementById("logEmpty");
const outputBox = document.getElementById("outputBox");
const inputForm = document.getElementById("inputForm");
const inputText = document.getElementById("inputText");
const inputSend = document.getElementById("inputSend");
const micBtn = document.getElementById("micBtn");

// Milestone 15 fix: real-machine feedback was having no way to cut off a
// long reply mid-speech (see tts.ts's stopSpeaking()) — this is the other
// half, making that capability discoverable. The mic button already
// triggers cancel() while busy (see the "/" shortcut and micBtn click
// handler below), it just didn't LOOK like a stop control while busy.
// Swapped for the whole turn (not just the listening sub-phase), since
// cancel() now genuinely stops things at every stage: mid-tool-loop or
// mid-speech.
const MIC_ICON = "🎙︎";
const STOP_ICON = "⏹";
function setMicBusy(isBusy) {
  micBtn.textContent = isBusy ? STOP_ICON : MIC_ICON;
  micBtn.setAttribute("aria-label", isBusy ? "Stop" : "Talk (same as F9)");
  micBtn.title = isBusy ? "Stop" : "Talk (same as F9)";
  micBtn.classList.toggle("stoppable", isBusy);
}
const orbStage = document.getElementById("orbStage");
const orbStateLabel = document.getElementById("orbStateLabel");
const statusState = document.getElementById("statusState");
const statusHotkey = document.getElementById("statusHotkey");
const statusUptime = document.getElementById("statusUptime");

// ---------- Clock ----------

function updateClock() {
  clockEl.textContent = new Date().toLocaleTimeString([], { hour12: false });
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Uptime ----------

let startedAt = null;
function updateUptime() {
  if (startedAt === null) return;
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  statusUptime.textContent = `${m}:${String(s).padStart(2, "0")}`;
}
setInterval(updateUptime, 1000);

// ================================================================
// Activity panel (Milestone 9 step 6) — replaces the old fixed 5-row
// PIPELINE card. Rows are a live, growing list appended one at a time as
// real events arrive, not a fixed skeleton — see CLAUDE.md's Milestone 9
// plan, item 7, for the full design and reasoning this follows.
//
// Row lifecycle: addActivityRow() appends a new <li>, live (pulsing dot,
// ticking elapsed timer) until resolveActivityRow() freezes it (done
// checkmark, frozen time). At most one row is ever "current" (live) at a
// time — the loop this drives (see engine.ts) is strictly sequential,
// never concurrent, so there's never a need to track more than one.
// ================================================================

const activityCard = document.getElementById("activityCard");
const activityList = document.getElementById("activityList");
const activityFinal = document.getElementById("activityFinal");
const activityFinalText = document.getElementById("activityFinalText");

// Rotating status words for the ONE genuinely-indeterminate wait in this
// pipeline: a smart-tier "Analyzing Input" row. Fast-tier decisions
// resolve in a few hundred ms, so they just show the label plainly — no
// point animating something that's already over by the time you'd
// notice. Kept short and dry, matching Proxy's own personality prompt
// (llm.ts) rather than going for full whimsy.
const SMART_TIER_WORDS = ["Thinking it over", "Working the problem", "Weighing the options", "Doing the math", "Mulling it over"];

let currentRow = null; // the one live (unresolved) row, if any
let lastDecidingRow = null; // most recent Analyzing Input row — thinking traces attach here
let turnInProgress = false; // see the "transcribed" handler below for why this exists

function fmtElapsed(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function resetActivityPanel() {
  activityList.innerHTML = "";
  activityFinal.classList.add("hidden");
  activityFinalText.textContent = "";
  currentRow = null;
  lastDecidingRow = null;
}

function showActivityPanel() {
  activityCard.classList.remove("hidden");
}

function addActivityRow(label, opts = {}) {
  const li = document.createElement("li");
  li.className = "activity-row active" + (opts.action ? " action" : "");
  li.innerHTML = `
    <div class="activity-row-main">
      <span class="activity-mark"></span>
      <div class="activity-body">
        <div class="activity-label"></div>
        <div class="activity-sub"></div>
      </div>
      <span class="activity-time"></span>
    </div>
  `;
  const labelEl = li.querySelector(".activity-label");
  const subEl = li.querySelector(".activity-sub");
  labelEl.textContent = opts.rotateWords ? SMART_TIER_WORDS[0] : label;
  if (opts.sub) subEl.textContent = opts.sub;
  activityList.appendChild(li);
  activityList.scrollTop = activityList.scrollHeight;

  const row = { el: li, labelEl, subEl, timeEl: li.querySelector(".activity-time"), startedAt: performance.now(), tickHandle: null, wordHandle: null };
  row.tickHandle = setInterval(() => {
    row.timeEl.textContent = fmtElapsed(performance.now() - row.startedAt);
  }, 100);

  if (opts.rotateWords) {
    let i = 0;
    row.wordHandle = setInterval(() => {
      i = (i + 1) % SMART_TIER_WORDS.length;
      row.labelEl.textContent = SMART_TIER_WORDS[i];
    }, 1400);
  }

  currentRow = row;
  return row;
}

function resolveActivityRow(row, opts = {}) {
  if (!row) return;
  if (row.tickHandle) clearInterval(row.tickHandle);
  if (row.wordHandle) clearInterval(row.wordHandle);
  row.timeEl.textContent = fmtElapsed(performance.now() - row.startedAt);
  row.el.classList.remove("active");
  row.el.classList.add(opts.stopped ? "stopped" : "done");
  if (opts.label) row.labelEl.textContent = opts.label;
  if (opts.sub) row.subEl.textContent = opts.sub;
  if (row === currentRow) currentRow = null;
}

// Real reasoning trace toggle (smart-tier rows only) — shown after the
// fact, since chat() (llm.ts) isn't a streaming call, so there's nothing
// to stream live. Not a fabricated "AI is thinking..." spinner; this is
// the model's actual `message.thinking` output, verbatim.
function attachThinkingTrace(row, trace) {
  if (!row) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "activity-expand";
  toggle.textContent = "Show reasoning \u25B8";
  const traceEl = document.createElement("div");
  traceEl.className = "activity-thinking hidden";
  traceEl.textContent = trace; // textContent, never innerHTML — model output, never trusted as markup
  let expanded = false;
  toggle.addEventListener("click", () => {
    expanded = !expanded;
    traceEl.classList.toggle("hidden", !expanded);
    toggle.textContent = expanded ? "Hide reasoning \u25BE" : "Show reasoning \u25B8";
  });
  row.el.appendChild(toggle);
  row.el.appendChild(traceEl);
}

// ================================================================
// Three.js orb — "PROXIMA CORE". A live wireframe/points sphere whose
// rotation speed, color, and pulse amplitude are driven by the current
// engine state. States (set via setOrbState, called from event handlers
// below):
//   idle      - slow, dim, calm
//   listening - brighter, medium pulse
//   thinking  - fastest spin (LLM routing is the real "thinking" gap
//               between transcribed -> routed)
//   speaking  - rhythmic pulse while TTS plays
//   error     - brief red flash, then reverts to idle
// A routed-with-a-real-command event triggers a short amber flash
// regardless of base state, so "a command actually fired" is visible
// even though it doesn't get its own sustained state (routing itself is
// near-instantaneous).
// ================================================================

const ORB_COLOR = { idle: 0x3fa9ff, listening: 0x5fc4ff, thinking: 0x7cd4ff, speaking: 0x5fc4ff, error: 0xff5c5c };
// Idle spin bumped up (was 0.06 — nearly imperceptible over a short
// glance) and idle pulse amplitude cut way down. With the preload bug
// above fixed, most of the time the orb should now actually be in
// listening/thinking/speaking states reacting to real events — but idle
// still needed to read as "calm rotation" on its own rather than "static
// image gently breathing," which is what it looked like while every
// state transition was silently failing to arrive.
const ORB_SPIN = { idle: 0.18, listening: 0.22, thinking: 0.4, speaking: 0.22, error: 0.5 };
const ORB_PULSE_AMP = { idle: 0.008, listening: 0.06, thinking: 0.04, speaking: 0.09, error: 0.08 };

let orbState = "idle";
let errorFlashTimeout = null;
let actionFlashUntil = 0;

function setOrbState(state) {
  orbState = state;
  orbStage.dataset.state = state;
  orbStateLabel.textContent = `• ${state.toUpperCase()}`;
}

function flashError(message) {
  if (errorFlashTimeout) clearTimeout(errorFlashTimeout);
  setOrbState("error");
  errorFlashTimeout = setTimeout(() => {
    errorFlashTimeout = null;
    setOrbState("idle");
  }, 2200);
}

function flashAction() {
  actionFlashUntil = performance.now() + 700;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.z = 4.2;

const canvas = document.getElementById("orbCanvas");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const geometry = new THREE.IcosahedronGeometry(1.5, 3);

const pointsMaterial = new THREE.PointsMaterial({ color: ORB_COLOR.idle, size: 0.035, sizeAttenuation: true });
const points = new THREE.Points(geometry, pointsMaterial);
scene.add(points);

const wireMaterial = new THREE.LineBasicMaterial({ color: ORB_COLOR.idle, transparent: true, opacity: 0.28 });
const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), wireMaterial);
scene.add(wireframe);

// Faint inner glow so the orb reads as a solid "core" rather than just dots.
const glowMaterial = new THREE.MeshBasicMaterial({
  color: ORB_COLOR.idle,
  transparent: true,
  opacity: 0.05,
  side: THREE.BackSide,
});
const glow = new THREE.Mesh(new THREE.SphereGeometry(1.35, 32, 32), glowMaterial);
scene.add(glow);

const currentColor = new THREE.Color(ORB_COLOR.idle);
const targetColor = new THREE.Color(ORB_COLOR.idle);
let currentSpin = ORB_SPIN.idle;

function resizeOrb() {
  const size = canvas.clientWidth || canvas.parentElement.clientWidth;
  renderer.setSize(size, size, false);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeOrb);
resizeOrb();

let lastFrame = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = (now - lastFrame) / 1000;
  lastFrame = now;

  const inActionFlash = now < actionFlashUntil;
  const targetHex = inActionFlash ? 0xe8a33d : ORB_COLOR[orbState];
  targetColor.setHex(targetHex);
  currentColor.lerp(targetColor, 0.08);
  pointsMaterial.color.copy(currentColor);
  wireMaterial.color.copy(currentColor);
  glowMaterial.color.copy(currentColor);

  const targetSpin = ORB_SPIN[orbState];
  currentSpin += (targetSpin - currentSpin) * 0.05;
  points.rotation.y += currentSpin * delta;
  wireframe.rotation.y = points.rotation.y;
  points.rotation.x += currentSpin * 0.3 * delta;
  wireframe.rotation.x = points.rotation.x;

  const amp = ORB_PULSE_AMP[orbState];
  const pulse = 1 + Math.sin(now / 260) * amp;
  points.scale.setScalar(pulse);
  wireframe.scale.setScalar(pulse);
  glow.scale.setScalar(pulse * 1.02);

  renderer.render(scene, camera);
}
animate();

// Milestone 20 starter CAD workspace: parametric primitives, orbit/zoom,
// per-object uniform scaling, and ASCII STL export. No external model or
// AI-generated geometry is implied by this local geometry editor.
const modelCanvas = document.getElementById("modelCanvas");
const modelScene = new THREE.Scene();
modelScene.background = new THREE.Color(0x0b111b);
const modelCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
modelCamera.position.set(5, 4, 8);
const modelRenderer = new THREE.WebGLRenderer({ canvas: modelCanvas, antialias: true, preserveDrawingBuffer: true });
modelRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const modelTransformGizmo = new TransformControls(modelCamera, modelRenderer.domElement);
modelScene.add(modelTransformGizmo.getHelper());
modelTransformGizmo.setMode("translate");
modelScene.add(new THREE.HemisphereLight(0xbcd8ff, 0x18202d, 2));
const modelLight = new THREE.DirectionalLight(0xffffff, 2.5);
modelLight.position.set(5, 8, 6);
modelScene.add(modelLight);
const modelGrid = new THREE.GridHelper(20, 20, 0x42516a, 0x263247);
modelScene.add(modelGrid);
const modelMeshes = [];
let selectedModel = null;
let secondaryModel = null;
let modelYaw = 0.6;
let modelPitch = 0.4;
let modelDistance = 10;
let draggingModel = false;
let lastModelPointer = null;
const modelStatus = document.getElementById("modelStatus");
const modelScale = document.getElementById("modelScale");
const modelCornerRadius = document.getElementById("modelCornerRadius");
const modelCornerRadiusRow = document.getElementById("modelCornerRadiusRow");
const modelTransformFields = {
  position: [document.getElementById("modelX"), document.getElementById("modelY"), document.getElementById("modelZ")],
  rotation: [document.getElementById("modelRotX"), document.getElementById("modelRotY"), document.getElementById("modelRotZ")],
  dimensions: [document.getElementById("modelDimX"), document.getElementById("modelDimY"), document.getElementById("modelDimZ")],
};
function syncModelTransformFields() {
  if (!selectedModel) return;
  [selectedModel.position.x, selectedModel.position.y, selectedModel.position.z].forEach((value, i) => { modelTransformFields.position[i].value = value.toFixed(2); });
  [selectedModel.rotation.x, selectedModel.rotation.y, selectedModel.rotation.z].forEach((value, i) => { modelTransformFields.rotation[i].value = String(Math.round(THREE.MathUtils.radToDeg(value))); });
  selectedModel.geometry.computeBoundingBox();
  const dimensions = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(selectedModel.scale);
  [dimensions.x, dimensions.y, dimensions.z].forEach((value, i) => { modelTransformFields.dimensions[i].value = value.toFixed(2); });
  const isRoundedBox = selectedModel.userData.kind === "rounded box";
  modelCornerRadiusRow.classList.toggle("hidden", !isRoundedBox);
  if (isRoundedBox) modelCornerRadius.value = Number(selectedModel.userData.cornerRadius || 0).toFixed(3);
}
function resizeModelCanvas() {
  const width = modelCanvas.clientWidth || 1;
  const height = modelCanvas.clientHeight || 1;
  modelRenderer.setSize(width, height, false);
  modelCamera.aspect = width / height;
  modelCamera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeModelCanvas);
resizeModelCanvas();
function updateModelCamera() {
  modelCamera.position.set(
    modelDistance * Math.cos(modelPitch) * Math.sin(modelYaw),
    modelDistance * Math.sin(modelPitch),
    modelDistance * Math.cos(modelPitch) * Math.cos(modelYaw),
  );
  modelCamera.lookAt(0, 0, 0);
}
function renderModelFrame() { requestAnimationFrame(renderModelFrame); modelRenderer.render(modelScene, modelCamera); }
renderModelFrame();
function addPrimitive(kind, config = null) {
  const geometry = kind === "box" ? new THREE.BoxGeometry(1, 1, 1)
    : kind === "sphere" ? new THREE.SphereGeometry(0.6, 24, 16)
      : new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x42c8bd, metalness: 0.15, roughness: 0.48 }));
  if (config?.dimensions && [config.dimensions.x, config.dimensions.y, config.dimensions.z].every(Number.isFinite)) {
    geometry.computeBoundingBox();
    const base = geometry.boundingBox.getSize(new THREE.Vector3());
    mesh.scale.set(config.dimensions.x / base.x, config.dimensions.y / base.y, config.dimensions.z / base.z);
  }
  if (config?.position && [config.position.x, config.position.y, config.position.z].every(Number.isFinite)) {
    mesh.position.set(config.position.x, config.position.y, config.position.z);
  } else {
    mesh.position.set((modelMeshes.length % 3 - 1) * 1.5, 0.5, Math.floor(modelMeshes.length / 3) * 1.5);
  }
  if (config?.rotation && [config.rotation.x, config.rotation.y, config.rotation.z].every(Number.isFinite)) {
    mesh.rotation.set(THREE.MathUtils.degToRad(config.rotation.x), THREE.MathUtils.degToRad(config.rotation.y), THREE.MathUtils.degToRad(config.rotation.z));
  }
  mesh.userData.kind = kind;
  modelMeshes.push(mesh);
  modelScene.add(mesh);
  selectModel(mesh);
}
function roundSelectedBox(radius) {
  if (!selectedModel || !["box", "rounded box"].includes(selectedModel.userData.kind)) return false;
  selectedModel.geometry.computeBoundingBox();
  const size = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3());
  const minDimension = Math.min(size.x, size.y, size.z);
  if (!Number.isFinite(radius) || radius < 0.005 || radius > minDimension * 0.45) return false;
  const oldGeometry = selectedModel.geometry;
  selectedModel.geometry = new RoundedBoxGeometry(size.x, size.y, size.z, 4, radius);
  selectedModel.userData.kind = "rounded box";
  selectedModel.userData.cornerRadius = radius;
  oldGeometry.dispose();
  syncModelTransformFields();
  return true;
}
function selectModel(mesh) {
  if (selectedModel) selectedModel.material.emissive.setHex(0x000000);
  if (secondaryModel) secondaryModel.material.emissive.setHex(0x000000);
  secondaryModel = null;
  selectedModel = mesh;
  if (selectedModel) {
    modelTransformGizmo.attach(selectedModel);
    selectedModel.material.emissive.setHex(0x164d56);
    modelScale.value = String(selectedModel.scale.x);
    syncModelTransformFields();
    modelStatus.textContent = `Selected ${selectedModel.userData.kind}. Shift-click another object for union/subtraction; drag the view to orbit.`;
  } else {
    modelTransformGizmo.detach();
    modelCornerRadiusRow.classList.add("hidden");
    modelStatus.textContent = "No object selected.";
  }
}
modelTransformGizmo.addEventListener("objectChange", () => {
  if (!selectedModel) return;
  selectedModel.position.set(
    THREE.MathUtils.clamp(selectedModel.position.x, -100, 100),
    THREE.MathUtils.clamp(selectedModel.position.y, -100, 100),
    THREE.MathUtils.clamp(selectedModel.position.z, -100, 100),
  );
  selectedModel.rotation.set(
    THREE.MathUtils.clamp(selectedModel.rotation.x, THREE.MathUtils.degToRad(-360), THREE.MathUtils.degToRad(360)),
    THREE.MathUtils.clamp(selectedModel.rotation.y, THREE.MathUtils.degToRad(-360), THREE.MathUtils.degToRad(360)),
    THREE.MathUtils.clamp(selectedModel.rotation.z, THREE.MathUtils.degToRad(-360), THREE.MathUtils.degToRad(360)),
  );
  selectedModel.geometry.computeBoundingBox();
  const baseDimensions = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3());
  for (let axis = 0; axis < 3; axis++) {
    const baseLength = baseDimensions.getComponent(axis);
    if (baseLength > 0) {
      const minScale = Math.max(0.000001, 0.000001 / baseLength);
      const maxScale = Math.min(1_000_000_000, 1000 / baseLength);
      selectedModel.scale.setComponent(axis, THREE.MathUtils.clamp(Math.abs(selectedModel.scale.getComponent(axis)), minScale, maxScale));
    }
  }
  modelScale.value = String(THREE.MathUtils.clamp(selectedModel.scale.x, Number(modelScale.min), Number(modelScale.max)));
  syncModelTransformFields();
});
for (const [id, mode] of [["modelMoveMode", "translate"], ["modelRotateMode", "rotate"], ["modelScaleMode", "scale"]]) {
  const button = document.getElementById(id);
  button.addEventListener("click", () => {
    modelTransformGizmo.setMode(mode);
    for (const candidate of document.querySelectorAll(".model-gizmo-mode")) candidate.setAttribute("aria-pressed", String(candidate === button));
    modelStatus.textContent = `${mode[0].toUpperCase()}${mode.slice(1)} gizmo active. Drag a colored axis to edit the selected object.`;
  });
}
document.getElementById("addBoxBtn").addEventListener("click", () => addPrimitive("box"));
document.getElementById("addSphereBtn").addEventListener("click", () => addPrimitive("sphere"));
document.getElementById("addCylinderBtn").addEventListener("click", () => addPrimitive("cylinder"));
const modelFileInput = document.getElementById("modelFileInput");
document.getElementById("importModelBtn").addEventListener("click", () => modelFileInput.click());
modelFileInput.addEventListener("change", async () => {
  const file = modelFileInput.files?.[0];
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { modelStatus.textContent = "For now, imported model files must be 50 MB or smaller."; modelFileInput.value = ""; return; }
  modelStatus.textContent = `Importing ${file.name}…`;
  try {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (extension === "stl") {
      const geometry = new STLLoader().parse(await file.arrayBuffer());
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x42c8bd, metalness: 0.1, roughness: 0.55 }));
      mesh.userData.kind = `STL ${file.name}`;
      const bounds = new THREE.Box3().setFromObject(mesh);
      mesh.position.sub(bounds.getCenter(new THREE.Vector3()));
      modelMeshes.push(mesh); modelScene.add(mesh); selectModel(mesh);
    } else if (extension === "obj") {
      const group = new OBJLoader().parse(await file.text());
      const bounds = new THREE.Box3().setFromObject(group);
      group.position.sub(bounds.getCenter(new THREE.Vector3()));
      group.updateMatrixWorld(true);
      const imported = [];
      group.traverse((child) => {
        if (!child.isMesh) return;
        const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x42c8bd, metalness: 0.1, roughness: 0.55 }));
        mesh.userData.kind = `OBJ ${file.name}`;
        imported.push(mesh);
      });
      for (const mesh of imported) { modelMeshes.push(mesh); modelScene.add(mesh); }
      selectModel(imported[0] || null);
    } else {
      modelStatus.textContent = "Choose an STL or OBJ file.";
      return;
    }
    modelStatus.textContent = `Imported ${file.name}. Geometry is centered; OBJ materials are not imported.`;
  } catch (error) {
    modelStatus.textContent = `Could not import ${file.name}: ${error instanceof Error ? error.message : "invalid model"}`;
  } finally {
    modelFileInput.value = "";
  }
});
document.getElementById("deleteModelBtn").addEventListener("click", () => {
  if (!selectedModel) return;
  modelScene.remove(selectedModel);
  selectedModel.geometry.dispose(); selectedModel.material.dispose();
  modelMeshes.splice(modelMeshes.indexOf(selectedModel), 1);
  if (secondaryModel) secondaryModel.material.emissive.setHex(0x000000);
  secondaryModel = null;
  selectModel(null);
});
function combineSelectedModels(operation, label) {
  if (!selectedModel || !secondaryModel || selectedModel === secondaryModel) {
    modelStatus.textContent = "Select one object, then Shift-click a second object to combine them.";
    return;
  }
  const triangleCount = (mesh) => (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
  if (triangleCount(selectedModel) + triangleCount(secondaryModel) > 80_000) {
    modelStatus.textContent = "Boolean operations are limited to 80,000 input triangles to keep the workspace responsive.";
    return;
  }
  const makeBrush = (mesh) => {
    const brush = new Brush(mesh.geometry.clone(), new THREE.MeshStandardMaterial({ color: 0x42c8bd, metalness: 0.1, roughness: 0.55 }));
    brush.position.copy(mesh.position);
    brush.quaternion.copy(mesh.quaternion);
    brush.scale.copy(mesh.scale);
    brush.updateMatrixWorld(true);
    return brush;
  };
  const brushA = makeBrush(selectedModel);
  const brushB = makeBrush(secondaryModel);
  try {
    const evaluator = new Evaluator();
    evaluator.useGroups = false;
    const result = evaluator.evaluate(brushA, brushB, operation);
    result.userData.kind = label;
    result.material = new THREE.MeshStandardMaterial({ color: 0x42c8bd, metalness: 0.1, roughness: 0.55 });
    modelScene.remove(selectedModel, secondaryModel);
    selectedModel.geometry.dispose(); selectedModel.material.dispose();
    secondaryModel.geometry.dispose(); secondaryModel.material.dispose();
    modelMeshes.splice(modelMeshes.indexOf(selectedModel), 1, result);
    modelMeshes.splice(modelMeshes.indexOf(secondaryModel), 1);
    modelScene.add(result);
    selectedModel = result;
    secondaryModel = null;
    selectModel(result);
    modelStatus.textContent = `${label} complete. Boolean results require watertight, non-intersecting input meshes for reliable geometry.`;
  } catch (error) {
    modelStatus.textContent = `Boolean operation failed: ${error instanceof Error ? error.message : "unsupported geometry"}. Try closed primitive meshes.`;
  } finally {
    brushA.geometry.dispose(); brushA.material.dispose();
    brushB.geometry.dispose(); brushB.material.dispose();
  }
}
document.getElementById("unionModelBtn").addEventListener("click", () => combineSelectedModels(ADDITION, "Union"));
document.getElementById("subtractModelBtn").addEventListener("click", () => combineSelectedModels(SUBTRACTION, "Subtraction"));
const measureModelBtn = document.getElementById("measureModelBtn");
const modelMetrics = document.getElementById("modelMetrics");
measureModelBtn.addEventListener("click", () => {
  if (!selectedModel) { modelMetrics.textContent = "Select an object to measure."; return; }
  selectedModel.updateMatrixWorld(true);
  const geometry = selectedModel.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  const total = index ? index.count : position.count;
  const start = geometry.drawRange.start;
  const count = Math.min(total, geometry.drawRange.count);
  const triangles = Math.floor(count / 3);
  const size = new THREE.Box3().setFromObject(selectedModel).getSize(new THREE.Vector3());
  let volumeText = "Volume estimate skipped for meshes over 120,000 triangles.";
  let topologyText = "Topology check skipped for meshes over 120,000 triangles.";
  if (triangles <= 120_000) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let signedVolume = 0;
    const diagnosticScale = Math.max(size.x, size.y, size.z, 1e-6);
    const weldTolerance = diagnosticScale * 1e-7;
    const degenerateAreaSquaredLimit = diagnosticScale ** 4 * 1e-20;
    const vertexIds = new Map();
    const edges = new Map();
    const firstTriangleAtVertex = new Map();
    const parents = new Int32Array(triangles);
    for (let i = 0; i < triangles; i++) parents[i] = i;
    const findRoot = (item) => {
      let root = item;
      while (parents[root] !== root) root = parents[root];
      while (parents[item] !== item) { const next = parents[item]; parents[item] = root; item = next; }
      return root;
    };
    const unionTriangles = (left, right) => {
      const aRoot = findRoot(left), bRoot = findRoot(right);
      if (aRoot !== bRoot) parents[bRoot] = aRoot;
    };
    const vertexId = (attributeIndex) => {
      const x = Math.round(position.getX(attributeIndex) / weldTolerance);
      const y = Math.round(position.getY(attributeIndex) / weldTolerance);
      const z = Math.round(position.getZ(attributeIndex) / weldTolerance);
      const key = `${x},${y},${z}`;
      let id = vertexIds.get(key);
      if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
      return id;
    };
    let degenerateTriangles = 0;
    for (let i = start; i + 2 < start + count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(selectedModel.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(selectedModel.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(selectedModel.matrixWorld);
      signedVolume += a.dot(b.clone().cross(c)) / 6;
      const area2 = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
      if (!Number.isFinite(area2) || area2 <= degenerateAreaSquaredLimit) degenerateTriangles++;
      const currentTriangle = Math.floor((i - start) / 3);
      const ids = [vertexId(ia), vertexId(ib), vertexId(ic)];
      for (const id of ids) {
        const previous = firstTriangleAtVertex.get(id);
        if (previous === undefined) firstTriangleAtVertex.set(id, currentTriangle);
        else unionTriangles(previous, currentTriangle);
      }
      for (let edge = 0; edge < 3; edge++) {
        const from = ids[edge], to = ids[(edge + 1) % 3];
        const low = Math.min(from, to), high = Math.max(from, to);
        const key = `${low}:${high}`;
        const record = edges.get(key) || { uses: 0, directionBalance: 0 };
        record.uses++;
        record.directionBalance += from === low ? 1 : -1;
        edges.set(key, record);
      }
    }
    volumeText = `Signed-mesh volume magnitude estimate: ${Math.abs(signedVolume).toFixed(3)} scene units³ (meaningful only for closed, consistently oriented geometry).`;
    let boundaryEdges = 0, nonManifoldEdges = 0, windingMismatches = 0;
    for (const edge of edges.values()) {
      if (edge.uses === 1) boundaryEdges++;
      else if (edge.uses > 2) nonManifoldEdges++;
      else if (edge.directionBalance !== 0) windingMismatches++;
    }
    const components = new Set(Array.from({ length: triangles }, (_, item) => findRoot(item))).size;
    const closed = boundaryEdges === 0 && nonManifoldEdges === 0;
    const manifoldText = closed ? "no boundary or non-manifold edges" : `${boundaryEdges} boundary and ${nonManifoldEdges} non-manifold edges`;
    const windingText = windingMismatches ? `${windingMismatches} shared edges have inconsistent face winding` : "shared edge winding is consistent";
    topologyText = `Topology diagnostic: ${manifoldText}; ${windingText}; ${degenerateTriangles} degenerate triangles; ${components} connected component(s).`;
  }
  modelMetrics.textContent = `Bounds: ${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} scene units · ${triangles.toLocaleString()} triangles. ${volumeText} ${topologyText} These geometry diagnostics do not certify printability or wall thickness.`;
});
modelScale.addEventListener("input", () => {
  if (!selectedModel) return;
  selectedModel.scale.setScalar(Number(modelScale.value));
  syncModelTransformFields();
});
for (let i = 0; i < 3; i++) {
  modelTransformFields.position[i].addEventListener("input", () => {
    if (!selectedModel) return;
    const raw = Number(modelTransformFields.position[i].value);
    const value = THREE.MathUtils.clamp(Number.isFinite(raw) ? raw : 0, -100, 100);
    selectedModel.position.setComponent(i, value);
    modelTransformFields.position[i].value = String(value);
  });
  modelTransformFields.rotation[i].addEventListener("input", () => {
    if (!selectedModel) return;
    const raw = Number(modelTransformFields.rotation[i].value);
    const degrees = THREE.MathUtils.clamp(Number.isFinite(raw) ? raw : 0, -360, 360);
    selectedModel.rotation["xyz"[i]] = THREE.MathUtils.degToRad(degrees);
    modelTransformFields.rotation[i].value = String(degrees);
  });
  modelTransformFields.dimensions[i].addEventListener("change", () => {
    if (!selectedModel) return;
    const requested = Number(modelTransformFields.dimensions[i].value);
    if (!Number.isFinite(requested) || requested <= 0 || requested > 1000) { syncModelTransformFields(); return; }
    selectedModel.geometry.computeBoundingBox();
    const baseSize = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3());
    const baseAxis = baseSize.getComponent(i);
    if (baseAxis <= 0) { syncModelTransformFields(); return; }
    selectedModel.scale.setComponent(i, requested / baseAxis);
    syncModelTransformFields();
  });
}
modelCornerRadius.addEventListener("change", () => {
  const radius = Number(modelCornerRadius.value);
  if (!roundSelectedBox(radius)) {
    syncModelTransformFields();
    modelStatus.textContent = "Corner radius must be positive and no more than 45% of the box's shortest side.";
    return;
  }
  modelStatus.textContent = "Corner radius updated. Review the rounded box before export.";
});
modelCanvas.addEventListener("pointerdown", (event) => {
  if (modelTransformGizmo.dragging) return;
  const rect = modelCanvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), modelCamera);
  const hit = ray.intersectObjects(modelMeshes)[0];
  if (hit && event.shiftKey && selectedModel && hit.object !== selectedModel) {
    if (secondaryModel) secondaryModel.material.emissive.setHex(0x000000);
    secondaryModel = hit.object;
    secondaryModel.material.emissive.setHex(0x6b4b1c);
    modelStatus.textContent = "Two objects selected. Choose Union or Subtract second.";
  } else if (hit) selectModel(hit.object);
  draggingModel = true; lastModelPointer = { x: event.clientX, y: event.clientY };
  modelCanvas.setPointerCapture(event.pointerId);
});
modelCanvas.addEventListener("pointermove", (event) => {
  if (modelTransformGizmo.dragging) return;
  if (!draggingModel || !lastModelPointer) return;
  modelYaw -= (event.clientX - lastModelPointer.x) * 0.009;
  modelPitch = Math.max(-1.35, Math.min(1.35, modelPitch + (event.clientY - lastModelPointer.y) * 0.009));
  lastModelPointer = { x: event.clientX, y: event.clientY };
  updateModelCamera();
});
modelCanvas.addEventListener("pointerup", () => { draggingModel = false; lastModelPointer = null; });
modelCanvas.addEventListener("wheel", (event) => { event.preventDefault(); modelDistance = Math.max(3, Math.min(30, modelDistance + Math.sign(event.deltaY) * 0.7)); updateModelCamera(); }, { passive: false });
document.getElementById("exportStlBtn").addEventListener("click", () => {
  if (!modelMeshes.length) { modelStatus.textContent = "Add a primitive before exporting."; return; }
  const sceneUnit = document.getElementById("modelStlUnit").value;
  const sceneUnitToMillimeters = { mm: 1, cm: 10, in: 25.4 }[sceneUnit] || 1;
  const triangles = [];
  let tooLarge = false;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for (const mesh of modelMeshes) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const count = Math.min(index ? index.count : position.count, mesh.geometry.drawRange.count);
    const start = mesh.geometry.drawRange.start;
    for (let i = start; i < start + count; i += 3) {
      if (triangles.length >= 500_000) { tooLarge = true; break; }
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      vA.fromBufferAttribute(position, a).applyMatrix4(mesh.matrixWorld);
      vB.fromBufferAttribute(position, b).applyMatrix4(mesh.matrixWorld);
      vC.fromBufferAttribute(position, c).applyMatrix4(mesh.matrixWorld);
      vA.multiplyScalar(sceneUnitToMillimeters);
      vB.multiplyScalar(sceneUnitToMillimeters);
      vC.multiplyScalar(sceneUnitToMillimeters);
      const normal = vB.clone().sub(vA).cross(vC.clone().sub(vA)).normalize();
      triangles.push(`facet normal ${normal.x} ${normal.y} ${normal.z}\n outer loop\n  vertex ${vA.x} ${vA.y} ${vA.z}\n  vertex ${vB.x} ${vB.y} ${vB.z}\n  vertex ${vC.x} ${vC.y} ${vC.z}\n endloop\nendfacet`);
    }
    if (tooLarge) break;
  }
  if (tooLarge) { modelStatus.textContent = "This model is too detailed for ASCII STL export here. Simplify it to fewer than 500,000 triangles first."; return; }
  const blob = new Blob([`solid proxima\n${triangles.join("\n")}\nendsolid proxima`], { type: "model/stl" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "proxima-model.stl"; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  modelStatus.textContent = `Exported ${modelMeshes.length} object(s). STL coordinates were converted using 1 scene unit = ${sceneUnit === "in" ? "1 inch (25.4 mm)" : sceneUnit === "cm" ? "1 cm (10 mm)" : "1 mm"}. STL does not store units; coordinates are now in millimeters.`;
});
const modelEditPrompt = document.getElementById("modelEditPrompt");
const applyModelEditBtn = document.getElementById("applyModelEditBtn");
applyModelEditBtn.addEventListener("click", async () => {
  const prompt = modelEditPrompt.value.trim();
  if (!prompt) { modelStatus.textContent = "Describe the transform change first."; return; }
  applyModelEditBtn.disabled = true;
  modelStatus.textContent = selectedModel ? "Asking the local model for a transform…" : "Asking the local model for a supported primitive…";
  try {
    const current = selectedModel ? {
      position: { x: selectedModel.position.x, y: selectedModel.position.y, z: selectedModel.position.z },
      rotation: {
        x: THREE.MathUtils.radToDeg(selectedModel.rotation.x),
        y: THREE.MathUtils.radToDeg(selectedModel.rotation.y),
        z: THREE.MathUtils.radToDeg(selectedModel.rotation.z),
      },
      scale: { x: selectedModel.scale.x, y: selectedModel.scale.y, z: selectedModel.scale.z },
      dimensions: (() => {
        selectedModel.geometry.computeBoundingBox();
        const size = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(selectedModel.scale);
        return { x: size.x, y: size.y, z: size.z };
      })(),
      geometryDimensions: (() => {
        selectedModel.geometry.computeBoundingBox();
        const size = selectedModel.geometry.boundingBox.getSize(new THREE.Vector3());
        return { x: size.x, y: size.y, z: size.z };
      })(),
    } : null;
    const result = await window.proxy.editModelTransform({ prompt, kind: selectedModel?.userData.kind, sceneUnit: document.getElementById("modelStlUnit").value, current });
    if (Array.isArray(result?.createObjects)) {
      for (const object of result.createObjects) {
        if (!["box", "sphere", "cylinder"].includes(object?.kind)
          || ![object?.dimensions?.x, object?.dimensions?.y, object?.dimensions?.z,
            object?.position?.x, object?.position?.y, object?.position?.z,
            object?.rotation?.x, object?.rotation?.y, object?.rotation?.z].every(Number.isFinite)) {
          modelStatus.textContent = "The local model returned an invalid assembly; nothing was added.";
          return;
        }
      }
      for (const object of result.createObjects) addPrimitive(object.kind, object);
      modelStatus.textContent = `Added ${result.createObjects.length} supported primitive(s). Adjust and review the assembly before export.`;
      return;
    }
    if (result?.geometryEdit?.kind === "rounded-box") {
      if (!roundSelectedBox(result.geometryEdit.radius)) { modelStatus.textContent = "That radius cannot be applied to this box; the object was not changed."; return; }
      modelStatus.textContent = `Rounded box corners applied with radius ${result.geometryEdit.radius.toFixed(2)} scene units. Review before export.`;
      return;
    }
    if (!result?.transform) { modelStatus.textContent = result?.error || "No transform was returned; the object was not changed."; return; }
    const { position, rotation, scale } = result.transform;
    if (![position?.x, position?.y, position?.z, rotation?.x, rotation?.y, rotation?.z, scale?.x, scale?.y, scale?.z].every(Number.isFinite)) {
      modelStatus.textContent = "The local model returned an invalid transform; the object was not changed.";
      return;
    }
    selectedModel.position.set(position.x, position.y, position.z);
    selectedModel.rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
    selectedModel.scale.set(scale.x, scale.y, scale.z);
    modelScale.value = String(THREE.MathUtils.clamp(scale.x, Number(modelScale.min), Number(modelScale.max)));
    syncModelTransformFields();
    modelStatus.textContent = "Transform applied. Scene units are arbitrary; review the result before export.";
  } catch { modelStatus.textContent = "Local transform editing is unavailable."; }
  finally { applyModelEditBtn.disabled = false; }
});
const analyzeModelBtn = document.getElementById("analyzeModelBtn");
const modelAnalysis = document.getElementById("modelAnalysis");
analyzeModelBtn.addEventListener("click", async () => {
  if (!modelMeshes.length) { modelAnalysis.textContent = "Add or import geometry first."; return; }
  analyzeModelBtn.disabled = true;
  modelAnalysis.textContent = "Sending this preview to the local smart model…";
  try {
    const image = modelCanvas.toDataURL("image/png").split(",")[1];
    const result = await window.proxy.analyzeModelPreview(image);
    modelAnalysis.textContent = result?.text || result?.error || "No description returned.";
  } catch { modelAnalysis.textContent = "Local vision analysis is unavailable."; }
  finally { analyzeModelBtn.disabled = false; }
});
updateModelCamera();

// ================================================================
// Log
// ================================================================

function timestamp(date) {
  return (date || new Date()).toLocaleTimeString([], { hour12: false });
}

// Milestone 14 fix — see index.html's comment on #confirmOverlay for why
// this replaces window.confirm(). Promise-based so call sites can still
// just `if (!(await showConfirm(...))) return;`, same shape as before.
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmMessage = document.getElementById("confirmMessage");
const confirmOkBtn = document.getElementById("confirmOkBtn");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
let resolveConfirm = null;

function showConfirm(message, okLabel = "OK") {
  confirmMessage.textContent = message;
  confirmOkBtn.textContent = okLabel;
  confirmOverlay.classList.remove("hidden");
  confirmOkBtn.focus();
  return new Promise((resolve) => {
    resolveConfirm = resolve;
  });
}

function closeConfirm(result) {
  confirmOverlay.classList.add("hidden");
  if (resolveConfirm) {
    resolveConfirm(result);
    resolveConfirm = null;
  }
}

confirmOkBtn.addEventListener("click", () => closeConfirm(true));
confirmCancelBtn.addEventListener("click", () => closeConfirm(false));
confirmOverlay.addEventListener("click", (event) => {
  if (event.target === confirmOverlay) closeConfirm(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !confirmOverlay.classList.contains("hidden")) closeConfirm(false);
});

// Confirmed via an in-app modal since this is irreversible - the whole
// point of Milestone 13's persistence is that history survives a
// relaunch, so clearing it should be a deliberate act, not a stray
// click. Clears the DOM immediately rather than waiting on the IPC
// round-trip - clearLog() is fire-and-forget on the main-process side
// (same shape as persistLogEntry), and there's nothing for the
// renderer to wait for.
const clearLogBtn = document.getElementById("clearLogBtn");
clearLogBtn.addEventListener("click", async () => {
  const ok = await showConfirm("Clear the session log? This can't be undone.", "Clear");
  if (!ok) return;
  log.innerHTML = "";
  log.appendChild(logEmpty);
  window.proxy.clearLog();
  inputText.focus();
});

const memoryList = document.getElementById("memoryList");
const refreshMemoryBtn = document.getElementById("refreshMemoryBtn");
const clearMemoryBtn = document.getElementById("clearMemoryBtn");
async function refreshMemoryPanel() {
  refreshMemoryBtn.disabled = true;
  memoryList.textContent = "Loading saved facts…";
  try {
    const result = await window.proxy.getMemory();
    memoryList.replaceChildren();
    if (!Array.isArray(result)) {
      memoryList.textContent = result?.error || "Saved memory is unavailable.";
      return;
    }
    if (!result.length) {
      memoryList.textContent = "No saved facts yet.";
      return;
    }
    for (const fact of result) {
      const row = document.createElement("div");
      row.className = "memory-item";
      row.textContent = typeof fact?.text === "string" ? fact.text : "Saved item";
      memoryList.appendChild(row);
    }
  } catch {
    memoryList.textContent = "Saved memory is unavailable.";
  } finally {
    refreshMemoryBtn.disabled = false;
  }
}
refreshMemoryBtn.addEventListener("click", refreshMemoryPanel);
clearMemoryBtn.addEventListener("click", async () => {
  const confirmed = await showConfirm("Forget all saved facts? This cannot be undone.", "Forget all");
  if (!confirmed) return;
  clearMemoryBtn.disabled = true;
  try {
    const result = await window.proxy.clearMemory();
    if (result?.ok) await refreshMemoryPanel();
    else memoryList.textContent = "Could not clear saved memory.";
  } catch {
    memoryList.textContent = "Could not clear saved memory.";
  } finally {
    clearMemoryBtn.disabled = false;
  }
});

// Milestone 13 — opts.timestamp (an ISO string) lets hydrated history
// entries show their real original time instead of "now"; opts.skipPersist
// stops a hydrated entry from being written straight back to the log file
// it was just read from. Everything else about a live vs. a replayed
// entry is identical - same DOM row, same styling, same describeRoute()
// formatting already applied by the caller before this function even
// sees the text.
function appendLog(kind, text, opts = {}) {
  if (logEmpty) logEmpty.remove();
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `
    <span class="log-time">${timestamp(opts.timestamp ? new Date(opts.timestamp) : undefined)}</span>
    <span class="log-kind ${kind}">${kind}</span>
    <span class="log-text"></span>
  `;
  row.querySelector(".log-text").textContent = text; // textContent, not innerHTML — never trust transcribed/model text as markup
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
  if (!opts.skipPersist) {
    window.proxy.persistLogEntry(kind, text);
  }
}

function describeRoute(info) {
  if (!info) return "unknown routing";
  if (info.source === "regex") return `regex → ${info.handler}`;
  // Milestone 9 step 6: tools (plural) — the orchestrator can chain more
  // than one real tool call per request now.
  if (info.source === "llm-tool") return `LLM tool → ${info.tools.join(", ")}`;
  // Milestone 10 Part B — the follow-up turn that resolves a run_script
  // confirmation request, resolved before the regex router or the
  // orchestrator ever see it.
  if (info.source === "confirmation") return info.confirmed ? "confirmation → confirmed" : "confirmation → cancelled";
  return "conversation (no command)";
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ================================================================
// Engine event wiring
// ================================================================

// Milestone 13 — sent once, before "ready", right after the persisted
// session log (previous runs) is loaded. Replays each entry through the
// exact same appendLog() a live entry uses (skipPersist so hydration
// doesn't write the history right back to the file it came from,
// timestamp so a from-yesterday entry shows yesterday's time, not "now"
// — showing a fake current-looking timestamp for something that already
// happened would be its own small dishonesty). A plain divider marks
// where previous-session history ends and this session's live entries
// begin, so scrolling back never reads as "all one continuous session"
// when it wasn't.
window.proxy.on("log-history", (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) return;
  entries.forEach((e) => appendLog(e.kind, e.text, { skipPersist: true, timestamp: e.timestamp }));
  if (logEmpty) logEmpty.remove();
  const divider = document.createElement("div");
  divider.className = "log-divider";
  divider.textContent = "— new session —";
  log.appendChild(divider);
  log.scrollTop = log.scrollHeight;
});

window.proxy.on("ready", (payload) => {
  hotkeyLabel.textContent = `hotkey: ${payload.hotkey}`;
  statusHotkey.textContent = payload.hotkey;
  statusState.textContent = "Ready";
  startedAt = Date.now();
});
window.proxy.on("activation", (payload) => {
  clapStatus.textContent = payload?.listening ? "double-clap: listening" : payload?.paused ? "double-clap: paused" : payload?.enabled ? "double-clap: unavailable" : "double-clap: off";
});

window.proxy.on("listening", (info) => {
  // Milestone 8 (VAD): there's no fixed recording length anymore, so
  // there's nothing honest to count down. info.maxMs is only the hard
  // safety cap — recording actually stops on silence, well before that
  // in the normal case. See engine.ts's "listening" event docs.
  turnInProgress = true;
  resetActivityPanel();
  showActivityPanel();
  addActivityRow("Listening", { sub: "waiting for you to speak…" });
  statusDot.classList.add("active");
  statusDot.classList.remove("alarm");
  setOrbState("listening");
  micBtn.classList.add("listening");
  micBtn.setAttribute("aria-pressed", "true");
  setMicBusy(true);
  appendLog("status", `listening (auto-stops after a pause, max ${Math.round(info.maxMs / 1000)}s)`);
  outputBox.innerHTML = '<span class="output-empty">Listening…</span>';
});

window.proxy.on("speech-start", () => {
  // Real signal, not decoration: this only fires once recorded energy
  // actually crossed the VAD's speech threshold.
  if (currentRow) currentRow.subEl.textContent = "hearing you — pause when done";
  appendLog("status", "hearing you...");
});

window.proxy.on("busy", () => {
  appendLog("status", 'still working on the last request — press the hotkey again (or type "stop") to cancel it');
});

window.proxy.on("no-speech", () => {
  resolveActivityRow(currentRow, { label: "Nothing heard", stopped: true });
  setOrbState("idle");
  appendLog("status", "didn't catch anything");
  outputBox.innerHTML = '<span class="output-empty">Didn\u2019t catch anything.</span>';
});

window.proxy.on("transcribing", () => {
  resolveActivityRow(currentRow);
  addActivityRow("Understanding your words");
});

window.proxy.on("transcribed", (text) => {
  if (!turnInProgress) {
    // Typed input (dashboard Input box) skips listening/speech-start/
    // transcribing entirely (see engine.ts's runWithText) — this is the
    // first event of the turn in that case, so it needs the same
    // fresh-turn treatment the "listening" handler gives the voice path.
    turnInProgress = true;
    resetActivityPanel();
    showActivityPanel();
    setMicBusy(true);
  } else {
    resolveActivityRow(currentRow, { sub: truncate(text, 60) });
  }
  // A queued submission (see the Typed input section below) has now
  // actually started — clear the box and re-enable Send.
  if (queuedText !== null) {
    inputText.value = "";
    queuedText = null;
    inputSend.disabled = false;
  }
  setOrbState("thinking");
  appendLog("heard", text);
  outputBox.innerHTML = '<span class="output-empty">Proxy is thinking…</span>';
});

// The four below only fire for the orchestrator path — a regex-matched
// command goes straight from "transcribed" to "routed"/"reply" with none
// of these, because a regex hit is a near-instant pattern match, not a
// decision. Inventing rows for stages that didn't happen would be
// exactly the fake precision the transparency principle rules out.

window.proxy.on("deciding", (tier) => {
  resolveActivityRow(currentRow);
  // Milestone 14 relabeling: "Deciding" → "Analyzing Input" (the
  // plan's own example) — same real fast/smart-tier timing underneath.
  lastDecidingRow = addActivityRow("Analyzing Input", {
    sub: tier === "smart" ? "smart tier" : "fast tier",
    rotateWords: tier === "smart",
  });
});

window.proxy.on("tool-start", (name) => {
  resolveActivityRow(currentRow);
  addActivityRow(`Running: ${name}`, { action: true });
  flashAction();
});

window.proxy.on("tool-result", ({ name, result }) => {
  resolveActivityRow(currentRow, { sub: truncate(result, 70) });
});

// Milestone 10 Part B — a script is now awaiting a yes/no on the next
// turn (see runScript.ts's docblock). This row stays open, not
// auto-resolved, since there's no "still waiting" event to resolve it
// with yet - it gets resolved implicitly the next time any row opens
// (resolveActivityRow(currentRow) at the top of the next turn's first
// event), same as every other row in this panel.
window.proxy.on("awaiting-confirmation", (info) => {
  resolveActivityRow(currentRow);
  const label = "path" in info ? `run ${info.path}` : `click "${info.description}"`;
  addActivityRow(`Awaiting confirmation: ${label}`, { action: true });
  flashAction();
});

window.proxy.on("thinking", (trace) => {
  attachThinkingTrace(lastDecidingRow, trace);
});

window.proxy.on("responding", () => {
  resolveActivityRow(currentRow);
  addActivityRow("Responding");
});

window.proxy.on("routed", (info) => {
  // Orchestrator-path actions already flash via "tool-start" above, per
  // execution — this covers the regex fast path, which never emits
  // tool-start at all.
  if (info && info.source === "regex") flashAction();
  appendLog("routed", describeRoute(info));
});

window.proxy.on("reply", (text) => {
  resolveActivityRow(currentRow); // resolves "Responding" on the orchestrator path; no-op on the regex path
  activityFinal.classList.remove("hidden");
  activityFinalText.textContent = text; // textContent, never innerHTML — model output, never trusted as markup
  appendLog("reply", text);
  outputBox.textContent = text;
});

window.proxy.on("speaking", () => {
  setOrbState("speaking");
});

window.proxy.on("cancelled", () => {
  resolveActivityRow(currentRow, { stopped: true });
  appendLog("status", "stopped");
  // engine.ts's cancel() also drops any queued typed text (a stop really
  // means stop) — mirror that here: nothing will fire it, so release
  // Send now rather than leaving it stuck disabled. The text itself
  // stays in the box either way; it was never cleared, so the user can
  // just hit send again if they still want it sent.
  if (queuedText !== null) {
    queuedText = null;
    inputSend.disabled = false;
  }
  // The orchestrator's own honest "Stopped — ..." text still arrives
  // via the normal "reply" event right after this — nothing more to do
  // here beyond marking the interrupted row so it doesn't read as done.
});

window.proxy.on("idle", () => {
  turnInProgress = false;
  statusDot.classList.remove("active");
  micBtn.classList.remove("listening");
  micBtn.setAttribute("aria-pressed", "false");
  setMicBusy(false);
  resolveActivityRow(currentRow); // safety net - nothing should normally still be open here
  statusState.textContent = "Ready";
  if (!errorFlashTimeout) setOrbState("idle");
});

window.proxy.on("error", (message) => {
  statusDot.classList.add("alarm");
  statusState.textContent = "Error";
  resolveActivityRow(currentRow, { stopped: true, sub: truncate(message, 70) });
  flashError(message);
  appendLog("error", message);
});

// Milestone 19 Part B — this panel renders only samples returned by the
// Windows query. Missing samples are an explicit unavailable state, never
// zero-valued placeholder metrics.
const monitorCpuValue = document.getElementById("monitorCpuValue");
const monitorCpuFill = document.getElementById("monitorCpuFill");
const monitorMemoryValue = document.getElementById("monitorMemoryValue");
const monitorMemoryFill = document.getElementById("monitorMemoryFill");
const monitorTopMemory = document.getElementById("monitorTopMemory");
const monitorTopCpu = document.getElementById("monitorTopCpu");
const monitorUpdated = document.getElementById("monitorUpdated");

function setMonitorUnavailable() {
  monitorCpuValue.textContent = "Unavailable";
  monitorMemoryValue.textContent = "Unavailable";
  monitorCpuFill.style.width = "0%";
  monitorMemoryFill.style.width = "0%";
  monitorTopMemory.textContent = "Unavailable";
  monitorTopCpu.textContent = "Unavailable";
  monitorUpdated.textContent = "No sample";
}

function renderProcessList(target, processes, valueKey, suffix) {
  target.replaceChildren();
  if (!Array.isArray(processes) || processes.length === 0) {
    target.textContent = "No process data";
    return;
  }
  for (const process of processes.slice(0, 3)) {
    const row = document.createElement("div");
    row.className = "monitor-process-row";
    const name = document.createElement("span");
    name.textContent = String(process.name);
    const value = document.createElement("span");
    value.textContent = `${process[valueKey]}${suffix}`;
    row.append(name, value);
    target.appendChild(row);
  }
}

window.proxy.on("system-usage", (usage) => {
  if (!usage || typeof usage !== "object") {
    setMonitorUnavailable();
    return;
  }
  const cpu = Number(usage.cpuPercent);
  const memory = Number(usage.usedMemPercent);
  if (!Number.isFinite(cpu) || !Number.isFinite(memory)) {
    setMonitorUnavailable();
    return;
  }
  const boundedCpu = Math.max(0, Math.min(100, cpu));
  const boundedMemory = Math.max(0, Math.min(100, memory));
  monitorCpuValue.textContent = `${cpu.toFixed(1)}%`;
  monitorCpuFill.style.width = `${boundedCpu}%`;
  monitorMemoryValue.textContent = `${memory.toFixed(1)}% (${usage.usedMemMB} / ${usage.totalMemMB} MB)`;
  monitorMemoryFill.style.width = `${boundedMemory}%`;
  renderProcessList(monitorTopMemory, usage.topByMemory, "memMB", " MB");
  renderProcessList(monitorTopCpu, usage.topByCpuTime, "cpuSeconds", " s");
  monitorUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour12: false })}`;
});

const presentDeviceList = document.getElementById("presentDeviceList");
window.proxy.on("present-devices", (devices) => {
  presentDeviceList.replaceChildren();
  if (!Array.isArray(devices)) {
    presentDeviceList.textContent = "Windows device inventory unavailable";
    return;
  }
  if (devices.length === 0) {
    presentDeviceList.textContent = "No Bluetooth or audio devices detected";
    return;
  }
  for (const device of devices.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "monitor-process-row";
    const name = document.createElement("span");
    name.textContent = String(device.name);
    const state = document.createElement("span");
    state.textContent = `${device.kind} · ${device.status}`;
    row.append(name, state);
    presentDeviceList.appendChild(row);
  }
});

// Location is only requested after this explicit user action. The tiles
// are requested from OpenStreetMap for the current viewport; the provider
// can therefore infer the area being viewed, as disclosed in the UI.
const mapLocationBtn = document.getElementById("mapLocationBtn");
const mapStatus = document.getElementById("mapStatus");
const mapTiles = document.getElementById("mapTiles");
function showMapAt(latitude, longitude) {
  const zoom = 14;
  const scale = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * scale);
  const latRad = latitude * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * scale);
  mapTiles.replaceChildren();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tileX = (x + dx + scale) % scale;
    const tileY = Math.max(0, Math.min(scale - 1, y + dy));
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;
    mapTiles.appendChild(img);
  }
  mapStatus.textContent = `Map centered near ${latitude.toFixed(3)}, ${longitude.toFixed(3)}.`;
}
mapLocationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) { mapStatus.textContent = "Location is unavailable in this runtime."; return; }
  mapStatus.textContent = "Waiting for location permission…";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => showMapAt(coords.latitude, coords.longitude),
    (error) => { mapStatus.textContent = error.code === error.PERMISSION_DENIED ? "Location permission denied." : "Could not get current location."; },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
  );
});

const newsRefreshBtn = document.getElementById("newsRefreshBtn");
const newsStatus = document.getElementById("newsStatus");
const newsList = document.getElementById("newsList");
newsRefreshBtn.addEventListener("click", async () => {
  newsRefreshBtn.disabled = true;
  newsStatus.textContent = "Loading current feeds…";
  try {
    const result = await window.proxy.fetchNews();
    newsList.replaceChildren();
    if (!Array.isArray(result)) { newsStatus.textContent = result?.error || "News is unavailable."; return; }
    if (!result.length) { newsStatus.textContent = "No headlines matched. Clear or adjust News interests in Settings."; return; }
    newsStatus.textContent = `${result.length} current headlines`;
    for (const item of result) {
      const row = document.createElement("a");
      row.className = "news-item";
      row.href = item.link;
      row.target = "_blank";
      row.rel = "noreferrer";
      row.textContent = `${item.title} · ${item.source}`;
      newsList.appendChild(row);
    }
  } catch { newsStatus.textContent = "News feeds are unavailable right now."; }
  finally { newsRefreshBtn.disabled = false; }
});

// ================================================================
// Camera / hand tracking (Milestone 7 — CV sprint). Webcam feed +
// MediaPipe HandLandmarker, running entirely in-renderer as WASM (no
// network calls once the model is downloaded once via `npm run
// setup:cv` — see scripts/download-hand-model.js).
//
// Scope of this slice, on purpose: DETECT AND VISUALIZE hands only.
// Gestures are NOT wired to any command yet — that's a deliberate
// separate step with its own safety design, same reasoning as the
// orchestration milestone: a new trigger surface gets its own safety
// pass, not bundled in with the capability that makes it possible.
// Right now this card only shows what Proxy can see.
//
// Everything below is wrapped in try/catch, and the MediaPipe module is
// DYNAMIC-imported (not a top-level static import like three.js above)
// specifically so that if vendoring failed, the model file is missing,
// or the webcam is unavailable, the failure is contained to this one
// card's status line — it cannot take down the rest of the dashboard.
// This is a direct lesson from the preload channel-mismatch bug: an
// uncaught failure at a module's top level silently breaks every line
// of code after it in that same module. The orb, pipeline, and log
// must keep working even if the camera can't start.
// ================================================================

const cameraVideo = document.getElementById("cameraVideo");
const cameraOverlay = document.getElementById("cameraOverlay");
const cameraStatus = document.getElementById("cameraStatus");
const cameraCtx = cameraOverlay.getContext("2d");
const cameraOffPanel = document.getElementById("cameraOffPanel");
const cameraFrame = document.getElementById("cameraFrame");
const cameraControls = document.getElementById("cameraControls");
const cameraOnBtn = document.getElementById("cameraOnBtn");
const cameraOffBtn = document.getElementById("cameraOffBtn");
const cameraStateTag = document.getElementById("cameraStateTag");
const handTrackingToggle = document.getElementById("handTrackingToggle");
const gestureTriggerToggle = document.getElementById("gestureTriggerToggle");

let cameraStream = null;
let HandLandmarkerCls = null; // holds the class itself, for its static HAND_CONNECTIONS
let handLandmarker = null;
let handTrackingOn = false;
let handLoopRunning = false;
let gestureTriggerOn = false;
let gestureTriggerArmed = true;
let lastGestureTriggerAt = 0;

function resizeCameraOverlay() {
  cameraOverlay.width = cameraOverlay.clientWidth;
  cameraOverlay.height = cameraOverlay.clientHeight;
}
window.addEventListener("resize", resizeCameraOverlay);

function toCanvasMapper() {
  // object-fit: cover mapping — the video element is scaled up to fill
  // the container and cropped (see .camera-frame video in style.css),
  // so landmark coordinates (normalized 0-1 against the FULL camera
  // frame) need that same scale+crop applied, or the overlay skeleton
  // drifts away from the actual hand at the edges.
  const vw = cameraVideo.videoWidth;
  const vh = cameraVideo.videoHeight;
  const cw = cameraOverlay.width;
  const ch = cameraOverlay.height;
  if (!vw || !vh || !cw || !ch) return null;
  const scale = Math.max(cw / vw, ch / vh);
  const offsetX = (vw - cw / scale) / 2;
  const offsetY = (vh - ch / scale) / 2;
  return (nx, ny) => [(nx * vw - offsetX) * scale, (ny * vh - offsetY) * scale];
}

function drawHands(result) {
  const cw = cameraOverlay.width;
  const ch = cameraOverlay.height;
  cameraCtx.clearRect(0, 0, cw, ch);
  const toCanvas = toCanvasMapper();
  if (!toCanvas) return;

  cameraCtx.strokeStyle = "#3fa9ff";
  cameraCtx.fillStyle = "#7cd4ff";
  cameraCtx.lineWidth = 2;

  for (const hand of result.landmarks) {
    for (const { start, end } of HandLandmarkerCls.HAND_CONNECTIONS) {
      const [ax, ay] = toCanvas(hand[start].x, hand[start].y);
      const [bx, by] = toCanvas(hand[end].x, hand[end].y);
      cameraCtx.beginPath();
      cameraCtx.moveTo(ax, ay);
      cameraCtx.lineTo(bx, by);
      cameraCtx.stroke();
    }
    for (const point of hand) {
      const [x, y] = toCanvas(point.x, point.y);
      cameraCtx.beginPath();
      cameraCtx.arc(x, y, 3, 0, Math.PI * 2);
      cameraCtx.fill();
    }
  }
}

function handLoop() {
  if (!handLoopRunning) return; // toggled off — stop rescheduling, not just skip a frame
  requestAnimationFrame(handLoop);
  if (cameraVideo.readyState < 2) return; // not enough data for a frame yet
  let result;
  try {
    result = handLandmarker.detectForVideo(cameraVideo, performance.now());
  } catch (err) {
    return; // skip this frame rather than spamming the status line
  }
  drawHands(result);
  const count = result.landmarks.length;
  if (gestureTriggerOn && count > 0) {
    const hand = result.landmarks[0];
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const palmScale = dist(hand[0], hand[9]);
    const isPinch = palmScale > 0 && dist(hand[4], hand[8]) / palmScale < 0.28;
    const now = performance.now();
    if (isPinch && gestureTriggerArmed && now - lastGestureTriggerAt > 1200) {
      gestureTriggerArmed = false;
      lastGestureTriggerAt = now;
      window.proxy.triggerVoice();
    } else if (!isPinch) {
      gestureTriggerArmed = true;
    }
    cameraStatus.textContent = count === 0 ? "No hand detected" : `${count} hand${count > 1 ? "s" : ""} detected · pinch to start or stop voice`;
  } else {
    cameraStatus.textContent = count === 0 ? "No hand detected" : `${count} hand${count > 1 ? "s" : ""} detected`;
  }
}

async function turnCameraOn() {
  cameraOnBtn.disabled = true;
  cameraStatus.textContent = "Requesting camera…";
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    cameraStatus.textContent = `Camera unavailable (${err.name || "error"}) — check Windows camera permissions.`;
    cameraOnBtn.disabled = false;
    return;
  }

  cameraVideo.srcObject = cameraStream;
  await new Promise((resolve) => {
    cameraVideo.onloadedmetadata = () => resolve();
  });
  await cameraVideo.play();

  cameraOffPanel.classList.add("hidden");
  cameraFrame.classList.remove("hidden");
  cameraControls.classList.remove("hidden");
  cameraStateTag.textContent = "CAM ON";
  cameraStateTag.classList.add("on");
  cameraStatus.textContent = "Camera on — hand tracking off";
  cameraOnBtn.disabled = false;
  resizeCameraOverlay();
}

function turnCameraOff() {
  if (handTrackingOn) setHandTracking(false);
  gestureTriggerOn = false;
  gestureTriggerToggle.disabled = true;
  gestureTriggerToggle.textContent = "Pinch trigger: Off";
  gestureTriggerToggle.setAttribute("aria-pressed", "false");
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraOffPanel.classList.remove("hidden");
  cameraFrame.classList.add("hidden");
  cameraControls.classList.add("hidden");
  cameraStateTag.textContent = "CAM OFF";
  cameraStateTag.classList.remove("on");
  cameraStatus.textContent = "";
}

async function setHandTracking(on) {
  if (on) {
    handTrackingToggle.disabled = true;
    cameraStatus.textContent = "Loading hand-tracking model…";
    if (!handLandmarker) {
      try {
        const mediapipe = await import("./vendor/mediapipe/vision_bundle.mjs");
        HandLandmarkerCls = mediapipe.HandLandmarker;
        const fileset = await mediapipe.FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
        handLandmarker = await HandLandmarkerCls.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "./vendor/mediapipe/hand_landmarker.task" },
          runningMode: "VIDEO",
          numHands: 2,
        });
      } catch (err) {
        cameraStatus.textContent = 'Hand-tracking model not found — run "npm run setup:cv", then rebuild.';
        handTrackingToggle.disabled = false;
        return;
      }
    }
    handTrackingOn = true;
    handLoopRunning = true;
    handTrackingToggle.textContent = "Hand tracking: On";
    handTrackingToggle.setAttribute("aria-pressed", "true");
    handTrackingToggle.disabled = false;
    gestureTriggerToggle.disabled = false;
    requestAnimationFrame(handLoop);
  } else {
    gestureTriggerOn = false;
    gestureTriggerToggle.disabled = true;
    gestureTriggerToggle.textContent = "Pinch trigger: Off";
    gestureTriggerToggle.setAttribute("aria-pressed", "false");
    handTrackingOn = false;
    handLoopRunning = false;
    handTrackingToggle.textContent = "Hand tracking: Off";
    handTrackingToggle.setAttribute("aria-pressed", "false");
    handTrackingToggle.disabled = false;
    cameraCtx.clearRect(0, 0, cameraOverlay.width, cameraOverlay.height);
    if (cameraStream) cameraStatus.textContent = "Camera on — hand tracking off";
  }
}

cameraOnBtn.addEventListener("click", () => {
  turnCameraOn().catch((err) => {
    cameraStatus.textContent = `Camera setup failed: ${err.message || err}`;
    cameraOnBtn.disabled = false;
  });
});

cameraOffBtn.addEventListener("click", turnCameraOff);

handTrackingToggle.addEventListener("click", () => {
  setHandTracking(!handTrackingOn).catch((err) => {
    cameraStatus.textContent = `Hand tracking failed: ${err.message || err}`;
    handTrackingToggle.disabled = false;
  });
});

gestureTriggerToggle.addEventListener("click", () => {
  if (!handTrackingOn) return;
  gestureTriggerOn = !gestureTriggerOn;
  gestureTriggerArmed = true;
  gestureTriggerToggle.textContent = `Pinch trigger: ${gestureTriggerOn ? "On" : "Off"}`;
  gestureTriggerToggle.setAttribute("aria-pressed", String(gestureTriggerOn));
  cameraStatus.textContent = gestureTriggerOn
    ? "Pinch thumb and index finger to start or stop voice."
    : "Gesture trigger off.";
});

// ================================================================
// Typed input (dashboard's real second way to talk to Proxy)
// ================================================================

// Milestone 14 bug fix: text used to vanish if you hit send while Proxy
// was still busy — submitText() dropped it silently on the engine side,
// but the box had already been cleared here regardless of whether it
// actually got accepted. Now: if a turn is already in progress
// (turnInProgress, set by the "listening"/"transcribed" handlers above),
// leave the text sitting in the box instead of clearing it — engine.ts
// holds it (pendingText) and runs it once the current request finishes,
// never interrupting what's already in flight. The "transcribed" handler
// below clears the box at the moment the queued text actually starts.
let queuedText = null;

inputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = inputText.value.trim();
  if (!text) return;
  window.proxy.submitText(text);
  if (turnInProgress) {
    queuedText = text;
    inputSend.disabled = true;
  } else {
    inputText.value = "";
  }
});

micBtn.addEventListener("click", () => {
  window.proxy.triggerVoice();
});

// "/" focuses the Input box from anywhere (skipped while already typing
// in any text field, so it still types a literal "/" there as normal).
document.addEventListener("keydown", (event) => {
  if (event.key !== "/") return;
  const active = document.activeElement;
  const alreadyTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA");
  if (alreadyTyping) return;
  event.preventDefault();
  showView("home");
  inputText.focus();
});

window.proxy.on("queued", () => {
  appendLog("status", "queued — will run once the current request finishes");
});

// ================================================================
// Settings modal (Milestone 13, second half)
// ================================================================

// Grouping/labels/input type - metadata with no backend equivalent, so
// it's hand-maintained here. The actual key NAMES and their current
// values come from window.proxy.getSettings() at open time, not from
// this list, so this only needs to stay in sync with core/settings.ts's
// SETTINGS_KEYS by having an entry for each one - a key missing here
// just wouldn't be editable, not a crash.
const SETTINGS_FIELDS = [
  { group: "Voice", key: "ELEVENLABS_API_KEY", label: "ElevenLabs API key", type: "password" },
  { group: "Voice", key: "ELEVENLABS_VOICE_ID", label: "ElevenLabs voice ID", type: "text" },
  { group: "Voice", key: "PIPER_EXE_PATH", label: "Piper executable path (fallback)", type: "text" },
  { group: "Voice", key: "PIPER_VOICE_PATH", label: "Piper voice path (fallback)", type: "text" },
  { group: "Speech recognition", key: "PROXY_WHISPER_CPP_EXE", label: "whisper.cpp executable path (optional)", type: "text" },
  { group: "Speech recognition", key: "PROXY_WHISPER_CPP_MODEL", label: "GGML model file path (optional)", type: "text" },
  { group: "Voice detection", key: "PROXY_DOUBLE_CLAP_ENABLED", label: "Always listen for double-clap trigger", type: "select" },
  { group: "Voice detection", key: "PROXY_DOUBLE_CLAP_THRESHOLD", label: "Double-clap sensitivity threshold", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_MS", label: "Max recording length (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_WAIT_MS", label: "Max wait for speech (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_SILENCE_MS", label: "Silence to auto-stop (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_THRESHOLD", label: "Silence threshold", type: "number" },
  { group: "Gmail", key: "GMAIL_CLIENT_ID", label: "Client ID", type: "text" },
  { group: "Gmail", key: "GMAIL_CLIENT_SECRET", label: "Client secret", type: "password" },
  { group: "Gmail", key: "GMAIL_REFRESH_TOKEN", label: "Refresh token", type: "password" },
  { group: "Market data", key: "ALPHA_VANTAGE_API_KEY", label: "Alpha Vantage API key (free tier)", type: "password" },
  { group: "Phone calls (Twilio)", key: "TWILIO_ACCOUNT_SID", label: "Account SID", type: "text" },
  { group: "Phone calls (Twilio)", key: "TWILIO_AUTH_TOKEN", label: "Auth token", type: "password" },
  { group: "Phone calls (Twilio)", key: "TWILIO_FROM_NUMBER", label: "Twilio phone number (E.164)", type: "text" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_TOKEN", label: "SMS webhook secret (Bearer token)", type: "password" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_BIND", label: "Webhook bind address (default 127.0.0.1)", type: "text" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_PORT", label: "Webhook port (default 8787)", type: "number" },
  { group: "iPhone integration", key: "PROXY_IPHONE_MESSAGES_FILE", label: "SMS history file path", type: "text" },
  { group: "Assistant", key: "PROXY_HOTKEY", label: "Hotkey", type: "text" },
  { group: "Assistant", key: "PROXY_START_ON_LOGIN", label: "Start Proxy when I sign in (packaged app)", type: "select" },
  { group: "Assistant", key: "PROXY_NEWS_INTERESTS", label: "News interests (comma-separated keywords)", type: "text" },
  { group: "Assistant", key: "PROXY_ORCHESTRATOR_MAX_STEPS", label: "Max tool steps per request", type: "number" },
  { group: "Assistant", key: "PROXY_SCRIPT_TIMEOUT_MS", label: "Script timeout (ms)", type: "number" },
  { group: "Storage", key: "PROXY_WORKSPACE_DIR", label: "Workspace directory", type: "text" },
  { group: "Storage", key: "PROXY_MEMORY_FILE", label: "Memory file path", type: "text" },
  { group: "Storage", key: "PROXY_SESSION_LOG_FILE", label: "Session log file path", type: "text" },
  { group: "Browser automation", key: "PROXY_CHROME_PROFILE_DIR", label: "Chrome profile directory", type: "text" },
];

const settingsBtn = document.getElementById("settingsBtn");
const settingsOverlay = document.getElementById("settingsOverlay");
const settingsBody = document.getElementById("settingsBody");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const settingsCancelBtn = document.getElementById("settingsCancelBtn");
const settingsSaveBtn = document.getElementById("settingsSaveBtn");
const settingsStatus = document.getElementById("settingsStatus");
const showSecretsToggle = document.getElementById("showSecretsToggle");

// Built once; re-populated (not rebuilt) each time the modal opens, so
// the input elements referenced in settingsInputs stay valid across
// opens rather than needing to be re-queried.
const settingsInputs = {};
let lastGroup = null;
for (const field of SETTINGS_FIELDS) {
  if (field.group !== lastGroup) {
    const heading = document.createElement("div");
    heading.className = "settings-group-title";
    heading.textContent = field.group;
    settingsBody.appendChild(heading);
    lastGroup = field.group;
  }
  const row = document.createElement("div");
  row.className = "settings-field";
  const label = document.createElement("label");
  label.textContent = field.label;
  label.htmlFor = `setting-${field.key}`;
  const input = document.createElement("input");
  if (field.type === "select") {
    const select = document.createElement("select");
    select.id = `setting-${field.key}`;
    for (const [value, text] of [["", "Disabled"], ["true", "Enabled"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    row.appendChild(label);
    row.appendChild(select);
    settingsBody.appendChild(row);
    settingsInputs[field.key] = select;
    continue;
  }
  input.type = field.type;
  input.id = `setting-${field.key}`;
  row.appendChild(label);
  row.appendChild(input);
  settingsBody.appendChild(row);
  settingsInputs[field.key] = input;
}

function openSettingsModal() {
  settingsStatus.textContent = "";
  settingsOverlay.classList.remove("hidden");
  window.proxy.getSettings().then((values) => {
    for (const field of SETTINGS_FIELDS) {
      settingsInputs[field.key].value = (values && values[field.key]) || "";
    }
  });
}

function closeSettingsModal() {
  settingsOverlay.classList.add("hidden");
}

settingsBtn.addEventListener("click", openSettingsModal);
settingsCloseBtn.addEventListener("click", closeSettingsModal);
settingsCancelBtn.addEventListener("click", closeSettingsModal);

// Click on the dimmed backdrop closes it too, same as pressing Escape
// below - only when the click actually lands on the overlay itself, not
// something inside the modal bubbling up.
settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) closeSettingsModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsOverlay.classList.contains("hidden")) closeSettingsModal();
});

showSecretsToggle.addEventListener("change", () => {
  const revealedType = showSecretsToggle.checked ? "text" : "password";
  for (const field of SETTINGS_FIELDS) {
    if (field.type === "password") settingsInputs[field.key].type = revealedType;
  }
});

settingsSaveBtn.addEventListener("click", () => {
  const values = {};
  for (const field of SETTINGS_FIELDS) {
    values[field.key] = settingsInputs[field.key].value;
  }
  settingsStatus.textContent = "Saving…";
  window.proxy.saveSettings(values).then((result) => {
    settingsStatus.textContent = result && result.ok ? "Saved — restart Proxy to apply." : "Save failed — see the console.";
  });
});

// ---------- Sidebar (Milestone 14 shell) ----------
// The navigation rail links to real dashboard panels. Chat remains
// visibly disabled until that separate interface exists.

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarSettingsItem = document.getElementById("sidebarSettingsItem");

sidebarToggle.addEventListener("click", () => {
  const expanded = sidebar.classList.toggle("expanded");
  document.body.classList.toggle("sidebar-expanded", expanded);
  sidebarToggle.setAttribute("aria-expanded", String(expanded));
});

sidebarSettingsItem.addEventListener("click", openSettingsModal);
sidebarSettingsItem.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openSettingsModal();
  }
});

// Each sidebar entry with data-view shows exactly that page. Hidden pages
// are display:none, so the canvases that measure themselves (orb, 3D
// studio, camera overlay) are re-measured via a synthetic resize.
const viewSections = Array.from(document.querySelectorAll(".view[data-view-name]"));

function showView(name) {
  const section = viewSections.find((v) => v.dataset.viewName === name);
  if (!section) return;
  for (const v of viewSections) v.classList.toggle("active", v === section);
  section.scrollTop = 0;
  sidebar.querySelectorAll(".sidebar-item[data-view]").forEach((el) => {
    const on = el.dataset.view === name;
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  if (name === "memory") void refreshMemoryPanel();
  // Wait one frame so the section has layout before canvases measure it.
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

for (const item of sidebar.querySelectorAll(".sidebar-item[data-view]")) {
  const navigate = () => showView(item.dataset.view);
  item.addEventListener("click", navigate);
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate();
    }
  });
}

// Deep link from the React shell: index.html#camera / #studio opens that page.
// showView() ignores names that aren't a real page.
const initialView = location.hash.slice(1);
if (initialView) showView(initialView);
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
