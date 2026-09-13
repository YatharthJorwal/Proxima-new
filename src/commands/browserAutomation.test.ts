/**
 * Mocks playwright-core entirely — there's no real Chrome to attach to
 * in this sandbox, so every real-machine behavior here (does a click
 * actually land, does the cursor actually move smoothly, does
 * connectOverCDP actually fail when Chrome isn't running with debugging
 * on) is real-machine-confirmed territory, not sandbox-tested. What IS
 * tested here is the control-flow logic this file owns: does a
 * commit-shaped click get gated behind confirmation instead of running
 * immediately, does confirm/deny/unclear on the pending click behave
 * like run_script's equivalent, does an unknown element_id fail
 * honestly instead of guessing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { mockConnectOverCDP, mockEvaluate, mockLocator, mockSpawn } = vi.hoisted(() => ({
  mockConnectOverCDP: vi.fn(),
  mockEvaluate: vi.fn(),
  mockLocator: {
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn().mockResolvedValue({ x: 10, y: 10, width: 100, height: 20 }),
    click: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
  },
  mockSpawn: vi.fn(),
}));

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: mockConnectOverCDP },
}));

// Backs isChromeProcessRunning()'s "is chrome already running" PowerShell
// check - real-machine-confirmed behavior (systemUsage.ts already uses
// the same spawn+stdout pattern), mocked here so the two diagnostic
// branches (chrome running vs. not) are actually covered by something
// other than this sandbox's real "powershell.exe not found" ENOENT path.
vi.mock("child_process", () => ({ spawn: mockSpawn }));

/** Simulates a PowerShell child process that prints `stdoutText` and exits 0. */
function fakeChromeCheckProcess(stdoutText: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  process.nextTick(() => {
    proc.stdout.emit("data", stdoutText);
    proc.emit("close", 0);
  });
  return proc;
}

import {
  executeBrowserNavigate,
  executeBrowserReadPage,
  executeBrowserClick,
  executeBrowserType,
  tryResolvePendingBrowserConfirmation,
  getPendingBrowserConfirmation,
  resetBrowserAutomationState,
} from "./browserAutomation";

// A page with a benign "Play" button [1] and a commit-shaped "Buy Now"
// button [2] - covers both the keyword heuristic and the ordinary path
// in one fixture, reused across tests.
const FAKE_ELEMENTS = [
  { id: "1", tag: "button", type: "", name: "Play" },
  { id: "2", tag: "button", type: "", name: "Buy Now" },
];

