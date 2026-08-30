/**
 * Same fallthrough fix as openApp.test.ts, applied to tryHandleBrowse for
 * consistency - see browse.ts's tryHandleBrowse for the fix itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLaunch } = vi.hoisted(() => ({ mockLaunch: vi.fn() }));
vi.mock("./launch", () => ({ launch: mockLaunch }));

import { tryHandleBrowse } from "./browse";

beforeEach(() => {
  mockLaunch.mockReset().mockResolvedValue(undefined);
});

describe("tryHandleBrowse", () => {
  it("returns null for text that doesn't match the search pattern at all", async () => {
    expect(await tryHandleBrowse("open github")).toBeNull();
  });

  it("handles a known site directly", async () => {
    const result = await tryHandleBrowse("search youtube for lofi beats");
    expect(result).toBe('Searching youtube for "lofi beats".');
    expect(mockLaunch).toHaveBeenCalledWith(
      "https://www.youtube.com/results?search_query=lofi%20beats"
    );
  });

  it("returns null for an unrecognized site instead of a canned wrong answer", async () => {
    expect(await tryHandleBrowse("search bing for cats")).toBeNull();
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
