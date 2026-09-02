import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetStoredFacts } = vi.hoisted(() => ({ mockGetStoredFacts: vi.fn() }));
vi.mock("../core/memory", () => ({ getStoredFacts: mockGetStoredFacts }));

import { executeRecallFacts } from "./memory";

beforeEach(() => {
  mockGetStoredFacts.mockReset();
});

describe("executeRecallFacts", () => {
  it("gives an honest reply when nothing is stored yet", async () => {
    mockGetStoredFacts.mockResolvedValue([]);
    const reply = await executeRecallFacts({});
    expect(reply).toMatch(/nothing stored/i);
  });

  it("returns every stored fact when no query is given", async () => {
    mockGetStoredFacts.mockResolvedValue([
      { id: "1", text: "Prefers metric units", timestamp: "t" },
      { id: "2", text: "Dog is named Max", timestamp: "t" },
    ]);

    const reply = await executeRecallFacts({});
    expect(reply).toContain("Prefers metric units");
    expect(reply).toContain("Dog is named Max");
  });

  it("filters to facts matching the query, case-insensitively", async () => {
    mockGetStoredFacts.mockResolvedValue([
      { id: "1", text: "Prefers metric units", timestamp: "t" },
      { id: "2", text: "Dog is named Max", timestamp: "t" },
    ]);

    const reply = await executeRecallFacts({ query: "DOG" });
    expect(reply).toContain("Dog is named Max");
    expect(reply).not.toContain("metric");
  });

  it("gives an honest no-match reply rather than falling back to everything", async () => {
    mockGetStoredFacts.mockResolvedValue([{ id: "1", text: "Prefers metric units", timestamp: "t" }]);

    const reply = await executeRecallFacts({ query: "nonexistent thing" });
    expect(reply).toMatch(/nothing stored in memory matches/i);
    expect(reply).toContain("nonexistent thing");
  });
});
