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
it doesn't get lost, not because it needed feasibility analysis. Now
confirmed wanted, with a second piece added to the same request:
real-machine testing surfaced "who am i" getting an answer that doesn't
know who's actually asking (rambling, addresses the user as an anonymous
"someone who uses this," not by name) — the user wants both (1) "sir" as
a hardcoded form of address and (2) the fact that the user IS Yatharth
(the project's own creator) hardcoded into `PERSONALITY` directly, not
derived at runtime. Explicitly acceptable per the user for a single-user
personal project — this is not a general-purpose product decision, just
a personality constant matching who's actually running this on their own
machine. Implemented in `CREATOR_BIO` (`llm.ts`) — turned out small
enough to just do rather than needing the broader tool-limits pass the
tool-verbosity finding is waiting on (`project-status.md`'s Known
Limitations). Not yet re-tested on the real machine.

## Milestone 10 Part C, Gmail slice: read-only scope instead of a confirmation gate

Prompted by picking Gmail as the first Part C slice to actually build
(over Groww, which has nothing to connect to yet since no portfolio
exists — see the Milestone 10 Part C research above). The same open
question that blocks `run_script` (Part B) — "this needs a confirmation
gate that doesn't exist yet" — does not apply here, and it's worth
being explicit about why, since the tool schema's `requiresConfirmation`
field could otherwise look like an oversight if left unset:

- **The OAuth scope requested is `gmail.readonly`**, not the broader
  `gmail.modify`/`gmail.send`. This isn't a self-imposed rule enforced
  by this codebase's own logic (the way `fileTools.ts`'s extension
  allowlist and workspace-folder confinement are) — it's enforced by
  Google's own OAuth server. A `gmail.readonly` token literally cannot
  be used to send, delete, archive, or modify anything, regardless of
  what the model asks for or what bugs might exist in this tool's code.
  That's a stronger safety property than anything sandboxing alone
  provides for the file tools, since it doesn't depend on this codebase
  getting its own validation right.
- **Consequence**: a wrong or overly broad search is the worst case here
  — an irrelevant result relayed to the user, not a destructive action.
  That's the same risk shape as `get_system_usage` (Milestone 19 Part
  A), not the same risk shape as `run_script`. `requiresConfirmation`
  stays unset for the same reason it's unset on the file tools and
  `get_system_usage` — setting it here would document a gate that
  protects against a risk this tool doesn't actually carry.
- **If this ever grows into sending or modifying email**, that's a
  different tool with a different OAuth scope, and it would need the
  same real design work Part B (`run_script`) is already blocked on —
  this decision doesn't set a precedent for a future `send_email` tool
  shipping the same way.

**Metadata-only fetch, not full message bodies** — same reasoning as
Milestone 19 Part A's one-PowerShell-round-trip choice: fetch only what
the model needs to relay an answer. `format: "metadata"` with an
explicit `metadataHeaders` list (From/Subject/Date) plus Gmail's own
`snippet` field (a short, Gmail-generated preview) is enough to answer
"do I have new mail" or "any emails from priya" without pulling full
email bodies into the LLM's context — cheaper, faster, and avoids
handing more of the user's email content to the local LLM than the
question actually calls for.

