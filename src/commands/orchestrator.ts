/**
 * Task orchestration loop — Milestone 9, build order step 4.
 *
 * This is the piece that turns Proxy from "one tool call per utterance"
 * into a real multi-step agent. It does NOT replace intentRouter.ts yet —
 * that swap (engine.ts calling this instead) is build order step 6, along
 * with the Activity panel that visualizes the events this module emits.
 * Built standalone first, deliberately, so it could be exercised by
 * step 5's unit tests without needing engine.ts, a mic, or real Ollama —
 * see CLAUDE.md's Milestone 9 plan section 8 for the full build order.
 * Step 6 is what actually calls this from engine.ts now, replacing the
 * old single-shot intentRouter.ts call.
 *
 * Shape, per that plan (section 1):
 *   1. Turn 1 always goes to the FAST tier (qwen3.5:4b, think: false),
 *      with the full tool list from tools.ts plus a fast-tier-only
 *      `defer_to_planner` escape hatch. It either:
 *        - replies conversationally (done, one call total), or
 *        - confidently calls a real tool (executed immediately; done in
 *          one call total UNLESS that tool is flagged
 *          `resultInformsNextStep`, in which case its result gets fed
 *          into the smart-tier loop below instead of being returned
 *          as-is — no current tool sets this flag, so today every
 *          fast-tier tool call is one-and-done), or
 *        - calls `defer_to_planner`, handing off to the smart tier with
 *          nothing yet resolved.
 *   2. Once escalated (by defer, or by a resultInformsNextStep result),
 *      the SMART tier (qwen3.5:9b, think: true) takes over a real
 *      ReAct-style loop: propose a tool, execute it, feed the real
 *      result back as a message, ask again — repeat until it stops
 *      calling tools or PROXY_ORCHESTRATOR_MAX_STEPS is hit. This is
 *      what makes "open notepad and snap it to the left" work: two
 *      individually fire-and-forget tool calls, chained.
 *   3. If the step cap is hit before the model signals it's done, this
 *      returns an honest "still working, wanted to check in" — never
 *      silently stops or claims completion it didn't reach.
 *
 * Env-var defaults live here (DEFAULT_MAX_STEPS), same pattern as
 * audioUtils.ts's VAD defaults — engine.ts (step 6) is where
 * PROXY_ORCHESTRATOR_MAX_STEPS actually gets read from .env and passed
 * in, keeping this module a pure options-in/result-out class like
 * recordUntilSilence(), not something that reaches into process.env
 * itself.
 */

import { EventEmitter } from "events";
import { Message, Tool } from "ollama";
import { chat, ModelTier } from "../core/llm";
import { TOOLS, getToolSchemas, dispatchTool } from "./tools";

const DEFAULT_MAX_STEPS = 5;

// Exposed only to the fast tier (never added to the smart-tier tool
// list) — its whole job is "I'm not confident planning this in one
// shot," so there's nothing for the smart-tier loop to gain by seeing
// it. Kept here rather than in tools.ts because it isn't a real,
// dispatchable action the way open_app/control_volume/control_window/
// browse are — tools.ts stays the registry of things that actually DO
// something on the PC.
const DEFER_TOOL: Tool = {
  type: "function",
  function: {
    name: "defer_to_planner",
    description:
      "Call this when the request needs multiple steps or careful planning you're not confident doing in one shot - e.g. it implies several actions in sequence, or something you don't have enough information to act on directly yet. Don't call this for anything you can already handle with one of your other tools, or with a plain reply.",
    parameters: { type: "object", properties: {} },
  },
};

export interface OrchestratorOptions {
  /** Hard cap on smart-tier loop iterations before giving up honestly. Default 5. */
  maxSteps?: number;
}

export interface OrchestratorResult {
  /** What Proxy should say back. */
  reply: string;
  /** Every tool that actually executed during this run, in order — empty for a plain conversational reply. */
  toolsUsed: string[];
  /** True if the fast tier resolved this alone (plain reply or one confident tool call) — never escalated. */
  fastTierOnly: boolean;
  /** True if PROXY_ORCHESTRATOR_MAX_STEPS was hit before the model signalled it was done. */
  hitStepCap: boolean;
  /** True if cancel() was called mid-run — reply is a best-effort "stopped" message, not the model's own words. */
  cancelled: boolean;
}

export declare interface Orchestrator {
  // tier is carried on "deciding" so a listener (the dashboard's
  // Activity panel) can tell a near-instant fast-tier decision apart
  // from a genuinely-takes-a-few-seconds smart-tier one, without
  // guessing from timing.
  on(event: "deciding", listener: (tier: ModelTier) => void): this;
  on(event: "tool-start", listener: (toolName: string) => void): this;
  on(event: "tool-result", listener: (toolName: string, result: string) => void): this;
  on(event: "thinking", listener: (trace: string) => void): this;
  on(event: "responding", listener: () => void): this;
  on(event: "cancelled", listener: () => void): this;
  emit(event: "deciding", tier: ModelTier): boolean;
  emit(event: "tool-start", toolName: string): boolean;
  emit(event: "tool-result", toolName: string, result: string): boolean;
  emit(event: "thinking", trace: string): boolean;
  emit(event: "responding"): boolean;
  emit(event: "cancelled"): boolean;
}

