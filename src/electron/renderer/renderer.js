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
// pipeline: a smart-tier "Deciding" row. Fast-tier decisions resolve in
// a few hundred ms, so they just show "Deciding" plainly — no point
// animating something that's already over by the time you'd notice.
// Kept short and dry, matching Proxy's own personality prompt (llm.ts)
// rather than going for full whimsy.
const SMART_TIER_WORDS = ["Thinking it over", "Working the problem", "Weighing the options", "Doing the math", "Mulling it over"];

let currentRow = null; // the one live (unresolved) row, if any
let lastDecidingRow = null; // most recent Deciding row — thinking traces attach here
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

// ================================================================
// Log
// ================================================================

function timestamp(date) {
  return (date || new Date()).toLocaleTimeString([], { hour12: false });
}

// Confirmed via a native dialog since this is irreversible - the whole
// point of Milestone 13's persistence is that history survives a
// relaunch, so clearing it should be a deliberate act, not a stray
// click. Clears the DOM immediately rather than waiting on the IPC
// round-trip - clearLog() is fire-and-forget on the main-process side
// (same shape as persistLogEntry), and there's nothing for the
// renderer to wait for.
const clearLogBtn = document.getElementById("clearLogBtn");
clearLogBtn.addEventListener("click", () => {
  if (!confirm("Clear the session log? This can't be undone.")) return;
  log.innerHTML = "";
  log.appendChild(logEmpty);
  window.proxy.clearLog();
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
  addActivityRow("Transcribing");
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
  } else {
    resolveActivityRow(currentRow, { sub: truncate(text, 60) });
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
  lastDecidingRow = addActivityRow("Deciding", {
    sub: tier === "smart" ? "smart tier" : "fast tier",
    rotateWords: tier === "smart",
  });
});

window.proxy.on("tool-start", (name) => {
  resolveActivityRow(currentRow);
  addActivityRow(`Executing: ${name}`, { action: true });
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
  // The orchestrator's own honest "Stopped — ..." text still arrives
  // via the normal "reply" event right after this — nothing more to do
  // here beyond marking the interrupted row so it doesn't read as done.
});

window.proxy.on("idle", () => {
  turnInProgress = false;
  statusDot.classList.remove("active");
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
  { group: "Gmail", key: "GMAIL_CLIENT_ID", label: "Client ID", type: "text" },
  { group: "Gmail", key: "GMAIL_CLIENT_SECRET", label: "Client secret", type: "password" },
  { group: "Gmail", key: "GMAIL_REFRESH_TOKEN", label: "Refresh token", type: "password" },
  { group: "Assistant", key: "PROXY_HOTKEY", label: "Hotkey", type: "text" },
  { group: "Assistant", key: "PROXY_ORCHESTRATOR_MAX_STEPS", label: "Max tool steps per request", type: "number" },
  { group: "Assistant", key: "PROXY_SCRIPT_TIMEOUT_MS", label: "Script timeout (ms)", type: "number" },
  { group: "Storage", key: "PROXY_WORKSPACE_DIR", label: "Workspace directory", type: "text" },
  { group: "Storage", key: "PROXY_MEMORY_FILE", label: "Memory file path", type: "text" },
  { group: "Storage", key: "PROXY_SESSION_LOG_FILE", label: "Session log file path", type: "text" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_MS", label: "Max recording length (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_WAIT_MS", label: "Max wait for speech (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_SILENCE_MS", label: "Silence to auto-stop (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_THRESHOLD", label: "Silence threshold", type: "number" },
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
