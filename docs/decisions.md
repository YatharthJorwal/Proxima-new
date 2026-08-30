# Decisions

Why things were built the way they were, including alternatives that were
considered and rejected. For current status see `project-status.md`; for
how the current implementation actually works see `architecture.md`.

## Language: Python → TypeScript/Node

The project was originally scaffolded in Python. Switched to
TypeScript/Node per the user's preference before Milestone 2. No further
Python code exists in the project.

## Trigger mechanism history

Several trigger mechanisms were tried, in this order, before landing on the
current setup:

1. **Voice wake word (Picovoice Porcupine)** — built-in "Jarvis" keyword,
   required a free Picovoice AccessKey. Dropped after discovering Picovoice
   requires a company email / discontinued its free tier for non-commercial
   individual use in mid-2026.
2. **Global hotkey via `node-global-key-listener`** — its background
   key-hook binary got blocked/removed on the user's machine, likely by
   antivirus.
3. **Plain Enter-keypress in the terminal** (Node `readline`) — adopted as
   the simplest reliable option once both of the above failed. This is why
   window-control commands on the CLI path need the user to Alt-Tab to
   their target app (see Known Limitations in `project-status.md`) — the
   terminal has to be focused to hit Enter.
4. **Electron's `globalShortcut` API (F9, default)** — added at Milestone 6
   once the project was already committing to an Electron shell for other
   reasons. Unlike `node-global-key-listener`, `globalShortcut` isn't a
   standalone background key-hook binary, so it isn't the shape of thing AV
   heuristics tend to flag. This also fixed the window-control
   focus-timing limitation from the CLI path, as a side effect, since a
   true global hotkey doesn't require focusing the terminal.

Mic capture (`@picovoice/pvrecorder-node`) was kept throughout this
churn — it's a plain audio-capture utility, not gated behind an account
the way Porcupine (the wake-word engine) was, so it never needed to be
replaced.

General principle this reinforced (now in `CLAUDE.md`): prefer options with
no extra native binaries/background processes when a simpler alternative
exists, since those tend to trip antivirus or platform quirks. Applied
again at Milestone 3: volume and window control both use inline C#
compiled on the fly via PowerShell's `Add-Type` (calling standard
`user32.dll` Win32 functions), rather than installing a dedicated
automation module or binary — see "PC automation approach" below.

## STT: model choice and the DirectML GPU attempt

Upgraded from `base.en` to `whisper-small.en` for accuracy — `base.en` was
mishearing words (e.g. "Discord" as "this code"). A GPU acceleration
attempt via DirectML (`device: "dml"`) was tried: it loads fine, but
Whisper's autoregressive decoding loop reproducibly comes back with zero
output tokens on this execution provider (`"token_ids must be a non-empty
array of integers"` on every request). Reverted to CPU for correctness.

Investigation later confirmed via `ollama ps` / `nvidia-smi` that the LLM
was already running 100% on GPU — it was never the latency bottleneck. STT
(CPU-only) and the old fixed 4-second recording window (fixed by VAD,
Milestone 8) were the real contributors to perceived latency.

### Milestone 15 investigation: Distil-Large-v3.5 + real GPU acceleration

User asked to switch from `whisper-small.en` to Distil-Large-v3.5 and move
STT off CPU onto the GPU (RTX 3060, currently idle for STT). Both halves
were investigated properly rather than assumed:

- **The model swap alone is real and easy**: `distil-whisper/distil-
  large-v3.5-ONNX` exists, and its usage example is a literal drop-in for
  the existing `pipeline()` call in `stt.ts` — same API, different model
  string.