function makeFakePage() {
  return {
    isClosed: vi.fn().mockReturnValue(false),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: mockEvaluate,
    locator: vi.fn().mockReturnValue(mockLocator),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function makeFakeBrowser(page: ReturnType<typeof makeFakePage>) {
  const context = { newPage: vi.fn().mockResolvedValue(page) };
  return {
    isConnected: vi.fn().mockReturnValue(true),
    contexts: vi.fn().mockReturnValue([context]),
    newContext: vi.fn().mockResolvedValue(context),
  };
}

let currentPage: ReturnType<typeof makeFakePage>;

beforeEach(() => {
  resetBrowserAutomationState();
  mockConnectOverCDP.mockReset();
  mockLocator.scrollIntoViewIfNeeded.mockClear();
  mockLocator.boundingBox.mockClear().mockResolvedValue({ x: 10, y: 10, width: 100, height: 20 });
  mockLocator.click.mockClear();
  mockLocator.pressSequentially.mockClear();

  // evaluate() serves two different purposes in browserAutomation.ts:
  // the element-snapshot query (called with no second argument) and the
  // click-ring visual (called with a {px, py} argument). Distinguishing
  // by arg count, rather than by inspecting the function body, keeps
  // this mock honest about testing behavior, not implementation.
  mockEvaluate.mockReset().mockImplementation((_fn: unknown, arg?: unknown) =>
    Promise.resolve(arg === undefined ? FAKE_ELEMENTS : undefined)
  );

  currentPage = makeFakePage();
  mockConnectOverCDP.mockResolvedValue(makeFakeBrowser(currentPage));

  mockSpawn.mockReset().mockImplementation(() => fakeChromeCheckProcess("no"));
});

describe("executeBrowserNavigate", () => {
  it("navigates and returns a labeled element snapshot", async () => {
    const result = await executeBrowserNavigate({ url: "example.com" });
    expect(result).toContain("Opened https://example.com");
    expect(result).toContain('[1] button "Play"');
    expect(result).toContain('[2] button "Buy Now"');
  });

  it("adds https:// when the model omits a scheme", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    expect(currentPage.goto).toHaveBeenCalledWith("https://example.com", expect.anything());
  });

  it("fails honestly when Chrome isn't running at all", async () => {
    mockConnectOverCDP.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await executeBrowserNavigate({ url: "example.com" });
    expect(result).toMatch(/isn't open/i);
    expect(result).toMatch(/say "open chrome"/i);
  });

  it("gives the more specific diagnosis when Chrome is running but not with debugging on (real-machine regression)", async () => {
    // The actual bug this covers: Chrome only applies
    // --remote-debugging-port on a genuinely fresh launch. If it was
    // already open, "open chrome" just activates the existing window and
    // silently ignores the flag - the plain "Chrome isn't open" message
    // is actively misleading in this case, since it clearly is open.
    mockConnectOverCDP.mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
    mockSpawn.mockImplementation(() => fakeChromeCheckProcess("yes"));

    const result = await executeBrowserNavigate({ url: "example.com" });
    expect(result).toMatch(/already running/i);
    expect(result).toMatch(/close every chrome window/i);
    expect(result).not.toMatch(/isn't open/i);
  });

  it("asks for a URL rather than guessing when none is given", async () => {
    const result = await executeBrowserNavigate({});
    expect(result).toMatch(/need a url/i);
    expect(mockConnectOverCDP).not.toHaveBeenCalled();
  });
});

describe("executeBrowserReadPage", () => {
  it("returns the current element snapshot without navigating", async () => {
    const result = await executeBrowserReadPage();
    expect(result).toContain('[1] button "Play"');
  });
});

describe("executeBrowserClick", () => {
  it("clicks a benign element immediately, no confirmation needed", async () => {
    await executeBrowserNavigate({ url: "example.com" }); // populates the element list
    const result = await executeBrowserClick({ element_id: "1" });
    expect(result).toContain('Clicked "Play"');
    expect(mockLocator.click).not.toHaveBeenCalled(); // animatedClick took the mouse-move path, not the fallback
  });

  it("gates a commit-shaped element (by label) behind confirmation instead of clicking", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    const result = await executeBrowserClick({ element_id: "2" });
    expect(result).toMatch(/ready to click "buy now"/i);
    expect(result).toMatch(/say "yes"/i);
    expect(getPendingBrowserConfirmation()).toEqual({ description: "Buy Now" });
  });

  it("gates any element behind confirmation when the model itself flags may_commit", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    const result = await executeBrowserClick({ element_id: "1", may_commit: true });
    expect(result).toMatch(/ready to click "play"/i);
    expect(getPendingBrowserConfirmation()).not.toBeNull();
  });

  it("fails honestly on a stale/unknown element_id instead of guessing", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    const result = await executeBrowserClick({ element_id: "99" });
    expect(result).toMatch(/don't have an element \[99\]/i);
  });

  it("does not append the reachability diagnosis when the connection is fine and the click itself just failed", async () => {
    await executeBrowserNavigate({ url: "example.com" }); // connection is good at this point
    mockLocator.boundingBox.mockRejectedValueOnce(new Error("element detached"));

    const result = await executeBrowserClick({ element_id: "1" });
    expect(result).toMatch(/something went wrong/i);
    expect(result).not.toMatch(/already running|isn't open/i); // would be misleading - chrome IS reachable
  });
});

describe("executeBrowserType", () => {
  it("types into a known element", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    const result = await executeBrowserType({ element_id: "1", text: "hello" });
    expect(result).toContain('Typed into "Play"');
    expect(mockLocator.pressSequentially).toHaveBeenCalledWith("hello", expect.objectContaining({ delay: expect.any(Number) }));
  });

  it("fails honestly on a stale/unknown element_id instead of guessing", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    const result = await executeBrowserType({ element_id: "99", text: "hello" });
    expect(result).toMatch(/don't have an element \[99\]/i);
  });
});

describe("tryResolvePendingBrowserConfirmation", () => {
  it("returns handled: false when nothing is pending", async () => {
    const result = await tryResolvePendingBrowserConfirmation("yes");
    expect(result.handled).toBe(false);
  });

  it("clicks the pending element on a clear yes", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    await executeBrowserClick({ element_id: "2" }); // sets the pending confirmation

    const result = await tryResolvePendingBrowserConfirmation("yes");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.reply).toContain('Clicked "Buy Now"');
    expect(getPendingBrowserConfirmation()).toBeNull();
  });

  it("cancels without clicking on a clear no", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    await executeBrowserClick({ element_id: "2" });

    const result = await tryResolvePendingBrowserConfirmation("no");
    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.reply).toMatch(/cancelled/i);
    expect(getPendingBrowserConfirmation()).toBeNull();
  });

  it("drops the pending confirmation on an unrelated utterance, same as run_script's version", async () => {
    await executeBrowserNavigate({ url: "example.com" });
    await executeBrowserClick({ element_id: "2" });

    const result = await tryResolvePendingBrowserConfirmation("open notepad");
    expect(result.handled).toBe(false);
    expect(getPendingBrowserConfirmation()).toBeNull(); // dropped, not left open for a stray later "yes"
  });
});
