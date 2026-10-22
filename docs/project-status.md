# Project Status

Current milestone-by-milestone status. For *how* things work, see
`architecture.md`; for *why* choices were made, see `decisions.md`.

## Resolved discrepancies (kept for history)

While reorganizing the original `CLAUDE.md`, two places where it
contradicted itself (or was ambiguous about current truth) turned up.
Both are now resolved.

1. ~~**Milestone 9's true current step.**~~ — RESOLVED. Since this
   reorg happened, Milestone 9 moved forward for real: step 4
   (`orchestrator.ts`) is wired into `engine.ts` (step 6), replacing the
   old `intentRouter.ts` call; the Activity panel dashboard component
   (also step 6) is built; and a thin slice of mocked unit tests (step
   5, 11 tests, `npm test`) passes. Step 7's three real-machine test
   cases are now confirmed too (see the Milestone 9 section below) —
   Milestone 9 is fully done. `intentRouter.ts` itself has been deleted
   from the codebase (it was flagged as a deletion candidate once this
   confirmation landed — see `decisions.md`).
2. ~~**Camera card position.**~~ — RESOLVED. The Milestone 7 entry in the
   original numbered milestone list said: *"Pending UI tweak, not yet
   built: move the Camera card to the bottom-left corner."* But the more
   detailed Milestone 7 status notes, later in the same original file,
   said the move **was** made. Checked directly against the actual code:
   `index.html`'s left column really does order the cards Input → Output
   → **Camera** → System Status → Session Log — confirming the
   code-level claim. User has since confirmed seeing it there too.

## Roadmap snapshot

1. ~~Audio pipeline~~ — done
2. ~~STT~~ — done (small.en, CPU; GPU/DirectML attempted and reverted)
3. ~~Command executor (hardcoded)~~ — done (open app, volume, window)
4. ~~TTS~~ — done (Piper default, ElevenLabs optional)
5. ~~LLM intent layer~~ — done (single-shot tool-calling router)
6. ~~Dashboard (Electron)~~ — done, confirmed working on the user's machine
7. Computer vision / gesture input — hand tracking confirmed working;
   optional pinch-to-voice trigger built, awaiting camera calibration
