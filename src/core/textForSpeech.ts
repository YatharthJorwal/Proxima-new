/**
 * Proxy is a voice-first assistant: every reply gets spoken by a local
 * TTS model (Piper, normally), not read as text. Found in real-machine
 * testing: the LLM would still slip in emoji, em/en dashes, and smart
 * quotes despite `llm.ts`'s system prompt now explicitly asking it not
 * to (see PERSONALITY there) - a prompt instruction is a strong nudge,
 * not a guarantee, same reasoning already applied elsewhere in this
 * project (the regex-fallthrough fix, the hallucination fix) - so this
 * is the deterministic backstop that guarantees it regardless of
 * whether the model actually listened.
 *
 * Applied to the reply text ONCE, in engine.ts's process(), before it's
 * either emitted as the "reply" event or handed to speak() - not
 * separately at the TTS call site. Deliberate: this keeps what's shown
 * (Activity panel's final quote, the Output card, the session log) and
 * what's actually spoken identical. A version that only cleaned the
 * string going to speak() would mean the displayed text and the spoken
 * audio no longer quite matched, which is its own small transparency
 * problem - "what you see is what gets said" is worth keeping literally
 * true, not just close enough.
 *
 * This is a targeted cleanup of specific known-troublesome characters,
 * not a broad "strip anything non-ASCII" pass - that would also mangle
 * legitimate text (an accented name, "café", etc.) that Piper handles
 * fine. Only the specific things found causing real problems are
 * touched.
 */

// Matches a single emoji, including multi-codepoint sequences: a
// variation selector (U+FE0F) directly after the base character, a
// ZWJ-joined chain (e.g. family/profession emoji), or a pair of
// regional indicator letters (flag emoji, e.g. 🇺🇸).
const EMOJI_PATTERN =
  /(?:\p{Extended_Pictographic}(?:\uFE0F)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*|\p{Regional_Indicator}{2})/gu;

// Em dash (—, U+2014) and en dash (–, U+2013), with any surrounding
// whitespace - replaced with a comma, which a TTS model reads as a
// natural pause instead of stumbling on (or silently dropping) the dash
// itself.
const DASH_PATTERN = /\s*[\u2014\u2013]\s*/g;

// Smart/curly double quotes (open/close U+201C/U+201D) and low double
// quotes (German-style „ U+201E, guillemets « » U+00AB/U+00BB) -> a
// plain straight double quote.
const SMART_DOUBLE_QUOTES = /[\u201C\u201D\u201E\u00AB\u00BB]/g;

// Smart/curly single quotes (open/close U+2018/U+2019, low single quote
// ‚ U+201A) -> a plain apostrophe. U+2019 doubles as a contraction
// apostrophe ("don't") in a lot of LLM output, so this also normalizes
// those to the plain ' Piper expects.
const SMART_SINGLE_QUOTES = /[\u2018\u2019\u201A]/g;

// Horizontal ellipsis (…, U+2026, a single codepoint) -> three periods,
// which reads as a natural trailing-off pause instead of the single
// glyph.
const ELLIPSIS_PATTERN = /\u2026/g;

export function normalizeForSpeech(text: string): string {
  return text
    .replace(EMOJI_PATTERN, "")
    .replace(ELLIPSIS_PATTERN, "...")
    .replace(SMART_DOUBLE_QUOTES, '"')
    .replace(SMART_SINGLE_QUOTES, "'")
    .replace(DASH_PATTERN, ", ")
    .replace(/[ \t]{2,}/g, " ") // collapse double spaces the above can leave behind
    .replace(/\s*,\s*,/g, ",") // a dash immediately after another separator (rare, but cheap to guard)
    .trim();
}
