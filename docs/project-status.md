# Project Status

Current milestone-by-milestone status. For *how* things work, see
`architecture.md`; for *why* choices were made, see `decisions.md`.

## ⚠️ One remaining flagged discrepancy (needs your confirmation)

While reorganizing the original `CLAUDE.md`, two places where it
contradicted itself (or was ambiguous about current truth) turned up.

1. ~~**Milestone 9's true current step.**~~ — RESOLVED. Since this
   reorg happened, Milestone 9 moved forward for real: step 4
   (`orchestrator.ts`) is wired into `engine.ts` (step 6), replacing the
   old `intentRouter.ts` call; the Activity panel dashboard component
   (also step 6) is built; and a thin slice of mocked unit tests (step
   5, 11 tests, `npm test`) passes. See the Milestone 9 section below
   for the accurate current step-by-step status.
2. **Camera card position.** The Milestone 7 entry in the original
   numbered milestone list said: *"Pending UI tweak, not yet built: move
   the Camera card to the bottom-left corner."* But the more detailed
   Milestone 7 status notes, later in the same original file, said the
   move **was** made. Checked directly against the actual code just now:
   `index.html`'s left column really does order the cards Pipeline →
   Input → Output → **Camera** → System Status → Session Log — the
   Camera card genuinely sits below Output, confirming the code-level
   claim. What's still outstanding is only the user's own visual
   confirmation on their actual screen — please confirm you've seen it
   there.

## Roadmap snapshot

1. ~~Audio pipeline~~ — done
2. ~~STT~~ — done (small.en, CPU; GPU/DirectML attempted and reverted)
3. ~~Command executor (hardcoded)~~ — done (open app, volume, window)
4. ~~TTS~~ — done (Piper default, ElevenLabs optional)
5. ~~LLM intent layer~~ — done (single-shot tool-calling router)
6. ~~Dashboard (Electron)~~ — done, confirmed working on the user's machine
7. Computer vision / gesture input — first slice (detection + visualization
   only) done, confirmed working; gesture-to-action wiring deferred to
   Milestone 10
8. ~~Voice activity detection (VAD)~~ — done, confirmed working
9. Task orchestration / multi-step tool calling — **in progress, steps
   1-6 of 7 built**, see detailed status below
10. Quality-of-life capabilities (gesture wiring, memory, complex multi-step
    tasks) as orchestrator tools — not started, not scoped in detail yet
11. Maps / location awareness — not started
12. Bluetooth / connected devices — not started
13. Settings panel + persistent dashboard session history — not started
14. Dashboard visual refresh — not started, planning stage (full spec
    below)
15. STT upgrade (Distil-Large-v3.5 + real GPU acceleration) — investigation
    done, decision pending your go-ahead (full findings: `decisions.md`)

## Milestones 1–5 — complete

1. **Audio pipeline** — done.
2. **STT** — done. Upgraded from base.en to whisper-small.en for accuracy
   (base.en was mishearing words, e.g. "Discord" as "this code"). A GPU
   attempt via DirectML was reverted to CPU for correctness (see Known
   limitations below and `decisions.md` for the full story).
3. **Command executor (hardcoded)** — done. Open app
   (`config/commands.json`, ~70 apps), volume (up/down/mute), window
   control (maximize/minimize/restore/snap-left/snap-right). Each command
   exposes a shared `execute*()` function used by both the regex router and
   the LLM tool-calling router.
4. **TTS** — done. Proxy speaks responses back via Piper, with an optional
   ElevenLabs upgrade path.
5. **LLM intent layer** — done. `commands/intentRouter.ts` exposes the
   three commands to `qwen3.5:9b` as Ollama tools; when the deterministic
   regex router doesn't match, the LLM either calls a tool or replies
   conversationally. Confirmed working by the user on natural phrasing the
   regex router couldn't handle (e.g. "bring the volume to 30").

