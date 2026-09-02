/**
 * Uses a real temp file (set via PROXY_MEMORY_FILE before memory.ts
 * loads) rather than mocking fs - same reasoning as fileTools.test.ts:
 * this module's whole job is real file persistence, so a throwaway real
 * file is more honest coverage than mocking fs would be. chat() is
 * mocked, same as any other real-LLM-call boundary in this codebase's
 * tests.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";

// process.env.PROXY_MEMORY_FILE must be set before memory.ts's
// module-level MEMORY_FILE constant is computed - but a plain statement
// here, even textually placed before the "./memory" import below, is
// NOT guaranteed to run first: vi.mock()/vi.hoisted() calls get hoisted
// above ordinary statements by Vitest's transform, and "./memory" gets
// imported as part of that same hoisted setup once "./llm" is mocked.
// Setting the env var inside vi.hoisted's own callback is the actually-
// guaranteed-safe way to win that race, since vi.hoisted's whole
// contract is "runs before any mocked import resolves."
const { mockChat, TEST_MEMORY_FILE } = vi.hoisted(() => {
  const file = require("path").join(require("os").tmpdir(), `proxy-memory-test-${Date.now()}.json`);
  process.env.PROXY_MEMORY_FILE = file;
  return { mockChat: vi.fn(), TEST_MEMORY_FILE: file as string };
});
vi.mock("./llm", () => ({ chat: mockChat }));

import { getStoredFacts, extractAndStoreMemories } from "./memory";

beforeEach(async () => {
  mockChat.mockReset();
  await fs.rm(TEST_MEMORY_FILE, { force: true });
});

afterAll(async () => {
  await fs.rm(TEST_MEMORY_FILE, { force: true });
});

describe("getStoredFacts", () => {
  it("returns an empty array when the memory file doesn't exist yet", async () => {
    expect(await getStoredFacts()).toEqual([]);
  });

  it("returns an empty array rather than throwing on a corrupted file", async () => {
    await fs.mkdir(path.dirname(TEST_MEMORY_FILE), { recursive: true });
    await fs.writeFile(TEST_MEMORY_FILE, "{not valid json", "utf-8");
    expect(await getStoredFacts()).toEqual([]);
  });
});

describe("extractAndStoreMemories", () => {
  it("stores facts parsed from a clean JSON array reply", async () => {
    mockChat.mockResolvedValue({
      reply: '["Prefers metric units", "Working on Ledger app"]',
      toolCall: null,
      thinking: null,
    });

    await extractAndStoreMemories("I prefer metric, by the way", "Got it, metric it is.");

    const facts = await getStoredFacts();
    expect(facts.map((f) => f.text)).toEqual(["Prefers metric units", "Working on Ledger app"]);
  });

  it("stores nothing for an empty array reply", async () => {
    mockChat.mockResolvedValue({ reply: "[]", toolCall: null, thinking: null });

    await extractAndStoreMemories("open chrome", "Opening Chrome.");

    expect(await getStoredFacts()).toEqual([]);
  });

  it("parses a reply wrapped in a markdown code fence", async () => {
    mockChat.mockResolvedValue({
      reply: '```json\n["Dog is named Max"]\n```',
      toolCall: null,
      thinking: null,
    });

    await extractAndStoreMemories("my dog Max needs a walk", "Noted.");

    const facts = await getStoredFacts();
    expect(facts.map((f) => f.text)).toEqual(["Dog is named Max"]);
  });

  it("does not store a duplicate of an already-stored fact", async () => {
    mockChat.mockResolvedValue({ reply: '["Prefers metric units"]', toolCall: null, thinking: null });

    await extractAndStoreMemories("a", "b");
    await extractAndStoreMemories("c", "d");

    expect(await getStoredFacts()).toHaveLength(1);
  });

  it("prunes the oldest fact once the 30-entry cap is exceeded", async () => {
    const seeded = Array.from({ length: 30 }, (_, i) => ({
      id: `seed-${i}`,
      text: `Seeded fact ${i}`,
      timestamp: new Date(2020, 0, i + 1).toISOString(),
    }));
    await fs.mkdir(path.dirname(TEST_MEMORY_FILE), { recursive: true });
    await fs.writeFile(TEST_MEMORY_FILE, JSON.stringify(seeded), "utf-8");

    mockChat.mockResolvedValue({ reply: '["One more fact"]', toolCall: null, thinking: null });
    await extractAndStoreMemories("x", "y");

    const facts = await getStoredFacts();
    expect(facts).toHaveLength(30);
    expect(facts.map((f) => f.text)).not.toContain("Seeded fact 0");
    expect(facts[facts.length - 1].text).toBe("One more fact");
  });

  it("swallows extraction errors without throwing, since the interaction already completed", async () => {
    mockChat.mockRejectedValue(new Error("ollama down"));

    await expect(extractAndStoreMemories("x", "y")).resolves.toBeUndefined();
    expect(await getStoredFacts()).toEqual([]);
  });

  it("uses the smart tier with thinking enabled, not the fast tier", async () => {
    mockChat.mockResolvedValue({ reply: "[]", toolCall: null, thinking: null });

    await extractAndStoreMemories("x", "y");

    expect(mockChat).toHaveBeenCalledWith(expect.objectContaining({ tier: "smart", think: true }));
  });
});