8. ~~Voice activity detection (VAD)~~ — done, confirmed working
9. ~~Task orchestration / multi-step tool calling~~ — **done, confirmed**
   (all 7 steps, including step 7's real-machine test cases), see
   detailed status below
10. Agentic capabilities — **in progress**. Parts A, B, and D's memory
    slice are confirmed working; Gmail and stock quotes are built and need
    credentials/live-service confirmation;
    browser automation is deferred by user choice; pinch-to-voice trigger
    is implemented and awaits real-camera confirmation. See detailed status below.
11. Maps / location awareness — opt-in map tile view built; awaiting Windows confirmation
12. Bluetooth / connected devices — initial inventory tile built; awaiting
    Windows confirmation
13. Settings panel + persistent dashboard session history — **done,
    confirmed** (session history and settings UI)
14. Dashboard visual refresh — shell and live monitor/device panels built;
    awaiting clean Electron launch and real-machine UI confirmation
15. STT upgrade (Distil-Large-v3.5 + real GPU acceleration) — CUDA
    whisper.cpp runtime and weights installed; inference confirmation remains
16. iPhone integration — authenticated SMS webhook and inbox query built;
    Shortcuts/tunnel setup and real-device confirmation remain
17. Packaging — opt-in startup setting implemented and Windows NSIS
    installer built; packaged install/launch confirmation remains
18. Alternative activation: double-clap detector implemented as explicit
    opt-in; real-device false-positive/sensitivity calibration remains
19. System monitor (Task Manager tile + Proxy-queryable resource usage) —
    Part A done and confirmed; Part B built, awaiting Windows confirmation
20. 3D modeling assistant — STL/OBJ import, primitive editor, numeric
    dimensions, transform gizmos, natural-language assembly/transform
    edits, rounded-box edits, union/subtraction, bounded topology diagnostics, preview
    description, and STL export built; advanced CAD features and real-machine
    WebGL confirmation remain
    biggest item on this roadmap
21. Personalized news panel/tool — RSS fetch, optional interest filter,
    and local-model summarization built; awaiting live feed confirmation
22. Proxy can call your phone — outbound spoken-message slice built;
    provider setup and real-machine confirmation remain

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
landmarks live in the dashboard's Camera card. A user-enabled pinch
trigger is wired to the same start/cancel voice action as F9; it is off
until the user turns on the camera, hand tracking, and Pinch trigger. The
pinch is edge-triggered and rate-limited. Real-camera calibration is
required before calling it confirmed.

- **Confirmed working on the user's machine**: camera permission prompt,
  WASM loading, and hand-tracking are all live and accurate — "hand
  tracking is great," per direct user feedback. The dynamic-import error
  isolation (see `architecture.md`) held up in practice too — no crash
  cascade into the rest of the dashboard during setup/testing.
- **Camera card position** — confirmed. See "Resolved discrepancies" near
  the top of this file.
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

## Milestone 9 — Task orchestration — done, confirmed on the real machine

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
   plus the new Activity panel dashboard component — **done, confirmed
   working on the real machine** (see step 7 below). See "Activity panel"
   and "Cancellation" below for what actually shipped here versus the
   original plan.
7. **Done, confirmed.** Real-machine test cases — "hello" (one-fast-tier-
   call plain reply), "open notepad and snap it to the left" (chained two
   tool calls through the smart tier), "who made you" (surfaced the
   personality/creator bio) — all confirmed working. Also confirmed in
   the same real-machine pass: the regex-fallthrough fix ("open chrome
   and open youtube," "open github," etc.), Milestone 10 Part A's file
   tools, the TTS text-normalization fix, and Milestone 19 Part A's
   `get_system_usage` tool. Milestone 9 is fully done — nothing left
   pending on it.

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

**Part A — file tools (write_file, open_path) — done, confirmed working
on the real machine.** The first concrete step toward "make me Flappy
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

**Part B — code execution (a `run_script` tool) — done, confirmed
working on the real machine.** The confirmation-mechanism design question this
was blocked on is now decided and implemented: voice confirmation via a
separate, following turn (not an inline mid-run pause — see
`decisions.md` for why the app's own architecture made that the natural
choice, not just a preference). `run_script`'s `execute()` never runs
anything itself — it validates the request (workspace-relative path,
`.js`/`.py` only, must already exist) and asks for a yes/no; the actual
run happens only if the *next* utterance is a clear confirmation,
checked before the regex router or the orchestrator ever see it. A clear
no cancels; anything else (including an unrelated new request) silently
drops the pending confirmation with no time-based expiry — a single
non-matching utterance is what closes the window, not a clock. Runs via
`execFile`'s async form (never sync — see the STT/"not responding"
finding above for exactly why that distinction matters here),
timeout-capped (`PROXY_SCRIPT_TIMEOUT_MS`, default 15s) and output-capped
(500 characters) in the spoken reply. 10 new unit tests
(`runScript.test.ts`) — real end-to-end, not mocked: actually runs real
`node`/`python` against real throwaway scripts, including a genuine
timeout-and-kill test. Confirmed on the real machine: write-then-run,
confirm, deny, and the drop-on-unrelated-utterance path all worked as
designed.

**Part C — external data (stock prices, Gmail) — Gmail and basic stock
quote slices built; external credentials and live-service confirmation
remain.** Gmail was picked as the first slice to
actually build (over Groww — see below, no portfolio exists yet to
connect to): `get_emails`, a read-only query tool (`gmail.readonly`
OAuth scope — can't send, delete, or modify anything, which is what
lets this ship without a confirmation gate; full reasoning:
`decisions.md`). Fetches only message metadata (From/Subject/Date) plus
Gmail's own short `snippet`, never full email bodies. Needs one-time
OAuth setup (`npm run setup:gmail`, README.md) before it can be tested
for real — confirm you've completed that and gotten a real answer back
("do I have any new emails," "any emails from X") before this counts as
done. 8 unit tests (`gmail.test.ts`) cover header-parsing and the
summary logic against a mocked Gmail client.

Further market-data research (see `decisions.md` for source findings):
- **Groww** — genuinely straightforward. Groww now has an official
  Trading API (₹499/month subscription) covering portfolio/holdings,
  live market data, and historical data — exactly the shape needed for
  "what are my profits on X." Real REST API, real docs, no scraping.
- **Screener.in** — no official API. Real data access exists only through
  third-party scrapers (e.g. Apify actors, Parse.bot) that scrape
  Screener.in on your behalf for a small per-request fee — usable, but
  worth knowing it's an unofficial middleman, not Screener.in itself, and
  could break if they change their site.
- **Generic stock quotes** — implemented with Alpha Vantage's official
  quote endpoint (details below), avoiding scraping.
- **Apple Stocks app** specifically — not a real integration target.
  Apple doesn't expose the Stocks app to third parties at all; "stock
  data on the PC" means a real market-data API (above), not pulling from
  the iPhone's own Stocks app.

Groww remains the natural next portfolio integration if there is a real
Groww portfolio to connect. It has a recurring subscription cost, so it
is not configured or called without the user choosing that provider.

The independent stock-quote slice uses Alpha Vantage's [`GLOBAL_QUOTE`
endpoint](https://www.alphavantage.co/documentation/) for one symbol at a
time. It caches a symbol for five minutes,
labels the default response as end-of-day, and does not claim real-time
data or make investment recommendations. The quote response used here
does not include currency, which Proxy says explicitly. The user must add
an API key in Settings; Alpha Vantage's [free service](https://www.alphavantage.co/support/)
currently allows 25 requests per day, while real-time and 15-minute-delayed
US quotes require a paid plan. The provider receives the ticker and API key. This slice
still needs a configured key and live-response confirmation.

**Part D — memory — confirmed on the real machine, two real bugs found and fixed.**
Scoped in conversation first (see `decisions.md` for the full design
record, including two deliberate reliability tradeoffs taken on
knowingly): facts, preferences, and project context are captured
**automatically** — a background smart-tier call looks at each completed
interaction after the user has already heard their reply and decides if
anything durable is worth keeping, storing it in a flat capped local
JSON file (`~/.proxima/memory.json`, `PROXY_MEMORY_FILE` overridable,
30-entry cap, oldest pruned first). The Memory dashboard panel now lets
the user review saved facts and clear the full store after confirmation.
There are no individual edit/delete or manual `remember_fact`/
`forget_fact` tools; a bad automatic capture remains until pruned or the
full store is cleared. Recall happens through a `recall_facts` tool the
model calls on demand (plain substring matching, no embeddings) —
`resultInformsNextStep: true`, since a raw fact list is material for an
answer, not the answer itself. 13+ unit tests (`core/memory.test.ts`,
`commands/memory.test.ts`) cover storage/cap/dedup logic and the recall
tool's filtering.

Real-machine testing surfaced two genuine bugs, both fixed: (1) the smart
tier occasionally put its entire answer into its internal `thinking`
trace and left the actual reply empty — `orchestrator.ts` now falls back
to an honest line instead of Proxy saying nothing; (2) `recall_facts`'s
own tool description used a specific, plausible-sounding example project
name ("...my Ledger project"), which the fast tier picked out of its own
tool schema and hallucinated into a whole invented backstory when asked
"what's up" — fixed by using a fully generic, non-proper-noun example
instead, plus extending `llm.ts`'s existing anti-overclaiming rule (never
say you did something a tool would be needed for) to cover memory
specifically, since the model was also claiming to have "noted" or
offering to "forget" facts with no write/delete tool to back either claim.