## Milestone 6 — Dashboard (Electron) — done, confirmed

Transparency-first visual UI, built on the principle "show the process,
never hide it." Visualizes transcribed text, which router handled a
request, what command/tool executed, current status, and the spoken reply.
Also the point where a true global hotkey (F9, via Electron's
`globalShortcut`) was finally added, fixing the window-control focus-timing
limitation from Milestone 3 as a side effect.

- **Built and typechecked in the sandbox first** (no display/GPU/audio
  there), so `electron .` had not actually been launched before the user's
  first real test.
- **First real-machine test found a genuine bug, fixed**: window rendered
  and the orb animated, but pipeline/log/status/output never updated on
  real events, and the typed Input box appeared to do nothing. Root cause:
  `preload.ts`'s channel allowlist listed prefixed IPC names
  (`"proxy:ready"`, etc.) while `renderer.js` called
  `window.proxy.on("ready", ...)` with short names — the allowlist check
  was always false, so every subscription silently failed with no error
  (looked like ten unrelated UI bugs; was one). Fixed by having preload
  accept the short names and prefix internally. Caught only by actual use —
  TypeScript had no way to know the allowlist's literal string values were
  wrong. Also toned down the orb's idle pulse and sped up idle rotation
  while in there — with every state transition silently failing, all the
  user had seen was permanent idle, which read as "breathing" instead of
  "spinning."
- **Confirmed fixed on the user's machine** — pipeline/log/status/output
  update live, orb changes state correctly. Patched and committed.
- **Second real-machine bug, same session, fixed**: the System Status card
  and topbar hotkey label stayed stuck on placeholder text
  ("binding hotkey…", "Starting…") forever. Root cause: a race condition in
  `main.ts` — `send("proxy:ready", ...)` fired as soon as `engine.init()`
  resolved, with no coordination with the renderer's own page-load time.
  `webContents.send()` is fire-and-forget — if the renderer's listener isn't
  attached yet, the message is just dropped, no queue, no retry. `"ready"`
  is the one event that fires seconds after launch, right as the page (plus
  ~2MB of vendored three.js) may still be loading, making it the one most
  likely to race and lose. Fixed by waiting for both `engine.init()` and
  the renderer's `did-finish-load` event before sending anything.
- **Dependency bump**: Electron was bumped from `^32.0.0` to `^43.4.1`
  after `npm audit` flagged real CVEs against the old pin (context-isolation
  bypass, cross-origin iframe issues). Went straight to the patched stable
  release rather than a `--force` downgrade path; re-typechecked clean.
  `extract-zip` rode along with the same bump.
- **Visual overhaul** followed a user-provided reference image (a generic
  sci-fi-dashboard template with panels for camera feed, connected devices,
  a live map, and project tracking — none of which Proxy actually had at
  the time). Rather than fake that data, the redesign kept only what's real
  and added the "Coming soon" card — the user explicitly confirmed this
  approach rather than leaving those panels out entirely or faking them.
  Design rationale: `decisions.md`.
- Mechanical details of the shell (file breakdown, security defaults, orb
  state mapping, per-stage timing, engine events): `architecture.md`.

## Milestone 7 — Computer vision / hand tracking — first slice confirmed

Webcam feed + MediaPipe `HandLandmarker`, detecting and drawing hand
landmarks live in the dashboard's Camera card. Deliberately scoped to
detection + visualization only — no gesture-to-action wiring yet (folded
into Milestone 10, to be built as an orchestrator tool rather than a
bespoke integration).

- **Confirmed working on the user's machine**: camera permission prompt,
  WASM loading, and hand-tracking are all live and accurate — "hand
  tracking is great," per direct user feedback. The dynamic-import error
  isolation (see `architecture.md`) held up in practice too — no crash
  cascade into the rest of the dashboard during setup/testing.
- **Camera card position** — see the flagged discrepancy at the top of this
  file (code-level move confirmed; your visual confirmation is the only
  thing still outstanding).
