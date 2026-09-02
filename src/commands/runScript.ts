/**
 * run_script — Milestone 10 Part B. The confirmation gate this tool was
 * blocked on until now (see decisions.md's "why Part B is blocked on a
 * confirmation mechanism that doesn't exist" entry). Design decided in
 * conversation: voice confirmation via a SEPARATE, following turn - not
 * an inline pause mid-orchestrator-run.
 *
 * Why a separate turn, not a mid-run pause: this app has no multi-turn
 * "session" or open-mic concept anywhere else (core/memory.ts's docblock
 * already established this for the same reason) - every hotkey press is
 * one self-contained interaction. Making the orchestrator loop genuinely
 * pause mid-flight and wait for a follow-up utterance would mean
 * building a "stay listening" mode this app doesn't have anywhere else
 * in its architecture. A follow-up TURN, by contrast, is something this
 * app already does effortlessly - it's just the next hotkey press.
 *
 * Mechanism: calling this tool never executes anything immediately. It
 * validates the request, stores exactly one pending confirmation
 * (module-level state - there's only ever one Proxy, one thing awaiting
 * confirmation at a time, no need for anything fancier than a single
 * variable), and replies asking for a yes/no. engine.ts's process()
 * checks tryResolvePendingConfirmation() as the very first thing on
 * every subsequent interaction - before the regex router or the
 * orchestrator ever see the new utterance.
 *
 * The confirmation window is exactly one utterance wide, not time-based:
 * a clear yes runs it, a clear no cancels it, and anything else
 * (including a totally unrelated new request, like "open notepad")
 * silently drops the pending confirmation and lets that utterance get
 * processed normally as a fresh request. No timeout, no expiry clock —
 * a single non-matching utterance is strictly safer than any time
 * window, since it can't be caught out by a stray "yes" said minutes
 * later for a completely unrelated reason.
 *
 * Scope, matching what decisions.md already ruled out for this tool: no
 * shell string, no arguments - `node` or `python` (chosen by extension)
 * on exactly one workspace-relative path that must already exist,
 * resolved through fileTools.ts's resolveInWorkspace() directly rather
 * than reimplemented, so there's exactly one place that knows what
 * counts as a safe workspace path.
 *
 * Runs via execFile's async/callback form - never execFileSync -
 * specifically because this session already found a real hang: STT
 * blocking Electron's main process synchronously causes Windows' "not
 * responding" dialog (see project-status.md's Known Limitations). A
 * script that ran synchronously here would risk the exact same failure
 * mode for a completely different reason. execFile's `timeout` option
 * kills a runaway script rather than letting Electron hang waiting on
 * it indefinitely.
 *
 * `requiresConfirmation: true` on this tool's schema (tools.ts) is
 * documentation of that property, not something orchestrator.ts reads
 * and acts on — the field still isn't wired into any generic gate there.
 * This tool satisfies "requires confirmation" through its own design
 * (deferred execution + a follow-up-turn resolution), not through a
 * reusable mechanism a future tool could opt into automatically. A
 * different future tool needing confirmation would still need its own
 * version of this same pattern, or a genuinely generic gate built later.
 */

import { execFile, ExecFileException } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import { resolveInWorkspace, getWorkspaceRoot } from "./fileTools";

const RUNNABLE_EXTENSIONS: Record<string, string> = {
  ".js": "node",
  ".py": "python",
};

// A runaway script gets killed rather than hanging Electron's process
// indefinitely waiting on it - matches the spirit of MAX_CONTENT_BYTES
// in fileTools.ts (cheap insurance against a runaway response), applied
// to execution time instead of file size. Overridable (same
// env-knob pattern as engine.ts's VAD_* constants) specifically so tests
// can exercise the actual timeout-and-kill path in milliseconds instead
// of waiting out a real 15-second timeout.
const EXECUTION_TIMEOUT_MS = Number(process.env.PROXY_SCRIPT_TIMEOUT_MS) || 15_000;

// Spoken output should read like a sentence, not a dumped log - same
// lesson project-status.md's Known Limitations already logged for
// get_system_usage, applied here from the start rather than repeating
// the mistake in brand-new code.
const MAX_OUTPUT_CHARS = 500;

interface PendingScriptConfirmation {
  relPath: string;
  absPath: string;
  interpreter: string;
}

