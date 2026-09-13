/**
 * Persisted dashboard session log — Milestone 13, first slice.
 * (The settings-panel half of Milestone 13 is a separate piece of work,
 * not part of this file or this patch.)
 *
 * Mirrors the shape of core/memory.ts's storage (flat capped local
 * JSON, no database) but stores something different: not facts Proxy
 * learned about the user, just a durable copy of what the dashboard's
 * own SESSION LOG card already shows — closing the "everything resets
 * on relaunch" rough edge project-status.md flagged for this milestone.
 *
 * Deliberately dumb: this file only knows how to store and retrieve
 * {kind, text, timestamp} entries. It doesn't know what "routed" or
 * "reply" mean, and doesn't format anything — all of that logic already
 * lives in renderer.js's appendLog()/describeRoute(), and duplicating
 * it here would just create a second place that could drift from the
 * first. main.ts relays already-formatted {kind, text} pairs from the
 * renderer straight through to here (see main.ts's
 * "proxy:persist-log-entry" handler) rather than reconstructing the
 * same formatting independently on the main-process side.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";

export interface LogEntry {
  kind: string;
  text: string;
  timestamp: string;
}

const LOG_FILE = process.env.PROXY_SESSION_LOG_FILE || path.join(os.homedir(), ".proxima", "session-log.json");

// Same cap-and-prune reasoning as core/memory.ts's MAX_FACTS - a
// dashboard log has no natural end, so something has to bound the file.
// 500 is generous for "history you might actually scroll back through"
// while staying a small, fast-to-load file even on a slow disk.
const MAX_ENTRIES = 500;

export async function loadLogHistory(): Promise<LogEntry[]> {
  try {
    const raw = await fs.readFile(LOG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // First run (no file yet) and a corrupted file both land here - both
    // should behave like "no history," not crash startup or a live
    // append.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to read session log, treating as empty:", err);
    }
    return [];
  }
}

/**
 * Read-modify-write on every call, same as core/memory.ts's addFacts() -
 * fine at this scale (a personal, single-user app logging at human
 * conversation speed, not a high-throughput writer) and keeps this file
 * simple rather than optimizing for a load this app doesn't have.
 */
export async function appendLogEntry(kind: string, text: string): Promise<void> {
  try {
    const existing = await loadLogHistory();
    const entry: LogEntry = { kind, text, timestamp: new Date().toISOString() };
    const combined = [...existing, entry];
    const trimmed = combined.length > MAX_ENTRIES ? combined.slice(combined.length - MAX_ENTRIES) : combined;
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify(trimmed), "utf-8");
  } catch (err) {
    // Best-effort, same as core/memory.ts's extraction failures - a
    // failed log write should never crash the app or block the
    // dashboard's own live update, which has already happened by the
    // time this runs.
    console.error("Failed to persist session log entry:", err);
  }
}

/**
 * Backs the dashboard's "Clear" button. Writes an empty array rather than
 * deleting the file - keeps loadLogHistory()'s read path uniform (an
 * empty array either way) and avoids reintroducing an ENOENT case
 * appendLogEntry's next write would just have to handle anyway.
 */
export async function clearLogHistory(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.writeFile(LOG_FILE, JSON.stringify([]), "utf-8");
  } catch (err) {
    console.error("Failed to clear session log:", err);
  }
}