- Implementation details (model download, vendoring, coordinate mapping,
  permission handling): `architecture.md`.

## Milestone 8 — Voice activity detection (VAD) — done, confirmed

Replaced the fixed 4-second recording window with `recordUntilSilence()` —
confirmed working on the user's real machine. Full three-phase mechanics,
env knobs, and the calibration edge case are documented in
`architecture.md`; the `.env` variables are listed in `workflows.md`.
`recordSeconds()` was removed outright, not left dead alongside the new
function, to avoid a code path that no longer matches what the UI claims is
happening.

## Milestone 9 — Task orchestration — in progress, steps 1-6 of 7 built

The big next architectural piece. The old `intentRouter.ts` handled exactly
one tool call per utterance — it couldn't chain steps, so "open notepad and
snap it to the left" didn't work (`control_window` acts on whatever's
focused, which only becomes the new window *after* `open_app` has actually
finished). `engine.ts` no longer calls `intentRouter.ts` as of step 6 below.

**Build order and status:**
1. Two-tier model calls (`qwen3.5:4b` fast / `qwen3.5:9b` smart) +
   personality baseline — **done, confirmed**. Model-choice rationale:
   `decisions.md`.
2. `tools.ts` shared tool registry — **done, confirmed**.
3. `browse.ts` tool + shared `launch.ts` launcher — **done, confirmed**.
4. `orchestrator.ts` — the actual multi-step loop (escalation, step cap,
   `defer_to_planner`, cancellation) — **done**. Built and typechecked in
   the sandbox; not independently real-machine-tested on its own since
   step 6 wired it in immediately after.
5. A thin slice of orchestrator unit tests — **done**. 11 mocked tests
   (`src/commands/orchestrator.test.ts`, `npm test`, `vitest`) covering
   plain replies, one confident tool call, `defer_to_planner` exposure,
   escalation, multi-tool chaining, the honest step-cap message,
   cancellation, tool-dispatch-failure resilience, and the forward-looking
   `resultInformsNextStep` path. No real Ollama/mic needed — all pass in
   the sandbox. `vitest` is a new devDependency; nothing tested this repo
   before.
6. Wiring the orchestrator into `engine.ts` (replacing `intentRouter.ts`),
   plus the new Activity panel dashboard component — **done, built and
   typechecked/built clean in the sandbox, not yet real-machine tested.**
   See "Activity panel" and "Cancellation" below for what actually shipped
   here versus the original plan.
7. **Not yet done** — real-machine test cases: "hello" (should stay a
   one-fast-tier-call plain reply), "open notepad and snap it to the left"
   (should chain two tool calls through the smart tier), "who made you"
   (should surface the personality/creator bio). This is the one remaining
   piece of Milestone 9, and it needs the user's actual machine, real
   Ollama, and the real dashboard — nothing further to verify from the
   sandbox alone.

**Processing pipeline** (as actually wired now): hotkey → VAD → regex fast
path (unchanged) → orchestrator loop. Turn 1 of every request goes to the
fast model (`think: false`); the loop only escalates to the smart model
(`think: true`) for turn 2+ once a request is shown to need more steps.
Simple utterances ("hello," "volume up") resolve in one fast-model call,
same latency as before; genuinely multi-step requests pay for the smarter
model only once that's demonstrated necessary.

**Safety surface**: a multi-step loop can compound a wrong turn across
several actions instead of one. Mitigations, all shipped: a real step cap
(`PROXY_ORCHESTRATOR_MAX_STEPS`, default 5, returning an honest "I've done a
few things but want to check in" if hit before the model signals done — not
a silent stop or a false completion claim), a `requiresConfirmation` hook on
the tool schema (built, still unused — no current tool is destructive enough
to need it), and cancellation (see below). These were added after
reconciling the design against an external architecture review — full
reconciliation: `decisions.md`.

