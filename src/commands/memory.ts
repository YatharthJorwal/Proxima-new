/**
 * recall_facts — Milestone 10 Part D. The read side of core/memory.ts's
 * storage; core/memory.ts's own docblock covers the automatic-capture
 * half and the reliability tradeoff of making this a model-invoked tool
 * at all.
 *
 * Deliberately marked resultInformsNextStep: true in tools.ts - the
 * first tool to actually need it (see orchestrator.ts's docblock, which
 * anticipated this exact "check X" shape before any tool used it).
 * Recalled facts are usually raw material for an answer, not the answer
 * itself: "what's my dog's name" recalling "Dog is named Max" alongside
 * a few unrelated stored facts needs the smart tier to compose "Your
 * dog's name is Max," not have the raw fact list read back verbatim.
 *
 * No semantic search, no embeddings - a plain case-insensitive substring
 * match against stored fact text, or the full (capped, so never large)
 * list when no query is given. Matches this codebase's established
 * "boring and vanilla" bar; nothing about the current scale of this
 * feature justifies more.
 */

import { getStoredFacts } from "../core/memory";

export async function executeRecallFacts(args: { query?: string }): Promise<string> {
  const facts = await getStoredFacts();

  if (facts.length === 0) {
    return "Nothing stored in memory yet.";
  }

  const query = args.query?.trim().toLowerCase();
  const matches = query ? facts.filter((f) => f.text.toLowerCase().includes(query)) : facts;

  if (matches.length === 0) {
    return `Nothing stored in memory matches "${args.query}".`;
  }

  return matches.map((f) => f.text).join(". ");
}
