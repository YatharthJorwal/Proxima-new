/**
 * Regression coverage for the router-fallthrough bug found in real-machine
 * testing: tryHandleOpenApp's regex is broad on purpose ("open " +
 * anything), which meant an unrecognized app name used to answer
 * confidently wrong (a canned "not set up" string) instead of returning
 * null and letting the router chain - and past it, the orchestrator -
 * take a real shot. See openApp.ts's tryHandleOpenApp for the fix.
 *
 * Uses the real config/commands.json (not mocked) since it's checked into
 * the repo and small - only launch() is mocked, so a "known app" test case
 * doesn't actually spawn PowerShell/Start-Process in the sandbox.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLaunch } = vi.hoisted(() => ({ mockLaunch: vi.fn() }));
vi.mock("./launch", () => ({ launch: mockLaunch }));

import { tryHandleOpenApp } from "./openApp";

beforeEach(() => {
  mockLaunch.mockReset().mockResolvedValue(undefined);
});

describe("tryHandleOpenApp", () => {
  it("returns null for text that doesn't look like an open command at all", async () => {
    expect(await tryHandleOpenApp("what's the weather")).toBeNull();
  });

  it("handles a known app directly, without going near launch() failing", async () => {
    const result = await tryHandleOpenApp("open notepad");
    expect(result).toBe("Opening notepad.");
    expect(mockLaunch).toHaveBeenCalledWith("notepad.exe");
  });

  it("returns null for an unrecognized single app name, instead of a canned wrong answer", async () => {
    // Regression case from real-machine testing: "open github" used to
    // match this regex and answer "I don't have github set up..." even
    // though github.com is a real, configured browse.ts site - this
    // regex just never gave that tool a chance to run.
    expect(await tryHandleOpenApp("open github")).toBeNull();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("returns null for a compound request instead of swallowing the whole phrase", async () => {
    // Regression case: "open chrome and open youtube" - the greedy
    // OPEN_PATTERN captured the entire remainder as one "app name",
    // which obviously wasn't a config key, and answered wrong. Now it
    // falls through so the orchestrator can chain the two real actions.
    expect(await tryHandleOpenApp("open chrome and open youtube")).toBeNull();
    expect(await tryHandleOpenApp("open youtube on chrome and search for pewdiepie")).toBeNull();
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
