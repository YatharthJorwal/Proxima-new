/**
 * LLM-based fallback router (Milestone 5).
 *
 * The deterministic regex router in index.ts handles exact phrasing fast,
 * with zero LLM latency ("open notepad", "volume up", etc.). Anything it
 * doesn't recognize comes HERE instead of going straight to plain
 * conversation: we ask qwen — with our three commands exposed as tools —
 * to decide whether the request is actually a command in disguise
 * ("bring the volume to 30", "hey pull up discord for me") or genuine
 * conversation, and either dispatch the matching command or return the
 * model's conversational reply.
 *
 * This reuses the same execute* functions the regex handlers call (see
 * openApp.ts / volume.ts / window.ts) — there's exactly one place that
 * knows how to actually run each command; only how we *parse intent*
 * differs (regex vs LLM).
 *
 * assistant.ts calls this as the fallback, in place of the old plain
 * askProxy call — so every message that doesn't hit the regex router now
 * gets a chance to be recognized as a command here first, before falling
 * through to genuine conversation.
 */

import { askProxyWithTools } from "../core/llm";
import { executeOpenApp } from "./openApp";
import { executeVolume, VolumeDirection } from "./volume";
import { executeWindow, WindowAction } from "./window";

// Tool schemas follow the same JSON-schema-based function-calling format
// used by OpenAI/Anthropic/etc. — Ollama's tool support mirrors it.
// IMPORTANT: enum values here are written to match our internal types
// exactly (e.g. "snap-left", not "snap_left") so dispatch below needs no
// translation layer between what the model says and what execute*
// expects.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "open_app",
      description: "Open, launch, or start an application on the user's PC by name.",
      parameters: {
        type: "object",
        properties: {
          app_name: {
            type: "string",
            description: "Name of the app to open, e.g. 'discord', 'chrome', 'notepad'.",
          },
        },
        required: ["app_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_volume",
      description: "Adjust the system volume up or down, or mute/unmute it.",
      parameters: {
        type: "object",
        properties: {
          direction: {
            type: "string",
            enum: ["up", "down", "mute", "unmute"],
            description: "Which way to adjust the volume.",
          },
        },
        required: ["direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "control_window",
      description:
        "Maximize, minimize, restore, or snap the currently focused window to one side of the screen.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["maximize", "minimize", "restore", "snap-left", "snap-right"],
            description: "The window action to perform.",
          },
        },
        required: ["action"],
      },
    },
  },
];

export async function handleWithIntent(text: string): Promise<string> {
  const { reply, toolCall } = await askProxyWithTools(text, TOOLS);

  if (!toolCall) {
    // The model looked at this and decided it's just conversation.
    return reply ?? "";
  }

  // Defensive lowercasing in case the model doesn't stick exactly to the
  // enum casing — cheap safety net, costs nothing if it wasn't needed.
  try {
    switch (toolCall.name) {
      case "open_app":
        return await executeOpenApp(String(toolCall.arguments.app_name ?? ""));

      case "control_volume":
        return await executeVolume(
          String(toolCall.arguments.direction ?? "").toLowerCase() as VolumeDirection
        );

      case "control_window":
        return await executeWindow(
          String(toolCall.arguments.action ?? "").toLowerCase() as WindowAction
        );

      default:
        console.warn("Model called an unrecognized tool:", toolCall.name);
        return "I'm not sure how to do that yet.";
    }
  } catch (err) {
    console.error("Failed to dispatch tool call:", toolCall, err);
    return "I understood what you wanted, but something went wrong doing it.";
  }
}