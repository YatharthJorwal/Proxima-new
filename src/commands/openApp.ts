/**
 * "Open app" command — matches phrases like "open notepad", "launch chrome",
 * "start calculator" and spawns the app via PowerShell's Start-Process.
 *
 * The phrase -> executable mapping lives in config/commands.json (not
 * hardcoded here) so you can add new apps without touching code. See that
 * file for the format.
 *
 * We shell out through PowerShell's Start-Process (rather than spawning the
 * .exe directly with child_process.spawn) because it resolves things like
 * "ms-settings:" URIs and PATH/App-Paths-registered names the same way the
 * Start Menu / Run box would — one code path handles both regular exes and
 * special Windows targets.
 */

import * as fs from "fs";
import * as path from "path";
import { CommandHandler } from "./types";
import { launch } from "./launch";

interface CommandsConfig {
  openApp: Record<string, string>;
}

// NOTE: this assumes you're running the project directly from src/ (e.g.
// via ts-node/tsx, no separate "compile to dist/" step) — that's how
// assistant.ts is currently run. __dirname then points at src/commands,
// and config lives one level up. If you later add a build step that
// outputs to dist/, you'll need to copy commands.json alongside it or
// switch this to a project-root-relative path.
const CONFIG_PATH = path.join(__dirname, "..", "config", "commands.json");

function loadConfig(): CommandsConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as CommandsConfig;
}

// Loaded once at module load time. Edit commands.json, then restart Proxy
// to pick up changes — fine for now, not worth hot-reload complexity yet.
const config = loadConfig();

// Matches "open X", "launch X", "start X", with an optional leading
// "please" and optional trailing punctuation from STT.
const OPEN_PATTERN = /^(?:please\s+)?(?:open|launch|start)\s+(.+?)[.!?]?$/i;

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Does the actual work of opening an app, given a (possibly LLM-extracted)
 * app name. Shared by the regex handler below and the LLM tool-call path
 * (originally commands/intentRouter.ts as of Milestone 5, now
 * orchestrator.ts/tools.ts — see decisions.md) — one place that knows
 * how to actually launch an app; only how we *get* the app name differs.
 */
export async function executeOpenApp(appNameRaw: string): Promise<string> {
  const requested = normalize(appNameRaw);
  const target = config.openApp[requested];

  if (!target) {
    // We know we're being asked to open *something*, just don't have that
    // app configured. Answer directly instead of pretending — an LLM
    // reply here would just talk about opening it without actually doing
    // anything, which is more confusing than a clear "not set up".
    return `I don't have "${requested}" set up to open yet. You can add it to commands.json.`;
  }

  try {
    await launch(target);
    return `Opening ${requested}.`;
  } catch (err) {
    console.error("Failed to open app:", err);
    return `I tried to open ${requested} but something went wrong.`;
  }
}

export const tryHandleOpenApp: CommandHandler = async (text) => {
  const match = text.match(OPEN_PATTERN);
  if (!match) return null;

  const requested = normalize(match[1]);
  if (!(requested in config.openApp)) {
    // Not a known app name — don't answer confidently wrong. This regex
    // is broad on purpose ("open " + anything), which means it was
    // grabbing things it had no business claiming: "open chrome and open
    // youtube" (compound - two actions), "open youtube on chrome and
    // search for pewdiepie" (compound + a browse-shaped request), "open
    // github" (a website, not an app - github.com is in browse.ts's
    // config, but this regex ran first and never gave that a chance).
    // Returning null here instead of a canned failure lets the router
    // chain (and past it, the orchestrator, which has both open_app and
    // browse and can reason about phrasing this fixed regex can't) take
    // a real shot instead. A genuine unknown-app miss still ends up with
    // an honest "not set up" reply either way - just reached through
    // executeOpenApp() below, once something (regex or the orchestrator)
    // is actually confident this is an open_app request specifically.
    return null;
  }

  return executeOpenApp(match[1]);
};