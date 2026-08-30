import { describe, it, expect } from "vitest";
import { normalizeForSpeech } from "./textForSpeech";

describe("normalizeForSpeech", () => {
  it("strips simple emoji", () => {
    expect(normalizeForSpeech("Done! 😭😂😍")).toBe("Done!");
  });

  it("strips a ZWJ-joined compound emoji", () => {
    expect(normalizeForSpeech("Nice \u{1F468}\u200D\u{1F4BB} setup")).toBe("Nice setup");
  });

  it("strips a flag emoji (regional indicator pair)", () => {
    expect(normalizeForSpeech("From \u{1F1FA}\u{1F1F8} with love")).toBe("From with love");
  });

  it("replaces em and en dashes with a comma", () => {
    expect(normalizeForSpeech("I opened Chrome\u2014it's ready")).toBe("I opened Chrome, it's ready");
    expect(normalizeForSpeech("10\u201315 minutes")).toBe("10, 15 minutes");
  });

  it("normalizes smart double quotes, low quotes, and guillemets to a straight quote", () => {
    expect(normalizeForSpeech("here's your \u201Cresult\u201D")).toBe('here\'s your "result"');
    expect(normalizeForSpeech("the \u201Eresult\u201C is in")).toBe('the "result" is in');
    expect(normalizeForSpeech("the \u00ABresult\u00BB is in")).toBe('the "result" is in');
  });

  it("normalizes smart single quotes (including contraction apostrophes) to a straight apostrophe", () => {
    expect(normalizeForSpeech("it\u2019s done")).toBe("it's done");
    expect(normalizeForSpeech("\u2018quoted\u2019")).toBe("'quoted'");
  });

  it("replaces the ellipsis character with three periods", () => {
    expect(normalizeForSpeech("still thinking\u2026")).toBe("still thinking...");
  });

  it("collapses double spaces left behind by stripped characters and trims", () => {
    expect(normalizeForSpeech("  Done  😭  for real  ")).toBe("Done for real");
  });

  it("leaves plain accented text alone (targeted cleanup, not a broad strip)", () => {
    expect(normalizeForSpeech("Meeting at the café in Zürich")).toBe("Meeting at the café in Zürich");
  });

  it("handles a realistic combined example", () => {
    const input = 'Done! \u{1F604} I opened Chrome\u2014here\u2019s your \u201Cresult\u201D.';
    expect(normalizeForSpeech(input)).toBe('Done! I opened Chrome, here\'s your "result".');
  });
});
