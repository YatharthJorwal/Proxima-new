import { describe, expect, it } from "vitest";
import { OneEuroFilter, PointFilter } from "./filter";

function noise(seed: number) { let a = seed; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296 - 0.5; }; }

describe("One Euro filter", () => {
  it("passes the first value through", () => {
    expect(new OneEuroFilter().filter(0.7, 0)).toBe(0.7);
  });

  it("steadies a still, noisy signal", () => {
    const f = new OneEuroFilter(1.0, 0.02);
    const r = noise(7);
    const raw: number[] = [], out: number[] = [];
    for (let i = 0; i < 120; i++) { const v = 0.5 + r() * 0.08; raw.push(v); out.push(f.filter(v, i * 66)); }
    const spread = (a: number[]) => Math.max(...a.slice(30)) - Math.min(...a.slice(30));
    expect(spread(out)).toBeLessThan(spread(raw) * 0.5);
  });

  it("still catches up quickly when the signal jumps", () => {
    const f = new OneEuroFilter(1.0, 0.5);
    for (let i = 0; i < 20; i++) f.filter(0.2, i * 66);
    let v = 0;
    for (let i = 20; i < 26; i++) v = f.filter(0.8, i * 66); // ~0.4 s after the jump
    expect(v).toBeGreaterThan(0.65);
  });

  it("filters x and y independently and can be reset", () => {
    const p = new PointFilter();
    p.filter(0.1, 0.9, 0);
    const a = p.filter(0.1, 0.9, 66);
    expect(a.x).toBeCloseTo(0.1, 6);
    expect(a.y).toBeCloseTo(0.9, 6);
    p.reset();
    expect(p.filter(0.5, 0.5, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
});
