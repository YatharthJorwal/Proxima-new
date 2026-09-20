/**
 * Shared tool registry — Milestone 9.
 *
 * Single source of truth for what tools exist, their LLM-facing schemas,
 * and how to actually run them. Pulled out of intentRouter.ts (which
 * used to own an inline TOOLS array + switch statement, until that file
 * was deleted once Milestone 9 was confirmed working — see decisions.md)
 * so orchestrator.ts has exactly one definition per tool instead of
 * copies that could quietly drift apart.
 *
 * Started as a pure refactor of three tools with no behavior change;
 * every tool since (file tools, query tools, Gmail, memory, run_script)
 * has been added here as the single place a tool needs to be registered
 * to reach both the fast and smart tier.
 */

import { Tool } from "ollama";
import { executeOpenApp } from "./openApp";
import { executeVolume, VolumeDirection } from "./volume";
import { executeWindow, WindowAction } from "./window";
import { executeBrowse, getBrowseSites } from "./browse";
import { executeWriteFile, executeOpenPath } from "./fileTools";
import { executeGetSystemUsage } from "./systemUsage";
import { executeGetEmails } from "./gmail";
import { executeRecallFacts } from "./memory";
import { executeRunScript } from "./runScript";
import {
  executeBrowserNavigate,
  executeBrowserClick,
  executeBrowserType,
  executeBrowserReadPage,
} from "./browserAutomation";

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
   * running for real. Default false — nothing else in the current tool
   * set is destructive enough to need this.
   *
   * First real consumer: `run_script` (Milestone 10 Part B, runScript.ts)
   * — but this field is documentation of that property, not something
   * orchestrator.ts reads and enforces. There's still no generic
   * confirm-and-wait gate here; `run_script` satisfies "requires
   * confirmation" entirely through its own design (its execute() never
   * runs anything, just registers a pending confirmation that a
   * *separate following turn* resolves — see runScript.ts's docblock for
   * the full mechanism and why a follow-up turn, not a mid-run pause). A
   * different future tool needing confirmation would need its own
   * version of that same pattern, or a genuinely generic gate built
   * later — this flag alone doesn't grant one.
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
        description:
          "Open, launch, or start a DESKTOP application already installed on the user's PC, by name (e.g. 'discord', 'chrome', 'notepad'). For a WEBSITE (YouTube, GitHub, Google, etc.) use the browse tool instead, even if it was phrased as 'open X' - browse knows the real list of configured sites; this tool doesn't.",
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
          "Open a website, optionally with a search query - e.g. 'search youtube for lo-fi beats' or just 'open google'. Builds the right URL directly, no clicking or typing on the page itself. Never use this for 'chrome', 'edge', 'firefox', or 'the browser' - those mean launching the browser application itself, which is open_app's job, not this tool's; this tool has no way to do that and picking a fallback site would be a wrong guess, not a real answer. Also never use this as a substitute when 'click X' or 'click the Y link' fails or the browser tools aren't working - searching for the same term on Google is not the same thing as clicking it, and describing that substitution as if it fulfilled the request would be exactly the kind of claim you're told not to make. Use this when opening/searching an actual website is the whole task; if the task needs clicking something or filling in a field after that, use browser_navigate instead.",
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

  // Milestone 10 Part A — see fileTools.ts's docblock for the full
  // sandboxing story (workspace-folder confinement, extension
  // allowlists, why open_path won't touch .js/.py). Neither tool is
  // flagged requiresConfirmation: sandboxing is what keeps these two
  // safe to ship, not a confirmation gate — see run_script below for the
  // tool that actually needed one.
  write_file: {
    schema: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Write text content to a file in Proxy's own workspace folder (not the general filesystem) - source code, HTML/CSS/JS, notes, data files. Use a relative path like 'flappybird.html' or 'games/snake.js'. To actually show the result to the user afterward, call open_path next.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path within the workspace, e.g. 'flappybird.html'. No absolute paths, no '..'.",
            },
            content: {
              type: "string",
              description: "The full file content to write.",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    execute: async (args) => executeWriteFile(String(args.path ?? ""), String(args.content ?? "")),
  },

  open_path: {
    schema: {
      type: "function",
      function: {
        name: "open_path",
        description:
          "Open a file that already exists in Proxy's own workspace folder, using its default viewer (e.g. an .html file opens in the browser). Only for files Proxy itself wrote via write_file - not for opening arbitrary files elsewhere on the PC (use open_app for that).",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path within the workspace, e.g. 'flappybird.html'.",
            },
          },
          required: ["path"],
        },
      },
    },
    execute: async (args) => executeOpenPath(String(args.path ?? "")),
  },

  // Milestone 19 Part A — the first query tool (fetches real numbers to
  // reason over), as opposed to every tool above it, which performs an
  // action. See systemUsage.ts's docblock for why that distinction
  // mattered for how it's implemented.
  get_system_usage: {
    schema: {
      type: "function",
      function: {
        name: "get_system_usage",
        description:
          "Check current CPU and memory (RAM) usage, and which processes are using the most - e.g. 'what's eating my RAM', 'how's my CPU doing', 'what's using all my memory'. Takes a moment to run (queries Windows directly). No arguments needed.",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => executeGetSystemUsage(),
  },

  // Milestone 10 Part C — Gmail slice. A second query tool (see
  // get_system_usage above for the query-vs-action distinction) and the
  // first that needs one-time user setup (OAuth) before it works at all
  // - see gmail.ts's docblock for why that doesn't need
  // requiresConfirmation the way a future run_script tool will.
  get_emails: {
    schema: {
      type: "function",
      function: {
        name: "get_emails",
        description:
          "Check or search the user's Gmail inbox - e.g. 'do I have any new emails', 'any emails from priya', 'check for emails about the invoice'. query is optional Gmail search syntax (e.g. 'is:unread', 'from:priya@example.com', 'subject:invoice') - omit it to just get the most recent inbox messages. Returns sender, subject, and a short preview only, never the full email body.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Gmail search syntax, e.g. 'is:unread' or 'from:priya@example.com'. Omit for the most recent messages.",
            },
            max_results: {
              type: "number",
              description: "How many emails to return, 1-10. Defaults to 5.",
            },
          },
        },
      },
    },
    execute: async (args) =>
      executeGetEmails({
        query: args.query ? String(args.query) : undefined,
        max_results: typeof args.max_results === "number" ? args.max_results : undefined,
      }),
  },

  // Milestone 10 Part D — the first tool to actually use
  // resultInformsNextStep (see that field's docs above, and
  // orchestrator.ts's docblock, which anticipated this exact shape before
  // any tool needed it). Recalled facts are raw material for an answer,
  // not the answer itself - the smart tier needs a pass over the result
  // to compose a real reply, not have it read back verbatim. Facts
  // themselves are captured automatically, not through this tool - see
  // core/memory.ts.
  recall_facts: {
    schema: {
      type: "function",
      function: {
        name: "recall_facts",
        description:
          "Check what you already know about the user or their ongoing projects from past interactions - e.g. 'what's my dog's name', 'what do you know about my current project'. query is an optional keyword to narrow the search (e.g. 'dog', 'project'); omit it to get everything currently remembered. This is READ-ONLY - there is no corresponding tool to add, correct, or remove a fact, so don't call this in response to a 'remember X' or 'forget X' request; there's nothing this tool can do about either.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Optional keyword to filter remembered facts by. Omit to get everything remembered.",
            },
          },
        },
      },
    },
    resultInformsNextStep: true,
    execute: async (args) => executeRecallFacts({ query: args.query ? String(args.query) : undefined }),
  },

  // Milestone 10 Part B — the tool this whole confirmation mechanism was
  // built for. Fire-and-forget like write_file (its own return text IS
  // the final reply) — NOT resultInformsNextStep, since both the
  // confirmation-request reply and the eventual run-result reply are
  // meant to be spoken exactly as returned, not composed further by the
  // smart tier. See runScript.ts's docblock for the full confirmation
  // design and why requiresConfirmation here doesn't route through any
  // generic orchestrator-level gate.
  run_script: {
    schema: {
      type: "function",
      function: {
        name: "run_script",
        description:
          "Run a script that already exists in the workspace (usually one written earlier with write_file) - e.g. 'run that script', 'execute test.py'. Only .js (via node) and .py (via python) are supported. This does NOT execute immediately - it asks for a yes/no confirmation first, and only actually runs the script if the user confirms in their next reply.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Workspace-relative path to the script to run, e.g. 'game.js' or 'analyze.py'.",
            },
          },
          required: ["path"],
        },
      },
    },
    requiresConfirmation: true,
    execute: async (args) => executeRunScript({ path: args.path ? String(args.path) : undefined }),
  },

  // Browser automation — the "stretch goal" browse.ts's own docblock
  // flagged, scoped through a real conversation (see
  // browserAutomation.ts's docblock for the full design). Use browse
  // above for the common "open/search and nothing more" case; reach for
  // these four only when the task needs to click, type, or read what's
  // actually on the page. All four are resultInformsNextStep - every one
  // returns a labeled element list that's context for the NEXT decision,
  // never something to speak verbatim (same "don't dump raw tool output"
  // lesson already logged for get_system_usage).
  browser_navigate: {
    schema: {
      type: "function",
      function: {
        name: "browser_navigate",
        description:
          "Open a URL in Proxy's browser tab, for a task that will need clicking or typing afterward - e.g. before adding something to a cart, playing a specific video, or filling in a form. Returns a numbered list of the page's clickable/typeable elements for browser_click/browser_type to reference. For just opening or searching a site with nothing further to do, use browse instead - it's faster and doesn't launch Proxy's separate automation browser.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to open, e.g. 'https://open.spotify.com' or 'open.spotify.com'.",
            },
          },
          required: ["url"],
        },
      },
    },
    resultInformsNextStep: true,
    execute: async (args) => executeBrowserNavigate({ url: args.url ? String(args.url) : undefined }),
  },

  browser_read_page: {
    schema: {
      type: "function",
      function: {
        name: "browser_read_page",
        description:
          "Get a fresh numbered list of the current page's clickable/typeable elements, without navigating or clicking anything. Call this again whenever asked something like 'can you see the page now' or 'what does it look like' - always check for real rather than answering from an earlier result or a guess, since the page may have changed (or Chrome may not even be attached yet).",
        parameters: { type: "object", properties: {} },
      },
    },
    resultInformsNextStep: true,
    execute: async () => executeBrowserReadPage(),
  },

  browser_click: {
    schema: {
      type: "function",
      function: {
        name: "browser_click",
        description:
          'Click an element from the most recent numbered element list (browser_navigate/browser_read_page/browser_click/browser_type all return one). This performs a real, visible click - the mouse actually moves and clicks on the user\'s screen, with a brief highlight ring, so if asked whether they\'ll be able to see it happen, the honest answer is yes. If asked to click something (e.g. "click the times of india link") without a specific element number given, call browser_read_page first to see what\'s actually on the current page and find the matching element there - don\'t ask the user to repeat themselves or guess by searching elsewhere without checking first. Set may_commit to true if this click submits, buys, sends, deletes, subscribes, or otherwise commits to something meaningful - when in doubt, set it true. A commit-shaped click (whether from this flag or the element\'s own label, e.g. "Buy Now") asks for a yes/no confirmation first instead of clicking immediately, resolved on the user\'s next reply.',
        parameters: {
          type: "object",
          properties: {
            element_id: {
              type: "string",
              description: "The bracketed number from the element list, e.g. '3' for '[3] button \"Play\"'.",
            },
            may_commit: {
              type: "boolean",
              description: "True if clicking this commits to something (submit, buy, send, delete, subscribe).",
            },
          },
          required: ["element_id"],
        },
      },
    },
    resultInformsNextStep: true,
    execute: async (args) =>
      executeBrowserClick({
        element_id: args.element_id ? String(args.element_id) : undefined,
        may_commit: args.may_commit === true,
      }),
  },

  browser_type: {
    schema: {
      type: "function",
      function: {
        name: "browser_type",
        description:
          "Type text into a field from the most recent numbered element list. Only enters text - never presses Enter or submits. If typing here needs to be followed by a search/submit button, use browser_click on that button as a separate step afterward.",
        parameters: {
          type: "object",
          properties: {
            element_id: {
              type: "string",
              description: "The bracketed number from the element list, e.g. '2' for '[2] input(text) \"Search\"'.",
            },
            text: {
              type: "string",
              description: "The text to type into that field.",
            },
          },
          required: ["element_id", "text"],
        },
      },
    },
    resultInformsNextStep: true,
    execute: async (args) =>
      executeBrowserType({
        element_id: args.element_id ? String(args.element_id) : undefined,
        text: args.text ? String(args.text) : undefined,
      }),
  },
};

/** All tool schemas, in the shape Ollama's `tools` chat param expects. */
export function getToolSchemas(): Tool[] {
  return Object.values(TOOLS).map((t) => t.schema);
}

/**
 * Runs a tool the model asked for, by name. Throws if the name isn't
 * recognized — orchestrator.ts (the sole caller today; the original
 * caller, intentRouter.ts, was deleted once Milestone 9 was confirmed
 * working — see decisions.md) wraps this in its own try/catch, since
 * "the model asked for a tool that doesn't exist" should fail gracefully
 * with a spoken reply, not crash the pipeline.
 */
export async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOLS[name];
  if (!tool) {
    throw new Error(`Unrecognized tool: ${name}`);
  }
  return tool.execute(args);
}
