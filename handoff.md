# Handoff note — read this first

Snapshot of the end of one working session, written so a fresh Claude (or a
rested future you) can start the next one — **moving the dashboard off
Electron** — without re-deriving where things stand. Short-lived on purpose:
once the migration is underway, fold anything still true into `CLAUDE.md` and
`docs/project-status.md`, then delete or replace this file.

If this conflicts with `docs/project-status.md`, trust this file for the items
below; the status doc gets reconciled when the migration starts.

## Where things stand

- **Everything built so far works from the user's point of view; the work is
  considered "kinda done" for now.** The backend (voice pipeline, tools,
  orchestrator, memory, Gmail/stock/news/phone/iPhone slices, whisper.cpp STT,
  double-clap) and the Electron dashboard are all in place. Per-feature
  "built vs confirmed on the real machine" status is in
  `docs/project-status.md` — that distinction still applies, and several
  items there are still awaiting real-machine confirmation.
- **Branch:** all current work is on `ui-cleanup` (pushed with
  `git push -u origin ui-cleanup`). GitHub's `main` is still the older
  pre-"Complete Proxima integration slices" state (`ae3594a`). Merging
  `ui-cleanup` into `main` has not been done — the user chose to wait.
- **Repo:** `github.com/YatharthJorwal/Proxima-new` (public — never commit
  `.env`, API keys, or tokens). Local folder: `E:\Project Proxima\core`.
  The user delivers/receives patches as files (`git apply --whitespace=fix
  ..\patch\<name>.patch` from `core`) because pasting files is a hassle.

## What happened this session (so it isn't re-litigated)

1. Another coding agent (Codex) made a very large uncommitted change
   (~38 files, +6.3k/−0.8k lines: news, stock quote, phone call, iPhone
   webhook, device status, double-clap, whisper.cpp STT worker, TTS/STT
   rewrites, 3D studio in the renderer, installer packaging, docs) and left
   the dashboard dead: no orb, no button clicks, chatbox unresponsive,
   topbar stuck on "binding hotkey…".
2. **Root cause:** `renderer.js` (~line 1722) had a `return;` inside the
   top-level `for` loop that builds the Settings modal's inputs. That is an
   illegal top-level `return` in a browser module, so the *entire* renderer
   script failed to parse. Fix: `return;` → `continue;`. It was found from
   the DevTools console (`Uncaught SyntaxError: Illegal return statement`),
   not from `tsc` or `node --check` — see "Gotchas" below.
3. The dashboard UI was split from one crammed three-column page into six
   pages (**Home, Camera, Memory & Log, System, Tools, 3D Studio**) switched
   from the sidebar; Settings stays a modal. Element IDs are unchanged, so
   the renderer's handlers kept working. Navigation logic was smoke-tested in
   a simulated DOM only — the visual result (especially the 3D canvas filling
   its space and camera overlay resizing after page switches) is not
   confirmed beyond the user running it.
4. The docs were updated to match (this file, `CLAUDE.md`,
   `docs/project-status.md`, `docs/architecture.md`, `docs/decisions.md`,
   `docs/workflows.md`). The old browser-automation `handoff.md` was deleted
   by the previous agent; its still-relevant content is summarized below.

## The next goal: move the UI off Electron

**Why (the user's words, paraphrased):** the Electron dashboard UI feels
un-customizable; they believe they can do much better with React + Tauri (or
similar), and have built good web pages before.

**What is and isn't actually coupled to Electron** (checked in the repo):

- `src/electron/main.ts` — window creation, `globalShortcut` (F9),
  `ipcMain` handlers, permission handler (camera/geolocation),
  `setLoginItemSettings`. Imports `electron`.
- `src/electron/preload.ts` — the `contextBridge` exposing `window.proxy`.
  Event allowlist: `ready, busy, queued, listening, speech-start,
  transcribing, transcribed, no-speech, deciding, tool-start, tool-result,
  thinking, responding, routed, awaiting-confirmation, reply, speaking,
  cancelled, idle, error, log-history, system-usage, present-devices,
  activation`. Verbs include `submitText`, `triggerVoice`, `persistLogEntry`,
  `clearLog`, `getSettings`, `saveSettings`, plus invoke-style calls for
  news, memory, and 3D-model analysis/edit (channels in `main.ts`:
  `proxy:fetch-news`, `proxy:get-memory`, `proxy:clear-memory`,
  `proxy:analyze-model`, `proxy:edit-model-transform`).
- `src/core/stt.ts` — uses `electron`'s `utilityProcess.fork` to run CPU STT
  in a separate process (falls back otherwise; read the file before porting).
- **Everything else** (`src/core/*`, `src/commands/*`, `ProxyEngine` as an
  `EventEmitter`) is plain TypeScript/Node with no Electron import. That is
  the valuable part, and it is already UI-agnostic.
- `src/electron/renderer/` — vanilla HTML/CSS/JS (no framework), ~1.8k lines
  in `renderer.js`: orb (three.js), Activity panel, session log, settings
  modal, camera + MediaPipe hand tracking, map, news, 3D Studio (three.js
  with STL/OBJ, gizmos, CSG via `three-bvh-csg`). Vendored three.js and
  MediaPipe live under the renderer's `vendor/` (copied by
  `scripts/copy-assets.js`).