// Single in-memory slot, not a list/map - there's exactly one Proxy and
// exactly one thing it can be waiting on confirmation for at a time. A
// second run_script call before the first is confirmed simply replaces
// it - the earlier one is presumed superseded, not explicitly cancelled,
// since the one-utterance confirmation window already keeps a forgotten
// stale request from lingering meaningfully anyway.
let pending: PendingScriptConfirmation | null = null;

/** The tool's execute() function (registered in tools.ts) - asks for confirmation, never runs anything itself. */
export async function executeRunScript(args: { path?: string }): Promise<string> {
  const relPath = args.path ?? "";
  const ext = path.extname(relPath).toLowerCase();
  const interpreter = RUNNABLE_EXTENSIONS[ext];

  if (!interpreter) {
    return `I can only run .js (via node) or .py (via python) files, not "${ext || "that"}".`;
  }

  const absPath = resolveInWorkspace(relPath);
  if (!absPath) {
    return `"${relPath}" isn't a valid workspace path - I can only run scripts inside my own workspace folder.`;
  }

  try {
    await fs.access(absPath);
  } catch {
    return `I don't have a file at ${relPath} in the workspace to run.`;
  }

  pending = { relPath, absPath, interpreter };
  return `Ready to run ${relPath} with ${interpreter} - say "yes" to confirm, or "no" to cancel.`;
}

/**
 * Plain keyword matching, not an LLM call - yes/no classification for a
 * handful of common phrasings is exactly the kind of deterministic task
 * that doesn't need one, and keeping this legible/auditable matters more
 * here than anywhere else in the codebase: this is the one place a
 * misclassification could mean running code the user didn't actually
 * confirm.
 */
function classify(text: string): "confirm" | "deny" | "unclear" {
  const t = text.trim().toLowerCase();
  const confirmPhrases = ["yes", "yeah", "yep", "confirm", "run it", "do it", "go ahead", "sure"];
  const denyPhrases = ["no", "nope", "cancel", "don't", "do not", "stop", "nevermind", "never mind"];

  const matches = (phrases: string[]) =>
    phrases.some((p) => t === p || t.startsWith(p + " ") || t.endsWith(" " + p));

  if (matches(confirmPhrases)) return "confirm";
  if (matches(denyPhrases)) return "deny";
  return "unclear";
}

/**
 * Checked at the very top of engine.ts's process(), before the regex
 * router or the orchestrator ever see the new utterance. Returns
 * {handled: false} immediately if nothing is pending - the normal case
 * for almost every interaction, including the one that just called
 * executeRunScript() itself in the same turn (that turn's reply is the
 * confirmation *request*; this function resolves it on the *next* one).
 */
export async function tryResolvePendingConfirmation(
  utterance: string
): Promise<{ handled: boolean; reply?: string; confirmed?: boolean }> {
  if (!pending) return { handled: false };

  const decision = classify(utterance);
  if (decision === "unclear") {
    pending = null; // dropped, not held open - see this file's docblock
    return { handled: false };
  }

  const { relPath, absPath, interpreter } = pending;
  pending = null;

  if (decision === "deny") {
    return { handled: true, reply: `Cancelled - I won't run ${relPath}.`, confirmed: false };
  }

  return new Promise((resolve) => {
    execFile(
      interpreter,
      [absPath],
      { cwd: getWorkspaceRoot(), timeout: EXECUTION_TIMEOUT_MS },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error?.killed) {
          resolve({
            handled: true,
            confirmed: true,
            reply: `Ran ${relPath}, but it was still going after ${EXECUTION_TIMEOUT_MS / 1000} seconds, so I stopped it.`,
          });
          return;
        }

        const rawOutput = (stdout || stderr || "").trim();
        const preview =
          rawOutput.length > MAX_OUTPUT_CHARS ? rawOutput.slice(0, MAX_OUTPUT_CHARS) + "... (truncated)" : rawOutput;

        if (error) {
          resolve({
            handled: true,
            confirmed: true,
            reply: `Ran ${relPath}, but it exited with an error.${preview ? ` Output: ${preview}` : ""}`,
          });
          return;
        }

        resolve({
          handled: true,
          confirmed: true,
          reply: preview ? `Ran ${relPath}. Output: ${preview}` : `Ran ${relPath} - no output.`,
        });
      }
    );
  });
}

/** Exposed for engine.ts's activity-panel event, right after an orchestrator run that called this tool. */
export function getPendingConfirmation(): { path: string } | null {
  return pending ? { path: pending.relPath } : null;
}

/** Exposed for tests - clears any pending confirmation between test cases. */
export function clearPendingConfirmation(): void {
  pending = null;
}
