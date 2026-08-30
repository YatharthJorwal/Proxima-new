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
10. Agentic capabilities (file tools, code execution, gesture wiring,
    memory) as orchestrator tools — **in progress**, see detailed status
    above. Part A (file tools) done; parts B-D not started.
11. Maps / location awareness — not started
12. Bluetooth / connected devices — not started
13. Settings panel + persistent dashboard session history — not started
14. Dashboard visual refresh — not started, planning stage (full spec
    below)
15. STT upgrade (Distil-Large-v3.5 + real GPU acceleration) — investigation
    done, decision pending your go-ahead (full findings: `decisions.md`)
16. iPhone integration (messages, remote control) — not started, real
    feasibility researched (full findings: `decisions.md`) — see the
    Milestone 16 section below for what's actually worth building first
17. Packaging (Windows installer + auto-launch on startup) — not started,
    genuinely easy when it happens
18. Alternative activation: double-clap trigger — not started
19. System monitor (Task Manager tile + Proxy-queryable resource usage) —
    Part A (the tool) done, not yet real-machine tested; Part B (the
    sidebar tile) blocked on Milestone 14
20. 3D modeling assistant ("a personalized Blender") — not started, the
    last major planned undertaking, phased (see below) — by far the
    biggest item on this roadmap
21. Personalized news window — not started, one of the more
    straightforward items here
22. Proxy can call your phone — not started, real feasibility researched
    — genuinely different in kind from everything above (needs a cloud
    telephony provider, real ongoing cost, breaks local-only — see below)

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

## Milestone 10 — Agentic capabilities — in progress

Scope widened significantly from the original vague placeholder, after a
real conversation about what "actual Jarvis" should mean: not just more
orchestrator tools for existing PC actions, but real code generation
(write a file, run it, show the result) and eventually live external data
(stock prices, messages). Broken into parts so each ships as its own
reviewable, testable slice rather than one big undertaking:

**Part A — file tools (write_file, open_path) — done, sandboxed, not yet
real-machine tested.** The first concrete step toward "make me Flappy
Bird" actually working: `write_file` creates a source/content file (HTML,
JS, CSS, JSON, MD, TXT, CSV, SVG, PY) and `open_path` opens it via the
OS's default handler (an `.html` file opens in the browser - genuinely
`launch()`, the same Start-Process call `open_app`/`browse` already use).
Both tools are confined entirely to a dedicated workspace folder
(`PROXY_WORKSPACE_DIR`, default `~/ProxyWorkspace`) that Proxy fully
owns - not the general filesystem. Path traversal (`..`, absolute paths)
is rejected; `write_file` refuses to create anything Windows would treat
as directly executable (no `.exe`/`.bat`/`.ps1`/etc.); `open_path` is
*more* restrictive still - it won't auto-open a `.js` or `.py` file even
though `write_file` is happy to create one, because depending on a
machine's file associations, launching one of those can *run* it rather
than just show it (a real, historical Windows risk, not a hypothetical
one). Full reasoning: `decisions.md`. 10 new unit tests
(`fileTools.test.ts`) cover the sandboxing directly - path escapes,
extension allowlists on both tools, the happy path - against a real
throwaway temp directory, not mocked filesystem calls.

Neither tool is flagged `requiresConfirmation` - see that field's own
notes in `architecture.md`: nothing enforces it yet, so setting it would
just be a lie about safety that isn't actually there. Sandboxing plus a
narrow extension allowlist is what makes these two safe enough to ship
without that gate; the next part isn't.

**Part B — code execution (a `run_script` tool) — not started, and
deliberately blocked on something else first: a real confirmation-and-
wait mechanism.** "Write me a Python script and run it" needs actual
process execution, which is a categorically bigger risk surface than
"write a file to a sandboxed folder" - even restricted to a fixed set of
known interpreters (`node`, `python`) on a workspace-confined path rather
than an arbitrary shell string, this is the piece that actually needs the
model to pause and the user to confirm before it happens for anything
beyond the most trivial case. Needs real design work: does confirmation
happen by voice, by a dashboard button, does the orchestrator loop
literally block waiting on it. Not attempted yet.

