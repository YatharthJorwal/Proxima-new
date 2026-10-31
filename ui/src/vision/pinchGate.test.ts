import { describe, expect, it } from "vitest";
import { GatedPinch } from "./pinch";

describe("gated pinch", () => {
  it("fires normally when allowed", () => {
    const g = new GatedPinch();
    expect(g.update(true, true, 0)).toBe(true);
    expect(g.update(true, true, 100)).toBe(false);
  });

  it("does not fire while not allowed", () => {
    const g = new GatedPinch();
    expect(g.update(true, false, 0)).toBe(false);
    expect(g.update(false, false, 100)).toBe(false);
  });

  it("a pinch that began while not allowed stays ignored after looking back, until the fingers open", () => {
    const g = new GatedPinch();
    expect(g.update(true, false, 0)).toBe(false);
    expect(g.update(true, true, 100)).toBe(false); // looked back, still pinched: no late fire
    expect(g.update(false, true, 200)).toBe(false); // fingers open
    expect(g.update(true, true, 1500)).toBe(true); // a fresh pinch works
  });

  it("losing attention mid-pinch doesn't matter once it has fired", () => {
    const g = new GatedPinch();
    expect(g.update(true, true, 0)).toBe(true);
    expect(g.update(true, false, 100)).toBe(false);
    expect(g.update(false, false, 200)).toBe(false);
  });

  it("reset forgets everything", () => {
    const g = new GatedPinch();
    g.update(true, false, 0);
    g.reset();
    expect(g.update(true, true, 10)).toBe(true);
  });
});
