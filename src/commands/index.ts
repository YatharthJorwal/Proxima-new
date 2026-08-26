/**
 * Command router — tries each hardcoded command in order and returns the
 * first one that handles the text. If none of them match, returns null so
 * assistant.ts knows to fall back to the LLM for a conversational reply.
 *
 * This is Milestone 3: a small, explicit list of deterministic commands.
 * Milestone 5 added an LLM intent-classification step so fuzzier phrasing
 * ("hey can you pull up notepad for me") still gets routed correctly
 * instead of requiring near-exact phrase matches.
 *
 * Milestone 6 (dashboard): tryHandleCommand now returns which named
 * handler matched, not just the reply text. This is purely additive
 * metadata for the dashboard ("regex hit: open-app") — the individual
 * command files (openApp.ts / volume.ts / window.ts) are untouched.
 */

import { CommandHandler } from "./types";
import { tryHandleOpenApp } from "./openApp";
import { tryHandleVolume } from "./volume";
import { tryHandleWindow } from "./window";
import { tryHandleBrowse } from "./browse";

export interface RegexCommandResult {
  handler: "open-app" | "volume" | "window" | "browse";
  reply: string;
}

// Milestone 3 complete: open app, volume, window control. Milestone 9
// added browse (URL templating for "search X for Y" requests).
const handlers: { name: RegexCommandResult["handler"]; fn: CommandHandler }[] = [
  { name: "open-app", fn: tryHandleOpenApp },
  { name: "volume", fn: tryHandleVolume },
  { name: "window", fn: tryHandleWindow },
  { name: "browse", fn: tryHandleBrowse },
];

export async function tryHandleCommand(text: string): Promise<RegexCommandResult | null> {
  for (const { name, fn } of handlers) {
    const result = await fn(text);
    if (result !== null) return { handler: name, reply: result };
  }
  return null;
}