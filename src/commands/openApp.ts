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

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { CommandHandler } from "./types";

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

function launch(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -WindowStyle Hidden keeps a PowerShell console window from flashing
    // up on screen every time you open something.
    const ps = spawn("powershell.exe", [
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process "${target}"`,
    ]);

    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Start-Process exited with code ${code}`));
    });
  });
}

/**
 * Does the actual work of opening an app, given a (possibly LLM-extracted)
 * app name. Shared by the regex handler below and, as of Milestone 5, the
 * LLM tool-call path in commands/intentRouter.ts — one place that knows
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
  return executeOpenApp(match[1]);
};