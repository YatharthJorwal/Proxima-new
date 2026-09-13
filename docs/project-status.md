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
7. Computer vision / gesture input — first slice (detection + visualization
   only) done, confirmed working; gesture-to-action wiring deferred to
   Milestone 10
8. ~~Voice activity detection (VAD)~~ — done, confirmed working
9. ~~Task orchestration / multi-step tool calling~~ — **done, confirmed**
   (all 7 steps, including step 7's real-machine test cases), see
   detailed status below
10. Agentic capabilities (file tools, code execution, gesture wiring,
    external data, memory) as orchestrator tools — **in progress**, see
    detailed status below. Parts A and B (file tools, code execution)
    confirmed working; Part C (external data) started (Gmail slice
    built, not yet real-machine tested — needs your OAuth setup + a real
    test); Part D (memory) started (automatic-capture slice built, not
    yet real-machine tested; gesture-to-action wiring not started).
11. Maps / location awareness — not started
12. Bluetooth / connected devices — not started
13. Settings panel + persistent dashboard session history — **in
    progress**: session log persistence built, not yet real-machine
    tested; settings UI not started
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
    Part A (the tool) done, confirmed working; Part B (the sidebar tile)
    blocked on Milestone 14
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

**Part C — external data (stock prices, Gmail) — Gmail slice built, not
yet real-machine tested; everything else in this part still just
researched, not started.** Gmail was picked as the first slice to
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

Everything else researched for this part (see `decisions.md` for the
full findings — searched rather than assumed, since this matters for
what's actually buildable):
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
- **Gmail** — the easy one, and the one built (see above). Official
  Gmail API, standard OAuth2, reading and searching messages is exactly
  what it's designed for. No caveats.
- **Apple Stocks app** specifically — not a real integration target.
  Apple doesn't expose the Stocks app to third parties at all; "stock
  data on the PC" means a real market-data API (above), not pulling from
  the iPhone's own Stocks app.

Recommendation, updated now that Gmail is built: prove the pattern held
(confirm the real-machine test above), then Groww is the natural next
source once there's an actual portfolio to point it at — no Groww
portfolio exists yet, so that piece stays exactly where it is in the
roadmap until there's a real one.

**Part D — memory — confirmed on the real machine, two real bugs found and fixed.**
Scoped in conversation first (see `decisions.md` for the full design
record, including two deliberate reliability tradeoffs taken on
knowingly): facts, preferences, and project context are captured
**automatically** — a background smart-tier call looks at each completed
interaction after the user has already heard their reply and decides if
anything durable is worth keeping, storing it in a flat capped local
JSON file (`~/.proxima/memory.json`, `PROXY_MEMORY_FILE` overridable,
30-entry cap, oldest pruned first). No manual `remember_fact`/
`forget_fact` override in v1 — a bad automatic capture just sits in the
list until pruned, a real known limitation, confirmed painfully in real
use, not solved here. Recall happens through a `recall_facts` tool the
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

**Part E — browser automation — done, confirmed working, real-machine
tested via cursor-visible clicks.** Scoped through a full conversation
(not defaulted on) after real-machine testing showed the actual limit
wasn't "the model can't reason," it was "there's no tool for interacting
with a webpage once it's open" (the concrete example: "play music by my
mood" — `browse.ts` can open a search page, but nothing could click
play). Three real decisions, asked rather than assumed, same posture as
Part B's confirmation mechanism:

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
bundled browser download needed) to an already-running Chrome rather
than launching a competing instance. `config/commands.json`'s `chrome`
entry now launches with `--remote-debugging-port=9222` (see `launch.ts`'s
new optional `args` parameter, additive and backward-compatible with
every existing plain-string app entry) so saying "open chrome" always
sets this up correctly; if Chrome's already open without that flag,
`connectOverCDP` fails and the tool says so honestly rather than hanging.
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
honest-failure paths (unreachable Chrome, stale element ID). What's real-
machine confirmed, not sandbox-testable: the actual cursor movement,
click accuracy, and CDP attach against a real running Chrome.

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

**Gesture-to-action wiring** (the other original Part D item, a
Milestone 7 CV follow-up) — still not started, still not scoped.
Distinct from the dashboard's session-log persistence in Milestone 13,
which is just the UI log surviving a relaunch, not the LLM knowing
anything.

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
pruned) as it's rendered, and replayed on the next launch — with real
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