**Part E — browser automation — deferred by user choice.** No real
`browser_click` has succeeded. The user chose to keep the everyday
profile and defer browser automation, so no isolated profile will be
created. The failure is understood to involve Chrome's single-profile
launch behavior: Chrome only applies `--remote-debugging-port` on a
genuinely fresh process launch. The user's decision to defer automation is
documented here and in `decisions.md`.
The initial
scope was agreed through a full
conversation after real-machine testing showed the missing capability:
interacting with a webpage once it is open (for example, clicking play
after searching for music). Three original scope decisions were:

1. **Drives the user's real Chrome profile**, not an isolated one — more
   useful (real logins, no separate auth needed), higher stakes if it
   clicks the wrong thing.
2. **Confirmation only for committing actions** (submit/buy/delete/send),
   not every click/type — otherwise even "search and hit play" becomes a
   back-and-forth.
3. **Visible, not headless**, with an animated cursor (smooth movement via
   Playwright's `steps` option, plus a brief highlight ring at the click
   point) — the user explicitly wants to watch it work and be able to
   intervene in real time.

Architecture: Chrome only allows one process per profile, so this
ATTACHES via CDP (`chromium.connectOverCDP`, `playwright-core` — no
bundled browser download needed) to Chrome using the user's real profile.
`config/commands.json`'s `chrome` entry launches with
`--remote-debugging-port=9222`; if Chrome is already open without that
flag, Chrome can ignore the later launch request and CDP cannot connect.
The current implementation explains that failure, but the shared-profile
launch conflict is unresolved. A separate automation profile was
proposed as a fix, but would start logged out and reverse the earlier
choice to use the real profile. **Do not implement it until the user
explicitly confirms that change.**
The port number (9222) is duplicated between `commands.json` and
`browserAutomation.ts` on purpose, not made configurable — a JSON config
file can't read this file's constant or an env var, and the two having
to always match by hand is a worse footgun than a plain, well-known,
commented default.