**Part C — external data (stock prices, Gmail) — not started, real
sources researched** (see `decisions.md` for the full findings — searched
rather than assumed, since this matters for what's actually buildable):
- **Groww** — genuinely straightforward. Groww now has an official
  Trading API (₹499/month subscription) covering portfolio/holdings,
  live market data, and historical data — exactly the shape needed for
  "what are my profits on X." Real REST API, real docs, no scraping.
- **Screener.in** — no official API. Real data access exists only through
  third-party scrapers (e.g. Apify actors, Parse.bot) that scrape
  Screener.in on your behalf for a small per-request fee — usable, but
  worth knowing it's an unofficial middleman, not Screener.in itself, and
  could break if they change their site.
- **Generic stock quotes** (for symbols outside Groww holdings) — any of
  the standard free-tier market data APIs (Alpha Vantage, Finnhub, etc.)
  would cover this cleanly, same shape as the above.
- **Gmail** — the easy one. Official Gmail API, standard OAuth2, reading
  and searching messages is exactly what it's designed for. No caveats.
- **Apple Stocks app** specifically — not a real integration target.
  Apple doesn't expose the Stocks app to third parties at all; "stock
  data on the PC" means a real market-data API (above), not pulling from
  the iPhone's own Stocks app.

Recommendation unchanged from the original scoping conversation: prove
the pattern with one source (Groww or Gmail, both genuinely simple)
before building toward more. Confirmed: no Groww portfolio exists yet, so
that specific piece would ship with nothing to actually connect to for
now - staying exactly where it is in the roadmap until there's a real
portfolio to point it at.

**Part D — the original placeholder scope** (gesture-to-action wiring,
Milestone 7 follow-up; memory - Proxy remembering facts/preferences
across sessions and referencing them naturally) - still not started, still
not scoped in detail. Distinct from the dashboard's session-log
persistence in Milestone 13, which is just the UI log surviving a
relaunch, not the LLM knowing anything.

## Milestone 16 — iPhone integration (messages, remote control) — not started, real feasibility researched

Distinct from Milestone 10 Part C above: this is device/ecosystem
integration (Apple's Shortcuts automation system, third-party bridge
apps), not "call a REST API." Feasibility varies a lot by piece — see
`decisions.md` for the full research, searched rather than assumed:

- **Reading iPhone messages (SMS/iMessage)** — feasible, one direction
  only: an iOS Shortcuts Automation on the phone can forward incoming
  SMS to a webhook URL (well-documented, real pattern). This means the
  *iPhone pushes to Proxy* when a message arrives — Proxy can't reach out
  and pull messages on demand. Needs Proxy to expose a reachable
  endpoint (fine on the same WiFi; needs a tunnel like ngrok or
  Cloudflare Tunnel to work away from home) and a Shortcuts Automation
  set up on the phone. iMessage-specific forwarding (as opposed to SMS)
  is less directly supported by Shortcuts than plain SMS.
- **WhatsApp** — **not recommended.** No official API for reading your
  own personal chats. The only real options are unofficial libraries
  that automate a WhatsApp Web session (violates WhatsApp's Terms of
  Service, real account-ban risk) or the WhatsApp Business API (built
  for a business replying to customers at scale, not a personal account
  reading its own messages — wrong tool for this). Worth revisiting only
  if WhatsApp itself ever ships something official for this.
- **Remote-triggering something on the iPhone** (e.g. "open Safari") —
  feasible via a third-party bridge app (Pushcut is the most direct
  example: Proxy sends an HTTP request, the phone gets a push
  notification, a pre-built Shortcut runs). Real and used by others for
  exactly this, but adds a dependency outside Proxy's control — the
  phone needs that app installed, configured, and each action needs its
  own Shortcut built ahead of time. Not a general "control the iPhone"
  capability, more like a small number of pre-wired remote buttons.
- **Unlocking the iPhone remotely** — **not feasible, full stop.** No
  research needed to reach this one: Apple deliberately does not expose
  any way to unlock a device remotely via Shortcuts, an API, or anything
  else — that's a hard security boundary by design, not a gap waiting to
  be filled. Not worth revisiting unless Apple's own stance changes.

Recommendation if this gets prioritized: the SMS-forward-to-webhook path
is the one actually worth building first — real, documented, no ToS risk,
and covers the "new message from a client" use case directly. Safari-open-
via-Pushcut is a fun demo but low value on its own. WhatsApp and
remote-unlock are not recommended pursuits, for the reasons above.

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
- **Found in real-machine testing, fixed this patch**: the LLM would
  occasionally produce emoji, em/en dashes, and smart quotes in replies,
  which Piper (a local TTS model) struggles with — garbled or dropped
  audio on the character itself, not just an odd pause. `llm.ts`'s system
  prompt now explicitly asks the model to avoid these (PERSONALITY), and
  `textForSpeech.ts`'s `normalizeForSpeech()` is the deterministic
  backstop in `engine.ts` that guarantees it regardless of whether the
  model actually listened — same "prompt nudge is not a guarantee"
  reasoning already applied to the regex-fallthrough fix and the earlier
  hallucination fix. Applied once, to both the displayed and spoken
  reply, so the two stay identical rather than silently drifting apart.
  Full design + test coverage: `decisions.md`, `textForSpeech.test.ts`.
  Worth noting precisely since it matters for where a future fix would
  go: this is a TTS (Piper, spoken output) problem, not an STT (Whisper,
  transcribing what the user says) one — Whisper never sees anything the
  LLM generates, there's no code path where it could.
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
- **Found in real-machine testing, fixed this patch**: `open_app`'s regex
  fast path (`OPEN_PATTERN` in `openApp.ts`) matches any "open X" phrase,
  which meant it was grabbing requests it had no business claiming and
  answering confidently wrong instead of letting anything better try:
  "open chrome and open youtube" (compound - two actions, matched as one
  literal app name), "open youtube on chrome and search for pewdiepie"
  (compound + browse-shaped), "open github" (a real, configured `browse.ts`
  site - github.com - that never got a chance because this regex claimed
  the utterance and failed first). Root cause was structural, not an LLM
  reliability issue: the regex router doesn't fall through on an
  unrecognized app name, it answers directly with a canned "not set up"
  string, which — because Milestone 3's regex router runs *before* any LLM
  is ever consulted — meant the orchestrator (or, pre-Milestone-9, the old
  `intentRouter.ts`) never even saw these requests. This actually explains
  and supersedes an earlier "Milestone 9 step 3" entry here that attributed
  a similar-looking symptom to single-shot LLM tool-selection
  unreliability — that diagnosis was wrong; it's this regex bug. Fixed:
  `tryHandleOpenApp` and `tryHandleBrowse` (same pattern) now return `null`
  on an unrecognized app/site instead of answering, letting the router
  chain — and past it, the orchestrator, which has both `open_app` and
  `browse` and can reason about phrasing a fixed regex can't — take a real
  shot. Regression tests: `openApp.test.ts`, `browse.test.ts`. What's
  *not* fixed by this, and remains a real open question (see Open
  Questions below): whether the model reliably picks the *right* tool and
  chains multi-step requests correctly once it does get a shot at them —
  that's a separate, genuine LLM-reliability question, not a routing bug,
  and needs real-machine confirmation.
- **Found in real-machine testing**: if the user types into the INPUT box
  and hits send while Proxy is still busy on a previous request, the typed
  text currently disappears rather than being preserved. Queued for
  Milestone 14.
- The dashboard's session log resets on every relaunch (no persistence yet
  — Milestone 13).