**Cancellation — shipped narrower than "spoken stop."** The original plan
said "a second hotkey press or spoken 'stop.'" What actually shipped: a
second hotkey press (Electron), a second Enter press (CLI), or typing the
literal word "stop" into the dashboard's Input box while busy — all three
call `ProxyEngine.cancel()`, which only takes effect at the orchestrator's
next loop boundary, not mid-request (aborting an in-flight Ollama call
mid-flight would need an `AbortController` threaded through the client and
every tool executor — real, separate complexity, not attempted). True
*spoken* "stop" — recognizing the word out loud while Proxy is still
mid-pipeline — would need a second, always-on audio channel running in
parallel with the main one; genuinely separate scope, deliberately not
built. Typed "stop" is the practical stand-in. Full rationale: `decisions.md`.

**Personality baseline** — **done, shipped in step 1**, not an open item
anymore (an earlier version of this doc listed it as still pending the
user's input — stale; the creator bio and personality tone are already
live in `llm.ts`'s system prompt).

**Activity panel — done, replaces the old Pipeline card entirely** (not
just "not yet built" as an earlier version of this doc said). Real
per-step visibility for the orchestrator loop: a live, growing row list
(not a fixed skeleton) — "Listening," "Transcribing," "Deciding,"
"Executing: <tool>" (one row per loop iteration, so a two-tool chain shows
two rows), "Responding." A regex-matched command shows only Listening and
Transcribing, then the final reply — no fake "Deciding" row invented for
something that was actually an instant pattern match. A tier indicator
("fast tier" / "smart tier") sits on each Deciding row's sub-label; a
rotating dry-witted status word (e.g. "Thinking it over," "Working the
problem") only replaces the label during a genuinely-indeterminate
smart-tier wait — fast-tier decisions resolve in well under a second, so
they just say "Deciding" plainly. A real reasoning trace (`message.thinking`
from Ollama, when the smart tier produces one) is shown after the fact
(not streamed — `chat()` in `llm.ts` isn't a streaming call, so there's
nothing to stream live) behind a "Show reasoning" toggle on the row that
produced it. Milestone 14's planned relabeling (e.g. "Deciding" →
"Analyzing Input") still applies on top of this later — the underlying
rule doesn't change: every row still has to map to something that
actually happened, at the time it actually finished.

**Tool schema fields** (`resultInformsNextStep`, `requiresConfirmation`):
field definitions and current usage are in `architecture.md`; the reasoning
behind adding them is in `decisions.md`.

## Milestone 10 — Quality-of-life capabilities — not started

Not deliberately scoped in detail yet. Covers three things once Milestone 9
exists as a foundation: gesture-to-action wiring (Milestone 7 follow-up),
memory (Proxy remembering facts/preferences about the user across sessions
and referencing them naturally — distinct from the dashboard's
session-log persistence in Milestone 13, which is just the UI log
surviving a relaunch, not the LLM knowing anything), and more complex
consecutive/multi-step tasks beyond the browser-search example. Per the
user's own framing, these should mostly become "a couple more tools" the
orchestrator can call, rather than three separate bespoke integrations.
Real scoping happens after Milestone 9's shape is concrete.

## Milestone 11 — Maps / location awareness — not started

Ties to the dashboard's "Live map" coming-soon tile. Needs a real location
source (Windows Location API, or an IP-geolocation fallback) before any map
rendering is worth building.

## Milestone 12 — Bluetooth / connected devices — not started

Ties to the dashboard's "Connected devices" coming-soon tile. Needs real
device enumeration (Windows Bluetooth/WinRT APIs, likely via a native Node
addon) — real data or an honest empty state, never placeholder numbers.

## Milestone 13 — Settings panel + persistent dashboard session history — not started

Right now all configuration is `.env`-only and the dashboard's session log
resets on every relaunch. A real settings UI and a persisted log (even just
a local JSON/SQLite file) would remove the last "everything resets" rough
edge. This is the dashboard's UI log persisting — not Proxy remembering
anything about the user (that's Milestone 10).

## Milestone 14 — Dashboard visual refresh — not started, planning stage

Triggered by the user sharing a reference image and a written wishlist.
Note: the *palette* this reference image inspired is already in
`style.css` (pinned back at Milestone 6) — this milestone is about pushing
the *execution* further toward the reference's polish/contrast/liveliness,
plus several independently-scoped fixes, not a new direction.

Planned scope:
- **Sidebar**: collapses to just a "Dashboard" nav item plus a hamburger
  toggle. The reference's other nav items are real future destinations, not
  decoration to fake now: Dashboard (current view), Chat interface (orb +
  input + output only), Memory (session log + summary, ties to Milestone
  10's memory work), Tools (a list of what Proxy can do — could just render
  `commands/tools.ts`'s registry), Maps (Milestone 11), Devices (Milestone
  12), Settings (Milestone 13). None of these get built now — just the nav
  rail + toggle.
- **Activity panel**: refined, not replaced (see Milestone 9 above) —
  friendlier row labels, same real event/timing rules.
- **Orb**: no change in direction — already correctly event-driven rather
  than a literal copy of the reference's static illustration.
- **Input box**: add a mic icon inside the box, same trigger as F9
  (currently hotkey-only, no in-UI equivalent).
- **Bug fix**: typed text currently disappears if you hit send while Proxy
  is still busy on a previous request. Should stay in the box (to be sent
  once Proxy is free) without interrupting the in-flight request.
- **Output / session log**: shorten to a compact placeholder-style card —
  the full detailed log view is what the future "Memory" nav destination is
  for.
- **Camera card**: drop the "Milestone 7 — hand tracking" tag, just
  "CAMERA" — more capabilities are coming to this card later.
- **New placeholder cards** (Neural Network graph, Activity chart): styled
  to match the reference's aesthetic, but kept honest rather than populated
  with realistic-looking fake data (the reference itself shows fabricated
  battery %, fake GPS, fake progress bars — fine for a marketing render,
  not for this app). Extend the existing "COMING SOON" pattern (which
  already plainly tags unbuilt tiles as "Not built yet"). Worth naming
  honestly: a literal "neural network" visualization of an LLM's internals
  isn't something that can be shown truthfully — it's decorative sci-fi
  flavor, not a data view.
- **TTS playback**: "can be made better" — real but loosely specified.
  Needs its own design pass (something like a waveform or speaking-state
  indicator is the likely direction) once we get here.
- Not scoped yet, deliberately: actually building any of the future nav
  destinations — this milestone is the shell (sidebar + placeholders + the
  fixes above) only.

## Milestone 15 — STT upgrade (Distil-Large-v3.5 + GPU) — investigation done, decision pending

User asked to switch from `whisper-small.en` to Distil-Large-v3.5 and move
STT off CPU onto the GPU. Both halves have been investigated (not assumed).
Short version: the model swap alone is easy; real GPU acceleration is not
possible with the currently-installed library on Windows, and would require
a genuine architecture change (different native module, different model
format, a `stt.ts` rewrite). **Full investigation findings, the
accuracy/speed tradeoff analysis, and the recommended path forward are in
`decisions.md`.** Pending your explicit go-ahead before starting, given the
size of the change.

## Deferred / not in MVP

- Voice wake word (parked — see `decisions.md` for the Picovoice/hotkey
  history).
- Absolute volume control ("set volume to 30%") — current implementation is
  relative only (up/down/mute via simulated media keys). Precise percentage
  control would need the Windows Core Audio API — deferred until actually
  needed.
- Targeting window commands at a *named* app ("snap Chrome left") rather
  than whatever's currently focused — see Known limitations below.
- GPU-accelerated STT — see Milestone 15 above.

## Known limitations

- VAD's calibration is a per-recording amplitude estimate, not a persistent
  per-user profile — every hotkey press re-calibrates from scratch against
  whatever's in the room in that ~300ms. Confirmed working under normal
  conditions; still untested against a room with variable background noise
  (TV, other people talking), which may need `PROXY_VAD_THRESHOLD` set
  manually if it comes up.
- `sharp` (pulled in transitively by `@huggingface/transformers`, used for
  image preprocessing) has a known `libvips` vulnerability with no fix
  currently available (per `npm audit`, checked at Milestone 6). Accepted
  for now since image processing isn't exercised yet — re-check before any
  milestone that does real image work.
- STT runs on CPU only. GPU (DirectML) was attempted and genuinely doesn't
  work for this model/library combo right now (full story: `decisions.md`).
  whisper-small.en on CPU is the current tradeoff. Milestone 15 investigates
  a real fix.
- STT still occasionally mishears words, though less than under base.en —
  not specifically re-tested since the model upgrade.
- Piper's voice is robotic/synthetic. ElevenLabs is available as an
  optional upgrade (falls back to Piper automatically if no API key is
  set) — reviewed and confirmed sound, currently dormant since no key is
  configured.
- `commands.json` doesn't yet cover every app the user wants (e.g. ChatGPT
  desktop app) — easy to extend any time, just add an entry.
- Volume control is relative only (nudges up/down, toggles mute) — no
  "set to X%" support.
- Window control acts on whatever window is currently focused when the
  script runs. Fully solved for the dashboard (F9 global hotkey doesn't
  require focusing anything). Still a real limitation for the CLI-only path
  (`npm run start`) — that one needs the user to Alt-Tab to their target
  app before/while the recording window is open. Not worth fixing the CLI
  path specifically now that the dashboard is the recommended way to run
  Proxy day-to-day.
- The regex command router still requires fairly exact phrasing for the
  zero-latency fast path; fuzzier phrasing gets caught by the LLM router
  instead (slower — an LLM round trip — but working) rather than falling
  through to plain command-unaware conversation.
- **Found in real-machine testing, Milestone 9 step 3**: bare "open
  youtube" / "open github" (no explicit browser mentioned) often gets
  ignored rather than routed to the `browse` tool, but only when Chrome
  isn't named explicitly alongside it. Verified this is *not* a bug in
  `browse.ts` itself (its URL-building logic has a passing unit check, and
  the tool schema's description already covers bare "open X" phrasing as an
  example) — it's the same underlying issue as a hallucination bug fixed in
  Milestone 9 step 1b: a single one-shot smart-tier call isn't perfectly
  reliable at picking the right tool for every phrasing. Expected to keep
  improving as the rest of Milestone 9 lands, not something worth chasing
  with more prompt patches meanwhile.
- **Found in real-machine testing**: if the user types into the INPUT box
  and hits send while Proxy is still busy on a previous request, the typed
  text currently disappears rather than being preserved. Queued for
  Milestone 14.
- The dashboard's session log resets on every relaunch (no persistence yet
  — Milestone 13).
- No Bluetooth device data, no map/location data yet — deferred milestones,
  not silently-faked features (see the "Coming soon" card in
  `architecture.md`).

## Open questions (need your input)

- **Milestone 9, step 7**: run the three real-machine test cases above
  ("hello," "open notepad and snap it to the left," "who made you") and
  report back — this is the only thing left before Milestone 9 can be
  called done.
- **Camera card position**: can you confirm you've actually seen it in the
  bottom-left on your machine? (See the flagged discrepancy at the top of
  this file — the code itself already checks out.)
- **Milestone 15 go-ahead**: do you want to proceed with the whisper.cpp +
  CUDA + Distil-Large-v3.5-ggml path? It's a real architecture change (new
  native module, new model format, `stt.ts` rewrite), not a quick patch —
  see `decisions.md` for the full investigation before deciding.
