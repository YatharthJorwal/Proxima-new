/**
 * File tools — Milestone 10 Part A: write_file + open_path.
 *
 * The first real step toward "write me a game and show it to me" instead
 * of "I don't have a tool for that." Deliberately scoped tight: both
 * tools are confined entirely to one dedicated workspace folder
 * (PROXY_WORKSPACE_DIR, default `~/ProxyWorkspace`) that Proxy fully
 * owns - not free rein over the filesystem, and nowhere close to a
 * general-purpose shell.
 *
 * This is what makes it safe to ship *without* a confirmation-and-wait
 * gate (tools.ts's `requiresConfirmation` field exists but nothing
 * enforces it yet - see that file):
 *   - write_file can't escape the workspace folder (absolute paths and
 *     `..` traversal are rejected - see resolveInWorkspace()).
 *   - write_file will only write source/content extensions - never
 *     anything Windows would treat as directly executable (.exe, .bat,
 *     .cmd, .ps1, .vbs, .scr, .msi, .com, .jar, .lnk, .reg, .dll, ...).
 *   - open_path only auto-opens a narrower subset of that: NOT .py or
 *     .js, even though write_file is happy to write them. Depending on
 *     a machine's file associations, Start-Process opening a .js file
 *     can run it via the Windows Script Host (a real, historical malware
 *     vector), and a .py file similarly if a Python launcher owns that
 *     association. write_file writing inert source code to disk is
 *     fine; open_path auto-launching it through whatever the OS decides
 *     to do with that extension is a different risk entirely. Full
 *     reasoning: decisions.md.
 *
 * What this deliberately does NOT do: actually run code. A `run_script`
 * tool (invoke a specific known interpreter - `node`, `python` - on a
 * workspace file, not an arbitrary shell string) is the natural next
 * step for "write me a Python script and run it," but that needs a real
 * confirm-and-wait mechanism first, which doesn't exist yet. Shipping it
 * without one would mean either lying about `requiresConfirmation` or
 * giving the model unsupervised process-execution - neither acceptable.
 * See decisions.md.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { launch } from "./launch";

// Same "read the env var directly in this module" pattern openApp.ts/
// browse.ts use for config/commands.json, not the "engine.ts reads it
// and passes it in" pattern used for VAD/orchestrator step-cap knobs.
// Deliberate distinction: those are engine.ts's own pipeline behavior;
// this is a tool module's own resource, the same way commands.json is -
// engine.ts has no reason to know where Proxy's workspace folder lives.
const WORKSPACE_ROOT = path.resolve(
  process.env.PROXY_WORKSPACE_DIR || path.join(os.homedir(), "ProxyWorkspace")
);

// Content/source files only. Notably excludes anything Windows could
// run directly. .py and .js ARE allowed here (writing inert source code
// is fine) but are deliberately NOT in OPEN_SAFE_EXTENSIONS below - see
// this file's docblock.
const WRITE_ALLOWED_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".json", ".md", ".txt", ".csv", ".svg", ".py",
]);

// Subset of the above safe to auto-open via Start-Process - i.e. the
// OS's default handler for these is a viewer/editor, not something that
// can execute the file's contents.
const OPEN_SAFE_EXTENSIONS = new Set([".html", ".htm", ".css", ".json", ".md", ".txt", ".csv", ".svg"]);

// Generous for generated code/text; cheap insurance against a runaway
// response filling the disk.
const MAX_CONTENT_BYTES = 1_000_000;

/**
 * Resolves a model-supplied relative path against the workspace root and
 * confirms the result actually stays inside it. Returns null (not a
 * thrown error) on an unsafe path so callers can give a plain, honest
 * spoken reply instead of a stack trace.
 */
function resolveInWorkspace(relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  const resolved = path.resolve(WORKSPACE_ROOT, relPath);
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    return null; // ../.. escaped the workspace
  }
  return resolved;
}

/**
 * Does the actual work of writing a file, given a (model-supplied)
 * relative path and content. Shared by the tool dispatch below - no
 * regex fast path for this one, unlike openApp.ts/browse.ts, since
 * there's no sensible "fairly exact phrasing" shape for arbitrary
 * generated file content the way "open notepad" has for an app name.
 */
export async function executeWriteFile(relPath: string, content: string): Promise<string> {
  const target = resolveInWorkspace(relPath);
  if (!target) {
    return `"${relPath}" isn't a valid workspace path - I can only write inside my own workspace folder, no absolute paths or "..".`;
  }

  const ext = path.extname(relPath).toLowerCase();
  if (!WRITE_ALLOWED_EXTENSIONS.has(ext)) {
    return `I won't write a "${ext || "(no extension)"}" file - I can create source/content files (.html, .js, .py, .css, .json, .md, .txt, .csv, .svg) but nothing Windows could run on its own.`;
  }

  if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
    return `That file would be over ${Math.round(MAX_CONTENT_BYTES / 1_000_000)}MB - too large for me to write in one go.`;
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
    return `Wrote ${relPath} (${Buffer.byteLength(content, "utf-8")} bytes) to the workspace.`;
  } catch (err) {
    console.error("Failed to write file:", target, err);
    return `I tried to write ${relPath} but something went wrong.`;
  }
}

/**
 * Does the actual work of opening a workspace file via its default OS
 * handler (the same Start-Process launch() openApp.ts/browse.ts use).
 */
export async function executeOpenPath(relPath: string): Promise<string> {
  const ext = path.extname(relPath).toLowerCase();
  const target = resolveInWorkspace(relPath);
  if (!target) {
    return `"${relPath}" isn't a valid workspace path - I can only open things inside my own workspace folder.`;
  }

  if (!OPEN_SAFE_EXTENSIONS.has(ext)) {
    // Deliberate, not a silent failure or a fake "done" - see this
    // file's docblock for the .js/.py file-association risk.
    return `I wrote that file, but I won't auto-open a "${ext}" file - depending on your file associations, opening it might run it instead of just showing it. You can open it yourself for now.`;
  }

  try {
    await fs.access(target);
  } catch {
    return `I don't have a file at ${relPath} in the workspace yet.`;
  }

  try {
    await launch(target);
    return `Opening ${relPath}.`;
  } catch (err) {
    console.error("Failed to open path:", target, err);
    return `I tried to open ${relPath} but something went wrong.`;
  }
}

/** Exposed for tests and for a future "what's in my workspace" tool - not used elsewhere yet. */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}