- No Bluetooth device data, no map/location data yet — deferred milestones,
  not silently-faked features (see the "Coming soon" card in
  `architecture.md`).

## Milestone 17 — Packaging (Windows installer + auto-launch on startup) — not started

Currently the dashboard only runs via `npm run dashboard` (dev-mode
Electron launch) — there's no real distributable build yet. Two genuinely
easy, well-trodden pieces:
- **Packaging**: `electron-builder` (or `electron-forge`) to produce a
  real `.exe` installer, instead of running from source.
- **Auto-launch on Windows startup**: Electron has
  `app.setLoginItemSettings()` built in for exactly this — no registry
  editing needed, no third-party library.

Not started. Reasonable to bundle with Milestone 14 (dashboard visual
refresh) timing-wise, since both are about the app being something you'd
actually hand to "normal Windows startup," but scoped as its own
milestone since it's unrelated in substance.

## Milestone 18 — Alternative activation: double-clap trigger — not started

The hotkey (F9) already works regardless of what app has focus — that's
existing behavior (Electron's `globalShortcut` is OS-level), not
something this milestone adds. This is specifically about a *second*,
additional way to trigger Proxy: two sharp claps within about a second,
detected continuously in the background, calling the same
`engine.runOnce()` (or `cancel()` if busy) the hotkey already calls.

Technically a smaller cousin of Milestone 8's VAD — amplitude-spike
detection, same general family — but with one real architectural
difference worth being upfront about: VAD only listens once triggered
(hotkey pressed, then it records); this needs a mic stream open
*continuously* in the background, discarding audio immediately unless a
clap pattern fires (never transcribing or storing anything otherwise).
Not a privacy concern in the sense that matters here, but a real
difference from how the pipeline works today. False-positive tuning (a
door slam, keys jangling, an actual clap in a video) will need the same
kind of calibration work VAD's threshold went through.

## Milestone 19 — System monitor (Task Manager tile + Proxy-queryable resource usage) — Part A done, not yet real-machine tested; Part B blocked on Milestone 14

Split once actually scoped, since the two halves turned out to have
different feasibility: a live hardware-usage sidebar tile (Part B)
genuinely can't be built yet — there's no sidebar to put it in, that's
Milestone 14's job, still not started. The orchestrator tool (Part A)
doesn't have that dependency, so it shipped on its own.

**Part A — `get_system_usage` tool — done, typechecked/tested/built in
the sandbox, not yet real-machine tested.** Queries CPU%, memory
used/total, and the top 5 processes by memory and by cumulative CPU time
via one PowerShell round-trip (`Get-CimInstance`, `Get-Counter`,
`Get-Process` — same invocation family `volume.ts`/`window.ts` already
use, but the first *query* tool in this codebase rather than an
*action* one — it captures and parses stdout instead of just waiting for
the script to exit). 5 unit tests (`systemUsage.test.ts`) cover the
parsing, including a real PowerShell quirk worth knowing about: a
single-item result list serializes as a bare object instead of a
one-element array, normalized transparently so callers never see it.
One honesty note baked into the tool itself: "top by CPU time" is
*cumulative* processor time since a process started, not an
instantaneous percentage — Windows doesn't expose reliable per-process
instantaneous CPU% as cheaply as memory — so a browser that's been open
for days will always top that list regardless of what's actually busy
right now. The tool's reply text says so explicitly rather than
presenting stale cumulative data as live CPU hogging.

**Part B — the sidebar tile — not started, blocked on Milestone 14.**
Once the sidebar exists, this is mostly a rendering task on top of Part
A's already-working tool (or a lighter-weight direct PowerShell poll for
a live-updating graph, TBD when it's actually built) — an aesthetic
alternative to Ctrl+Shift+Esc, not a replacement for it. The tool alone
already answers "what's eating my RAM" via voice or the dashboard's
Input box today — Part B just makes it also glanceable without asking.

## Milestone 20 — 3D modeling assistant ("a personalized Blender") — not started, the last major planned undertaking

By far the most ambitious item on this roadmap - explicitly positioned
last, not because nothing will ever be added after it, but because
everything else here is comparatively incremental next to this. Worth
being honest about scale up front: Blender itself represents roughly
three decades of development. What's being asked for breaks into four
genuinely separable capabilities, at very different levels of "how
solved is this problem":

1. **Viewing a 3D file** (import STL/OBJ, orbit/pan/zoom) - easy. Three.js
   is already a dependency in this project (it renders the dashboard's
   orb) and has loaders for exactly these formats.
2. **Basic parametric editing** - add primitives (box, cylinder, sphere),
   drag-adjust them with on-screen gizmos (position/rotation/scale),
   boolean union/subtract, export back to STL for printing. Real and
   scoped: Three.js's `TransformControls` covers the gizmos, and solid
   web CSG (boolean-operation) libraries exist for the rest. This alone
   delivers an actual, if simple, personal CAD tool.
3. **AI "understanding" a model** - rendering it from a few angles and
   having a vision-capable model describe or critique it ("this wall is
   too thin to print reliably") is realistic and buildable.
4. **AI *generating* a model from a description** - genuinely the
   uncertain part, not a promise. Text-to-3D generation is real, active
   research, but running it locally with the geometric precision 3D
   printing actually needs (watertight, manifold meshes) is not a solved
   problem today. Realistic scope: Proxy helping compose and adjust
   primitives conversationally ("make that leg 2cm taller," "round the
   corners") rather than conjuring an arbitrary object whole from a
   sentence.

Recommendation when this gets picked up: phases 1-3 in order first -
each is independently useful and de-risks the next. Phase 4 stays framed
as an open research problem to attempt, not a committed deliverable.

## Milestone 21 — Personalized news window — not started

A second Electron `BrowserWindow` (or a new sidebar destination — either
works, both are well-understood patterns) showing news the LLM has
already filtered and summarized against known interests, not a raw feed
dump. Fetching doesn't need a paid API — most outlets publish RSS feeds
directly, no signup, no rate limit. The genuinely personalized version
("it knows my interests without being told each time") depends on
Milestone 10 Part D (memory) existing first; until then, this ships in a
simpler form — a static, user-configured interest list (similar in
spirit to `config/commands.json`) - still real and useful, just less
automatic than the end state. One of the more straightforward items on
this roadmap: no new architecture, no ongoing cost, composes cleanly with
what Milestone 14 already has planned for the sidebar.

## Milestone 22 — Proxy can call your phone — not started, real feasibility researched, genuinely different in kind from everything else here

Verified current: Twilio's Media Streams is the standard, well-documented
way to do this — it opens a WebSocket to a server you run, streams live
call audio in real-time, and plays back whatever audio you send. The
existing Whisper/orchestrator/Piper pipeline could sit behind that
WebSocket in principle. Flagging plainly, not to discourage it, but
because it's the first item on this whole roadmap that isn't "more
capability on the local foundation already built" - it's a real
architecture branch:
- **Requires a cloud telephony provider** (Twilio or equivalent) — there
  is no way to place a real PSTN call without one; this is physics/
  regulation, not a gap in available tooling.
- **Real, ongoing per-minute cost** — small for occasional use, but not
  free, and not a one-time setup charge.
- **Breaks local-only** — call audio necessarily transits the telephony
  provider's servers. Nothing else in this project does that.
- **The PC needs to be reachable from the internet** to receive Twilio's
  callbacks while away from home (a tunnel like Cloudflare Tunnel, or
  port-forwarding) — its own small infrastructure project on top of the
  calling feature itself.

Recommendation: start narrow — Proxy places a call only when explicitly
asked to, proving the pipeline, before ever considering Proxy deciding on
its own when a call is warranted. The latter is a materially harder,
easier-to-get-annoying UX problem (what's actually call-worthy, how often
is too often) that deserves its own real design pass, not an assumption
baked in alongside the plumbing.

## Personality/tone: FRIDAY-style address ("sir") — not a milestone, just a prompt edit whenever

Worth noting separately from the numbered milestones above: this is a
few lines in `llm.ts`'s existing `PERSONALITY` constant (already touched
this session for TTS-safety), not a new capability. No architecture, no
research, no real scoping needed - just hasn't shipped yet because
nothing's forced a code patch to include it. Folding into whichever
patch comes next rather than tracking as its own item.

## Open questions (need your input)

- **Milestone 9, step 7**: run the three real-machine test cases above
  ("hello," "open notepad and snap it to the left," "who made you") and
  report back — this is the only thing left before Milestone 9 can be
  called done. Also worth throwing in while testing, now that the regex
  fallthrough bug above is fixed: "open chrome and open youtube," "open
  youtube on chrome and search for pewdiepie," "open github" — confirm the
  orchestrator actually picks the right tool(s) for these now that it's
  getting a real shot at them. Also worth trying "what's eating my RAM"
  and similar once Milestone 19 Part A's patch is applied — real
  PowerShell output on your actual machine hasn't been checked, only the
  parsing logic against mocked data in the sandbox.
- **Camera card position**: can you confirm you've actually seen it in the
  bottom-left on your machine? (See the flagged discrepancy at the top of
  this file — the code itself already checks out.)
- **Milestone 10 workspace folder**: `write_file`/`open_path` default to
  `~/ProxyWorkspace` if `PROXY_WORKSPACE_DIR` isn't set. Worth confirming
  that's actually where you want generated files to land, or whether
  you'd rather set the env var to somewhere else (a synced folder, a
  specific project directory, etc.) before testing Part A for real.
- **Milestone 10 Part B priority**: is code execution (`run_script`) or
  external data (stock/messages) more valuable to build next, once Part
  B's confirmation-mechanism design work happens? Not urgent to answer
  now, just flagging it's an open ordering question.
- **Milestone 15 go-ahead**: do you want to proceed with the whisper.cpp +
  CUDA + Distil-Large-v3.5-ggml path? It's a real architecture change (new
  native module, new model format, `stt.ts` rewrite), not a quick patch —
  see `decisions.md` for the full investigation before deciding.
