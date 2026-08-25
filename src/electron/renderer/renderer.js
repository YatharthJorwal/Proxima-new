/**
 * Dashboard renderer — Milestone 6 visual overhaul.
 *
 * ES module (note the <script type="module"> in index.html) so it can
 * `import * as THREE` from the vendored local copy — no CDN, no bundler,
 * since this is a local-first app (three.js is copied into
 * vendor/three.module.js by scripts/copy-assets.js at build time).
 *
 * Everything on screen — the pipeline timings, the orb's state, the log —
 * comes straight from window.proxy.on(...), which preload.ts wires to the
 * real ProxyEngine events. The orb's rotation/color/pulse are the one
 * place this file makes an interpretive call (mapping engine events to a
 * visual "mood"), but the mapping is fixed and documented below — it
 * can't drift into showing something that isn't happening.
 */

import * as THREE from "./vendor/three.module.js";
// Note: MediaPipe (HandLandmarker) is NOT imported statically here —
// it's dynamic-imported inside setupCameraAndHandTracking() below, on
// purpose. See that function's docblock for why.

// ---------- DOM refs ----------

const statusDot = document.getElementById("statusDot");
const hotkeyLabel = document.getElementById("hotkeyLabel");
const clockEl = document.getElementById("clock");
const log = document.getElementById("log");
const logEmpty = document.getElementById("logEmpty");
const outputBox = document.getElementById("outputBox");
const inputForm = document.getElementById("inputForm");
const inputText = document.getElementById("inputText");
const inputSend = document.getElementById("inputSend");
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
// Pipeline stage list — real per-stage timing, not decoration.
// Each stage row shows: pending (dim) -> active (pulsing, live timer
// counting up) -> done (checkmark color, frozen elapsed time).
// ================================================================

const STAGES = ["listening", "transcribed", "routed", "reply", "speaking"];
const stepEls = Object.fromEntries(
  STAGES.map((stage) => [stage, document.querySelector(`.pipeline-step[data-stage="${stage}"]`)])
);

let activeStage = null;
let activeStageStart = null;
let tickHandle = null;

