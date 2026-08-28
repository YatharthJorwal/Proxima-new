/**
 * Proxy's orchestration engine — Milestone 6.
 *
 * This is the same pipeline that used to live inline in assistant.ts
 * (record -> transcribe -> route -> reply -> speak), pulled out into an
 * EventEmitter so more than one "front end" can drive/observe it:
 *   - the CLI (assistant.ts): Enter-key trigger, logs events to the console
 *   - the Electron dashboard (electron/main.ts): global-hotkey trigger,
 *     forwards every event to the renderer UI over IPC
 *
 * Why an EventEmitter instead of the dashboard just wrapping/copying the
 * loop: CLAUDE.md commits to "show the process, never hide it" as a
 * design principle, specifically as the opposite of the barehands.md
 * prompt-injection pattern we found. If the dashboard had its own copy of
 * this logic, the two could quietly drift apart and the UI could stop
 * accurately reflecting what Proxy actually does. Emitting real pipeline
 * events (not synthesized ones) means the dashboard is *structurally*
 * unable to show anything other than the truth of what's happening.
 *
 * This module owns no trigger mechanism itself (no readline, no hotkey) —
 * callers decide how runOnce()/runWithText() gets invoked. That keeps
 * CLI-only vs. dashboard usage decoupled from the pipeline itself.
 *
 * Two entry points, one shared tail:
 *   - runOnce()     — voice path: record -> transcribe -> [shared tail]
 *   - runWithText()  — typed path (dashboard Input box): skips recording
 *                      and STT entirely, feeds text straight into
 *                      [shared tail]. Added alongside the dashboard visual
 *                      overhaul so the Input box is a real second way to
 *                      talk to Proxy, not a decorative copy of a UI
 *                      reference — same router, same tool dispatch, same
 *                      TTS reply as a spoken command gets.
 */

import { EventEmitter } from "events";
import { initSTT, transcribe } from "./stt";
import { speak } from "./tts";
import { recordUntilSilence } from "./audioUtils";
import { ModelTier } from "./llm";
import { tryHandleCommand, RegexCommandResult } from "../commands";
import { Orchestrator } from "../commands/orchestrator";

// Milestone 8 (VAD) tuning knobs — optional .env overrides, same pattern
// as PROXY_HOTKEY in electron/main.ts. Read here rather than in
// audioUtils.ts so that module stays a pure, independently-testable
// helper (options in, result out) and engine.ts is the one place that
// knows how Proxy is actually configured.
const VAD_SILENCE_MS = Number(process.env.PROXY_VAD_SILENCE_MS) || 900;
const VAD_MAX_WAIT_MS = Number(process.env.PROXY_VAD_MAX_WAIT_MS) || 6000;
const VAD_MAX_RECORD_MS = Number(process.env.PROXY_VAD_MAX_MS) || 15000;
// Unset by default (adaptive calibration is used instead) — only kicks in
// if explicitly set, as an escape hatch for a mic/room where calibration
// guesses wrong. See recordUntilSilence()'s docblock in audioUtils.ts.
const VAD_FIXED_THRESHOLD = Number(process.env.PROXY_VAD_THRESHOLD) || undefined;

// Milestone 9 step 6 — same "env knobs live in engine.ts, not the module
// they configure" pattern as the VAD constants above. Orchestrator.ts
// has its own DEFAULT_MAX_STEPS fallback so it stays independently
// usable/testable without this file, but engine.ts is what actually
// knows how Proxy is configured on this machine.
const ORCHESTRATOR_MAX_STEPS = Number(process.env.PROXY_ORCHESTRATOR_MAX_STEPS) || 5;

// Discriminated union describing how a given utterance was ultimately
// handled — this is the "which router handled it" info CLAUDE.md calls
// for in the dashboard. `tools` is an array as of Milestone 9 step 6
// (was a single `tool` string) — the orchestrator can chain more than
// one real tool call per request now, and reporting only the first/last
// one would misrepresent what actually happened.
export type RouteInfo =
  | { source: "regex"; handler: RegexCommandResult["handler"] }
  | { source: "llm-tool"; tools: string[] }
  | { source: "conversation" };

export interface EngineEvents {
  busy: () => void; // trigger fired while a previous request was still running
  // Milestone 8: no fixed duration anymore, so there's no "seconds" to
  // report up front — maxMs is the hard safety cap (recording stops
  // regardless past this point), included so the UI can say something
  // true ("auto-stops after Ns") instead of a countdown that would
  // imply a duration Proxy isn't actually using.
  listening: (info: { maxMs: number }) => void;
  // Fires once, the moment the VAD actually hears speech (as opposed to
  // just "recording started, still waiting for you to talk").
  "speech-start": () => void;
  // Milestone 9 step 6: fires the moment speech was heard and recording
  // stopped, right before the whisper call starts. Previously this gap
  // was silent — a real honesty fix on its own, not just new UI
  // plumbing (see CLAUDE.md's Activity panel design).
  transcribing: () => void;
  transcribed: (text: string) => void;
  "no-speech": () => void;
  // The four below only fire for the orchestrator path (regex-matched
  // commands skip straight from `routed` to `reply` — a regex hit is a
  // near-instant pattern match, not a "decision," and inventing rows for
  // stages that didn't really happen would be exactly the kind of fake
  // precision the transparency principle rules out).
  deciding: (tier: ModelTier) => void;
  "tool-start": (toolName: string) => void;
  "tool-result": (toolName: string, result: string) => void;
  thinking: (trace: string) => void;
  responding: () => void;
  routed: (info: RouteInfo) => void;
  reply: (text: string) => void;
  speaking: () => void;
  idle: () => void; // request fully finished, back to waiting
  error: (err: Error) => void;
  // Fires when cancel() actually interrupted an in-flight orchestrator
  // run. The `reply`/`speaking` pipeline still runs normally right after
  // this — the orchestrator's own honest "Stopped — didn't finish
  // everything" text is what gets spoken, no special-casing needed here.
  cancelled: () => void;
}

