/**
 * Real temp file, same pattern as core/memory.test.ts. Env var set
 * inside vi.hoisted()'s callback per this session's revised standing
 * rule (decisions.md) — even though this file has no vi.mock at all,
 * the rule is now "always use vi.hoisted for this," not "only when a
 * vi.mock is present," after that assumption already caused one
 * confirmed real bug this session.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs/promises";

const { TEST_LOG_FILE } = vi.hoisted(() => {
  const file = require("path").join(require("os").tmpdir(), `proxy-session-log-test-${Date.now()}.json`);
  process.env.PROXY_SESSION_LOG_FILE = file;
  return { TEST_LOG_FILE: file as string };
});

import { loadLogHistory, appendLogEntry, clearLogHistory } from "./sessionLog";

beforeEach(async () => {
  await fs.rm(TEST_LOG_FILE, { force: true });
});

afterAll(async () => {
  await fs.rm(TEST_LOG_FILE, { force: true });
});

describe("loadLogHistory", () => {
  it("returns an empty array when the log file doesn't exist yet", async () => {
    expect(await loadLogHistory()).toEqual([]);
  });

  it("returns an empty array rather than throwing on a corrupted file", async () => {
    await fs.writeFile(TEST_LOG_FILE, "{not valid json", "utf-8");
    expect(await loadLogHistory()).toEqual([]);
  });
});

describe("appendLogEntry", () => {
  it("appends an entry with a real timestamp", async () => {
    await appendLogEntry("heard", "hello proxy");

    const history = await loadLogHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "heard", text: "hello proxy" });
    expect(new Date(history[0].timestamp).toString()).not.toBe("Invalid Date");
  });

  it("preserves order across multiple appends", async () => {
    await appendLogEntry("heard", "first");
    await appendLogEntry("reply", "second");
    await appendLogEntry("status", "third");

    const history = await loadLogHistory();
    expect(history.map((e) => e.text)).toEqual(["first", "second", "third"]);
  });

  it("prunes the oldest entry once the 500-entry cap is exceeded", async () => {
    const seeded = Array.from({ length: 500 }, (_, i) => ({
      kind: "status",
      text: `seeded ${i}`,
      timestamp: new Date(2020, 0, 1).toISOString(),
    }));
    await fs.writeFile(TEST_LOG_FILE, JSON.stringify(seeded), "utf-8");

    await appendLogEntry("heard", "newest entry");

    const history = await loadLogHistory();
    expect(history).toHaveLength(500);
    expect(history.map((e) => e.text)).not.toContain("seeded 0");
    expect(history[history.length - 1].text).toBe("newest entry");
  });
});

describe("clearLogHistory", () => {
  it("empties out previously persisted entries", async () => {
    await appendLogEntry("heard", "one");
    await appendLogEntry("reply", "two");
    expect(await loadLogHistory()).toHaveLength(2);

    await clearLogHistory();

    expect(await loadLogHistory()).toEqual([]);
  });

  it("is safe to call when no log file exists yet", async () => {
    await clearLogHistory();

    expect(await loadLogHistory()).toEqual([]);
  });
});