Settings are a modal overlay (button in the topbar), covering all 17
known configuration values across four groups (Voice, Gmail, Assistant,
Storage, Voice detection). Saved values live in a separate flat JSON file
(`~/.proxima/settings.json`, `PROXY_SETTINGS_FILE` overridable) layered
OVER `.env` rather than rewriting `.env` directly — `.env` is a
hand-edited file with the user's own comments and formatting, and a
programmatic rewrite that only knows about 17 specific keys risked
mangling anything else in it. A blank field, saved, removes that key's
override entirely (falls back to `.env`) rather than persisting an empty
string — keeps `settings.json`'s content always exactly "what's filled
in, minus the blanks."

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
- ~~**Camera card**: drop the "Milestone 7 — hand tracking" tag, just
  "CAMERA" — more capabilities are coming to this card later.~~ — DONE,
  pulled forward ahead of the rest of this milestone (bundled into the
  Milestone 13 settings-panel patch instead of shipped alone).
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
- **Found in real-machine testing, deferred by request, not fixed**: the
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
  its own confidence on codegen isn't surprising. **Not fixed** — the
  user explicitly chose to defer this and address tool-description limits
  more broadly later (across this tool and future ones) rather than
  patch `write_file` in isolation right now. Directly informed two
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
  `open_path`). Still deferred by request, same broader tool-limits pass
  as above.
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
- **Found in real-machine testing, not fixed, needs a real architecture
  decision**: Electron became unresponsive (Windows' standard "not
  responding" dialog, wait/close) twice during this session's testing.
  No confirmed root cause (not reproduced/profiled directly), but the
  code gives a strong candidate: `stt.ts`'s `transcribe()` runs Whisper
  inference via a direct `await transcriber(audio, ...)` call - no
  worker thread, no `utilityProcess.fork()`, no child process - and it's
  invoked from `engine.ts`, which runs in Electron's own main process
  (instantiated directly in `main.ts`). The logged transcription time
  that session was 16.8 seconds; a CPU-bound native ONNX inference call
  of that length blocking the main process's own message loop is exactly
  what triggers Windows' unresponsive-app detector, and matches the
  reported symptom precisely. If this is confirmed, the real fix is
  moving STT inference off the main process entirely (a worker thread or
  Electron `utilityProcess`) - a genuine architecture change, not a
  one-line patch, so this is logged as a finding to revisit deliberately,
  not fixed here. Worth deliberately triggering a slow transcription
  again and watching whether the dashboard UI (not just voice) also
  freezes during it, which would confirm the main-process-blocking
  theory versus some other cause.
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

## Milestone 19 — System monitor (Task Manager tile + Proxy-queryable resource usage) — Part A done, confirmed; Part B blocked on Milestone 14

Split once actually scoped, since the two halves turned out to have
different feasibility: a live hardware-usage sidebar tile (Part B)
genuinely can't be built yet — there's no sidebar to put it in, that's
Milestone 14's job, still not started. The orchestrator tool (Part A)
doesn't have that dependency, so it shipped on its own.

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
Milestone 10 Part D (memory)'s automatic-capture slice, now built
(pending real-machine confirmation — see the Milestone 10 section
above); until that's confirmed working end-to-end, or if you'd rather
not wait, this ships in a simpler form — a static, user-configured
interest list (similar in spirit to `config/commands.json`) - still real
and useful, just less automatic than the end state. One of the more
straightforward items on this roadmap: no new architecture, no ongoing
cost, composes cleanly with what Milestone 14 already has planned for
the sidebar.

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

## Open questions (need your input)

- **Milestone 10 Part C, Gmail slice**: the real-machine test came back
  "Gmail isn't connected yet" — the tool's own honest not-configured
  reply, not a real answer. Most likely cause: `GMAIL_REFRESH_TOKEN`
  never made it into `.env` after running `npm run setup:gmail`, or the
  app wasn't restarted after editing `.env`. Worth double-checking all
  three `GMAIL_*` values are actually in `.env` and restarting before
  retrying "do I have any new emails."
- **Milestone 10 Part D, memory slice**: try it for real once you've
  had a few ordinary interactions with Proxy — check
  `~/.proxima/memory.json` (or wherever `PROXY_MEMORY_FILE` points) to
  see what it's actually capturing, and try asking something
  `recall_facts` would need to answer (e.g. "what do you know about my
  <project>"). Only mocked/unit-tested so far, not confirmed against a
  real Ollama call end-to-end.
- **Milestone 10 workspace folder**: `write_file`/`open_path` default to
  `~/ProxyWorkspace` if `PROXY_WORKSPACE_DIR` isn't set. Now confirmed
  working at that default — flagging only in case you'd rather point it
  somewhere else (a synced folder, a specific project directory, etc.).
- **Tool-limits pass (deferred, narrowed)**: two findings still waiting
  on the same later pass — (1) the fast tier never deferring to the
  smart tier (Flappy Bird / Gmail activity-log finding), (2) fire-and-
  forget tools returning raw, unscoped output regardless of how the
  question was actually phrased (`get_system_usage` yapping full stats
  at a casual "you feel laggy"). The third item that used to be grouped
  here — hardcoding "sir" + the user's identity into `PERSONALITY` — is
  now done (see `decisions.md`); it turned out small enough not to need
  the broader pass after all. (1) and (2) still share a root mechanism —
  see Known Limitations above and `decisions.md` — and Milestone 10 Part
  D's `recall_facts`/automatic-capture design already had to account for
  (1)'s risk.
- **Electron "not responding" during STT** (see Known Limitations above):
  a real architecture change if the main-process-blocking hypothesis is
  right (moving `transcribe()` off Electron's main process), not
  something to patch reflexively. Worth deliberately reproducing first —
  trigger a slow transcription and check whether the dashboard UI itself
  also freezes — before committing to a fix approach.
- **Milestone 15 go-ahead**: do you want to proceed with the whisper.cpp +
  CUDA + Distil-Large-v3.5-ggml path? It's a real architecture change (new
  native module, new model format, `stt.ts` rewrite), not a quick patch —
  see `decisions.md` for the full investigation before deciding.
