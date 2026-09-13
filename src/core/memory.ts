/**
 * Proxy's long-term memory — Milestone 10 Part D (first slice: facts and
 * project context, captured automatically; gesture-to-action wiring, the
 * other Part D item, is separate and not started).
 *
 * Two halves live here:
 *   1. Storage — a flat local JSON file, one entry per fact, capped and
 *      pruned oldest-first. No categories, no embeddings, no database -
 *      matches this codebase's established "boring and vanilla" style
 *      (see fileTools.ts, gmail.ts) at the scale this actually needs.
 *   2. Extraction — after every real orchestrator-routed interaction
 *      (engine.ts calls this; see its docblock for why regex-matched
 *      commands are skipped), a background smart-tier call looks at the
 *      one exchange and decides if anything durable is worth keeping.
 *      Runs AFTER the user has already heard their reply - this never
 *      adds latency to what the user is waiting for.
 *
 * Explicitly a deliberate risk, not an oversight: recall_facts.ts (the
 * tool the model calls to actually use this) depends on the model
 * *choosing* to call it. That's the same "will a small model reliably
 * invoke an optional tool" question this project already ran into with
 * defer_to_planner never firing (see decisions.md, Milestone 10 Part D).
 * Chosen anyway, with eyes open, because the alternative (always
 * injecting the full fact list into every prompt) was the safer
 * technical default that got explicitly turned down in favor of this
 * one - logged here so a future session doesn't mistake the tradeoff for
 * something nobody thought about.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { chat } from "./llm";

export interface MemoryFact {
  id: string;
  text: string;
  timestamp: string;
}

// Same env-override-with-sane-default pattern as fileTools.ts's
// PROXY_WORKSPACE_DIR - but deliberately NOT inside the workspace folder
// itself. The workspace is "files Proxy writes that the user asked for";
// this is Proxy's own internal state, not something that belongs mixed
// into the user's generated-files folder.
const MEMORY_FILE =
  process.env.PROXY_MEMORY_FILE || path.join(os.homedir(), ".proxima", "memory.json");

// Deliberately small. This is the whole safety net against unbounded
// growth for a store with no manual editing in v1 (see decisions.md) -
// oldest facts fall off rather than the file growing forever. 30 was
// picked as "generous for a personal assistant's worth of durable facts,
// small enough that a future always-inject fallback would still be a
// reasonable prompt size" - not derived from any measurement, revisit if
// real use shows it's wrong in either direction.
const MAX_FACTS = 30;

async function loadFacts(): Promise<MemoryFact[]> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // First run (file doesn't exist yet) and a corrupted file both land
    // here - both should behave like "nothing stored yet," not crash the
    // background extraction pass or the recall tool.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Failed to read memory file, treating as empty:", err);
    }
    return [];
  }
}

async function saveFacts(facts: MemoryFact[]): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
  await fs.writeFile(MEMORY_FILE, JSON.stringify(facts, null, 2), "utf-8");
}

/**
 * Appends new fact strings, cheapest-possible dedup (drops an incoming
 * fact if its text exactly matches one already stored - not a semantic
 * check), then prunes to MAX_FACTS oldest-first. No contradiction
 * handling ("likes coffee" then later "gave up coffee" both just sit in
 * the list) - a real known limitation, not solved here; see
 * decisions.md for why v1 accepts this rather than building the
 * structured fact-keying a real fix would need.
 */
async function addFacts(newFactTexts: string[]): Promise<void> {
  if (newFactTexts.length === 0) return;

  const existing = await loadFacts();
  const existingTexts = new Set(existing.map((f) => f.text));
  const now = new Date().toISOString();

  const additions: MemoryFact[] = newFactTexts
    .filter((text) => text.trim().length > 0 && !existingTexts.has(text.trim()))
    .map((text) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim(),
      timestamp: now,
    }));

  if (additions.length === 0) return;

  const combined = [...existing, ...additions];
  const trimmed = combined.length > MAX_FACTS ? combined.slice(combined.length - MAX_FACTS) : combined;
  await saveFacts(trimmed);
}

/** Exposed for recall_facts.ts (commands/memory.ts) - the only other consumer of stored facts. */
export async function getStoredFacts(): Promise<MemoryFact[]> {
  return loadFacts();
}

const EXTRACTION_SYSTEM_PROMPT = `You analyze a single exchange between a user and their local voice
assistant to decide what's worth remembering long-term - not for this
conversation, but for future ones the assistant has no memory of
otherwise.

Worth remembering: durable facts about the user (their name, stated
preferences, ongoing projects they've mentioned, recurring habits or
routines). NOT worth remembering: one-off requests with no lasting
information ("open chrome," "what's the weather," "turn up the
volume"), anything you're not confident is actually true and durable, or
anything that's just the assistant's own reply restated.

Respond with ONLY a JSON array of short plain strings, one per fact
worth keeping, each written as a standalone statement (e.g. "Prefers
metric units," "Working on a personal budgeting app"). If nothing
from this exchange is worth remembering - which will be most exchanges -
respond with exactly: []

No markdown, no code fences, no explanation. Just the JSON array.`;

/**
 * Best-effort, defensive parsing - a 9b local model asked for "ONLY a
 * JSON array" will still occasionally wrap it in a code fence or add a
 * stray sentence. Same spirit as systemUsage.ts's tolerance for its own
 * external process's quirks: fail toward "nothing extracted" rather than
 * crashing the background pass.
 */
function parseFactArray(raw: string): string[] {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/**
 * Called by engine.ts after a completed, non-cancelled orchestrator
 * interaction - fire-and-forget from the caller's side (not awaited into
 * the reply path), and everything in here is caught rather than thrown,
 * since a background memory pass failing must never surface as a user-
 * facing error for an interaction that's already finished and been
 * spoken.
 *
 * Uses the smart tier deliberately - "how do I want this filtered"
 * quiz question, answered: judgment quality matters more here than
 * latency, since nothing is waiting on this call.
 */
export async function extractAndStoreMemories(userText: string, replyText: string): Promise<void> {
  try {
    const result = await chat({
      tier: "smart",
      think: true,
      systemPromptOverride: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `User said: "${userText}"\nAssistant replied: "${replyText}"`,
        },
      ],
    });

    const facts = parseFactArray(result.reply ?? "");
    if (facts.length > 0) {
      await addFacts(facts);
    }
  } catch (err) {
    console.error("Memory extraction failed (non-fatal, interaction already completed):", err);
  }
}
