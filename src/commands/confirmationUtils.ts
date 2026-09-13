/**
 * Shared yes/no classification for the "confirm on a following turn"
 * pattern — extracted from runScript.ts (Milestone 10 Part B, the
 * original owner of this logic) once browserAutomation.ts needed the
 * exact same behavior for click confirmations. Two independent copies
 * of the same phrase list would mean they could silently drift apart -
 * updating "yes" phrasing for one confirmation flow but not the other -
 * which is a worse outcome than one shared, slightly more central file.
 *
 * Plain keyword matching, not an LLM call, for the same reason
 * runScript.ts originally gave: yes/no classification for a handful of
 * common phrasings is exactly the kind of deterministic task that
 * doesn't need one, and keeping this legible/auditable matters more here
 * than almost anywhere else in the codebase - this is one of the few
 * places a misclassification could mean an action the user didn't
 * actually confirm (running a script, clicking something that commits
 * to a purchase/deletion/send).
 */

export function classifyYesNo(text: string): "confirm" | "deny" | "unclear" {
  // Trailing punctuation stripped the same way openApp.ts/browse.ts's
  // own regexes already do for STT transcripts ("No." is "no" plus
  // whatever punctuation STT guessed at, not a different answer).
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  const confirmPhrases = ["yes", "yeah", "yep", "confirm", "run it", "do it", "go ahead", "sure"];
  const denyPhrases = ["no", "nope", "cancel", "don't", "do not", "stop", "nevermind", "never mind"];

  const matches = (phrases: string[]) =>
    phrases.some((p) => t === p || t.startsWith(p + " ") || t.endsWith(" " + p));

  if (matches(confirmPhrases)) return "confirm";
  if (matches(denyPhrases)) return "deny";
  return "unclear";
}
