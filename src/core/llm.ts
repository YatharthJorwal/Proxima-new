/**
 * The "brain" — talks to your local Ollama models and returns replies or
 * tool-call decisions.
 *
 * Requires Ollama running locally (http://localhost:11434 by default).
 *
 * Milestone 9 (task orchestration): replaces the old single
 * always-qwen3.5:9b setup with two tiers. See chat()'s docblock for the
 * mechanics; see CLAUDE.md's Milestone 9 plan for the full reasoning
 * (latency goals, why same-family models, VRAM budget, etc.).
 */

import ollama, { Message, Tool } from "ollama";

export type ModelTier = "fast" | "smart";

// Same qwen3.5 family as what was already proven working on this
// machine, deliberately — keeps tool-call formatting/reliability
// consistent between tiers instead of introducing a second model
// family's quirks. qwen3.5:2b is the documented fallback for `fast` if
// qwen3.5:4b turns out too tight on VRAM alongside the smart tier and
// Milestone 7's camera/hand-tracking — swap the one line below if that
// turns out to be needed; nothing else in this file has to change.
const MODEL_BY_TIER: Record<ModelTier, string> = {
  fast: "qwen3.5:4b",
  smart: "qwen3.5:9b",
};

// ---------------------------------------------------------------------
// Personality + creator bio.
//
// Diagnosed why replies used to feel flat/corporate: the old prompt
// just listed Proxy's tools, and when the model didn't know what else
// to say, it paraphrased that list back — which is exactly the "I can
// adjust volume, open apps, etc." the user was hearing. PERSONALITY
// below tells it explicitly not to do that.
//
// CREATOR_BIO: filled in from real-machine testing (CLAUDE.md
// Milestone 9's open question #1 — resolved). Before this was answered
// it deliberately told the model not to guess a name if asked, rather
// than risk confabulating one — that held up in testing (asked "who's
// your creator," got an honest "I wish I knew" instead of a made-up
// name). Extended later (real-machine testing again — "who am i" got a
// rambling, generic answer) to explicitly say the user talking to Proxy
// IS Yatharth, not just that Yatharth is "the creator" as some separate
// fact — the model wasn't connecting those on its own. "Sir" added at
// the same time, both hardcoded rather than derived, since this is a
// single-user personal project where that's simply always true.
// ---------------------------------------------------------------------

const PERSONALITY = `You have some personality - a little dry wit is welcome - but you are not a
corporate support bot. Never recite your own capabilities as a sentence like
"I can open apps, adjust volume, etc." - if you don't understand a request,
just say so plainly, maybe with a bit of humor, the way a sharp friend would,
not like a help menu. Keep spoken replies short (1-3 sentences) unless the
user clearly wants more detail. No markdown, no emoji, no em dashes or smart
quotes - plain words and plain punctuation only. Every reply gets spoken
aloud by a local TTS model, not read as text.`;

const CREATOR_BIO = `Your creator is Yatharth, who built you (Proxima) as a personal project.
The person you're talking to right now IS Yatharth - this is his own
single-user project, not a public product, so there's no one else it
could be. If asked something like "who am I" or "who are you talking
to," answer with his name directly rather than describing him generically
as "a user" or "someone who uses this." Address him as "sir" when it
feels natural, not forced into every sentence. Refer to him by name when
that's natural too, don't force that either.`;

function buildSystemPrompt(hasTools: boolean): string {
  const toolGuidance = hasTools
    ? `\n\nYou have tools available to control the user's PC. Only call one when the request clearly asks for it - most things people say to you are ordinary conversation, not commands.

Never say you are doing, will do, or have done something a tool would be needed for (opening an app, adjusting volume, controlling a window) unless you actually call that tool in this same turn. If you're not calling a tool, don't narrate the action as if it happened - say what you'd need instead, or ask a clarifying question.`
    : "";

  return `You are Proxy (short for Proxima), a local voice assistant running on the user's PC.
${PERSONALITY}

About your creator: ${CREATOR_BIO}${toolGuidance}`;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  // The model's plain reply, when it chose to respond conversationally
  // instead of calling a tool.
  reply: string | null;
  // The tool it decided to call instead, if any. At most one — we only
  // ever expect the model to pick one action per turn (a multi-tool
  // response, if a model ever sends one, would need handling this
  // doesn't attempt yet; see CLAUDE.md's open questions).
  toolCall: ToolCall | null;
  // The model's reasoning trace, when `think` was requested and the
  // model actually produced one. Real output from Ollama, not something
  // synthesized for display — see the Activity panel design in
  // CLAUDE.md for why that distinction matters.
  thinking: string | null;
}

