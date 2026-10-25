import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";

const { FILE } = vi.hoisted(() => {
  const file = require("path").join(require("os").tmpdir(), `proxy-instructions-test-${Date.now()}.txt`);
  process.env.PROXY_INSTRUCTIONS_FILE = file;
  return { FILE: file as string };
});

import { getInstructions, instructionsBlock, MAX_INSTRUCTIONS_LENGTH, normalizeInstructions, setInstructions } from "./instructions";

beforeEach(async () => { await fs.rm(FILE, { force: true }); });
afterAll(async () => { await fs.rm(FILE, { force: true }); });

describe("standing instructions", () => {
  it("round-trips through the file and is empty before anything is saved", async () => {
    expect(await getInstructions()).toBe("");
    const r = await setInstructions("  Keep answers short.\nCall me sir.  ");
    expect(r).toEqual({ ok: true, text: "Keep answers short.\nCall me sir." });
    expect(await fs.readFile(FILE, "utf-8")).toBe("Keep answers short.\nCall me sir.");
    expect(await getInstructions()).toBe("Keep answers short.\nCall me sir.");
  });

  it("rejects non-strings and over-long text without touching the file", async () => {
    await setInstructions("keep");
    expect((await setInstructions("x".repeat(MAX_INSTRUCTIONS_LENGTH + 1))).ok).toBe(false);
    expect((await setInstructions(42)).ok).toBe(false);
    expect(await fs.readFile(FILE, "utf-8")).toBe("keep");
  });

  it("clearing is just saving empty text", async () => {
    await setInstructions("something");
    expect(await setInstructions("   ")).toEqual({ ok: true, text: "" });
    expect(instructionsBlock("")).toBe("");
  });

  it("wraps text in a labelled block for the system prompt", () => {
    expect(instructionsBlock("Be brief.")).toContain("Standing instructions from the user");
    expect(instructionsBlock("Be brief.")).toContain("Be brief.");
    expect(normalizeInstructions("a\r\nb")).toBe("a\nb");
  });
});
