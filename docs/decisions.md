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
`message.content`. Plan: fast-tier calls use `think: false` (matches
"doesn't overthink"); smart-tier calls use `think: true`. The dashboard is
planned to show this as a real, expandable "thinking" panel tied to the
current step — the model's actual reasoning trace, not a fabricated "AI is
thinking..." spinner.

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
over time) — Milestone 9 only ships the fixed baseline. The actual
personality/bio copy is still an open item pending the user's input (see
`project-status.md`).

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
