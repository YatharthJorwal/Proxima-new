# Architecture

Current technical reference for how Proxima is built. This file describes
*what exists and how it works today* — not the history of how it got there
(see `decisions.md`) and not what's done/pending (see `project-status.md`).

## End-to-end pipeline (as currently wired)

```
Trigger (Enter keypress) → record audio → STT (speech-to-text)
                                                  ↓
                                     Hardcoded command match? ──yes──→ run command (PowerShell)
                                                  │no
                                                  ↓
                            LLM w/ tools (qwen3.5:9b) ──tool call──→ run command (same executors)
                                                  │no tool call
                                                  ↓
                                          conversational reply
                                                  ↓
                                          TTS (speaks back)
```

The dashboard adds a global hotkey (F9, via Electron's `globalShortcut`) as
an alternative trigger to the terminal Enter-keypress, and visualizes every
stage of this pipeline live.

**Note:** Milestone 9 replaced the "LLM w/ tools" step above with a
two-tier orchestrator loop (see "Orchestrator & tool system" below) — as
of step 6, `engine.ts` calls `orchestrator.ts` instead of the old
`intentRouter.ts`. The diagram above is the pre-Milestone-9 shape; see
`project-status.md` for the current wired pipeline and what's still
pending real-machine confirmation.

## MVP stack (v1, TypeScript/Node)

| Piece | Choice | Why (brief) |
|---|---|---|
| Language | TypeScript on Node.js | User's preference; good library support for LLM/automation |
| Trigger | Press Enter in the terminal (Node `readline`) | Simplest reliable option — see `decisions.md` for the trigger-mechanism history |
| Mic capture | `@picovoice/pvrecorder-node` | Plain audio-capture utility, not gated behind an account |
| STT | Whisper (**small.en**) via `@huggingface/transformers`, local **CPU** inference | Upgraded from base.en for accuracy; GPU (DirectML) attempt reverted — see `decisions.md` |
| Local LLM | Ollama + `qwen3.5:9b`, via `ollama` npm client, with tool/function calling | Fits in 12GB VRAM; confirmed running 100% on GPU |
| TTS | Piper (local, default), ElevenLabs (cloud) as an optional upgrade path | User-added; only used if `ELEVENLABS_API_KEY`/`ELEVENLABS_VOICE_ID` are set, else Piper only, zero cost |
| PC automation | Windows automation via `child_process` (PowerShell). Open-app uses `Start-Process`; volume/window control use inline C# via `Add-Type` calling `user32.dll` | Avoids native module build issues and extra PowerShell modules |
| Command routing | Two-stage: deterministic regex first, then LLM tool-calling as fallback | Common commands stay instant; fuzzy phrasing still gets caught |
| Config | dotenv (`.env`) for secrets/keys, JSON files for command config | `config/commands.json` holds the open-app phrase → executable-path mapping (~70 apps) |

This table describes the original MVP-era stack (pre-dashboard, pre-CV,
pre-orchestration). Additions since then are documented in their own
subsections below.

## Directory structure

```
core/                  (project root — user renamed this from "files/" after Milestone 7)
  src/
    core/               # trigger-agnostic engine, STT, TTS, LLM client
      assistant.ts      # CLI entry: Enter-key trigger + console logging of engine events
      engine.ts         # ProxyEngine (EventEmitter) — Milestone 6, shared by CLI + dashboard
                         # reads PROXY_VAD_* env knobs (Milestone 8) and wires them into audioUtils
      audioUtils.ts      # recordUntilSilence() — Milestone 8 VAD (energy/amplitude threshold),
                         # replaced the old fixed-4s recordSeconds()
      llm.ts            # chat() — Milestone 9 two-tier model calls (fast/smart, tiered `think`);
                         # askProxy/askProxyWithTools kept as back-compat wrappers around it
      stt.ts
      tts.ts            # Piper (default) + optional ElevenLabs upgrade path, reviewed
    commands/           # hardcoded + LLM-routed PC-automation commands
      index.ts          # deterministic regex router (fast path); returns {handler, reply}
      intentRouter.ts   # single-shot LLM tool-calling router (Milestone 5); returns {reply, tool}.
                         # No longer called by engine.ts as of Milestone 9 step 6 (orchestrator.ts
                         # replaced that call) - kept around for now as a reference/fallback, not
                         # wired into anything. Candidate for deletion once Milestone 9 is confirmed
                         # solid on the user's real machine.
      orchestrator.ts    # Milestone 9 build order step 4 — the actual multi-step loop (two-tier
                         # escalation, step cap, defer_to_planner, cancellation). Wired into
                         # engine.ts as of step 6 — replaces the old intentRouter.ts call above.
      orchestrator.test.ts # Milestone 9 step 5 — mocked control-flow unit tests (`npm test`,
                         # vitest). Deliberately thin, not exhaustive - see project-status.md.
      tools.ts           # Milestone 9 step 2 — shared tool registry (schemas + dispatch), pulled
                         # out of intentRouter.ts so it and orchestrator.ts share one definition
                         # per tool instead of two copies.
      browse.ts           # Milestone 9 step 3 — "open/search site" via URL templating, no browser
                         # automation. Site -> URL map lives in config/commands.json's "browse" section.
      launch.ts           # shared Start-Process launcher, factored out of openApp.ts so browse.ts
                         # can reuse it.
      types.ts          # shared CommandHandler type
      openApp.ts        # "open/launch/start X" + executeOpenApp()
      volume.ts         # volume up/down/mute + executeVolume()
      window.ts         # maximize/minimize/restore/snap left/right + executeWindow()
    config/
      commands.json     # phrase -> executable path mapping for openApp.ts (~70 apps)
    electron/           # Milestone 6 — transparency-first dashboard
      main.ts           # window creation, F9 global hotkey, IPC event forwarding, camera
                         # permission allowlist (Milestone 7), ready-event race fix
      preload.ts        # narrow contextBridge: proxy.on(channel, cb) read-only for events,
                         # PLUS proxy.submitText(text) as the one write-path (dashboard Input box)
      renderer/          # plain HTML/CSS/JS dashboard UI, no framework
        index.html
        style.css
        renderer.js      # includes Milestone 7's camera + MediaPipe HandLandmarker logic
        vendor/          # generated by copy-assets.js at build time — three.js, MediaPipe
                         # WASM runtime, and the downloaded hand-tracking model. Not in git.
    skills/             # higher-level "skills" built on top of commands (later)
  scripts/
    copy-assets.js         # copies electron/renderer + config/commands.json + vendored
                            # three.js/MediaPipe (+ the hand-tracking model, if present) into dist/
    download-hand-model.js # `npm run setup:cv` — one-time download of hand_landmarker.task
  models/                # hand_landmarker.task lives here once downloaded — gitignored
  logs/                 # runtime logs
  voices/               # Piper voice model files (.onnx + .onnx.json)
  package.json
  tsconfig.json
  .env                  # see docs/workflows.md for the full variable list
  CLAUDE.md              # root instructions file
  docs/                  # this documentation set
```

## Voice activity detection (VAD)

`audioUtils.ts`'s `recordUntilSilence(opts)` returns `{ audio, speechDetected }`
(replacing the old fixed-duration `recordSeconds(seconds)`, which has been
removed outright). Three phases, energy/amplitude-threshold only — no ML
model or extra dependency:

1. **Calibrate** — sample ~300ms of lead-in audio to estimate the room's
   ambient noise floor, and derive a speech threshold from it
   (`max(min(noiseFloor, ceiling) × 3, 0.02)`). These frames are kept in the
   returned audio (not discarded), so a fast talker who starts speaking
   immediately doesn't lose the start of their sentence. The noise-floor
   estimate is capped at a ceiling (0.05) before the ×3 multiplier is
   applied — this guards against the case where the user starts talking
   during the calibration window itself, which would otherwise inflate the
   threshold so high the rest of the sentence might never cross it. Worst
   case, calibration degrades to a fixed conservative threshold instead of a
   broken one.
2. **Wait for speech** — read frames until one crosses the threshold, or
   give up after `PROXY_VAD_MAX_WAIT_MS` (default 6s) and report
   `speechDetected: false`.
3. **Record until silence** — once speech starts, keep going until a
   continuous quiet stretch lasts `PROXY_VAD_SILENCE_MS` (default 900ms), or
   `PROXY_VAD_MAX_MS` (default 15s) is hit regardless, as a safety cap.

`PROXY_VAD_THRESHOLD` is a fixed-threshold escape hatch that bypasses
calibration entirely when set. All VAD env knobs are read in `engine.ts`,
not `audioUtils.ts`, so that module stays a pure options-in/result-out
helper (same pattern as `PROXY_HOTKEY` living in `electron/main.ts` rather
than inside the engine). Full variable list: `workflows.md`.

**Latency effect**: if nothing ever crosses the speech threshold,
`engine.ts` skips the Whisper call entirely and emits `no-speech`
immediately, instead of always transcribing a full clip.

**Event contract**: `listening` carries `{ maxMs }` (the safety cap) instead
of a fixed `seconds` countdown; a `speech-start` event fires the moment VAD
actually hears speech. This is threaded through `engine.ts` (event types),
`electron/main.ts` (IPC forwarding), `electron/preload.ts` (channel
allowlist), and `electron/renderer/renderer.js` (Listening step reads
"waiting for you to speak…" then "hearing you — pause when done").

## Electron dashboard shell

An Electron app that visualizes what Proxy is doing in real time:
transcribed text, which router handled it (regex hit vs LLM tool call vs
plain conversation), what command/tool executed, current status, the spoken
reply. Design principle: **show the process, never hide it.**

- `electron/main.ts` — window creation, F9 global hotkey via
  `globalShortcut` (fixes the window-control focus-timing limitation from
  Milestone 3 as a side effect, since a true global hotkey doesn't need the
  terminal focused), IPC event forwarding, and camera-permission
  allowlisting (Milestone 7).
- `electron/preload.ts` — narrow `contextBridge`: `proxy.on(channel, cb)` is
  read-only for events, plus `proxy.submitText(text)` as the one write-path
  (the dashboard's Input box).
- `electron/renderer/` — plain HTML/CSS/JS, no framework. `renderer.js`
  also contains the Milestone 7 camera + MediaPipe logic.
- **Security defaults**: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; `session.defaultSession.setPermissionRequestHandler`
  explicitly allowlists only `"media"` (camera) and denies everything else
  (Electron denies permission requests by default on a `file://` origin, so
  `getUserMedia()` would otherwise hang/reject with no camera ever
  appearing).
- **Orb visualization**: a live three.js orb ("PROXIMA CORE"), vendored
  locally (not a CDN, consistent with this being a local-first app). Its
  rotation speed, color, and pulse map directly to engine state (idle /
  listening / thinking / speaking / error, plus a brief amber flash when a
  real command fires) — a fixed state→visual mapping documented in
  `renderer.js`, not a decorative animation. This is the one place the
  dashboard makes an interpretive visual call rather than displaying a raw
  event.
  - **Vendoring gotcha**: `three.module.js` is not a single self-contained
    bundle — it imports `./three.core.js`. Both files must be copied into
    the vendor directory together, or the import fails at runtime.
- **"Coming soon" card**: honestly lists dashboard capabilities that aren't
  built yet (camera feed tagged specifically as Milestone 7 / Computer
  Vision, others as "not built yet") rather than displaying fabricated data
  for panels the reference design showed but Proxy doesn't actually have.
- **Per-stage timing**: each Activity panel row shows a live-ticking timer
  while active and freezes the elapsed time on completion (via
  `performance.now()` deltas), plus a real one-line description per row —
  not decorative numbers or static captions. (Through Milestone 8, this was
  the Pipeline card's fixed 5-row list; Milestone 9 step 6 replaced it with
  the Activity panel — see below.)
- **Input box**: `proxy.submitText(text)` (`runWithText()` on the engine)
  runs typed text through the identical router/tool-dispatch/TTS path as a
  spoken command, just skipping recording+STT. As of Milestone 9 step 6, if
  the box is busy and the typed text is exactly "stop" (case-insensitive),
  it cancels the in-flight orchestrator run instead of queuing — see
  "Orchestrator & tool system" below.
- **Engine events** (emitted by `ProxyEngine`, an `EventEmitter` with no
  trigger mechanism of its own): `busy`, `listening`, `speech-start`,
  `transcribing`, `transcribed`, `no-speech`, `deciding`, `tool-start`,
  `tool-result`, `thinking`, `responding`, `routed`, `reply`, `speaking`,
  `idle`, `error`, `cancelled`. This is what lets the CLI and dashboard
  observe the exact same pipeline rather than the dashboard re-implementing
  or scraping it. The five in the middle (`deciding` through `responding`)
  only fire for the orchestrator path — a regex-matched command goes
  straight from `transcribed` to `routed`/`reply`, since a regex hit is a
  near-instant pattern match, not a decision worth a row of its own.
  `RouteInfo`'s `llm-tool` variant carries `tools: string[]` (plural, as of
  step 6) rather than a single tool name, since the orchestrator can chain
  more than one real tool call per request.
- **Activity panel** (Milestone 9 step 6, replaces the old fixed 5-row
  Pipeline card entirely): a live, growing row list built from the engine
  events above, not a fixed skeleton — a plain "hello" ends up 3-4 rows
  (Listening → Transcribing → Deciding → Responding), a chained multi-tool
  request grows one "Executing: `<tool>`" row per loop iteration. Each
  Deciding row's sub-label shows which tier handled it (`fast tier` /
  `smart tier`); a smart-tier Deciding row additionally rotates through a
  short list of dry status words ("Thinking it over," "Working the
  problem," …) while genuinely indeterminate — fast-tier decisions resolve
  in well under a second, so they just say "Deciding" plainly, no
  animation. A Deciding row that got back a real `message.thinking` trace
  from Ollama gets a "Show reasoning" toggle revealing it verbatim (shown
  after the fact, not streamed — `chat()` in `llm.ts` isn't a streaming
  call). Lives beside the orb in the center column now, not the left
  column. Row/CSS implementation: `renderer.js`'s "Activity panel" section,
  `style.css`'s matching block.
  `responding` — see `project-status.md`.
- three.js and the MediaPipe vision bundle are vendored locally
  (`electron/renderer/vendor/`, generated by `copy-assets.js`, not committed
  to git).

## Computer vision / hand-tracking (Camera card)

Webcam feed + MediaPipe `HandLandmarker` (called directly — no `barehands`
code copied; see `decisions.md` for why) running in the dashboard's Camera
card, detecting and drawing hand landmarks live. Scoped to detection +
visualization only — gestures are not wired to any action yet (planned as
part of Milestone 10, as an orchestrator tool).

- **Model file**: `hand_landmarker.task` (~7-9MB) is hosted on Google's
  model CDN, not bundled in the `@mediapipe/tasks-vision` npm package, and
  the build sandbox has no network access to fetch it. `npm run setup:cv`
  (`scripts/download-hand-model.js`) downloads it once to `models/`
  (gitignored — regenerate via the script rather than committing it, unlike
  the Piper voice files which the repo does commit — a deliberate
  inconsistency, since nothing about this file needs to be shared/
  versioned). `copy-assets.js` copies it into `dist/` only if present, and
  warns (doesn't fail the build) if missing — CV is additive, not required
  for the rest of the dashboard.
- **Vendored locally** (like three.js): `vision_bundle.mjs` (JS API) plus
  only the SIMD WASM variant (`vision_wasm_internal.js/.wasm`, ~12MB) — the
  package also ships nosimd and a third variant (~34MB for all three
  combined), skipped because Electron's bundled Chromium is always recent
  enough to support WASM SIMD (confirmed by reading
  `FilesetResolver.forVisionTasks()`'s own source).
- **Error isolation**: the MediaPipe module is dynamic-imported inside
  `setupCameraAndHandTracking()`, not a top-level static import like
  three.js — a direct lesson from an earlier preload channel-mismatch bug,
  where an uncaught failure at a module's top level silently broke every
  line after it in that same module. If the webcam's unavailable,
  permissions are denied, or the model file is missing, the failure is now
  caught and shown in the Camera card's own status line; the orb/pipeline/
  log keep working regardless.
- **Coordinate mapping**: the video uses `object-fit: cover` (scaled+cropped
  to fill its frame), so landmark coordinates (normalized against the full
  camera frame) need that same scale+crop math applied, or the skeleton
  overlay drifts from the actual hand — implemented in `toCanvasMapper()` in
  `renderer.js`.

Camera-card layout: current status of the "move to bottom-left" change is
flagged as a discrepancy in `project-status.md` — check there before
assuming it's done or not done.

## Orchestrator & tool system (Milestone 9 — wired in as of step 6)

- `tools.ts` — shared tool registry (schemas + dispatch), pulled out of
  `intentRouter.ts` so both it and `orchestrator.ts` share one definition
  per tool instead of two copies. Each tool schema carries:
  - `resultInformsNextStep` (default `false`) — true only for a tool whose
    output the model needs to reason about before deciding what's next.
    None of the current tools (open app, volume, window, browse) need it.
  - `requiresConfirmation` — built now, unused for now; no current tool is
    destructive enough to need it, but a future tool can flip it on.
- `orchestrator.ts` — the multi-step loop: LLM proposes a step, step
  executes, result feeds back to the LLM, repeat until it signals done or a
  safety cap is hit (a small ReAct-style agent loop). Includes escalation
  between the two model tiers, a step cap (`PROXY_ORCHESTRATOR_MAX_STEPS`,
  default 5), a `defer_to_planner` signal, and cancellation support. **Wired
  into `engine.ts` as of step 6** — `engine.ts` calls `orchestrator.run()`
  instead of `intentRouter.ts`'s single-shot router now. 11 mocked unit
  tests (`orchestrator.test.ts`, `npm test`) cover its control flow.
- `browse.ts` / `launch.ts` — "open/search site" via URL templating (no
  browser automation): YouTube's `/results?search_query=`, Google's
  `/search?q=`, etc. `launch.ts` is the shared `Start-Process` launcher
  factored out of `openApp.ts` so `browse.ts` can reuse it.
- **Two-tier model routing**: turn 1 of every request goes to a small fast
  model (`qwen3.5:4b`, `think: false`); the loop only escalates to
  `qwen3.5:9b` (`think: true`) for turn 2+ if the request actually needs
  more steps. Model *choice* rationale and rejected alternatives:
  `decisions.md`.
- **Cancellation**: `ProxyEngine.cancel()` forwards to
  `Orchestrator.cancel()`, which sets a flag checked at the next loop
  boundary (not mid-request — see `decisions.md` for why true mid-flight
  abort wasn't attempted). Triggered by a second hotkey press (Electron), a
  second Enter press (CLI), or typing "stop" into the dashboard's Input box
  while busy.

Rollout status of each piece above (built/tested/wired/real-machine
confirmed) lives in `project-status.md`, not here.