export declare interface ProxyEngine {
  on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this;
  emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): boolean;
}

export class ProxyEngine extends EventEmitter {
  private busy = false;
  private initialized = false;
  // One instance, reused across requests — not recreated per call —
  // so cancel() always has the actually-in-flight run to act on. Its
  // events are forwarded here once, in the constructor, not per-run:
  // re-subscribing on every process() call would double up the forwarded
  // events on the second request and keep multiplying from there.
  private orchestrator = new Orchestrator();

  constructor() {
    super();
    this.orchestrator.on("deciding", (tier) => this.emit("deciding", tier));
    this.orchestrator.on("tool-start", (name) => this.emit("tool-start", name));
    this.orchestrator.on("tool-result", (name, result) => this.emit("tool-result", name, result));
    this.orchestrator.on("thinking", (trace) => this.emit("thinking", trace));
    this.orchestrator.on("responding", () => this.emit("responding"));
    this.orchestrator.on("cancelled", () => this.emit("cancelled"));
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await initSTT();
    this.initialized = true;
  }

  /**
   * Requests the current orchestrator run (if any) stop as soon as
   * possible — see Orchestrator.cancel()'s docs for what "as soon as
   * possible" actually means (next loop boundary, not mid-request).
   * Harmless to call when nothing's cancellable in flight — a regex
   * fast-path reply, or TTS playback, or simply an idle engine — since
   * Orchestrator.cancel() just sets a flag nothing will ever read in
   * that case. Callers (main.ts, assistant.ts) decide what triggers
   * this — a second hotkey press, typed "stop," Enter pressed again.
   */
  cancel(): void {
    this.orchestrator.cancel();
  }

  /** True while a request is in flight — callers can use this to ignore/queue triggers. */
  isBusy(): boolean {
    return this.busy;
  }

  async runOnce(): Promise<void> {
    if (this.busy) {
      this.emit("busy");
      return;
    }
    this.busy = true;

    try {
      this.emit("listening", { maxMs: VAD_MAX_RECORD_MS });
      const { audio, speechDetected } = await recordUntilSilence({
        silenceHangMs: VAD_SILENCE_MS,
        maxWaitForSpeechMs: VAD_MAX_WAIT_MS,
        maxRecordMs: VAD_MAX_RECORD_MS,
        fixedThreshold: VAD_FIXED_THRESHOLD,
        onSpeechStart: () => this.emit("speech-start"),
      });

      // Nothing ever crossed the threshold — skip STT entirely rather
      // than running a whisper pass over near-silence. This is a real
      // latency win on top of VAD's main point (Whisper on CPU is the
      // slowest stage in the pipeline — see Known limitations).
      if (!speechDetected) {
        this.emit("no-speech");
        return;
      }

      this.emit("transcribing");
      const text = await transcribe(audio);

      if (!text) {
        this.emit("no-speech");
        return;
      }
      this.emit("transcribed", text);
      await this.process(text);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.busy = false;
      this.emit("idle");
    }
  }

  /** Same pipeline as runOnce(), but for text that's already known (dashboard Input box) — skips recording/STT. */
  async runWithText(text: string): Promise<void> {
    if (this.busy) {
      this.emit("busy");
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      this.emit("no-speech");
      return;
    }

    this.busy = true;
    try {
      this.emit("transcribed", trimmed);
      await this.process(trimmed);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.busy = false;
      this.emit("idle");
    }
  }

  /** Shared tail: route -> reply -> speak. Used by both entry points above. */
  private async process(text: string): Promise<void> {
    const regexResult = await tryHandleCommand(text);

    let reply: string;
    if (regexResult !== null) {
      this.emit("routed", { source: "regex", handler: regexResult.handler });
      reply = regexResult.reply;
    } else {
      // Milestone 9 step 6: the orchestrator replaces the old single-shot
      // intentRouter.ts call here. Its own deciding/tool-start/tool-result/
      // thinking/responding events are already forwarded (see constructor)
      // — this just needs its final result to build the one `routed` event
      // and get the reply into the shared speak() tail below.
      const result = await this.orchestrator.run(text, { maxSteps: ORCHESTRATOR_MAX_STEPS });
      this.emit(
        "routed",
        result.toolsUsed.length > 0
          ? { source: "llm-tool", tools: result.toolsUsed }
          : { source: "conversation" }
      );
      reply = result.reply;
    }

    this.emit("reply", reply);
    this.emit("speaking");
    await speak(reply);
  }
}
