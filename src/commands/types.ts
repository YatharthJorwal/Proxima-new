/**
 * Shared types for hardcoded PC-automation commands.
 *
 * Each command module exports a single `tryHandle` function that looks at
 * the transcribed text and either:
 *   - handles it and returns a string (what Proxy should say back), or
 *   - returns null, meaning "not my command" — the router will try the next
 *     one, and if nothing matches, the text falls through to the LLM.
 */

export type CommandHandler = (text: string) => Promise<string | null>;
