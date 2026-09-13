/**
 * Shared regex fragment for openApp.ts's OPEN_PATTERN and browse.ts's
 * SEARCH_PATTERN — both anchor at the start of the utterance and, until
 * now, tolerated only an optional "please" before the actual command.
 * Real speech doesn't work that way: "Okay, so open Chrome" is a
 * completely ordinary thing to say, and it missed OPEN_PATTERN entirely
 * (session log evidence, not a hypothetical), falling through to the LLM
 * fast tier — which then picked the nearest thing it could from a fixed
 * site enum ("google") since "chrome" isn't a browsable site at all.
 *
 * This closes the gap deterministically instead of hoping the LLM
 * guesses right: a short, specific, repeatable list of common lead-ins,
 * stripped from the START only. Deliberately NOT unanchoring the whole
 * pattern (matching "open X" anywhere in the utterance) - that would
 * also match things like "I already opened chrome," which isn't a
 * command at all. A bounded prefix list is a real fix for the reported
 * bug without that false-positive risk.
 */

export const LEAD_IN_SOURCE =
  "(?:(?:okay|ok|alright|well|so|um|please|can you|could you|would you)[,]?\\s+)*";
