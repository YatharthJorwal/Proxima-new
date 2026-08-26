/**
 * LLM-based fallback router (Milestone 5).
 *
 * The deterministic regex router in index.ts handles exact phrasing fast,
 * with zero LLM latency ("open notepad", "volume up", etc.). Anything it
 * doesn't recognize comes HERE instead of going straight to plain
 * conversation: we ask qwen — with our tools exposed — to decide whether
 * the request is actually a command in disguise ("bring the volume to
 * 30", "hey pull up discord for me") or genuine conversation, and either
 * dispatch the matching command or return the model's conversational
 * reply.
 *
 * Tool schemas + dispatch now live in tools.ts (Milestone 9) — this file
 * used to own an inline TOOLS array and a switch statement, both pulled
 * out into a shared registry so orchestrator.ts (later in Milestone 9)
 * doesn't need its own separate copy of the same three tools. Pure
 * refactor, no behavior change here.
 *
 * assistant.ts calls this as the fallback, in place of the old plain
 * askProxy call — so every message that doesn't hit the regex router now
 * gets a chance to be recognized as a command here first, before falling
 * through to genuine conversation.
 */

import { askProxyWithTools } from "../core/llm";
import { getToolSchemas, dispatchTool } from "./tools";

export interface IntentResult {
  reply: string;
  // null = the model just replied conversationally, no tool called.
  tool: string | null;
}

export async function handleWithIntent(text: string): Promise<IntentResult> {
  const { reply, toolCall } = await askProxyWithTools(text, getToolSchemas());

  if (!toolCall) {
    // The model looked at this and decided it's just conversation.
    return { reply: reply ?? "", tool: null };
  }

  try {
    const result = await dispatchTool(toolCall.name, toolCall.arguments);
    return { reply: result, tool: toolCall.name };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unrecognized tool")) {
      console.warn("Model called an unrecognized tool:", toolCall.name);
      return { reply: "I'm not sure how to do that yet.", tool: toolCall.name };
    }
    console.error("Failed to dispatch tool call:", toolCall, err);
    return {
      reply: "I understood what you wanted, but something went wrong doing it.",
      tool: toolCall.name,
    };
  }
}