**One-time OAuth setup script (`scripts/gmail-auth.js`, `npm run
setup:gmail`), same shape as `scripts/download-hand-model.js`** — a
visible, described, user-initiated step rather than anything automatic,
consistent with this project's stance (`CLAUDE.md`) on never running
setup without describing it first. The refresh token is printed to the
terminal for the user to paste into `.env` themselves, not written to
`.env` automatically — same pattern already established for Piper's
paths and the ElevenLabs key, so credential handling stays consistent
across the project rather than this one tool inventing a new pattern.
`googleapis` (the official Google API client) was the natural dependency
choice — the alternative (hand-rolling OAuth2 token exchange and REST
calls against Gmail's API) would be reinventing a well-maintained
library for no real benefit.

**`intentRouter.ts` deleted in this same patch** — flagged in
`architecture.md` as a "candidate for deletion once Milestone 9 is
confirmed solid on the user's real machine" back when it was written;
that confirmation came in this session (Milestone 9 step 7's three test
cases, all confirmed). Grepped the whole codebase first to confirm
nothing actually imports it anymore (only comments referenced it,
descriptively) before removing it — the handful of stale comments that
described it as still-live (in `tools.ts`, `llm.ts`, `window.ts`,
`openApp.ts`, `volume.ts`) were updated in the same patch rather than
left pointing at a file that no longer exists.

## Milestone 10 Part D: memory design, and the reliability risk taken on knowingly

Scoped in conversation before building anything, since the shape of a
memory system determines whether it's useful or just noise. Three real
forks, each decided explicitly rather than defaulted:

**What counts as memory**: facts/preferences AND project context,
noticed automatically — not narrowed to just explicit facts.

**Capture: automatic, not explicit-only.** The recommendation going in
was explicit-only ("remember that..."), reasoning by direct analogy to
the write_file/defer_to_planner finding above: a small local model
overestimating its own judgment about what's "worth" doing unprompted is
the same failure mode whether the stakes are a game's code or the user's
personal data. That recommendation was turned down in favor of full
automatic capture — logged here so a future session sees this as a
considered choice, not a lapse. The architecture still shaped how
"automatic" had to work: Proxy has no multi-turn "session" concept (every
hotkey press is one self-contained interaction), so "automatic, after
conversations" necessarily means *after every single interaction*, not
after some session boundary that doesn't exist here. Runs as a background
call, fired after the reply is already spoken — never awaited into the
reply path, so it can't add latency to what the user is waiting for.

**Extraction runs on the smart tier, not the fast tier** — the one place
in this design that pushed back toward caution: given automatic capture
was the chosen direction, judgment quality on "is this actually worth
remembering long-term" matters more than latency, since nothing is
waiting on the result. `think: true`, same as the smart tier's identity
everywhere else in this codebase.

**No manual override for v1** (no `remember_fact`/`forget_fact` tools) —
also a deliberate choice, not an oversight: a bad automatic capture just
sits in the list until pruned rather than being correctable. A real known
limitation, not solved here.

**Recall: a model-invoked tool (`recall_facts`), not always-injected.**
This is the second deliberate acceptance of the exact reliability risk
already surfaced by the write_file/defer_to_planner finding above — a
small model has to actually *choose* to call `recall_facts` for it to do
anything. The safer technical default (always inject the full capped
list into every prompt, avoiding any dependence on the model's own
judgment about when to look something up) was raised and explicitly
turned down. Both memory-reliability risks in this feature (automatic
capture's judgment call, and recall's on-demand invocation) were chosen
with the tradeoff stated plainly first — this is not the same as the
write_file case, where the risk wasn't recognized as a design decision
until it had already caused a bad outcome (Flappy Bird). `recall_facts`
is marked `resultInformsNextStep: true` — the first tool to actually use
that field (see orchestrator.ts's docblock, which anticipated this exact
"check X" shape before any tool needed it) — since a raw fact list is
usually raw material for an answer, not the answer itself.

**Storage**: a flat local JSON file, `~/.proxima/memory.json` by default
(`PROXY_MEMORY_FILE` overridable, same pattern as
`PROXY_WORKSPACE_DIR`) — deliberately NOT inside the workspace folder,
since that folder is "files Proxy wrote that the user asked for," not
Proxy's own internal state. No categories, no embeddings — a flat
capped list (30 entries, oldest pruned first) matches this codebase's
established "boring and vanilla" bar at the scale this actually needs.
Exact-text dedup only (an incoming fact identical to a stored one is
dropped) — no contradiction handling ("likes coffee" then later "gave up
coffee" both just sit in the list); a real known limitation, not solved
here, since a real fix would need structured fact-keying (category/key/
value) rather than free-text blobs, and that's a bigger redesign than
this slice's scope justified.

**`chat()` gained an optional `systemPromptOverride`** (`core/llm.ts`)
so the extraction call isn't forced through the Proxy-persona system
prompt ("You are Proxy, a local voice assistant...") for a task that
never reaches the user as a reply at all. Worth being explicit about why
this doesn't undermine `chat()`'s own documented "one system prompt, no
drift" design principle: that principle is about Proxy not developing
two different personas depending on which code path is talking to the
user. This isn't a second persona — it's Proxy's own backend running an
internal analysis task that was never a conversation with the user in
the first place. Left optional and undocumented to ordinary callers on
purpose, specifically so it doesn't become a tempting escape hatch for
some future caller that actually IS replying to the user.

**Test-writing pitfall worth flagging for future sessions — theory
revised twice, be conservative here.** First occurrence:
`core/memory.test.ts` set `process.env.PROXY_MEMORY_FILE` with a plain
statement textually before `import { ... } from "./memory"` — the same
pattern `fileTools.test.ts` already uses successfully for
`PROXY_WORKSPACE_DIR`. It silently failed there because that test file
also uses `vi.mock("./llm", ...)` for a dependency of the module under
test, and the original theory logged here was "`vi.mock`/`vi.hoisted`
hoisting is the trigger — safe without one."

**That theory was wrong, or at least incomplete** —
`commands/runScript.test.ts` hit the exact same symptom (a workspace-root
env var silently not taking effect before `fileTools.ts`'s module-level
constant read it) with **no `vi.mock` anywhere in the file**. The only
difference from `fileTools.test.ts`'s working case: `runScript.test.ts`
imports `./runScript`, which transitively imports `./fileTools`, rather
than importing `./fileTools` directly — root cause not fully pinned down
(a Vite dependency-pre-bundling reorder for the transitive case is the
leading guess, not confirmed), and not worth burning more time on given
a fix that works regardless of the exact mechanism.

**Standing rule, revised again — this time from a real, previously-
undetected bug, not just a close call.** The line above ("`fileTools.
test.ts`'s own plain-statement pattern still works, confirmed still
passing") was checked the wrong way and was wrong. Discovered while
independently verifying Part B's patch: `~/ProxyWorkspace` — the real
default workspace folder, on whatever machine runs `npm test` — was
getting real files written into it (`flappybird.html`, `games/snake.js`,
`note.txt`, `script.py`) on every single test run, every session, this
entire time. `fileTools.test.ts` has both a `vi.mock` (for `./launch`)
*and* the plain-statement `process.env.PROXY_WORKSPACE_DIR = ...` before
its import of `./fileTools` — the exact vulnerable shape already
described above — and the env var was never actually taking effect. The
tests still passed throughout because they check the written path
against `getWorkspaceRoot()` on *both* sides of the assertion: if
`getWorkspaceRoot()` itself resolves to the wrong (real, default) path,
the assertion comparing "where was it actually written" against "what
does `getWorkspaceRoot()` say" trivially agrees with itself regardless
of whether workspace isolation is doing anything at all. A self-
referential check can't catch its own reference point being wrong.
Fixed the same way as the other two instances (env var moved inside
`vi.hoisted()`'s callback); confirmed after the fix that a full
`npm test` run no longer touches `~/ProxyWorkspace` at all.

**Revised standing rule**: treat "set env var via a plain statement
before an import" as *not* a safe pattern in this codebase's test suite,
full stop — not "safe unless X," not "safe for direct imports." Three
independent instances of the same failure (`core/memory.test.ts` with
`vi.mock`; `runScript.test.ts` with no `vi.mock` at all, transitive
import; `fileTools.test.ts` with `vi.mock`, direct import, silently
broken for an unknown length of time before this) is enough occurrences
across enough different shapes that the pattern itself should be
considered unreliable in this toolchain, not any particular variant of
it. `vi.hoisted()`'s callback is the one mechanism with an actual
documented guarantee here; use it for any env var a test needs a module
to see before that module's own top-level code runs, every time, with
no exceptions carved out for "no `vi.mock`" or "direct import." Also:
tests that verify path/output values by re-deriving the expected value
from the same function under test (as `fileTools.test.ts` did with
`getWorkspaceRoot()`) can pass while checking nothing meaningful about
correctness — worth a second look at any test whose "expected" value is
computed by calling the code being tested, rather than an independently
known value.

## Milestone 10 Part B: run_script's confirmation mechanism — decided and built

The design question this tool was blocked on (see the Part A entry
above): does confirmation happen by voice, a dashboard button, or does
the orchestrator loop pause mid-run and wait? Decided in conversation
before building anything, same as Part D's memory design.

**Chosen: voice confirmation via a separate, following turn — not an
inline pause mid-orchestrator-run.** The deciding factor was
architectural, not a preference call: this app has no multi-turn
"session" or open-mic concept anywhere else — Part D's memory design
already established this for the same underlying reason (every hotkey
press is one self-contained interaction, full stop). Making the
orchestrator loop genuinely pause mid-flight and wait for a follow-up
utterance would mean building a "stay listening" mode this app doesn't
have anywhere in its architecture — a materially bigger lift than the
tool itself. A follow-up turn, by contrast, is something this app
already does effortlessly: it's just the next hotkey press. Building
Part B's confirmation flow around a capability the app doesn't have
would have meant solving two hard problems (arbitrary code execution
safety, and open-mic session management) to ship one feature; building
it around a capability the app already has meant solving exactly one.

**Mechanism**: `run_script`'s `execute()` (`runScript.ts`) never runs
anything itself. It validates the request (workspace-relative path via
`fileTools.ts`'s `resolveInWorkspace()`, extension in `{.js, .py}`, file
must already exist) and, if valid, stores exactly one pending
confirmation in module-level state — there's only ever one Proxy, one
thing it can be waiting on at a time, no need for anything fancier than
a single variable. The reply asks for a yes/no. `engine.ts`'s
`process()` checks `tryResolvePendingConfirmation()` as the very first
thing on every subsequent turn, before the regex router or the
orchestrator ever see the new utterance.

**The confirmation window is exactly one utterance wide, not
time-based**: a clear yes runs it, a clear no cancels it, and anything
else — including a totally unrelated new request like "open notepad" —
silently drops the pending confirmation and lets that utterance be
processed normally as a fresh request. No timeout, no expiry clock. This
was a deliberate choice over the more obvious "expires after N minutes"
design: a time window can still be caught out by a stray "yes" said
minutes later for a completely unrelated reason; a single
non-matching-utterance window can't be, structurally, regardless of how
long the user takes to say something else. Simpler to implement and
harder to get wrong, at no real cost — nobody confirms a script run with
a several-minute pause before answering yes or no anyway.

**Classification is plain keyword matching, not an LLM call.** Yes/no
recognition for a handful of common phrasings ("yes," "confirm," "run
it" vs. "no," "cancel," "stop") is exactly the kind of deterministic
task that doesn't need one — and legibility matters more here than
almost anywhere else in the codebase, since this is the one place a
misclassification could mean running code the user didn't actually
confirm. An LLM call would also reintroduce the exact reliability
question this whole feature is designed to route around.

**Execution**: `execFile`'s async/callback form — never
`execFileSync` — specifically because this session already found a real
hang (STT blocking Electron's main process synchronously causes
Windows' "not responding" dialog; see project-status.md's Known
Limitations). A script that ran synchronously here would risk the exact
same failure mode for an unrelated reason. `execFile`'s `timeout` option
(configurable via `PROXY_SCRIPT_TIMEOUT_MS`, default 15s) kills a
runaway script rather than letting Electron hang waiting on it
indefinitely. Output capped at 500 characters in the spoken reply —
applying the `get_system_usage` over-verbosity lesson (Known
Limitations) to brand-new code from the start, rather than shipping the
same mistake again and fixing it later.

**Scope held to what decisions.md already ruled out**: no shell string,
no arguments — `node` or `python` (by extension) on exactly one
workspace-relative path. Extending this to accept script arguments was
considered and rejected for now: it would reopen a version of the same
injection surface a shell string would, for a case ("run this specific
script with no arguments") that already covers the overwhelming majority
of "write me a script and run it" requests.

**`requiresConfirmation: true` is documentation, not enforcement** — see
the field's own updated docs in `tools.ts`. There still isn't a generic
orchestrator-level confirmation gate; this tool satisfies the property
entirely through its own design. A future tool needing confirmation for
a different kind of action would need either its own version of this
same pattern, or a genuinely generic gate built once there's a second
real use case to generalize from.

**Dashboard/CLI transparency**: a new `awaiting-confirmation` event
(and a `"confirmation"` source added to the existing `routed` event,
rather than a second new event for the resolution half) makes the
waiting state visible in both the dashboard's Activity panel and the
CLI's console log — not just implied by the reply text. Consistent with
the rest of this codebase's transparency principle: a script silently
sitting there waiting for a yes/no, with zero visible indication
anywhere that anything is pending, would be its own quiet form of
dishonesty even though nothing false would technically be claimed.

## Milestone 13, first slice: persisted session log

Chosen as the next milestone with the user explicitly delegating the
pick ("be creative and choose for me"). Reasoning for the choice itself:
every credential/config added this session (`GMAIL_CLIENT_ID`,
`PROXY_MEMORY_FILE`, `PROXY_SCRIPT_TIMEOUT_MS`, on top of the existing
`PROXY_WORKSPACE_DIR`) lives in `.env` only, and the dashboard's SESSION
LOG card resets to empty on every relaunch — the two rough edges
Milestone 13 already names. Picked over Maps/Bluetooth (both need real
Windows-API research first) and the STT rewrite (explicitly needs the
user's go-ahead, not a default to just start).

Split into two independent pieces rather than attempted together: this
session built the **persisted session log** half only. The **settings
UI** half (an actual in-app editor for what's currently `.env`-only) is
separate, larger, and not started — it also raises a real design
question of its own (does editing a setting take effect live, or only
after a restart, given nearly everything in this codebase reads its
config once at module load time?) that deserves its own decision instead
of an implicit default.

**Design: main.ts persists, renderer.js formats — deliberately not
duplicated in both places.** All the logic that decides *what the
SESSION LOG card's text actually says* (`describeRoute()`, the specific
wording for "listening"/"busy"/"no-speech"/etc.) already lives in
`renderer.js`'s `appendLog()` call sites. Two ways to persist that same
text: have `main.ts` reconstruct the same formatting independently, or
have the renderer mirror the *already-formatted* `{kind, text}` pair
back to `main.ts` over a new IPC verb (`persistLogEntry`) right when it
renders it live. Chose the second — a second independent place deciding
how to phrase the same event is a real drift risk (the two could quietly
diverge over time, e.g. if `describeRoute()`'s wording changes and
whoever changes it doesn't know a second copy exists), while the first
approach makes `core/sessionLog.ts` genuinely dumb: it only ever stores
and returns `{kind, text, timestamp}`, never interprets any of it.

**Hydration timing follows the exact precedent that already exists for
"ready".** `main.ts` already has a documented, previously-fixed bug
class here: `webContents.send()` is fire-and-forget, and sending
anything before the renderer's page has actually finished loading (and
its `ipcRenderer.on()` listeners are attached) silently drops the
message with no error and no retry — this is exactly what happened to
"ready" once, per that event's own existing comment. The new
`"proxy:log-history"` send follows the identical fix: sent only after
`Promise.all([engine.init(), pageLoaded])` resolves, in the same spot,
right before "ready" — not because order matters much functionally
here, but because it was the natural place to avoid reintroducing a bug
that's already been found and fixed once.

**Historical entries carry their real original timestamp, not "now."**
`appendLog()` gained an `opts.timestamp` override specifically so a
replayed entry from yesterday shows yesterday's time. This is the same
transparency instinct that runs through the rest of this codebase
applied to a new case: a fake "just happened" timestamp on something
that already happened would be a small, specific dishonesty, not just a
missing nicety.

**A plain divider (`"— new session —"`), not a bigger visual treatment.**
Marks where replayed history ends and this session's live entries begin,
so scrolling back never quietly reads as "one continuous session" when
it wasn't — without inventing a whole "session" concept in the UI that
doesn't exist anywhere else in this app's architecture (see Part D's and
Part B's docblocks for why this app deliberately has no multi-turn
session concept at all).

**Cap and prune, same shape as `core/memory.ts`'s facts store**: 500
entries, oldest dropped first, plain flat JSON at
`~/.proxima/session-log.json` (`PROXY_SESSION_LOG_FILE` overridable).
No categorization, no search — matches this codebase's established bar
for what actually needs more than a flat list at this scale.

**Test file follows this session's revised standing rule from the
start**, rather than needing a second bug to teach it: `env var set
inside vi.hoisted()`, even though `sessionLog.test.ts` has no `vi.mock`
at all. One test originally planned (does `appendLogEntry` swallow a
real write failure) was cut before it shipped, not after — `LOG_FILE` is
a frozen module-level constant, so reassigning `process.env` mid-test
has no effect on it, and a test written that way would have passed for
the wrong reason (nothing was actually broken) rather than testing what
its name claimed. Better to have no test here than one that looks like
coverage but isn't.

## Milestone 13, second slice: Settings panel

Three real decisions asked before building rather than defaulted on, same
posture as Part B's confirmation mechanism:

1. **Where it lives**: modal/overlay opened by a button, not a new
   dashboard card or a separate page. User's call.
2. **How it persists**: left as "your call" by the user. Chose a separate
   flat JSON file (`~/.proxima/settings.json`, `PROXY_SETTINGS_FILE`
   overridable) layered OVER `.env`, rather than parsing and rewriting
   `.env` directly. Reasoning: `.env` is a hand-edited file with the
   user's own comments and formatting; a programmatic rewrite that only
   understands 17 specific keys risks mangling anything else in it. A
   separate file never touches `.env` at all, and matches the same flat-
   JSON-file shape `core/memory.ts` and `core/sessionLog.ts` already use
   for local persistence — one more consistent pattern instead of a new
   one. Mental model: a value saved here always wins over `.env`; a blank
   field, saved, removes the override rather than persisting an empty
   string, falling back to `.env` instead.
3. **Scope**: user chose "everything, including API keys/secrets" over a
   curated subset. All 17 known settings across the codebase are
   editable. Secret-shaped fields (`ELEVENLABS_API_KEY`,
   `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`) render as password
   fields behind a single "show secret values" toggle — not a new
   security boundary, since `settings.json` sits at the same plaintext-
   on-disk, single-user trust level `.env` already has, just a small
   shoulder-surfing courtesy in the UI itself.

**The real gotcha, worth remembering — same shape as this session's
`vi.hoisted()` testing lesson, just in production code instead of a
test file.** `core/settings.ts` has to apply `settings.json`'s contents
to `process.env` before `main.ts`/`assistant.ts`'s own imports pull in
`engine.ts` and, transitively, every module that reads its own config at
top-level scope (`tts.ts`, `gmail.ts`, `memory.ts`, `sessionLog.ts`,
`runScript.ts`, and more). A plain exported function the entry point
calls explicitly does NOT achieve this: by the time any statement in the
importing file's own body runs — even the very first line after its
imports — every module in that file's entire import graph has already
finished executing, including anything imported later in the same file.
The only reliable fix is the same one `dotenv/config` itself already
uses: make loading a MODULE-LEVEL side effect of importing the file at
all (`settings.ts` calls its own `applySavedSettingsToEnv()` at the
bottom of the file, unconditionally), and import that file second, right
after `dotenv/config`, before anything else. Get the ordering wrong and
the failure mode is silent — every saved setting simply does nothing,
with no error anywhere — exactly the "looks fine, isn't" shape the
`vi.hoisted()` bug had.

One consequence of that: `core/settings.ts`'s own load path
(`loadSavedSettingsSync()`) uses `fs.readFileSync`, not the `fs/promises`
pattern every other storage file in this codebase uses. Deliberate, not
an inconsistency — it's the one file that has to finish before the
import graph it's racing against even starts.

Bundled into the same patch rather than shipped separately (per the
user's own request to stop sending one-off patches for small things):
dropping the "Milestone 7 — hand tracking" tag from the CAMERA card
(pulled forward from Milestone 14's planned scope list — see that
section), and fixing a stale line in this file's own "Personality/tone"
section that said the FRIDAY-style "sir" address hadn't shipped yet when
it actually had (this file just hadn't been updated to match — this
file's own FRIDAY/CREATOR_BIO entry earlier on was already correct).

## Milestone 10, Hermes Agent investigated and shelved (not adopted)

Real trigger: hardcoded/limited tool coverage kept failing on genuinely
judgment-heavy or multi-step requests ("play music by my mood," complex
chained tasks), and a separate concrete bug (volume control ignoring a
requested delta amount, always moving by a fixed default step). Led to a
real architecture conversation rather than just patching examples one at
a time.

Researched (not assumed) two different things both called "Hermes":
the Hermes function-calling prompt format (a training convention, not
software) versus Hermes Agent, a full open-source agent runtime Nous
Research shipped February 2026 — persistent memory, autonomous skill
creation, 40-70+ built-in tools, local Ollama support. The second one is
what would actually address "no matter how much we hardcode, it's always
limited," since it grows its own tool coverage instead of needing every
capability hand-built.

Tested directly (Path C — try it standalone before deciding, same
"feasibility researched, not assumed" instinct as the M16 iPhone/M22
phone-call investigations) rather than adopting or dismissing it from
documentation alone: ran Hermes Agent locally against qwen3.5:9b (12GB
VRAM). Result: poor — hallucinating, refusing, hitting capability limits.
Corroborated independently: a Nous Research GitHub issue
(NousResearch/hermes-agent#25041) reports the identical failure on the
identical VRAM budget, with the maintainers' own diagnosis being specific
— "Hermes's massive system prompt (+10K tokens, 30+ tool schemas, memory
injection) overwhelms small models," not that 9B models can't call tools
at all. Worth remembering: this indicts qwen3.5:9b driving HERMES AGENT's
heavy harness specifically, not necessarily qwen3.5:9b driving Proxima's
own much leaner tool list and system prompt — a genuinely different
cognitive load, not yet separately tested.

Decision: shelve Hermes Agent adoption, keep building Proxima's own
orchestrator. Reasoning, not just "it didn't work today": adopting Hermes
Agent's runtime wholesale would mean re-verifying (not re-deriving) every
safety property already reasoned through here — Part B's confirmation
gate, the transparency principle, `preload.ts`'s narrow-verbs philosophy —
against a large, fast-moving, third-party autonomous system that would
now be the thing with actual PC access. That's a bigger commitment than
the actual bottleneck (a 9B model's capability ceiling under heavy load)
needs solved. Two things stay open, worth a look before writing off local
models at this VRAM tier entirely: a same-VRAM model swap (Gemma 4 12B
specifically called out across multiple sources for tool-calling *format
reliability*, not raw intelligence, versus similarly-sized Qwen models),
and an optional cloud-escalation tier gated behind a user-supplied API
key for the rare request the local tiers genuinely can't do — newly
scoped here, not previously documented anywhere despite being asked
about as if it already was.

Also corrected in this conversation: this file already had the FRIDAY/
"sir" personality change and its reasoning recorded correctly;
project-status.md's copy of that item was stale (see that file's
"Personality/tone" section).

## Milestone 10 Part E: browser automation — three real decisions, asked not defaulted on

Same posture as Part B's confirmation mechanism. Full technical
writeup lives in project-status.md's Part E section (architecture,
element-labeling, confirmation reuse, test coverage) — this entry is
the reasoning behind the three choices themselves:

1. **Real Chrome profile, not an isolated one.** User's call, made with
   the tradeoff stated plainly first: real logins and no separate
   authentication needed, versus real stakes if the wrong thing gets
   clicked inside a session that's actually the user's own.
2. **Confirmation only for committing actions**, not every click/type.
   Confirming everything would turn even "search YouTube and hit play"
   into a multi-turn back-and-forth, defeating the point; the chosen
   split (read/navigate/type unconfirmed, submit/buy/delete/send gated)
   mirrors the trust level `browse.ts` already has for the unconfirmed
   half, and Part B's mechanism exactly for the gated half.
3. **Visible with an animated cursor, not headless.** User explicitly
   wants to watch it work and intervene in real time if something looks
   wrong — directly in the spirit of this project's transparency
   principle, applied to a tool that can now act on real webpages, not
   just PC-local actions.

Calibration given alongside the visible-cursor build, worth remembering
before the first real test: the cursor being visible and smooth doesn't
mean the reasoning behind where it clicks got any smarter — that's still
qwen 9b, bounded and nerfed, the same model this whole conversation
established has real limits. The visual will outpace the underlying
capability; worth not mistaking a good-looking click for a reliably
correct one on the first few real runs.

Commit-detection heuristic (keyword list + element type + a model-set
`may_commit` flag, combined via OR) deliberately biased toward false
positives over false negatives: an unnecessary confirmation costs mild
annoyance, a missed one could mean an actual unconfirmed purchase or
deletion. `browser_type` was scoped WITHOUT a "press Enter to submit"
option specifically to avoid a second, differently-shaped, harder-to-
heuristically-judge commit decision for text fields — pushing all
of them through the one already-reasoned-through click heuristic instead.

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