/**
 * One instance is meant to be reused across requests (engine.ts, at step
 * 6, will hold a single one) — `cancel()` only ever affects whichever
 * `run()` is currently in flight, and ProxyEngine's own `busy` gate
 * already ensures there's at most one at a time.
 */
export class Orchestrator extends EventEmitter {
  private cancelled = false;

  /**
   * Requests the current run() stop as soon as possible. Only checked at
   * loop boundaries (before starting the next model call) — an Ollama
   * request or a tool execution already in flight isn't interrupted
   * mid-call. That's a real limitation, not an oversight: doing better
   * would mean wiring an AbortController through the ollama client and
   * every command executor, which is more than a "minimal cancellation
   * path" (CLAUDE.md's own words for this) needs to start with. Worth
   * revisiting if real use shows the lag matters.
   */
  cancel(): void {
    this.cancelled = true;
  }

  async run(text: string, opts: OrchestratorOptions = {}): Promise<OrchestratorResult> {
    const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.cancelled = false;
    const toolsUsed: string[] = [];
    const messages: Message[] = [{ role: "user", content: text }];

    // --- Turn 1: fast tier, always ---
    this.emit("deciding", "fast");
    const fastResult = await chat({
      tier: "fast",
      messages,
      tools: [...getToolSchemas(), DEFER_TOOL],
    });

    if (!fastResult.toolCall) {
      // Plain conversation — done, one call total.
      this.emit("responding");
      return { reply: fastResult.reply ?? "", toolsUsed, fastTierOnly: true, hitStepCap: false, cancelled: false };
    }

    if (fastResult.toolCall.name === "defer_to_planner") {
      // Nothing resolved yet — hand straight to the smart-tier loop with
      // just the original request. Not recorded as a message: the defer
      // call itself carries no information the smart tier needs to see.
      return this.smartLoop(messages, toolsUsed, maxSteps);
    }

    // Fast tier confidently called a real tool — run it now.
    const { name, arguments: args } = fastResult.toolCall;
    this.emit("tool-start", name);
    const toolResult = await this.safeDispatch(name, args);
    this.emit("tool-result", name, toolResult);
    toolsUsed.push(name);

    const tool = TOOLS[name];
    if (!tool?.resultInformsNextStep) {
      // Fire-and-forget, as all current tools are — done, one call total.
      this.emit("responding");
      return { reply: toolResult, toolsUsed, fastTierOnly: true, hitStepCap: false, cancelled: false };
    }

    // Forward-looking path: no tool sets resultInformsNextStep today, so
    // this branch isn't exercised yet, but the shape is here for when
    // Milestone 10 adds a "check X" style tool. Feed the real result in
    // and let the smart tier decide what's next.
    messages.push({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });
    messages.push({ role: "tool", tool_name: name, content: toolResult });
    return this.smartLoop(messages, toolsUsed, maxSteps);
  }

  /**
   * The ReAct-style loop: propose a tool (or a final reply), execute,
   * feed the real result back, repeat — until the smart tier stops
   * calling tools or `maxSteps` is hit. `messages` already holds
   * whatever history got us here (just the user's text, or that plus a
   * fast-tier tool call/result — see run() above).
   */
  private async smartLoop(
    messages: Message[],
    toolsUsed: string[],
    maxSteps: number
  ): Promise<OrchestratorResult> {
    for (let step = 0; step < maxSteps; step++) {
      if (this.cancelled) {
        this.emit("cancelled");
        return {
          reply: "Stopped — didn't finish everything you asked.",
          toolsUsed,
          fastTierOnly: false,
          hitStepCap: false,
          cancelled: true,
        };
      }

      this.emit("deciding", "smart");
      const result = await chat({
        tier: "smart",
        messages,
        tools: getToolSchemas(), // no defer_to_planner here — the smart tier IS the planner
        think: true,
      });

      if (result.thinking) {
        this.emit("thinking", result.thinking);
      }

      if (!result.toolCall) {
        this.emit("responding");
        return { reply: result.reply ?? "", toolsUsed, fastTierOnly: false, hitStepCap: false, cancelled: false };
      }

      const { name, arguments: args } = result.toolCall;
      messages.push({ role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] });

      this.emit("tool-start", name);
      const toolResult = await this.safeDispatch(name, args);
      this.emit("tool-result", name, toolResult);
      toolsUsed.push(name);

      messages.push({ role: "tool", tool_name: name, content: toolResult });
    }

    // Cap hit before the model signalled it was done — say so honestly
    // rather than silently stopping or pretending the task finished.
    this.emit("responding");
    return {
      reply: "I've done a few things but want to check in before going further.",
      toolsUsed,
      fastTierOnly: false,
      hitStepCap: true,
      cancelled: false,
    };
  }

  /**
   * dispatchTool() throws for an unrecognized name or a genuine execution
   * failure — the orchestrator's job is to keep the loop alive and hand
   * the model (or the user) an honest spoken-friendly result either way,
   * not to crash the pipeline. Mirrors intentRouter.ts's existing
   * try/catch shape around the same call.
   */
  private async safeDispatch(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      return await dispatchTool(name, args);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Unrecognized tool")) {
        console.warn("Model called an unrecognized tool:", name);
        return "I'm not sure how to do that yet.";
      }
      console.error("Failed to dispatch tool call:", name, args, err);
      return "Something went wrong trying to do that.";
    }
  }
}