**Decision points for the next session — ask the user, don't default:**

1. **"Tauri" vs. "React renderer in Electron."** The pain described is about
   the *UI layer*, which is the vanilla renderer — not necessarily Electron
   itself. A React (+ Vite, Tailwind/shadcn or similar) front end can replace
   `renderer.js`/`style.css` while keeping Electron, which is by far the
   smaller change and keeps every Node-side feature working. Tauri is a
   bigger change: it has **no embedded Node runtime**, so the TypeScript core
   would have to run as a separate sidecar process (talking to the UI over
   stdio/WebSocket/HTTP) or be rewritten in Rust. Tauri also swaps Chromium
   for the system WebView (WebView2 on Windows), so WebGL, `getUserMedia`,
   and the MediaPipe wasm path need re-verifying. Present both honestly with
   those costs; let the user choose.
2. If Tauri: the sidecar/IPC design replacing `preload.ts` + `ipcMain`, the
   global hotkey (plugin), start-on-login, and installer story (currently
   `electron-builder`/NSIS via `npm run package:win`).
3. Whether to keep the six-page structure or redesign it — the user wants
   more customization, so ask what "customizable" means (themes? movable
   panels? layout presets?) before designing.

**Suggested approach:** define the UI↔core contract first (the event names
and verbs above, as a typed schema), build the new front end against that
contract with the existing engine behind it, and keep the Electron app
runnable until the new one reaches parity. Keep the project rules in
`CLAUDE.md` (security defaults, honest "not built yet" panels, no
fabricated data) in the new UI.

## Gotchas learned the hard way

- **`node --check renderer.js` is not a valid check for this renderer.**
  Node treats `.js` as CommonJS and wraps it in a function, so a top-level
  `return` passes. The browser loads it as an ES module (`<script
  type="module">`) and rejects it. Check as a module instead:
  `copy src\electron\renderer\renderer.js $env:TEMP\renderer-check.mjs` then
  `node --check $env:TEMP\renderer-check.mjs` — and open DevTools
  (Ctrl+Shift+I) on the real window. `tsc --noEmit` does not cover the
  renderer at all.
- A single syntax error in the module kills *everything* in the window
  silently (orb, buttons, chat) — the symptom looks like ten bugs.
- `npm install` may warn about pending install scripts (Electron, Whisper);
  run `npm approve-scripts --allow-scripts-pending`, then `npm install`.
- When pushing a first-time branch: `git push -u origin <branch>`.
- Hidden (`display:none`) pages make canvases measure 0px; the sidebar code
  fires a synthetic `resize` after each page switch for that reason. Any new
  canvas-based panel must handle `resize`.

## Still-open items carried over (details in `docs/project-status.md`)

- **Browser automation (Milestone 10 Part E)** — never worked end to end.
  Root cause identified earlier: Proxy's automation and the user's everyday
  browsing share one Chrome profile, so `--remote-debugging-port` races.
  Proposed fix: a dedicated Chrome profile (`--user-data-dir`). The user
  chose to defer this and keep their everyday profile; **do not build the
  separate-profile version without explicit confirmation** (it logs them out
  of everything in that profile). The Settings list now has a
  `PROXY_CHROME_PROFILE_DIR` field.
- **Local-model ceiling:** qwen3.5:9b at 12 GB VRAM is unreliable for
  multi-step agentic tasks (Hermes Agent was tested and shelved —
  `docs/decisions.md`). Open options: a model better at tool calling, or an
  optional cloud tier behind a user-supplied key. Not decided.
- **Awaiting real-machine confirmation:** Gmail OAuth setup, stock quotes
  (Alpha Vantage key), map tiles, device inventory, monitor, news, pinch
  trigger, double-clap calibration, 3D Studio WebGL/import/export,
  whisper.cpp GPU inference, Twilio calls, iPhone webhook/tunnel, packaged
  installer launch.
- **Housekeeping:** two label typos in the Settings field list
  ("Chromeprofile directory", "Max wait forspeech (ms)") are cosmetic;
  `git status` should be checked before every commit that `.env` stays out.
