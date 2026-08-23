/**
 * Command router — tries each hardcoded command in order and returns the
 * first one that handles the text. If none of them match, returns null so
 * assistant.ts knows to fall back to the LLM for a conversational reply.
 *
 * This is Milestone 3: a small, explicit list of deterministic commands.
 * Milestone 5 will add an LLM intent-classification step so fuzzier
 * phrasing ("hey can you pull up notepad for me") still gets routed
 * correctly instead of requiring near-exact phrase matches.
 */

import { CommandHandler } from "./types";
import { tryHandleOpenApp } from "./openApp";
import { tryHandleVolume } from "./volume";
import { tryHandleWindow } from "./window";

// Milestone 3 complete: open app, volume, window control.
const handlers: CommandHandler[] = [tryHandleOpenApp, tryHandleVolume, tryHandleWindow];

export async function tryHandleCommand(text: string): Promise<string | null> {
  for (const handler of handlers) {
    const result = await handler(text);
    if (result !== null) return result;
  }
  return null;
}