- **CUDA is not available on this stack on Windows — verified from the
  installed library's own source, not assumed.** `@huggingface/
  transformers` v3.8.1 (the actual installed version) has a literal
  compatibility table in its bundled code: CUDA is only supported on Linux
  x64; Windows only ever gets DirectML or CPU. Requesting `device: "cuda"`
  on Windows throws `Unsupported device` immediately — a hard platform
  wall, not a graceful fallback.
- **DirectML — the only GPU option this library offers on Windows — is the
  same thing already tried and reverted.** That bug is architectural (any
  Whisper-shaped model has the same decode-loop structure), so retrying it
  with Distil-Large-v3.5 would very likely hit the identical wall — not
  attempted, since the diagnosis is already known and repeating a
  known-failed experiment isn't a good use of time.
- **The accuracy trade, quantified as honestly as the evidence allows**: no
  single authoritative source directly compares whisper-small to
  Distil-Large-v3.5 (Distil-Whisper's own benchmarks only compare against
  full Whisper-large variants). What's solid: Distil-Large-v3.5 performs
  within about 1% WER of Whisper large-v3 on out-of-distribution audio.
  Whisper's own published benchmarks put small.en's realistic-world error
  rate meaningfully higher than large's (roughly double, on the more
  realistic multi-dataset benchmarks OpenAI itself used, versus a much
  smaller gap on clean audiobook-quality speech). Net: a real accuracy
  upgrade, plausibly cutting the error rate roughly in half in realistic
  conditions — a reasoned estimate from the numbers that do exist, not a
  published number for this exact pair of models.
- **The speed trade is more nuanced than "3x the parameters, 3x slower"**:
  Distil-Whisper keeps the full large-v3 encoder (frozen, undistilled) but
  shrinks the decoder to 2 layers (vs. whisper-small's 12). For short
  voice-command-length audio, the encoder pass is the fixed-ish per-request
  cost (Whisper always processes a 30-second window internally regardless
  of speech length) and it's meaningfully bigger here — but the decode
  loop, which parameter-count comparisons usually assume dominates, is
  actually lighter than whisper-small's. No confident number exists for
  this specific pair on short audio; this genuinely needs a real-machine
  benchmark once built, not a projection.
- **The actual path to real GPU speed, found and verified feasible**: drop
  `@huggingface/transformers` for a Node binding around whisper.cpp (mature,
  proven CUDA support on Windows, unlike DirectML) — `nodejs-whisper`
  (actively maintained, a plain `withCuda: true` option) or
  `whisper-node-addon` (prebuilt Windows x64 binaries, built for Electron,
  recently added CUDA backend binaries) are both real, current candidates.
  Distil-Large-v3.5 already has an official GGML conversion
  (`distil-whisper/distil-large-v3.5-ggml`, published by the Distil-Whisper
  team itself) — meaning both halves of what the user wants are achievable
  together, just not through the currently-installed library.
- **Why this isn't a quick patch**: it's a dependency swap (new native
  module instead of `@huggingface/transformers`), a model format change
  (GGML instead of ONNX), and a rewrite of `stt.ts` around a different API
  shape — a real architecture decision for a subsystem that's currently
  working. Recommended direction: pursue the whisper.cpp + CUDA +
  Distil-Large-v3.5-ggml path as its own properly-scoped piece of work,
  the same way Milestone 9 got a design pass before any code. Pending the
  user's explicit go-ahead given the size of the change.

Also fixed along the way: a TypeScript complexity error (TS2590) in
`stt.ts`, resolved by typing the transcriber as `any`.

## TTS: Piper default, ElevenLabs optional

Piper (local) is the default — zero cost, works offline. The user added
ElevenLabs support to `tts.ts` himself: if `ELEVENLABS_API_KEY`/
`ELEVENLABS_VOICE_ID` are set in `.env`, it's used (falling back to Piper on
any failure); if unset, behavior is unchanged — Piper only. Not currently
paying for ElevenLabs; the code path is kept in for if an API key is
obtained later.

## PC automation approach

Windows automation goes through `child_process` (PowerShell): open-app uses
`Start-Process`; volume and window control use inline C# compiled on the
fly via PowerShell's `Add-Type`, calling standard `user32.dll` Win32
functions. This avoids native module build issues common with `robotjs` on
Windows, and avoids installing extra PowerShell modules just for relative
volume/window control.

## Command routing: two-stage regex + LLM

Deterministic regex first (`commands/index.ts`) — instant, zero LLM
latency, stays the fastest path for exact-phrase commands like "open
notepad." LLM tool-calling (`intentRouter.ts`, then Milestone 9's
orchestrator) is the fallback for fuzzier phrasing ("bring the volume to
30") that the regex router can't catch. This means common commands stay
instant while fuzzy/varied phrasing doesn't just fall through to plain,
command-unaware conversation.

## Dashboard-before-CV reordering

Originally planned as CV (Milestone 6) then Dashboard (Milestone 7).
Swapped after discussing scope with the user. Reasoning: the dashboard
delivers real value with zero CV work (a live view of Proxy's
transcription → routing → execution → reply), is a natural extension of
the existing Node/TS stack rather than a new Python bridge, and
incidentally fixes the window-control focus-timing bug via Electron's
`globalShortcut`. CV slots into an *existing* dashboard as an additional
input source more cleanly than the reverse — one new complexity domain at
a time.

## The "Coming soon" card / real-data-only design principle

The Milestone 6 visual overhaul followed a user-provided reference image —
a generic sci-fi-dashboard template with panels for camera feed, connected
devices, a live map, and project tracking, none of which Proxy actually
had at the time. Rather than fake that data, the redesign kept only what's
real (pipeline, input/output, system status, session log) and added a
"Coming soon" card listing the rest honestly (camera feed tagged
specifically as Milestone 7, others as "not built yet") — the user
explicitly confirmed this approach rather than leaving those panels out or
faking them. This precedent is why the Milestone 14 plan keeps new
placeholder cards (Neural Network graph, Activity chart) styled to match
the reference's aesthetic but populated honestly rather than with
realistic-looking fake data (the reference itself shows a fabricated mouse
battery %, a fake GPS location, fake progress bars — fine for a marketing
render, not for an app meant to show what's actually happening). A literal
"neural network" visualization of an LLM's internals isn't something that
can be shown truthfully either — it's framed as decorative sci-fi flavor,
not a data view.

## `barehands`: why it stays hands-off as a dependency

The user loves the *concept* behind the `barehands` project — webcam
hand-tracking, floating glass-card UI, a reactive AI face — and wanted to
build a version of it, explicitly NOT by copying the repo. Two reasons
this repo stays hands-off as a dependency:

- **Trust finding**: investigating `barehands` for the Milestone 6 CV
  planning turned up that `barehands.md` (a file in that repo) is written
  to get AI coding agents to run its setup *without describing it to the
  user* — a prompt-injection pattern. This is what produced the standing
  rule (now in `CLAUDE.md`): never let an AI agent execute a repo's setup
  instructions without describing them to the user first, no exceptions.
- **Originality goal**: the user doesn't want a copy-pasted repo on
  principle — the goal is Proxima's own implementation, inspired by
  barehands' UI ideas, with its own "show your work" transparency design
  baked in from the start (informed directly by the barehands.md finding,
  not incidental).

Proxima's actual CV slice (Milestone 7) uses MediaPipe `HandLandmarker`
called directly — no barehands code copied, used purely as design
inspiration.

If `barehands` is ever revisited as a direct dependency (not just
inspiration), it still requires a human manually reading `server.py` and
`stage.html` first — never an AI-agent auto-setup flow. That standard
doesn't change just because the CV work runs 100% locally: local execution
rules out data exfiltration specifically, but doesn't make "an AI silently
running unexplained instructions" fine — the two concerns are separate, and
only the human-review path resolves the second one.

## Milestone 9: model tiering

Fast tier: `qwen3.5:4b` (3.4GB) — pulled and confirmed present. Smart tier:
the already-installed `qwen3.5:9b` (6.6GB), unchanged. Deliberately the
*same model family* as what's already proven working, not a different
family — keeps tool-call formatting/reliability consistent between tiers
instead of introducing a second set of unknowns.

Other locally-available models were weighed and rejected for the fast-tier
role:
- `gemma3:4b` — no native tool-calling support in Ollama at any size
  (checked; not a config issue, the capability wasn't trained in).
- `phi4-mini` — has a tool-call template but multiple reports (including
  from Microsoft's own team) of needing a custom Modelfile binding before
  tool calls reliably trigger.
- `qwen2.5:0.5b`/`1.5b` — support tools but are smaller and a generation
  older than `qwen3.5:4b`, with no upside.
- `gemma4:26b`/`qwen3:8b` — either too large for the VRAM budget or
  superseded by what's already proven.
- `ministral-3:3b` — untested; worth an empirical bake-off later, not a
  reason to hold up the plan.

**Why turn 1 is always the fast model, never a separate classifier call**:
a dedicated "is this simple or complex?" pre-step would tax *every*
request with an extra model call, including "hello" — the exact case
that's supposed to feel instant. Letting the fast model's own first
response double as the routing decision (reply / confident tool call /
defer) means the common case pays for exactly one call, same as today.

**VRAM plan**: 6.6GB + 3.4GB = 10GB of the RTX 3060's 12GB, before KV
cache/context and whatever the dashboard's own GPU usage is (canvas orb,
hand-tracking). Workably close but not assumed blindly — v1 plan is to
*not* force both models resident (no `keep_alive` pinning): the fast model
stays warm since it's used every request, the smart model loads on demand
for the rarer escalated requests, paying a one-time load delay only then.
If that swap latency turns out annoying in real use, the documented
fallback is `qwen3.5:2b` (2.7GB) for the fast tier, giving more headroom to
pin both resident. Real answer comes from testing on the actual machine
(`ollama ps` / `nvidia-smi`), not from guessing further.

## Milestone 9: "thinking" made honest instead of decorative

Ollama's chat API has a native `think` parameter (`true`/`false`/a level),
and `qwen3.5` models support it — the response comes back with
`message.thinking` (the actual reasoning trace) separate from
`message.content`. Fast-tier calls use `think: false` (matches "doesn't
overthink"); smart-tier calls use `think: true`. **Built, Milestone 9 step
6**: the dashboard's Activity panel shows this as a real, expandable
"Show reasoning" toggle on whichever Deciding row produced a trace — the
model's actual reasoning trace, not a fabricated "AI is thinking..."
spinner. Shown after the fact rather than streamed live — `chat()` in
`llm.ts` isn't a streaming call, so there was nothing to stream even if
the UI wanted to; this resolves what was previously an open detail
("streamed vs. shown after the fact — decided when this is actually
built").

## Milestone 9: personality baseline pulled forward from Milestone 10

Diagnosed why replies currently feel flat: `llm.ts`'s `TOOL_SYSTEM_PROMPT`
literally says "You have tools available to control the user's PC: opening
apps, adjusting volume, and controlling the currently focused window" —
when the model doesn't know what else to say, it paraphrases its own
instructions back, which reads exactly like the canned "I can adjust
volume, open this, etc." the user flagged. Since `llm.ts` is being
rewritten anyway for the two-tier setup, a real personality pass and a
short static creator bio are shipping as part of Milestone 9 rather than
waiting for Milestone 10. What stays in Milestone 10 is specifically
*dynamic*, memory-driven personalization (referencing things Proxy learns
over time) — Milestone 9 only ships the fixed baseline. **The
personality/bio copy shipped in step 1** — this was an open item early in
Milestone 9 but is resolved now (see `llm.ts`, and `project-status.md` for
confirmation it's no longer pending).

## Milestone 9: cancellation shipped narrower than "spoken stop"

The plan (informed by the external architecture review below) called for
"a minimal way to interrupt a stuck/long-running loop (a second hotkey
press or spoken 'stop')." What actually shipped, step 6: a second hotkey
press (Electron), a second Enter press (CLI), or typing the literal word
"stop" into the dashboard's Input box while busy — all three call
`ProxyEngine.cancel()`, which forwards to `Orchestrator.cancel()`.

Two deliberate scope decisions inside that:

- **Loop-boundary cancellation, not mid-request.** `cancel()` sets a flag
  checked only at the top of the orchestrator's next loop iteration — an
  Ollama call or a tool execution already in flight still runs to
  completion. True mid-flight abort would need an `AbortController`
  threaded through the `ollama` client and every tool executor
  (`dispatchTool`), which is real, separate complexity beyond what "a
  minimal cancellation path" (the plan's own words) called for. Worth
  revisiting if real use shows the lag between pressing cancel and it
  actually taking effect matters in practice.
- **Typed "stop" instead of true spoken interruption.** Recognizing the
  word "stop" spoken out loud *while Proxy is still mid-pipeline* would
  need a second, always-on audio channel running in parallel with the
  main recording/STT one — a genuinely separate subsystem, not a small
  addition to the existing one-mic-at-a-time pipeline. Typing "stop" into
  the dashboard's existing Input box was the practical stand-in: it
  reaches the same outcome (a way to interrupt a running loop without the
  hotkey) without inventing new audio infrastructure. The CLI has no
  typed-text channel at all, so it only gets the second-Enter-press path.

## Milestone 9: tool schema field additions

- `resultInformsNextStep?: boolean` (default `false`) — marks a tool whose
  result the model needs to reason about before deciding what's next. None
  of today's tools need this; it's forward-looking for Milestone 10-era
  "check X" style tools. Escalation from the fast to the smart tier happens
  automatically when this flag is set — structural, not dependent on the
  small model correctly self-assessing that it needs to escalate.
- `requiresConfirmation?: boolean` (default `false`) — a confirmation-gate
  hook. Built now, unused now: nothing in the current tool set (open app,
  volume, window, browse) is destructive enough to need an "are you sure?"
  round trip. Exists so a future tool (delete file, send email, etc.) can
  flip it on without redesigning the loop. Deliberately not building the
  interactive confirm-and-wait UX yet, since there's no current consumer
  for it.
- `defer_to_planner` — a lightweight tool exposed only to the fast-tier
  model, its escape hatch for "this needs more thinking than I should
  attempt," used as a fallback alongside the structural
  `resultInformsNextStep` escalation trigger.

## Milestone 9: external architecture review, reconciled

The user brought a 20-point architecture review (independently written) for
a gut check before finalizing the Milestone 9 plan. It was checked point by
point against the actual code rather than taken at face value:

- **Already true, the review didn't know it**: the Pipeline/Log the
  dashboard already has *is* the "observability panel" it proposed;
  `RouteInfo` already covers most of a proposed `RouteDecision` type; CLI
  and dashboard already share one `ProxyEngine`; TTS already proves the
  "swappable provider" pattern works when actually needed.
- **Already this plan, good independent confirmation**: its routing
  hierarchy (regex → small model → escalate to big model) matches ours
  closely. Its own stated priority ("optimize for latency") also confirms
  the call that the fast tier should execute directly when confident, not
  just classify — a classify-only fast tier would force a second model
  call even for "hello."
- **Adopted, elevated into Milestone 9 rather than deferred**:
  *cancellation* — right now a trigger while `busy` is just dropped
  silently; that gets worse once a single interaction can mean a
  multi-step loop plus a "thinking" pass, so a minimal interrupt was added
  to the safety-surface list. *A thin testing slice* — there are currently
  zero tests in the repo, and the orchestrator's branching (step cap,
  escalation, defer, multi-tool dispatch) can't be verified by
  typecheck+build alone, and can't be functionally verified in the sandbox
  either (no mic/GPU/Ollama there). Mocked unit tests for the loop's
  control flow are part of the build order specifically so patches can be
  verified as *correct*, not just "compiles," before being handed over.
- **Real, good, correctly scoped for later (not blocking Milestone 9)**:
  memory and session/task continuity are Milestone 10 as already planned —
  the review's version is the same idea with sharper vocabulary, not new
  scope. System tray / background runtime is a confirmed real gap (closing
  the dashboard window currently calls `app.quit()` on Windows, killing the
  engine and hotkey too) but it's its own project, not part of this one.
  Renderer modularization is legitimate (`renderer.js` is ~2,000 lines and
  Milestone 9 adds more to it) but sequenced *after* Milestone 9's UI work
  lands, not during — and without adopting a framework, which would cut
  against the project's "boring and vanilla" stance.
- **Rejected or explicitly held**, because they cut against decisions
  already made for real reasons: a cloud-model escalation tier beyond the
  local smart model breaks the local-first premise the entire project is
  built on, for a capability nothing asked-for actually needs — not
  adopted. Manually benchmarking alternate GGUF quantization levels is
  premature optimization before the default-quant two-tier setup has even
  been tried once, and slightly self-contradicts the review's own "don't
  assume you need to requantize" caveat two lines earlier. A full
  READ/WRITE/DANGEROUS permission taxonomy with sandboxing/prompt-injection
  threat modeling isn't justified by anything in the current or planned
  tool set — the `requiresConfirmation` boolean already in the plan is the
  right-sized seed to grow from when a genuinely dangerous tool shows up,
  not before. A generalized plugin SDK — the review flags this as
  premature itself; agreed.

## Milestone 9 (post-wiring): regex fast path answering confidently wrong instead of falling through

Found in real-machine testing, after step 6 landed: `open_app`'s regex
fast path (`OPEN_PATTERN` in `openApp.ts`, matches any "open X" phrase)
was intercepting requests it had no business claiming — a compound
request ("open chrome and open youtube"), a request for a real,
configured `browse.ts` site with no app equivalent ("open github") — and
answering with a canned "I don't have X set up to open yet" instead of
returning `null` and letting the router chain (regex → the orchestrator)
take a real shot. Root cause was structural: this regex handler runs
before any LLM is ever consulted, and previously treated "not in
`commands.json`" as a confident terminal answer rather than "not
confidently mine, let something smarter try."

**Fix**: `tryHandleOpenApp` (and `tryHandleBrowse`, same pattern, same
bug) now checks whether the extracted name is actually a known key
*before* calling `executeOpenApp`/`executeBrowse` — if not, returns `null`
instead of the canned string. `executeOpenApp`/`executeBrowse` themselves
are unchanged and still return that same canned message when genuinely
appropriate — once *something* (a regex match or an explicit orchestrator
tool call) is actually confident this was an open_app/browse request
specifically, honesty requires saying plainly it's not configured, same
principle as before. The only thing that changed is which layer gets to
decide *that* confidently.

**Why not just special-case "and" or other compound-phrase markers in the
regex instead?** That would only patch the compound-request symptom, not
the actual root cause — "open github" isn't compound at all, and would
still have failed. The `null`-on-miss fix handles all three logged
failure cases (two compound, one single-app-that's-actually-a-website)
uniformly, because it's fixing the actual thing that was wrong: a
"not found" outcome getting treated as "definitely can't be done" instead
of "not confidently my command."

**Also done in the same patch**: strengthened `open_app`'s tool
description (`tools.ts`) to explicitly say it's for desktop apps, not
websites, and to point at `browse` for those — a small, direct nudge at
the exact ambiguity ("github" being a plausible-sounding "app name" to a
model that hasn't been told otherwise) that caused one of the three
logged failures. This doesn't guarantee correct tool selection every
time — that's a genuine model-reliability question, not a structural bug,
and is tracked as an open question in `project-status.md`, to be checked
during Milestone 9 step 7's real-machine testing.

**What this is not**: a fix for tool-calling reliability in general. The
user's stated larger goal — more ambitious tasks (writing and running
code, pulling in external data) — is a different, much larger scope,
being discussed separately rather than folded into this patch.

## Milestone 10 Part A: file tools shipped without a confirmation gate — why that's a defensible line, not a shortcut

Prompted by a direct conversation about scope: the user wants Proxy to
eventually write and run code on request ("make me Flappy Bird" should
produce an actual working game, not a refusal or a hallucinated
non-answer), and was explicit that data-exfiltration risk isn't a concern
since the whole system is local-only. Worth separating two different
risks explicitly, since "it's local" only addresses one of them:

- **Exfiltration risk** (data leaving the machine) — genuinely
  near-zero here; nothing about these tools makes a network call.
- **Destructive-local-action risk** (the tool does something harmful *to
  this machine*) — orthogonal to locality entirely. A local script with
  real filesystem/process access can damage things just as easily as a
  remote one; "it never leaves my PC" doesn't make an `rm -rf` equivalent
  safe.

Milestone 10 Part A (`write_file`, `open_path` — see `fileTools.ts`)
is scoped specifically to avoid the second risk without needing a
confirmation gate at all, rather than building the gate first:

- **Everything is confined to one folder Proxy fully owns**
  (`PROXY_WORKSPACE_DIR`, default `~/ProxyWorkspace`), not the general
  filesystem. `resolveInWorkspace()` rejects absolute paths and any `..`
  traversal — there's no path a model-supplied string can construct that
  lands outside that folder.
- **`write_file` can't create anything Windows would run on its own** —
  the extension allowlist is source/content types only
  (`.html/.js/.css/.json/.md/.txt/.csv/.svg/.py`), explicitly excluding
  `.exe/.bat/.cmd/.ps1/.vbs/.scr/.msi/.com/.jar/.lnk/.reg/.dll`.
- **`open_path` is narrower than `write_file`, on purpose** — it won't
  auto-open a `.js` or `.py` file even though `write_file` is happy to
  create one. Depending on a machine's file associations, `Start-Process`
  opening a `.js` file can run it via the Windows Script Host (a real,
  well-known malware vector, not a hypothetical), and similarly for `.py`
  if a Python launcher owns that file association. Writing inert source
  code to a sandboxed folder is fine; auto-launching it through whatever
  the OS decides to do with that extension is a different thing entirely.
  A `.js`/`.py` file Proxy wrote can still be opened by the user manually
  if they want — same as any file that landed on their disk from anywhere
  else — Proxy just won't be the one that pulls that trigger.

This means Flappy Bird (or any browser-viewable HTML/CSS/JS output)
actually works end to end today: write the file, `open_path` launches it
in the default browser. It does *not* mean "write me a Python script and
run it" works — that needs actual process execution, which is Part B, and
Part B is deliberately not built yet.

**Why Part B (`run_script`) is blocked on a confirmation mechanism that
doesn't exist, rather than shipped the same way**: sandboxing plus an
extension allowlist works for Part A because neither tool can execute
anything — the worst case is an inert file sitting in a folder. Actually
running code is a different risk shape entirely: even confined to
`node`/`python` on a workspace-relative path (not an arbitrary shell
string — that's off the table regardless), a script *executing* can do
things a script merely *existing* cannot. `tools.ts`'s
`requiresConfirmation` field has existed since Milestone 9 step 5
specifically for this — but nothing in `orchestrator.ts` currently checks
it. Shipping `run_script` with that flag set, when nothing enforces it,
would be worse than not having the flag: it would look safe in the
schema without actually being gated. Real design work needed before Part
B: does confirmation happen by voice ("say yes to run it"), a dashboard
button, does the orchestrator loop actually pause mid-run and wait — none
of that is decided yet, and it shouldn't be decided implicitly by
shipping around it.

## TTS text normalization: prompt nudge + deterministic backstop, not either alone

Found in real-machine testing: the LLM would produce emoji, em/en dashes,
and smart quotes in replies, and Piper (the local TTS model) genuinely
struggles with them — not just an awkward pause, garbled or dropped audio
right on the character. The user's own framing was exactly right: "Proxy
is primarily a TTS model" — every reply gets spoken, so text that reads
fine but speaks badly is a real defect, not a cosmetic one.

Two layers, same reasoning already used for the regex-fallthrough fix and
the earlier hallucination fix — a prompt instruction is a strong nudge,
not a guarantee, so don't rely on one alone for something that actually
needs to be true every time:

1. **`llm.ts`'s PERSONALITY prompt** now explicitly says "no emoji, no em
   dashes or smart quotes - plain words and plain punctuation only,"
   alongside the existing "no markdown" instruction. Best case, the model
   just doesn't produce these in the first place.
2. **`textForSpeech.ts`'s `normalizeForSpeech()`** is the deterministic
   backstop — applied in `engine.ts`'s `process()`, once, regardless of
   whether the prompt was followed. Strips emoji (including ZWJ compound
   sequences and flag pairs, not just single-codepoint ones), converts
   em/en dashes to a comma (a natural spoken pause instead of a
   character Piper stumbles on), normalizes smart/curly quotes and
   guillemets to straight ones, and converts the ellipsis character to
   three periods.

**Targeted, not broad.** This is a specific list of known-troublesome
characters, not "strip anything non-ASCII" — that would also mangle
legitimate text Piper actually handles fine (an accented name, "café",
"Zürich"). Only characters actually found causing problems are touched.

**Applied once, to both displayed and spoken text, not separately at the
TTS call site.** The alternative — clean a copy only for `speak()`, leave
the original for the "reply" event/Activity panel/session log — would
mean what's shown and what's actually said could quietly drift apart
(an em dash visible on screen, a comma heard out loud). Given this
project's own transparency principle already treats "what you see is
what happened" as non-negotiable elsewhere (the Activity panel's whole
design, the "never claim a tool ran when it didn't" rule), keeping the
displayed and spoken text identical was the more consistent call, even
though it means the dashboard log loses a little typographic polish
("word, word" instead of "word — word"). Regex-matched replies
(`openApp.ts`, etc.) pass through the same normalization too, even though
they're already plain ASCII by construction — a no-op for those today,
but one code path instead of two, and free defense-in-depth if a future
hardcoded reply string ever picks up a stray curly quote from a
copy-paste.

**Terminology note, since it affects where a future fix would actually
go**: the user described this as "whisper struggling" — worth being
precise that this is a TTS (Piper, spoken output) issue, not an STT
(Whisper, transcribing what the user says) one. There's no code path
where LLM-generated text ever reaches Whisper; Whisper only ever
processes microphone audio. Whisper's own, separate mishearing issues are
tracked under Milestone 15 in `project-status.md`, unrelated to this fix.

## Milestone 10 Part C / Milestone 16: external data + iPhone integration — feasibility researched, not assumed

Prompted by the user naming specific real sources (Groww, Screener.in,
Apple Stocks, iPhone messages/WhatsApp/Gmail, remote iPhone control) and
asking for an honest assessment before committing anything to the
roadmap. Searched current information for each rather than relying on
possibly-stale assumptions, since asserting something is buildable when
it isn't (or vice versa) into a living roadmap doc is worse than not
having researched it at all.

**Stock data:**
- **Groww** has a real, official Trading API now (₹499/month
  subscription) — portfolio/holdings, live market data, historical data,
  order management. This is a genuine, well-documented REST API, not a
  scrape or a workaround. Straightforward to build against.
- **Screener.in** has no official API. Third-party scraping services
  (Apify actors, Parse.bot, and similar) provide structured access to its
  data for a small per-request fee - real and usable, but it's worth
  being clear this is an unofficial middleman scraping Screener.in on
  your behalf, not something Screener.in itself provides or guarantees
  will keep working.
- **Apple's Stocks app** isn't a real integration target at all - Apple
  doesn't expose it to third parties in any way. "Stock data on the PC"
  means a real market-data API (Groww, or a standard one like Alpha
  Vantage/Finnhub for symbols outside Groww holdings), not pulling from
  the phone's own Stocks app - there's no path for that regardless of
  effort spent.

**Gmail**: official Gmail API, standard OAuth2. No caveats - this is the
easy one, same shape as any other well-documented external API
integration.

**iPhone messages and remote control** - a genuinely different problem
shape than the above, because it's Apple's device/automation ecosystem
(Shortcuts, push notifications), not a REST API:
- **Reading SMS/iMessage**: iOS Shortcuts Automations can forward
  incoming SMS to a webhook URL - real, documented, used by others for
  exactly this. The direction only goes one way: the *phone pushes to
  Proxy* when a message arrives; Proxy has no way to reach out and pull
  message history on demand, since Apple doesn't expose that. Needs Proxy
  to expose a reachable endpoint (fine on the same WiFi at home; needs a
  tunnel like ngrok or Cloudflare Tunnel to receive messages while away)
  and a Shortcuts Automation configured on the phone per message type.
  iMessage-specific forwarding (vs. plain SMS) is less well-supported by
  Shortcuts than SMS is.
- **WhatsApp**: genuinely not recommended. No official API exists for a
  personal account to read its own chat history. The only real options
  are (a) unofficial libraries (e.g. whatsapp-web.js-style tools) that
  automate a logged-in WhatsApp Web session - this violates WhatsApp's
  Terms of Service and carries a real risk of the account getting banned,
  not a hypothetical one, or (b) the official WhatsApp Business API,
  which is built for a business messaging customers at scale and isn't
  designed for (and may not even cleanly support) a personal account
  reading its own personal chats. Recommendation: don't build this one
  unless WhatsApp ships something official for it.
- **Remote-triggering something on the iPhone** (e.g. "open Safari"):
  feasible through a third-party bridge app - Pushcut is the concrete,
  widely-used example. Proxy sends an HTTP request, Apple's push
  infrastructure delivers it to the phone, a pre-built Shortcut runs.
  Real and working, but it's not "control the iPhone" in general - it's
  a small number of specific actions, each requiring its own Shortcut
  built ahead of time on the phone, plus that bridge app installed and
  configured. A real dependency outside Proxy's own control, not
  something Proxy alone can set up end-to-end.
- **Unlocking the iPhone remotely**: not feasible, and this didn't need
  deep research to conclude - Apple deliberately does not expose any way
  to unlock a device remotely, through Shortcuts, an API, or anything
  else. That's a intentional security boundary, not a gap that's likely
  to open up. Not worth revisiting unless Apple's own position changes.

**Bottom line recommendation, if Milestone 16 gets prioritized**: the
SMS-to-webhook path is the one actually worth building - real, no ToS
risk, and it directly covers "new message from a client." Safari-via-
Pushcut is a fun proof of concept but low standalone value. WhatsApp and
remote-unlock are not recommended pursuits given the above, not because
of low effort tolerance but because the honest options for each are
either unsupported or genuinely risky.

## Milestones 17-20: four more future items, weighed for feasibility before logging

A further scoping conversation, this time covering: Windows packaging/
auto-startup, a double-clap activation trigger, a Task-Manager-style
system monitor Proxy can talk about, and a 3D modeling assistant ("a
personalized Blender," explicitly the user's biggest ambition for this
project, MCU Tony Stark-inspired). Per-milestone detail lives in
`project-status.md`; this entry is the cross-cutting reasoning.

**Clarified, not built**: the hotkey already works regardless of which
app has focus (games included) - this came up as a request but is
existing behavior (`globalShortcut` is OS-level), not a gap. Worth
recording so it doesn't get re-asked-for as if it were missing.

**Packaging + auto-launch (Milestone 17)**: genuinely easy when it
happens. `electron-builder`/`electron-forge` for a real installer,
`app.setLoginItemSettings()` (built into Electron) for startup - no
registry-editing workaround needed for either piece.

**Double-clap trigger (Milestone 18)**: a smaller cousin of Milestone 8's
VAD technically (amplitude-spike detection, same family), but with one
real architectural difference worth naming plainly rather than glossing
over: VAD only listens once triggered; this needs a mic stream open
continuously in the background. Not a meaningful privacy concern the way
it's scoped (discarding audio immediately, never transcribing or storing
unless the actual clap pattern fires), but a genuine difference from how
the pipeline works today, and false-positive tuning will need real
calibration work, same as VAD's threshold did.

**System monitor (Milestone 19)**: the easiest new capability of the
four. The insight worth recording: a live-usage tile alone is just a
prettier Task Manager - the actual value is the orchestrator tool
(`Get-Process`/`Get-Counter` via PowerShell, same pattern already used
throughout `commands/`) that lets Proxy answer "what's eating my RAM" in
words. Shipping the tile without the tool would miss the actual point of
the request.

**3D modeling assistant (Milestone 20)**: the one that needed the most
honesty. Broken into four phases specifically because they sit at very
different points on the "how solved is this" spectrum - viewing (easy,
Three.js already a dependency), basic parametric editing with gizmos and
boolean ops (real and scoped, existing web tooling covers it), AI
description/critique of a model via rendered views + a vision model
(realistic), and AI *generating* a model from a text description (not
promised - local text-to-3D generation with the geometric precision 3D
printing needs, watertight/manifold meshes, is not a solved problem
today, and packaging it as a committed deliverable rather than an open
research attempt would be overpromising). Positioned as the last
milestone at the user's own request, and the phasing itself is the
recommendation for how to approach it when the time comes: 1-3 first,
each de-risking the next, 4 attempted last and framed as research, not
a promise.

## Milestones 21-22 + personality tone: three more requests, one turned out categorically different

**News window (Milestone 21)**: genuinely easy relative to everything
else discussed - RSS needs no API key/signup, personalization is a good
LLM task (filter/summarize headlines against known interests), the
window itself is a standard second Electron `BrowserWindow`. Real
dependency worth naming: true "it knows my interests" personalization
needs Milestone 10 Part D (memory) first; ships in a simpler
static-interest-list form until then.

**Phone calling (Milestone 22)**: verified current before writing this
down, not assumed - Twilio's Media Streams is confirmed as the standard
way to bridge a real phone call to a WebSocket server for real-time
bidirectional audio, and the existing local pipeline (Whisper/
orchestrator/Piper) could sit behind that in principle. Flagged
prominently as the first item across this whole roadmap that isn't "more
capability on the local foundation" - it necessarily requires a cloud
telephony provider (no way around this for real PSTN access), costs real
money per minute on an ongoing basis, and requires the PC to be reachable
from the internet if calls are meant to reach the user while away from
home. Not a rejection - the user gets to weigh a real tradeoff with
accurate information, same principle as every other feasibility
assessment in this document. Recommendation: user-initiated calls only,
first - Proxy deciding on its own when a call is warranted is a
materially harder and easier-to-get-wrong UX problem than the plumbing
underneath it, and shouldn't be bundled in as if it were the same size
of decision.

**FRIDAY/JARVIS tone ("call me sir")**: explicitly NOT scoped as a
milestone - it's a few lines in `llm.ts`'s existing `PERSONALITY`
constant, no new capability, no research needed. Recorded here only so
it doesn't get lost, not because it needed feasibility analysis.

## Milestone 19 Part A: query tools are a new shape, not just another action tool

`get_system_usage` is the first *query* tool in this codebase - every
tool before it (`open_app`, `volume`, `window`, `browse`, the file
tools) performs an action and reports whether it worked; this one's
entire purpose is fetching real numbers for the model to reason over and
relay. That distinction mattered enough to change the implementation
shape: `volume.ts`/`window.ts`/`openApp.ts` all spawn a PowerShell script
via `spawn()` and just wait for it to exit (`ps.on("close", ...)`) -
none of them need the script's output. `systemUsage.ts` captures stdout
and parses JSON out of it, a pattern this codebase hadn't needed until
now.

**Split into Part A (tool) and Part B (sidebar tile) as soon as it was
actually scoped**, not planned that way in advance - the tile depends on
Milestone 14's sidebar navigation existing, which it doesn't yet; the
tool has no such dependency. Shipping Part A alone means "what's eating
my RAM" already works through voice or the dashboard's Input box today,
rather than waiting on unrelated dashboard work to land first.

**One PowerShell round-trip, not several** - CPU%, memory totals, and
top-5-by-memory and top-5-by-CPU-time all come back in one JSON blob,
rather than issuing `Get-Process`/`Get-Counter`/`Get-CimInstance`
separately and stitching results together in Node. Cheaper, and avoids
any window where the numbers could be sampled at slightly different
moments.

**"Top by CPU time" is honestly labeled as cumulative, not live.**
Windows doesn't expose reliable per-process instantaneous CPU% as
cheaply as it does memory - getting a true live percentage would need
sampling a counter over an interval per process, meaningfully more
complex than this tool's one-shot query. `Get-Process`'s `CPU` property
(total processor time used since the process started) was the pragmatic
choice for v1, but presenting it as "what's using your CPU right now"
would be a plausible-but-wrong answer - a browser open for three days
will always top a cumulative-time list regardless of what's actually
busy at the moment asked. The tool's reply text says "total CPU time
used since they started, not necessarily busy right now" explicitly,
so the model relays that framing accurately instead of the more
misleading (and more expected-sounding) "these are hogging your CPU."

**Test coverage exercises a real PowerShell serialization quirk on
purpose**: `ConvertTo-Json` collapses a single-element array to a bare
object rather than a one-item array - genuine PowerShell behavior, not a
hypothetical edge case, and exactly the kind of thing that would only
surface on a machine with very few processes matching a filter, easy to
miss without a dedicated test for it. `asArray()`'s normalization and
its test both exist specifically because of this.