export interface ChatOptions {
  tier: ModelTier;
  /** Conversation so far. System prompt is prepended automatically here — don't include it. */
  messages: Message[];
  tools?: Tool[];
  /** Request a reasoning trace back (message.thinking). Forced to false on the fast tier regardless of what's passed here — see chat()'s docblock. */
  think?: boolean;
  /**
   * Replaces the default Proxy-persona system prompt entirely, for
   * internal calls that aren't Proxy talking to the user at all — e.g.
   * memory.ts's background fact-extraction pass (Milestone 10 Part D).
   * That call isn't a second version of "who Proxy is" (the exact drift
   * this file's single-buildSystemPrompt() design otherwise guards
   * against, per chat()'s docblock) — it's Proxy's own backend running
   * an analysis task that never reaches the user as a reply. Left
   * optional and undocumented to ordinary callers on purpose: anything
   * that IS a reply to the user should keep going through
   * buildSystemPrompt() like every other caller here.
   */
  systemPromptOverride?: string;
}

/**
 * The one place that actually calls Ollama. Two things worth calling out:
 *
 * - Tier picks the model (see MODEL_BY_TIER above). The fast tier ALWAYS
 *   runs with thinking forced off, regardless of what's passed — "the
 *   fast tier doesn't overthink" is a hard rule of this design, not a
 *   convention callers have to remember to follow. Only the smart tier
 *   can think, and only when a caller explicitly asks for it (defaults
 *   to false, so nothing changes for a caller that doesn't know about
 *   thinking yet — see the back-compat wrappers below).
 * - The system prompt is built here, not by callers — one place that
 *   can't drift into two different versions of who Proxy is depending on
 *   which code path is asking.
 */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const think = opts.tier === "fast" ? false : opts.think ?? false;

  const response = await ollama.chat({
    model: MODEL_BY_TIER[opts.tier],
    messages: [
      {
        role: "system",
        content: opts.systemPromptOverride ?? buildSystemPrompt(Boolean(opts.tools && opts.tools.length > 0)),
      },
      ...opts.messages,
    ],
    tools: opts.tools,
    think,
  });

  const toolCalls = response.message.tool_calls;
  const toolCall =
    toolCalls && toolCalls.length > 0
      ? {
          name: toolCalls[0].function.name,
          arguments: toolCalls[0].function.arguments as Record<string, unknown>,
        }
      : null;

  return {
    reply: toolCall ? null : response.message.content.trim(),
    toolCall,
    thinking: response.message.thinking ?? null,
  };
}

// ---------------------------------------------------------------------
// Back-compat wrappers around chat().
//
// Originally kept so commands/intentRouter.ts (Milestone 5's single-shot
// router) didn't need to change when chat() was rewritten for Milestone
// 9's two-tier setup. intentRouter.ts has since been deleted (Milestone
// 9 is confirmed working on orchestrator.ts/tools.ts instead — see
// decisions.md), so these two currently have no caller anywhere in the
// codebase. Left in rather than deleted alongside it: unlike
// intentRouter.ts, nothing here was ever flagged as dead weight to clean
// up, and a plain conversational call / single-shot tool call is a
// reasonable thing a future feature (a dashboard chat panel, say) might
// still want without going through the full orchestrator loop.
// ---------------------------------------------------------------------

export interface ProxyToolResponse {
  reply: string | null;
  toolCall: ToolCall | null;
}

/**
 * Plain conversational call, no tools. Not currently used anywhere —
 * assistant.ts and the dashboard both go through engine.ts's
 * orchestrator now, not this. Kept around for anywhere that wants a
 * straight LLM reply without command-dispatch overhead, e.g. a future
 * dashboard chat panel.
 */
export async function askProxy(userText: string): Promise<string> {
  const result = await chat({
    tier: "smart",
    messages: [{ role: "user", content: userText }],
  });
  return result.reply ?? "";
}

/**
 * Like askProxy, but exposes `tools` to the model and lets it either
 * call one (returned as `toolCall`) or reply normally (returned as
 * `reply`) — single LLM call doing double duty as both intent
 * classification and conversation.
 */
export async function askProxyWithTools(
  userText: string,
  tools: unknown[]
): Promise<ProxyToolResponse> {
  const result = await chat({
    tier: "smart",
    messages: [{ role: "user", content: userText }],
    tools: tools as Tool[],
  });
  return { reply: result.reply, toolCall: result.toolCall };
}