function fmtElapsed(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function setStepSub(stage, text) {
  stepEls[stage].querySelector('[data-role="sub"]').textContent = text;
}

function freezeActiveStage() {
  if (activeStage === null) return;
  const elapsed = performance.now() - activeStageStart;
  stepEls[activeStage].querySelector('[data-role="time"]').textContent = fmtElapsed(elapsed);
  stepEls[activeStage].classList.remove("active");
  stepEls[activeStage].classList.add("done");
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  activeStage = null;
}

function beginStage(stage, opts = {}) {
  freezeActiveStage();
  activeStage = stage;
  activeStageStart = performance.now();
  stepEls[stage].classList.add("active");
  if (opts.action) stepEls[stage].classList.add("action");
  const timeEl = stepEls[stage].querySelector('[data-role="time"]');
  tickHandle = setInterval(() => {
    timeEl.textContent = fmtElapsed(performance.now() - activeStageStart);
  }, 100);
}

function resetPipeline() {
  freezeActiveStage();
  STAGES.forEach((stage) => {
    stepEls[stage].classList.remove("active", "done", "action");
    stepEls[stage].querySelector('[data-role="time"]').textContent = "";
  });
  setStepSub("listening", "waiting for hotkey");
  setStepSub("transcribed", "—");
  setStepSub("routed", "—");
  setStepSub("reply", "—");
  setStepSub("speaking", "—");
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

// ================================================================
// Log
// ================================================================

function timestamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function appendLog(kind, text) {
  if (logEmpty) logEmpty.remove();
  const row = document.createElement("div");
  row.className = "log-entry";
  row.innerHTML = `
    <span class="log-time">${timestamp()}</span>
    <span class="log-kind ${kind}">${kind}</span>
    <span class="log-text"></span>
  `;
  row.querySelector(".log-text").textContent = text; // textContent, not innerHTML — never trust transcribed/model text as markup
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function describeRoute(info) {
  if (!info) return "unknown routing";
  if (info.source === "regex") return `regex → ${info.handler}`;
  if (info.source === "llm-tool") return `LLM tool → ${info.tool}`;
  return "conversation (no command)";
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

// ================================================================
// Engine event wiring
// ================================================================

window.proxy.on("ready", (payload) => {
  hotkeyLabel.textContent = `hotkey: ${payload.hotkey}`;
  statusHotkey.textContent = payload.hotkey;
  statusState.textContent = "Ready";
  startedAt = Date.now();
});

window.proxy.on("listening", (info) => {
  // Milestone 8 (VAD): there's no fixed recording length anymore, so
  // there's nothing honest to count down. info.maxMs is only the hard
  // safety cap — recording actually stops on silence, well before that
  // in the normal case. See engine.ts's "listening" event docs.
  resetPipeline();
  statusDot.classList.add("active");
  statusDot.classList.remove("alarm");
  setOrbState("listening");
  beginStage("listening");
  setStepSub("listening", "waiting for you to speak…");
  appendLog("status", `listening (auto-stops after a pause, max ${Math.round(info.maxMs / 1000)}s)`);
  outputBox.innerHTML = '<span class="output-empty">Listening…</span>';
});

window.proxy.on("speech-start", () => {
  // Real signal, not decoration: this only fires once recorded energy
  // actually crossed the VAD's speech threshold.
  setStepSub("listening", "hearing you — pause when done");
  appendLog("status", "hearing you...");
});

window.proxy.on("busy", () => {
  appendLog("status", "still working on the last request — ignored");
});

window.proxy.on("no-speech", () => {
  freezeActiveStage();
  setOrbState("idle");
  appendLog("status", "didn't catch anything");
  outputBox.innerHTML = '<span class="output-empty">Didn\u2019t catch anything.</span>';
});

window.proxy.on("transcribed", (text) => {
  setOrbState("thinking");
  beginStage("transcribed");
  setStepSub("transcribed", truncate(text, 70));
  appendLog("heard", text);
  outputBox.innerHTML = '<span class="output-empty">Proxy is thinking…</span>';
});

window.proxy.on("routed", (info) => {
  const isAction = info && info.source !== "conversation";
  beginStage("routed", { action: isAction });
  setStepSub("routed", describeRoute(info));
  if (isAction) flashAction();
  appendLog("routed", describeRoute(info));
});

window.proxy.on("reply", (text) => {
  beginStage("reply");
  setStepSub("reply", truncate(text, 70));
  appendLog("reply", text);
  outputBox.textContent = text;
});

window.proxy.on("speaking", () => {
  setOrbState("speaking");
  beginStage("speaking");
  setStepSub("speaking", "playing TTS reply");
});

window.proxy.on("idle", () => {
  statusDot.classList.remove("active");
  freezeActiveStage();
  statusState.textContent = "Ready";
  if (!errorFlashTimeout) setOrbState("idle");
});

window.proxy.on("error", (message) => {
  statusDot.classList.add("alarm");
  statusState.textContent = "Error";
  freezeActiveStage();
  flashError(message);
  appendLog("error", message);
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

async function setupCameraAndHandTracking() {
  const video = document.getElementById("cameraVideo");
  const overlay = document.getElementById("cameraOverlay");
  const status = document.getElementById("cameraStatus");
  const ctx = overlay.getContext("2d");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    status.textContent = `Camera unavailable (${err.name || "error"}) — check Windows camera permissions.`;
    return;
  }

  video.srcObject = stream;
  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });
  await video.play();

  status.textContent = "Loading hand-tracking model…";

  let HandLandmarker, handLandmarker;
  try {
    const mediapipe = await import("./vendor/mediapipe/vision_bundle.mjs");
    HandLandmarker = mediapipe.HandLandmarker;
    const fileset = await mediapipe.FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: "./vendor/mediapipe/hand_landmarker.task" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  } catch (err) {
    status.textContent = 'Hand-tracking model not found — run "npm run setup:cv", then rebuild.';
    return; // camera preview still works, just no tracking overlay
  }

  function resizeOverlay() {
    overlay.width = overlay.clientWidth;
    overlay.height = overlay.clientHeight;
  }
  window.addEventListener("resize", resizeOverlay);
  resizeOverlay();

  function toCanvasMapper() {
    // object-fit: cover mapping — the video element is scaled up to
    // fill the container and cropped (see .camera-frame video in
    // style.css), so landmark coordinates (normalized 0-1 against the
    // FULL camera frame) need that same scale+crop applied, or the
    // overlay skeleton drifts away from the actual hand at the edges.
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = overlay.width;
    const ch = overlay.height;
    if (!vw || !vh || !cw || !ch) return null;
    const scale = Math.max(cw / vw, ch / vh);
    const offsetX = (vw - cw / scale) / 2;
    const offsetY = (vh - ch / scale) / 2;
    return (nx, ny) => [(nx * vw - offsetX) * scale, (ny * vh - offsetY) * scale];
  }

  function drawHands(result) {
    const cw = overlay.width;
    const ch = overlay.height;
    ctx.clearRect(0, 0, cw, ch);
    const toCanvas = toCanvasMapper();
    if (!toCanvas) return;

    ctx.strokeStyle = "#3fa9ff";
    ctx.fillStyle = "#7cd4ff";
    ctx.lineWidth = 2;

    for (const hand of result.landmarks) {
      for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
        const [ax, ay] = toCanvas(hand[start].x, hand[start].y);
        const [bx, by] = toCanvas(hand[end].x, hand[end].y);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      for (const point of hand) {
        const [x, y] = toCanvas(point.x, point.y);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    if (video.readyState < 2) return; // not enough data for a frame yet
    let result;
    try {
      result = handLandmarker.detectForVideo(video, performance.now());
    } catch (err) {
      return; // skip this frame rather than spamming the status line
    }
    drawHands(result);
    const count = result.landmarks.length;
    status.textContent = count === 0 ? "No hand detected" : `${count} hand${count > 1 ? "s" : ""} detected`;
  }
  requestAnimationFrame(loop);
}

setupCameraAndHandTracking().catch((err) => {
  const status = document.getElementById("cameraStatus");
  if (status) status.textContent = `Camera setup failed: ${err.message || err}`;
});

// ================================================================
// Typed input (dashboard's real second way to talk to Proxy)
// ================================================================

inputForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = inputText.value.trim();
  if (!text) return;
  window.proxy.submitText(text);
  inputText.value = "";
});
