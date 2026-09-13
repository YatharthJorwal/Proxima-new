# Handoff note — read this first

This is a snapshot of one specific session, written to get a fresh Claude
(or a rested future you) back up to speed fast. It's meant to be
short-lived: once you've read it and it's informed what happens next,
fold anything still true into `CLAUDE.md` and `docs/project-status.md`,
and either delete this file or replace it with the next handoff.

If anything here conflicts with `docs/project-status.md` or
`docs/decisions.md`, THIS file is more current on the browser-automation
thread specifically — those docs will get updated once the thread
resolves, not mid-debugging.

## Where things actually stand, honestly

Most of this project works and is confirmed on the real machine: the
whole voice pipeline, file tools, `run_script` with its confirmation
gate, Gmail (pending one setup step), automatic memory, the settings
panel, session log persistence with a working clear button. That's not
in question and doesn't need re-litigating.

**Browser automation (Milestone 10 Part E) is built but has never once
worked end to end.** Not one `browser_click` has succeeded in any real
test. Several real bugs got found and fixed along the way (see below),
each one confirmed fixed — but the underlying reason it still doesn't
work turned out to be structural, not a bug, and wasn't identified until
late in the debugging. That's the main unresolved thread this note exists
for.

The user is understandably frustrated by this point — several rounds of
"here's a fix" that each turned out to be real but incomplete. Worth
approaching the next session for this thread with that context: be
honest about what's actually confirmed vs. still theoretical, don't
oversell the next fix as *the* fix without saying plainly that it hasn't
been tested yet either.

## The browser automation debugging trail, in order

1. **First real test**: crashed repeatedly. Traced to the dev machine
   being under heavy concurrent load (a GPU training job eating ~19GB,
   separately from Proxima) — Ollama OOM'd, Electron's GPU process OOM'd
   and fatally crashed. Not a Proxima bug; flagged and left alone, machine
   contention explains it.
2. **Routing bug** (fixed, confirmed): "Okay, so open Chrome" missed the
   regex fast path (only tolerated "please", not real conversational
   lead-ins) and fell to the LLM, which then picked `browse(site=google)`
   instead of `open_app` — chrome isn't a browsable site, so the model
   improvised. Fixed with a shared, bounded lead-in prefix list
   (`regexUtils.ts`) and tighter tool descriptions. Confirmed fixed —
   "open chrome" routes correctly now.
3. **Diagnosis bug** (fixed, confirmed): when CDP couldn't connect, the
   error message just said "not reachable," which was true but not
   actionable. Now distinguishes "Chrome isn't running" from "Chrome's
   running but not with debugging on" (checks for a running `chrome.exe`
   via the same `Get-Process` pattern `systemUsage.ts` already used).
   Message itself confirmed accurate against what was actually happening.
4. **Transparency bug** (fixed, confirmed via the fix landing, not yet
   re-tested live): the model was silently turning every "click X" into
   a Google search for X and describing it as if it fulfilled the
   request — never once saying "I couldn't actually click that." Fixed
   by extending `llm.ts`'s existing anti-overclaiming rule to cover
   silent substitution, plus tightening `browse`'s and `browser_click`'s
   descriptions.
5. **The actual root cause** (identified, NOT yet fixed or built): Chrome
   only applies `--remote-debugging-port` on a genuinely fresh launch.
   The user closed every Chrome window via Task Manager — more thorough
   than even asked — and it *still* failed. That ruled out "user isn't
   closing it correctly" and pointed at something structural: **Proxy's
   automation and the user's everyday browsing share the same Chrome
   profile**, so there's an inherent race between whichever one launched
   more recently. No amount of manual-close discipline fixes a structural
   sharing conflict.

## The pending decision — not built yet, needs confirmation

**Proposed, not yet built or agreed to**: give Proxy its own dedicated
Chrome profile (separate `--user-data-dir`), launched independently of
the user's everyday Chrome. Chrome supports two fully independent
instances running at once as long as they don't share a profile
directory — this removes the sharing conflict entirely, no more closing
anything.

Real cost, stated plainly to the user already: that profile starts logged
out of everything. Whatever needs a login (Gmail, GitHub, etc.) needs to
be logged into once, inside that dedicated profile, same as setting up a
new browser from scratch. This directly reverses the user's earlier
choice ("my actual profile, more useful, higher stakes") — worth being
upfront that this is a real reversal, not a minor tweak, and confirming
it's actually what they want before building it.

One open question asked but not yet answered by the user: whether they've
been saying "open chrome" to Proxy each time, or clicking their normal
Chrome icon, when reopening after closing everything. Doesn't change the
recommended fix, but worth knowing for completeness.

**Do not build the separate-profile version without the user explicitly
confirming they want it** — this is a real design reversal, same
"ask, don't default" territory as Part B's confirmation mechanism.

## Also true, lower priority

- Real-machine crashes (GPU process OOM, Ollama `std::bad_alloc`) seem
  tied to concurrent heavy GPU/CPU load on the user's machine (a training
  job in at least one case), not a Proxima bug. `app.disableHardwareAcceleration()`
  would make the app survive GPU contention instead of fatally crashing,
  at a real cost (Camera card's hand-tracking would likely get choppier on
  software rendering). Proposed, not decided, not built.
- Session log corruption (`Unexpected end of JSON input`) was observed
  once, almost certainly from a crash landing mid-write. Atomic writes
  (write-to-temp-then-rename) would close this permanently across
  `sessionLog.ts`, `settings.ts`, and `memory.ts`. Proposed, not built.
- `DEFAULT_MAX_STEPS` (5, `orchestrator.ts`) wasn't raised for browser
  tasks specifically, even though a realistic multi-step flow can burn
  through it fast. Still an open question, not urgent until the profile
  fix actually gets browser automation working at all.

## The bigger, still-open question

Hermes Agent was investigated and deliberately shelved this session (full
reasoning: `docs/decisions.md`) — tested directly against qwen3.5:9b at
12GB VRAM, found unreliable, corroborated by an identical failure
reported in Hermes Agent's own GitHub issues at the same VRAM budget.

The deeper pattern behind the browser-automation struggles (losing track
of page context between turns, not reliably choosing the right tool in a
multi-step sequence) looks like the same underlying limit, not a separate
issue — a 9B-class local model genuinely struggling with multi-step
agentic composition, as distinct from single-tool-call requests, which it
handles fine. Two real options were raised and left open, not decided:
swapping the local smart-tier model for something specifically noted for
tool-calling reliability (Gemma 4 12B was named, unconfirmed), or an
optional cloud-escalation tier gated behind a user-supplied API key for
requests the local tiers genuinely can't do. Neither is scoped in detail
yet — that would need its own real conversation, same as the browser
automation scope did.

## Goals, in rough priority order

1. Get explicit confirmation on the separate-Chrome-profile fix, then
   build and real-machine-test it. This is the actual next step for the
   browser automation thread.
2. Once (if) browser automation is genuinely working, revisit whether
   `DEFAULT_MAX_STEPS` needs raising for multi-step browser tasks.
3. Finish Milestone 10 Part C (Gmail's pending `.env` setup issue) —
   still open, not touched this session, no known blocker beyond the
   user's own setup.
4. Scope gesture-to-action wiring — still completely unscoped.
5. Whenever it feels right, not urgently: the local-model-ceiling
   question above (model swap experiment vs. cloud escalation tier vs.
   accept the current ceiling for multi-step agentic tasks specifically).
