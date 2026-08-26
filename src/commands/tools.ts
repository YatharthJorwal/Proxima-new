/**
 * Shared tool registry — Milestone 9.
 *
 * Single source of truth for what tools exist, their LLM-facing schemas,
 * and how to actually run them. Pulled out of intentRouter.ts (which
 * used to own an inline TOOLS array + switch statement) so both the
 * existing single-shot router and orchestrator.ts (later in this
 * milestone) share exactly one definition per tool instead of two
 * copies that could quietly drift apart.
 *
 * Pure refactor — no behavior change. Same three tools, same schemas,
 * same dispatch logic, just relocated and given real types instead of
 * an untyped array passed through `as any`.
 */

import { Tool } from "ollama";
import { executeOpenApp } from "./openApp";
import { executeVolume, VolumeDirection } from "./volume";
import { executeWindow, WindowAction } from "./window";
import { executeBrowse, getBrowseSites } from "./browse";

export interface ProxyTool {
  /** The LLM-facing schema — name, description, parameters. Sent to Ollama as-is. */
  schema: Tool;
  /**
   * True if this tool's result is information the model needs to reason
   * about before deciding what's next (a future "check X" style tool).
   * Default false — "fire and forget," nothing about the result should
   * change the plan. None of today's three tools need this; it's what
   * lets orchestrator.ts know structurally when a result needs a
   * reflection round versus when it doesn't (see CLAUDE.md's Milestone
   * 9 plan).
   */
  resultInformsNextStep?: boolean;
  /**
   * True if this tool needs a "are you sure?" confirmation before
   * running. Default false — nothing in the current tool set is
   * destructive enough to need this. The hook exists so a future tool
   * (delete file, send email, whatever Milestone 10+ brings) can flip
   * it on without redesigning the loop. Deliberately no interactive
   * confirm-and-wait UX built yet — no current consumer for it.
   */
  requiresConfirmation?: boolean;
  /** Actually run the tool with the arguments the model provided. Returns what Proxy should say. */
  execute(args: Record<string, unknown>): Promise<string>;
}

// Tool schemas follow the same JSON-schema-based function-calling format
// used by OpenAI/Anthropic/etc. — Ollama's tool support mirrors it.
// IMPORTANT: enum values here are written to match our internal types
// exactly (e.g. "snap-left", not "snap_left") so dispatch needs no
// translation layer between what the model says and what execute*
// expects.
export const TOOLS: Record<string, ProxyTool> = {
  open_app: {
    schema: {
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
    execute: async (args) => executeOpenApp(String(args.app_name ?? "")),
  },

  control_volume: {
    schema: {
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
    // Defensive lowercasing in case the model doesn't stick exactly to
    // the enum casing — cheap safety net, costs nothing if it wasn't needed.
    execute: async (args) =>
      executeVolume(String(args.direction ?? "").toLowerCase() as VolumeDirection),
  },

  control_window: {
    schema: {
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
    execute: async (args) =>
      executeWindow(String(args.action ?? "").toLowerCase() as WindowAction),
  },

  browse: {
    schema: {
      type: "function",
      function: {
        name: "browse",
        description:
          "Open a website, optionally with a search query - e.g. 'search youtube for lo-fi beats' or just 'open google'. Builds the right URL directly (no browser automation), same fast path as a real search bar.",
        parameters: {
          type: "object",
          properties: {
            site: {
              type: "string",
              enum: getBrowseSites(),
              description: "Which site to open.",
            },
            query: {
              type: "string",
              description: "What to search for on that site. Omit to just open the site's homepage.",
            },
          },
          required: ["site"],
        },
      },
    },
    execute: async (args) =>
      executeBrowse(String(args.site ?? ""), args.query ? String(args.query) : undefined),
  },
};

/** All tool schemas, in the shape Ollama's `tools` chat param expects. */
export function getToolSchemas(): Tool[] {
  return Object.values(TOOLS).map((t) => t.schema);
}

/**
 * Runs a tool the model asked for, by name. Throws if the name isn't
 * recognized — callers decide how to handle that (intentRouter.ts today,
 * orchestrator.ts later, both wrap this in their own try/catch, since
 * "the model asked for a tool that doesn't exist" should fail gracefully
 * with a spoken reply, not crash the pipeline).
 */
export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) {
    throw new Error(`Unrecognized tool: ${name}`);
  }
  return tool.execute(args);
}