Four new tools (`browser_navigate`, `browser_read_page`, `browser_click`,
`browser_type`), all `resultInformsNextStep: true` — every one returns a
numbered list of the page's current interactive elements (tagged
directly onto the DOM as `data-proxy-id`, so resolving a click target is
one attribute selector, not fuzzy text matching) as context for the
model's next decision, never something to speak verbatim — same "don't
dump raw tool output" lesson already logged for `get_system_usage`.
`browser_click`'s confirmation gate combines a keyword/element-type
heuristic (conservative on purpose — false positives just cost one extra
confirmation, false negatives could mean an unconfirmed purchase) with a
`may_commit` flag the model can set itself; either signal triggers
confirmation. The confirmation mechanism itself is Part B's exact
pattern, not a new one — a pending click resolved on a separate following
turn (see `runScript.ts`'s docblock for why) — with one difference: what's
"pending" is a reference to an element on a page that's still open and
unchanged, since the browser session persists between turns, so
confirming just clicks it as-is rather than re-running a multi-step plan.
The yes/no classifier itself was extracted from `runScript.ts` into a
shared `confirmationUtils.ts` once a second confirmation flow needed the
exact same behavior — two independent copies risked silently drifting
apart. `browser_type` deliberately has no "press Enter to submit" option
— a field that submits on Enter still needs a separate `browser_click` on
whatever triggers it, so every commit decision goes through the one
already-reasoned-through heuristic instead of a second, differently-
shaped guess for text fields.

15 new unit tests (`browserAutomation.test.ts`) mock `playwright-core`
entirely — there's no real Chrome in the sandbox — covering the
confirmation gate (keyword-triggered, `may_commit`-triggered, confirm/
deny/unclear resolution matching `runScript.ts`'s exact behavior) and
honest-failure paths (unreachable Chrome, stale element ID). The cursor
movement, click accuracy, and CDP attach have not yet been confirmed end
to end on the user's machine.

Real-machine testing surfaced one more thing worth remembering: Chrome's
`--remote-debugging-port` only applies on a genuinely fresh process
launch. If Chrome was already running (the common case - most people
leave it open), invoking it again just activates the existing window via
Chrome's single-instance handling and silently ignores the new flag,
even though `open_app`'s config correctly includes it. `browserAutomation.ts`
now distinguishes this from "Chrome isn't running at all" by checking for
a running `chrome.exe` (same `Get-Process` pattern `systemUsage.ts`
already uses) whenever the CDP connection fails, and gives the specific,
actionable fix (close every window completely, including background/tray
instances, then relaunch) instead of a generic "not reachable" message
that was technically true but not useful. 2 more unit tests cover both
diagnosis branches directly (mocking the process check), plus a test
confirming the diagnosis is only shown when the connection actually
dropped, not appended to an ordinary action-level failure on an otherwise
healthy connection.

Known, deliberately deferred: `DEFAULT_MAX_STEPS` (5, `orchestrator.ts`)
wasn't raised for browser tasks specifically, even though a realistic
multi-step flow (navigate → type → click → click again) can burn most of
that budget fast. Revisit if real testing shows it's cutting off
legitimate tasks partway — not changed speculatively here.

The current working tree also carries a TTS stop/cancellation fix awaiting
real-machine confirmation. Browser automation code remains present but is
not exposed to the model while the milestone is deferred.

**Gesture-to-action wiring** (the other original Part D item) — an
optional pinch trigger now invokes the voice trigger after the user turns
on the camera, hand tracking, and the separate pinch-trigger control. It
starts listening or cancels an active request; it does not launch apps or
send messages. Sensitivity and false positives need real-camera testing.

## Milestone 16 — iPhone integration — authenticated SMS receive path built

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

The app now has an optional authenticated local webhook (`POST
/api/iphone/sms`) and a `get_iphone_messages` tool. The listener starts
only when `PROXY_IPHONE_WEBHOOK_TOKEN` is configured and binds to
127.0.0.1 by default; it accepts only bounded JSON payloads with a valid
Bearer token and stores the latest 100 messages locally. The user still
needs to configure an iPhone Shortcut and an HTTPS tunnel/reachable
endpoint. No firewall changes, tunnel, or phone automation were configured
here. WhatsApp and remote unlock remain out of scope for the reasons above.

## Milestone 11 — Maps / location awareness — opt-in map tile view built, awaiting Windows confirmation

The user approved location access only after an explicit in-app action and
online map tiles. The dashboard map now requests browser location only
after “Enable location” is clicked, then renders the current area with
OpenStreetMap raster tiles and visible attribution. Its public tile policy
requires attribution, a stable identifiable app User-Agent, and cache use;
the app supplies its identity and leaves normal browser caching on. No
coordinates are queried at launch. The tile provider can infer the map area
from requested tile URLs. Windows Location Services, Electron permission
behavior, and tile rendering still require real-machine confirmation.
There is no place search, route planning, or background tracking yet.

## Milestone 12 — Bluetooth / connected devices — initial inventory tile built

The dashboard polls Windows PnP for currently-present Bluetooth and audio
endpoints and displays their names, device classes, and Windows status.
The label says “detected now” because `Get-PnpDevice -PresentOnly` does
not guarantee an active Bluetooth link or provide signal strength. The
panel reports an honest unavailable state if the Windows query fails.
This first slice has not yet been confirmed on the user's Windows machine.

This is the first implementation slice of the Connected Devices card. It
uses Windows PnP's `-PresentOnly` query for Bluetooth and audio endpoints,
reports the actual device names/statuses, and uses an explicit unavailable
or empty state. It is a presence inventory, not a signal-strength or
protocol-link monitor. Real Windows confirmation remains outstanding.

## Milestone 13 — Settings panel + persistent dashboard session history — done, confirmed

Right now all configuration is `.env`-only and the dashboard's session log
resets on every relaunch. A real settings UI and a persisted log (even just
a local JSON/SQLite file) would remove the last "everything resets" rough
edge. This is the dashboard's UI log persisting — not Proxy remembering
anything about the user (that's Milestone 10).

**Session log persistence — confirmed on the real machine.** Every
SESSION LOG card entry (`heard`/`routed`/`reply`/`status`/`error`) is now
mirrored to a flat local JSON file (`~/.proxima/session-log.json`,
`PROXY_SESSION_LOG_FILE` overridable, capped at 500 entries, oldest
pruned) through atomic same-directory writes and serialized appends as
it's rendered, and replayed on the next launch — with real
original timestamps, not "now" — separated from the new session's live
entries by a plain divider. `main.ts` never formats anything itself; it
mirrors the already-formatted `{kind, text}` pairs `renderer.js` already
rendered, so there's exactly one place (`renderer.js`) that decides how
an event reads. 7 unit tests (`sessionLog.test.ts`) cover load/append/
cap/clear logic against a real temp file. Confirmed via an actual
relaunch: history restored with real original timestamps, divider in the
right place. Also added, once confirmed: a small "Clear" button on the
SESSION LOG card (`clearLogHistory()`) — wipes both the on-screen log and
the persisted file, behind a native confirm dialog since it's
irreversible and the whole point of this feature is that history
survives a relaunch.

**Settings UI — built, confirmed working end to end.** The open design
question (did changing a setting take effect live, or only after
restarting Proxy?) was resolved in favor of restart-to-apply, matching
how nearly every env var here is already read once at module load time —
rearchitecting that everywhere for live reload was considered and
rejected as solving a problem this app doesn't have yet.

Settings are a modal overlay (button in the topbar), covering known
configuration values across Voice, Gmail, Assistant, Storage, and feature
groups added by later milestones. Saved values live in a separate flat JSON file
(`~/.proxima/settings.json`, `PROXY_SETTINGS_FILE` overridable) layered
OVER `.env` rather than rewriting `.env` directly — `.env` is a
hand-edited file with the user's own comments and formatting, and a
programmatic rewrite that only knows about 17 specific keys risked
mangling anything else in it. A blank field, saved, removes that key's
override entirely (falls back to `.env`) rather than persisting an empty
string — keeps `settings.json`'s content always exactly "what's filled
in, minus the blanks." Settings and memory also replace their JSON state
atomically so an interrupted write does not leave a partial file.

The one real subtlety, worth remembering if this ever seems to
misbehave: `core/settings.ts` applies the saved file's contents to
`process.env` as a MODULE-LEVEL side effect the moment it's imported —
same pattern `dotenv/config` itself uses, and for the same reason. It has
to be the very next import after `dotenv/config` in both `main.ts` and
`assistant.ts`, before anything that transitively imports `tts.ts`/
`gmail.ts`/etc., or those modules would capture their `process.env`
values before the override ever gets applied and every saved setting
would silently do nothing. Same shape of easy-to-reintroduce bug as this
session's `vi.hoisted()` testing lesson — see decisions.md.

Also cleaned up while in this area: the CAMERA card's title no longer
shows "Milestone 7 — hand tracking" — just "CAMERA." The milestone/
feature-name tag made sense while that card was new; it doesn't add
anything now that hand tracking has just been a normal, working part of
the dashboard for a while.

## Milestone 14 — Dashboard visual refresh — implementation present, awaiting real-machine confirmation

Triggered by the user sharing a reference image and a written wishlist.
Note: the *palette* this reference image inspired is already in
`style.css` (pinned back at Milestone 6) — this milestone is about pushing
the *execution* further toward the reference's polish/contrast/liveliness,
plus several independently-scoped fixes, not a new direction.

Implemented scope:
- **Sidebar navigation**: collapsed icon rail with working Dashboard and
  Settings controls plus links to the typed Chat input and existing Camera,
  Tools, Maps, Devices, and Memory panels.
- **Activity panel**: refined, not replaced (see Milestone 9 above) —
  friendlier row labels, same real event/timing rules.
- **Orb**: no change in direction — already correctly event-driven rather
  than a literal copy of the reference's static illustration.
- **Input box**: mic button invokes the same voice trigger as F9.
- **Busy input**: text submitted while busy is queued and surfaced in the
  dashboard, then processed after the current request.
- **Output, session log, monitor, and devices**: dashboard shows current
  event output and history, real CPU/RAM samples, and present-device
  inventory. Monitor/device panels may show unavailable until queried.
- ~~**Camera card**: drop the "Milestone 7 — hand tracking" tag, just
  "CAMERA" — more capabilities are coming to this card later.~~ — DONE,
  pulled forward ahead of the rest of this milestone (bundled into the
  Milestone 13 settings-panel patch instead of shipped alone).
- **Neural Network graph and Activity chart**: honest not-built placeholders,
  with no fabricated data.
- **TTS playback**: "can be made better" — real but loosely specified.
  Needs its own design pass (something like a waveform or speaking-state
  indicator is the likely direction) once we get here.
- Remaining: any further design work and real-machine visual confirmation.

## Milestone 15 — STT upgrade (Distil-Large-v3.5 + GPU) — runtime installed; inference confirmation pending

User asked to switch from `whisper-small.en` to Distil-Large-v3.5 and move
STT off CPU onto the GPU. The optional whisper.cpp path converts Proxy's
16kHz float samples to temporary PCM WAV, launches a configured executable
asynchronously, and cleans up the temporary file. `npm run setup:whisper`
downloads the official CUDA 12.4 Windows x64 build and Distil GGML weights,
verifying their published SHA-256 hashes. The installed executable opens
and reports its CLI options; running from the project root auto-detects
both assets. The current Transformers.js CPU path remains the fallback if
CUDA transcription fails. Real speech inference and GPU utilization
measurement remain unverified. The model's official GGML conversion is
described in the [model card](https://huggingface.co/distil-whisper/distil-large-v3.5-ggml).
Full investigation findings and tradeoffs: `decisions.md`.

## Deferred / not in MVP

- Voice wake word (parked — see `decisions.md` for the Picovoice/hotkey
  history).
- Absolute volume control ("set volume to 30%") — current implementation is
  relative only (up/down/mute via simulated media keys). Precise percentage
  control would need the Windows Core Audio API — deferred until actually
  needed.
- Targeting window commands at a *named* app ("snap Chrome left") rather
  than whatever's currently focused — see Known limitations below.

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
- The official whisper.cpp CUDA runtime and Distil GGML model are present
  under the ignored `models/` folder; a real speech inference still needs
  confirmation. The Transformers.js CPU path remains the fallback.
- STT still occasionally mishears words, though less than under base.en —
  not specifically re-tested since the model upgrade.
- Piper's voice is robotic/synthetic. ElevenLabs is available as an
  optional upgrade (falls back to Piper automatically if no API key is
  set) — reviewed and confirmed sound, currently dormant since no key is
  configured.
- **Found in real-machine testing, fixed and confirmed working**: the LLM
  would occasionally produce emoji, em/en dashes, and smart quotes in replies,
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
- **Found in real-machine testing, fixed and confirmed working**:
  `open_app`'s regex
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
  shot. Regression tests: `openApp.test.ts`, `browse.test.ts`. The
  remaining open question this entry used to flag — whether the model
  reliably picks the *right* tool and chains multi-step requests
  correctly once it gets a real shot at them — is now confirmed: "open
  chrome and open youtube," "open youtube on chrome and search for
  pewdiepie," and "open github" were all specifically retested on the
  real machine and route correctly.
- **Found in real-machine testing; code changes implemented, awaiting retest**: the
  fast tier appears to never actually escalate to the smart tier via
  `defer_to_planner` — the Activity panel consistently shows "deciding:
  fast tier" only. Confirmed two ways in this session: (1) the Gmail
  real-machine test's activity log showed a direct
  `heard → routed (LLM tool → get_emails) → reply` path with no smart-
  tier step; (2) asking Proxy to write a full Flappy Bird game produced a
  file and an opened window, but no working gameplay (no bird, no
  movement) — consistent with the entire game having been generated
  single-shot by the small, non-reasoning fast-tier model via `write_file`
  (a fire-and-forget tool — once called, its result is the final reply,
  no smart-tier review ever happens) rather than the fast tier
  recognizing the task needed real reasoning and deferring. Likely root
  cause: `write_file`'s tool description doesn't tell the fast tier
  where its own limits are — nothing currently instructs it to defer for
  anything beyond trivial file writes, so a small model overestimating
  its own confidence on codegen isn't surprising. This was deferred at the
  time; it has now been addressed more broadly: `write_file` recommends
  deferral for substantial code generation and is marked as informing the
  next step, so its result reaches the smart-tier loop. Directly informed two
  Milestone 10 Part D design choices (see `decisions.md`): the
  `recall_facts` tool accepted this same "will the model choose to call
  an optional tool" risk knowingly, and automatic memory-capture was
  deliberately routed to the smart tier rather than the fast tier for
  the same reason. **Update, same session**: confirmed this generalizes
  beyond `write_file` specifically — asking "you feel laggy" (a casual
  remark, not "give me full system stats") routed to `get_system_usage`
  and got the tool's entire raw formatted dump back verbatim (CPU%,
  memory breakdown, top processes by memory AND by total CPU time) as the
  spoken reply. Correct data, wrong length and tone for what was
  actually asked. Same root mechanism: any tool without
  `resultInformsNextStep` returns its own text as the final reply with no
  pass to actually compose an answer shaped to the question — not a
  `write_file`-specific quirk, a structural property of every current
  fire-and-forget tool (`get_system_usage`, `get_emails`, `write_file`,
  `open_path`). `get_system_usage` is now also marked as informing the next
  step so raw readings can be summarized to fit the request. The updated
  tool flow still needs focused real-machine confirmation.
- **Found in real-machine testing, fixed in code, not yet re-tested**:
  "who am i" got a rambling reply that doesn't know who's actually
  asking — addressed the user as an anonymous "someone who uses this,"
  not by name, and confusingly hedged between answering "who are you"
  instead. Root cause: `CREATOR_BIO` told the model Yatharth is "the
  creator" as a separate fact, but never said the person actually talking
  to Proxy right now IS Yatharth — the model wasn't connecting those on
  its own. Fixed by making that connection explicit in `CREATOR_BIO`
  directly (`llm.ts`), plus adding "sir" as a natural form of address —
  both hardcoded rather than derived, since this is a single-user
  personal project where that's simply always true. Not yet re-tested on
  the real machine — confirm "who am i" gives a real answer now.
- **Found in real-machine testing; responsiveness fix implemented, awaiting
  real-machine confirmation**: Electron previously became unresponsive
  during slow CPU Whisper inference. The Transformers CPU fallback now
  loads and transcribes in an Electron utility process (or a Node child
  process in CLI mode); the optional whisper.cpp path also runs in a child
  process. Worker errors reject pending requests and clear the process state so a later initialization can
  retry. This should leave Electron's main event loop available while the
  CPU model runs, but packaged-process loading, dashboard responsiveness,
  and real inference still need confirmation on Windows.
- **Found during this session's own patch verification, fixed and
  confirmed**: `npm test` was silently writing real files
  (`flappybird.html`, `games/snake.js`, `note.txt`, `script.py`) into the
  real default `~/ProxyWorkspace` on whatever machine ran it, every test
  run, for an unknown length of time before this — not the throwaway
  temp directory `fileTools.test.ts`'s own docblock describes. Root
  cause and fix: `decisions.md`'s test-writing-pitfall entries (this is
  the third instance of the same underlying bug class). Confirmed after
  the fix: a full `npm test` run no longer touches `~/ProxyWorkspace` or
  `~/.proxima` at all. Worth being aware this means past test runs, in
  this session and possibly others, may have left real files in that
  folder — nothing harmful was ever written (test fixture content only),
  but it's real disk state that didn't need to be there.
- The dashboard now queues typed input while busy and includes initial
  device/map panels. Those Windows-specific paths remain unconfirmed here.

## Milestone 17 — Packaging (Windows installer + auto-launch on startup) — installer built

The dashboard currently runs via `npm run dashboard` (dev-mode Electron
launch). A distributable NSIS installer is now built. Windows startup is an
opt-in Settings value (`PROXY_START_ON_LOGIN=true`) applied through
Electron's `app.setLoginItemSettings()`. Startup remains disabled by
default; the startup entry is applied only in a packaged build.

The two pieces are:
- **Packaging**: `electron-builder` (or `electron-forge`) to produce a
  real `.exe` installer, instead of running from source.
- **Auto-launch on Windows startup**: Electron has
  `app.setLoginItemSettings()` built in for exactly this — no registry
  editing needed, no third-party library.

Both pieces are implemented. `npm run package:win` successfully created
`installer/Proxima-0.1.0-x64.exe` (about 779 MB), including the CSG
controls. The NSIS installer itself has not been launched on this Windows
machine yet.

## Milestone 18 — Alternative activation: double-clap trigger — implemented, opt-in; calibration pending

The hotkey (F9) already works regardless of what app has focus — that's
existing behavior (Electron's `globalShortcut` is OS-level), not
something this milestone adds. This is specifically about a *second*,
additional way to trigger Proxy: two sharp claps within about a second,
detected continuously in the background, calling the same
`engine.runOnce()` (or `cancel()` if busy) the hotkey already calls.

The RMS clap detector is implemented behind the Settings opt-in
`PROXY_DOUBLE_CLAP_ENABLED=true` (off by default). It opens the mic only
when enabled, discards frames after checking amplitude, and stops the
listener before the normal VAD recorder starts. Two threshold-crossing
peaks in the configured window call the same voice trigger as F9. No audio
is transcribed or saved by the detector. Real-device false-positive and
sensitivity calibration remains; the numeric threshold can be adjusted
through Settings.

## Milestone 19 — System monitor (Task Manager tile + Proxy-queryable resource usage) — Part A done, confirmed; Part B built

Part A is an orchestrator query tool; Part B is a dashboard tile. Both
implementations are present. Part B awaits a clean Electron launch and
real-machine UI confirmation.

**Part A — `get_system_usage` tool — done, confirmed working on the real
machine.** Queries CPU%, memory
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

**Part B — dashboard monitor tile — built, awaiting real-machine
confirmation.** It samples every ten seconds through the same Windows
query used by the tool, renders CPU and memory bars and the top three
processes by memory and cumulative CPU time, and shows an unavailable
state rather than fabricated zeros when the query fails. “Top cumulative
CPU time” remains labeled honestly; it is not an instantaneous per-process
CPU percentage.

## Milestone 20 — 3D modeling assistant ("a personalized Blender") — starter CAD slice built

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

The dashboard supports importing STL/OBJ geometry, adding box, sphere, and
cylinder primitives, orbiting/zooming the scene, selecting/deleting an
object, on-screen move/rotate/scale gizmos, numeric position/rotation,
per-axis dimensions, and uniform-scale editing, geometry bounds/triangle/volume estimates, and
exporting ASCII STL. Gizmo manipulation also updates the numeric controls.
With no selection, the local smart model can compose a small assembly of up
to 12 supported primitives (boxes, spheres, cylinders) from a short request.
The main process validates each primitive's dimensions, position, and
rotation before adding any object. With a selection, it can translate
a short instruction into bounded position/rotation/per-axis-scale changes,
or round corners on a box primitive. The main process validates transforms
and caps the rounded-box radius before the scene changes. The selected rounded
box exposes its radius as an editable numeric parameter. Other geometry edits
do not execute arbitrary code and remain unsupported.
Before STL export, choose whether one scene unit represents a millimeter,
centimeter, or inch; export converts all coordinates to millimeters. STL has
no unit metadata, so the chosen conversion is stated in the UI after export.
The selected export scale is also sent with natural-language edits, allowing
explicit dimensions such as centimeters to be converted into scene units.
Position, rotation, scale, and resulting dimensions have bounded ranges.
Shift-click a second object to select a pair, then apply union or subtraction.
Boolean operations use `three-bvh-csg`, limited to 80,000 input triangles
per operation. The [upstream project](https://github.com/gkjohnson/three-bvh-csg)
describes the implementation as experimental: it expects watertight
two-manifold meshes and numerical edge cases can still produce invalid
results. Imported meshes may fail if open
or non-manifold; the editor does not claim print-ready output. OBJ material
files are not loaded. A user-triggered “Describe preview” button sends the
canvas image only to the configured local Ollama smart model; it describes
visible shape only, not measurements or print safety. Geometry measurement
reports bounds and a volume estimate in arbitrary scene units and does not
certify manifoldness or printability. For meshes up to 120,000 triangles,
measurement also reports edge closure/manifold counts, shared-edge winding,
degenerate faces, and connected components. STL vertices are welded with a
scale-relative tolerance for this diagnostic. These checks do not test wall
thickness, self-intersection, material, printer settings, or slicer behavior,
so the result is not a printability certification. Natural-language mesh
editing beyond this rounded-box primitive and text-to-3D generation remain.
WebGL interaction, vision-model
support, boolean geometry, and exported STL validity still need real-machine
confirmation.

## Milestone 21 — Personalized news — built, awaiting live feed confirmation

The dashboard now has a user-triggered news panel for BBC World/Asia RSS
headlines, with an optional comma-separated interest filter in Settings.
The `get_news` tool retrieves the same items and returns them to the local
model for a composed summary. Article text is treated as untrusted input.
No periodic polling or paid news API is used. The feeds and current
network response still need Windows confirmation. Interests remain
user-set; automatic interest capture from memory is not wired.

## Milestone 22 — Proxy can call your phone — outbound spoken-message slice built; provider setup pending

The first slice uses Twilio's Calls REST API with inline TwiML `<Say>`.
The model proposes an E.164 destination and exact message, then the engine
waits for a separate, explicit yes before placing the call. Credentials
are optional settings and are not present in this repo. No call has been
made or provider configured. Twilio documents this REST API and inline
TwiML input in the [Call resource reference](https://www.twilio.com/docs/voice/api/call-resource).
This first phase is a one-way spoken message, not a live AI conversation.
The wider interactive version remains a separate architecture branch:
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

Live conversational audio, inbound call handling, and call transcripts
remain unimplemented. The outbound tool still requires user provider setup
and a real-machine test; Twilio charges for completed calls.

## Personality/tone: FRIDAY-style address ("sir") — done

A few lines in `llm.ts`'s existing `PERSONALITY`/`CREATOR_BIO` constants,
not a new capability — no milestone needed. `CREATOR_BIO` hardcodes both
the "sir" form of address and that the person talking to Proxy IS
Yatharth (the project's own creator), not derived at runtime. Explicitly
acceptable per the user for a single-user personal project. This section
previously said "hasn't shipped yet" after the change had already landed
— decisions.md had the correct, current state; this section just hadn't
been updated to match. Confirmed live in the real session log too
(Proxy addressing the user as "sir" unprompted).

## Remaining completion gates

These are concrete external setup or real-machine checks, not open design
decisions. The user has authorized the map's opt-in location request and
online tile use, deferred browser automation while keeping the everyday
Chrome profile, and asked for phone calling to be implemented without
configuring its provider yet.

- **Gmail OAuth**: set all three `GMAIL_*` values, run `npm run
  setup:gmail`, then restart and verify a real inbox query.
- **Stock quotes**: add `ALPHA_VANTAGE_API_KEY` in Settings and verify one
  ticker query. The free tier is limited to 25 requests/day and the default
  quote is end-of-day; real-time US data is a paid service.
- **Real Windows checks**: launch the packaged/development app and verify
  the recent dashboard navigation, map tile request, device inventory,
  monitor, news refresh, pinch trigger, double-clap calibration, 3D
  WebGL/import/export behavior, and whisper.cpp speech inference/GPU use.
  Build success alone does not confirm
  hardware or online integrations.
- **iPhone Shortcut/tunnel**: configure a random webhook token and an
  HTTPS endpoint, then verify delivery from the phone. The listener is
  bound to localhost by default and does not expose a public endpoint.
- **Outbound calls**: add Twilio credentials and verify only when the
  user is ready to incur provider call charges. No call has been placed.
- **Windows installer**: the NSIS installer is built; install and launch
  it once to confirm the packaged app and optional startup setting.
- **Milestone 20 scope**: primitive import/editing, boolean CSG, and
  natural-language primitive/transform edits and rounded-box corner edits
  are implemented; bounded topology diagnostics are implemented; broader
  mesh editing and additional CAD/print-analysis capabilities remain.
- **Known product limits**: tool-result composition and CPU STT worker
  isolation are implemented; both still need focused real-machine
  confirmation. Smart-tier escalation quality also needs interaction-level
  confirmation after the tool-description updates.
