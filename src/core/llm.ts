/**
 * The "brain" — sends transcribed text to your local qwen3.5:9b model
 * (via Ollama, running on http://localhost:11434 by default) and
 * returns its reply.
 *
 * Requires Ollama to be running in the background (it usually starts
 * automatically on Windows after install) and `qwen3.5:9b` to already
 * be pulled — which it is, per `ollama list`.
 */

import ollama from "ollama";

const MODEL_NAME = "qwen3.5:9b";

const SYSTEM_PROMPT = `You are Proxy (short for Proxima), a helpful voice assistant running locally on the user's PC.
Keep replies short and conversational (1-3 sentences) since they will be spoken aloud, unless the
user clearly asks for more detail. Don't use markdown formatting — plain spoken sentences only.`;

/**
 * Plain conversational call, no tools. Not currently used by assistant.ts
 * (which now goes through askProxyWithTools below for the fallback path),
 * but kept around — useful for anywhere we want a straight LLM reply
 * without command-dispatch overhead, e.g. a future dashboard chat panel.
 */
export async function askProxy(userText: string): Promise<string> {
  const response = await ollama.chat({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
  });

  return response.message.content.trim();
}

// --- Milestone 5: tool-aware chat (used as the fallback path when the
// deterministic regex commands in commands/index.ts don't match) ---

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProxyToolResponse {
  // The model's plain reply, when it chose to respond conversationally
  // instead of calling a tool.
  reply: string | null;
  // The tool it decided to call instead, if any. At most one — we only
  // ever expect the model to pick one action per turn.
  toolCall: ToolCall | null;
}

const TOOL_SYSTEM_PROMPT = `${SYSTEM_PROMPT}
You have tools available to control the user's PC: opening apps, adjusting volume, and controlling
the currently focused window. If the user's request clearly matches one of those tools, call it.
Most things people say to you are ordinary conversation, not commands — only call a tool when the
request is actually asking you to do one of those specific things.`;

/**
 * Like askProxy, but exposes `tools` to the model and lets it either call
 * one (returned as `toolCall`) or reply normally (returned as `reply`).
 * This is a single LLM call doing double duty as both intent
 * classification and conversation — no separate "is this a command?"
 * pre-step.
 *
 * NOTE: this depends on qwen3.5:9b supporting Ollama's native tool-calling
 * format. Most current Qwen models do, but we haven't specifically
 * confirmed it for this one — if tool calls come back empty/unreliable
 * even for clearly-command-shaped requests, the fallback plan is
 * prompting for structured JSON output instead of relying on native tool
 * calls.
 */
export async function askProxyWithTools(
  userText: string,
  tools: unknown[]
): Promise<ProxyToolResponse> {
  const response = await ollama.chat({
    model: MODEL_NAME,
    messages: [
      { role: "system", content: TOOL_SYSTEM_PROMPT },
      { role: "user", content: userText },
    ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: tools as any,
  });

  const toolCalls = response.message.tool_calls;
  if (toolCalls && toolCalls.length > 0) {
    const call = toolCalls[0];
    return {
      reply: null,
      toolCall: {
        name: call.function.name,
        arguments: call.function.arguments as Record<string, unknown>,
      },
    };
  }

  return { reply: response.message.content.trim(), toolCall: null };
}