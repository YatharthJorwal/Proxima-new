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
import { tryHandleCommand, RegexCommandResult } from "../commands";
import { handleWithIntent } from "../commands/intentRouter";

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

// Discriminated union describing how a given utterance was ultimately
// handled — this is the "which router handled it" info CLAUDE.md calls
// for in the dashboard.
export type RouteInfo =
  | { source: "regex"; handler: RegexCommandResult["handler"] }
  | { source: "llm-tool"; tool: string }
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
  transcribed: (text: string) => void;
  "no-speech": () => void;
  routed: (info: RouteInfo) => void;
  reply: (text: string) => void;
  speaking: () => void;
  idle: () => void; // request fully finished, back to waiting
  error: (err: Error) => void;
}

export declare interface ProxyEngine {
  on<K extends keyof EngineEvents>(event: K, listener: EngineEvents[K]): this;
  emit<K extends keyof EngineEvents>(event: K, ...args: Parameters<EngineEvents[K]>): boolean;
}

export class ProxyEngine extends EventEmitter {
  private busy = false;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await initSTT();
    this.initialized = true;
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
      const intentResult = await handleWithIntent(text);
      this.emit(
        "routed",
        intentResult.tool
          ? { source: "llm-tool", tool: intentResult.tool }
          : { source: "conversation" }
      );
      reply = intentResult.reply;
    }

    this.emit("reply", reply);
    this.emit("speaking");
    await speak(reply);
  }
}
