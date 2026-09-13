/**
 * Extracted from runScript.test.ts's implicit coverage (it only tested
 * classify() indirectly through tryResolvePendingConfirmation) now that
 * the classifier is its own shared module - direct coverage here means
 * both runScript.ts and browserAutomation.ts's confirmation gates are
 * backed by the same tested behavior, not two copies that could drift.
 */

import { describe, it, expect } from "vitest";
import { classifyYesNo } from "./confirmationUtils";

describe("classifyYesNo", () => {
  it("recognizes common confirm phrasings", () => {
    for (const phrase of ["yes", "yeah", "yep", "confirm", "run it", "do it", "go ahead", "sure", "yes please"]) {
      expect(classifyYesNo(phrase)).toBe("confirm");
    }
  });

  it("recognizes common deny phrasings", () => {
    for (const phrase of ["no", "nope", "cancel", "don't", "do not", "stop", "nevermind", "never mind"]) {
      expect(classifyYesNo(phrase)).toBe("deny");
    }
  });

  it("treats an unrelated new request as unclear, not a match for either", () => {
    expect(classifyYesNo("open notepad")).toBe("unclear");
    expect(classifyYesNo("what's the weather")).toBe("unclear");
  });

  it("is case-insensitive and tolerates surrounding whitespace", () => {
    expect(classifyYesNo("  YES  ")).toBe("confirm");
    expect(classifyYesNo("No.")).toBe("deny");
  });
});
