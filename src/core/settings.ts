/**
 * Milestone 13, second half — backs the dashboard's Settings modal.
 *
 * Design decision (asked, not defaulted on, same as Part B's confirmation
 * mechanism): saved settings live in a separate flat JSON file layered
 * OVER .env, rather than rewriting .env directly. Same shape as
 * core/memory.ts and core/sessionLog.ts's existing local-JSON-file
 * pattern, and it sidesteps a real risk a direct-.env-rewrite approach
 * would have: .env is a hand-edited file with the user's own comments
 * and formatting, and a programmatic rewrite that only knows about 17
 * specific keys risks mangling anything else in it. A separate file
 * never touches .env at all.
 *
 * Mental model, and the one thing worth remembering if this ever seems
 * to misbehave: a value saved here always wins over .env. Clearing a
 * field in the Settings modal and saving removes the override, falling
 * back to whatever .env (or the built-in default) says. If you edit
 * .env directly and don't see the change take effect, check here first
 * — this file's value is still winning.
 *
 * Restart-to-apply, not live: every one of the ~18 known settings is
 * read from `process.env` once, at module load time, all over this
 * codebase (tts.ts, gmail.ts, memory.ts, sessionLog.ts, runScript.ts,
 * engine.ts, fileTools.ts, main.ts). Rearchitecting every one of those
 * to poll a live config source was explicitly weighed and rejected in
 * project-status.md before this file existed — this matches that
 * decision, not a new one made here.
 *
 * The one non-obvious wrinkle, worth flagging clearly because it's the
 * same shape of easy-to-reintroduce bug as this session's vi.hoisted()
 * testing lesson (decisions.md): applySavedSettingsToEnv() below runs
 * as a MODULE-LEVEL side effect — not something callers invoke — and it
 * matters enormously WHEN it runs relative to other imports. main.ts and
 * assistant.ts both do `import "dotenv/config"` as their very first
 * import specifically so .env is loaded before anything else reads
 * process.env; this file's `import "./settings"` (or "../core/settings")
 * has to be the very next import after that, still before engine.ts (or
 * anything that transitively imports tts.ts/gmail.ts/etc.) — otherwise
 * those modules capture process.env values BEFORE this file's overrides
 * ever get applied, and every saved setting would silently do nothing.
 * Static imports don't help by themselves here: a plain exported
 * function only runs when something calls it, and by the time an
 * import'ing file's own code runs, every module in its whole import
 * graph has already finished executing — including modules further down
 * the same file's import list. The fix, same one dotenv/config itself
 * uses: make loading a side effect of importing this file at all, and
 * put that import first.
 */

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

// One list, used both to know what to load/save and to know what NOT to
// silently pass through if the renderer ever sent something unexpected
// (see saveSettings()'s filtering below) — same "don't trust our own
// renderer blindly" instinct as main.ts's other IPC handlers.
export const SETTINGS_KEYS = [
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "PIPER_EXE_PATH",
  "PIPER_VOICE_PATH",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "PROXY_HOTKEY",
  "PROXY_ORCHESTRATOR_MAX_STEPS",
  "PROXY_SCRIPT_TIMEOUT_MS",
  "PROXY_WORKSPACE_DIR",
  "PROXY_CHROME_PROFILE_DIR",
  "PROXY_MEMORY_FILE",
  "PROXY_SESSION_LOG_FILE",
  "PROXY_VAD_MAX_MS",
  "PROXY_VAD_MAX_WAIT_MS",
  "PROXY_VAD_SILENCE_MS",
  "PROXY_VAD_THRESHOLD",
] as const;

export type SettingKey = (typeof SETTINGS_KEYS)[number];
export type SettingsMap = Partial<Record<SettingKey, string>>;

const SETTINGS_FILE = process.env.PROXY_SETTINGS_FILE || path.join(os.homedir(), ".proxima", "settings.json");

/**
 * Synchronous on purpose — see the module docblock. This is the one
 * place in the app that can't use the fs/promises pattern every other
 * storage file here uses, because it has to finish before the rest of
 * the import graph even starts evaluating.
 */
function loadSavedSettingsSync(): SettingsMap {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    // First run (no file yet) and a corrupted file both land here - both
    // should behave like "no overrides," not crash startup. Same
    // reasoning as sessionLog.ts's loadLogHistory(), just sync.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to read settings.json, ignoring saved settings for this run:", err);
    }
    return {};
  }
}

function applySavedSettingsToEnv(): void {
  const saved = loadSavedSettingsSync();
  for (const key of SETTINGS_KEYS) {
    const value = saved[key];
    if (typeof value === "string" && value.length > 0) {
      process.env[key] = value;
    }
  }
}

// The side effect itself - runs once, the moment this file is first
// imported. See the module docblock for why this can't be an exported
// function callers remember to invoke instead.
applySavedSettingsToEnv();

/**
 * What the Settings modal actually shows: the CURRENTLY EFFECTIVE value
 * of every known setting, whatever its source (a saved override, .env,
 * or unset). Deliberately not "just what's in settings.json" - showing
 * only override-file contents would make a value the user set directly
 * in .env look blank/unset in the UI, which reads as "Proxy doesn't know
 * about this" when it does. process.env already holds the fully resolved
 * value by the time anything calls this (applySavedSettingsToEnv() ran
 * at import time, before this function could ever be reached).
 */
export function getEffectiveSettings(): SettingsMap {
  const result: SettingsMap = {};
  for (const key of SETTINGS_KEYS) {
    result[key] = process.env[key] || "";
  }
  return result;
}

/**
 * Full-replace semantics, not a partial merge: whatever the modal had
 * filled in when Save was clicked becomes settings.json's entire
 * content, key by key - a blank field means "no override for this one,"
 * which deletes that key rather than persisting an empty string (an
 * empty-string override would itself be a value that could win over a
 * real .env one, which isn't what a blank field is meant to communicate).
 * This keeps the mental model simple: settings.json's content is always
 * exactly "what's currently filled in, minus the blanks," directly
 * readable and predictable if you ever open the file by hand.
 */
export async function saveSettings(values: SettingsMap): Promise<void> {
  const toPersist: SettingsMap = {};
  for (const key of SETTINGS_KEYS) {
    const value = values[key];
    if (typeof value === "string" && value.trim().length > 0) {
      toPersist[key] = value.trim();
    }
  }
  await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(toPersist, null, 2), "utf-8");
}
