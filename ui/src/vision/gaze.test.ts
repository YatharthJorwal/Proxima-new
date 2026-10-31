import { describe, expect, it } from "vitest";
import { BLINK_EAR, gazeFeatures } from "./gaze";
import { makeFace } from "./syntheticFace";

const f = (o = {}) => gazeFeatures(makeFace(o), (o as { aspect?: number }).aspect ?? 1)!;

describe("gaze features", () => {
  it("reads a centred gaze as the middle of both eyes", () => {
    const g = f();
    expect(g.gx).toBeCloseTo(0.5, 6);
    expect(g.gy).toBeCloseTo(0.5, 6);
    expect(g.yaw).toBeCloseTo(0, 6);
    expect(g.pitch).toBeCloseTo(0.7, 6);
  });

  it("recovers where the irises are, horizontally and vertically", () => {
    for (const gx of [0.2, 0.35, 0.5, 0.65, 0.8]) expect(f({ gx }).gx).toBeCloseTo(gx, 6);
    for (const gy of [0.25, 0.5, 0.75]) expect(f({ gy }).gy).toBeCloseTo(gy, 6);
  });

  it("moves in the right direction: looking toward image-right raises gx, looking down raises gy", () => {
    expect(f({ gx: 0.7 }).gx).toBeGreaterThan(f({ gx: 0.3 }).gx);
    expect(f({ gy: 0.7 }).gy).toBeGreaterThan(f({ gy: 0.3 }).gy);
  });

  it("ignores where the face is and how big it is", () => {
    const base = f({ gx: 0.6, gy: 0.4 });
    const moved = f({ gx: 0.6, gy: 0.4, cx: 0.3, cy: 0.62, io: 0.18 });
    expect(moved.gx).toBeCloseTo(base.gx, 6);
    expect(moved.gy).toBeCloseTo(base.gy, 6);
    expect(moved.size).toBeLessThan(base.size);
  });

  it("is not thrown off by tilting the head (roll), which only shows up in roll", () => {
    const base = f({ gx: 0.62, gy: 0.45, yaw: 0.1, pitch: 0.05 });
    const tilted = f({ gx: 0.62, gy: 0.45, yaw: 0.1, pitch: 0.05, roll: (25 * Math.PI) / 180 });
    for (const k of ["gx", "gy", "yaw", "pitch"] as const) expect(tilted[k]).toBeCloseTo(base[k], 6);
    expect(tilted.roll).toBeCloseTo((25 * Math.PI) / 180, 6);
  });

  it("measures with square pixels on a widescreen camera", () => {
    const wide = f({ gx: 0.58, gy: 0.42, yaw: -0.2, aspect: 16 / 9 });
    const square = f({ gx: 0.58, gy: 0.42, yaw: -0.2 });
    for (const k of ["gx", "gy", "yaw", "pitch", "size"] as const) expect(wide[k]).toBeCloseTo(square[k], 6);
  });

  it("separates head turns from eye movement", () => {
    const turned = f({ yaw: 0.3 });
    expect(turned.yaw).toBeGreaterThan(f().yaw);
    expect(turned.gx).toBeCloseTo(0.5, 6);
    expect(f({ pitch: 0.2 }).pitch).toBeGreaterThan(f().pitch);
  });

  it("skips blinks but accepts half-open eyes", () => {
    expect(gazeFeatures(makeFace({ open: 0.2 }))).toBeNull(); // opening ratio 0.06, well under BLINK_EAR
    expect(gazeFeatures(makeFace({ open: 0.6 }))).not.toBeNull();
    expect(BLINK_EAR).toBeGreaterThan(0.06);
  });

  it("refuses unusable input instead of guessing", () => {
    expect(gazeFeatures([])).toBeNull();
    expect(gazeFeatures(makeFace().slice(0, 400))).toBeNull();
    expect(gazeFeatures(makeFace(), 0)).toBeNull();
    const nan = makeFace(); nan[468] = { x: NaN, y: 0.5 };
    expect(gazeFeatures(nan)).toBeNull();
    expect(gazeFeatures(makeFace({ io: 0 }))).toBeNull();
  });
});
