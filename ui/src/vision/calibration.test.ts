import { describe, expect, it } from "vitest";
import { AttentionTracker, rawAttention } from "./attention";
import { CalibrationSession, CalSample, DEFAULT_TARGETS, featureVector, fitCalibration, fitModel, leaveOneTargetOut, parseModel, predict, solveLinear, trimOutliers } from "./calibration";
import { GazeFeatures } from "./gaze";

let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 - 0.5; };

/** Features a person would produce looking at screen point (x, y), under a made-up but plausible mapping. */
const featuresFor = (x: number, y: number, headX = 0, noise = 0): GazeFeatures => ({
  gx: 0.5 + (x - 0.5 - 0.3 * headX) / 1.8 + rnd() * noise,
  gy: 0.5 + (y - 0.5) / 2.2 + rnd() * noise,
  yaw: headX + rnd() * noise * 0.5, pitch: 0.7 + 0.1 * (y - 0.5) + rnd() * noise * 0.5, roll: rnd() * noise * 0.2, size: 0.3,
});

const makeSamples = (noise: number, perTarget = 20): CalSample[] =>
  DEFAULT_TARGETS.flatMap((t, g) => Array.from({ length: perTarget }, () => ({ f: featureVector(featuresFor(t.x, t.y, rnd() * 0.1, noise)), target: t, group: g })));

describe("linear solver", () => {
  it("solves a system and reports a singular one", () => {
    const x = solveLinear([[2, 1], [1, 3]], [5, 10])!;
    expect(x[0]).toBeCloseTo(1, 9); expect(x[1]).toBeCloseTo(3, 9);
    expect(solveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });
});

describe("calibration fit", () => {
  it("recovers a clean mapping and predicts targets accurately", () => {
    const model = fitModel(makeSamples(0.0005))!;
    for (const t of DEFAULT_TARGETS) {
      const p = predict(model, featuresFor(t.x, t.y, 0.03, 0));
      expect(Math.hypot(p.x - t.x, p.y - t.y)).toBeLessThan(0.02);
    }
  });

  it("predicts a spot it was never calibrated on (interpolation)", () => {
    const model = fitModel(makeSamples(0.002))!;
    const p = predict(model, featuresFor(0.3, 0.7, 0.02, 0));
    expect(Math.hypot(p.x - 0.3, p.y - 0.7)).toBeLessThan(0.04);
  });

  it("survives a feature that never varies (no divide-by-zero, no NaN)", () => {
    const flat = makeSamples(0.001).map((s) => ({ ...s, f: s.f.map((v, i) => (i === 4 ? 0.1 : v)) }));
    const model = fitModel(flat)!;
    expect(model.wx.every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(predict(model, flat[0].f).x)).toBe(true);
  });

  it("reports honest quality: small for clean data, clearly worse for noisy data", () => {
    const clean = leaveOneTargetOut(makeSamples(0.002))!;
    const noisy = leaveOneTargetOut(makeSamples(0.12))!;
    expect(clean).toBeLessThan(0.08);
    expect(noisy).toBeGreaterThan(clean * 2);
  });

  it("needs enough targets and samples before it will produce a calibration", () => {
    expect(fitCalibration(makeSamples(0.002))).not.toBeNull();
    expect(fitCalibration(makeSamples(0.002).filter((s) => s.group < 4))).toBeNull(); // only 4 targets
    expect(fitCalibration(makeSamples(0.002, 5))).toBeNull(); // 5 samples each
    expect(fitModel([])).toBeNull();
  });

  it("drops stray samples (a glance away) rather than letting them bend the fit", () => {
    const samples = makeSamples(0.002);
    const polluted = samples.map((s, i) => (i % 20 === 0 ? { ...s, f: s.f.map((v) => v + 0.6) } : s)); // 5% wild
    const kept = trimOutliers(polluted);
    expect(kept.length).toBeLessThan(polluted.length);
    const fit = fitCalibration(polluted)!;
    const p = predict(fit.model, featuresFor(0.5, 0.5, 0.0, 0));
    expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeLessThan(0.05);
  });

  it("round-trips through JSON and rejects damaged or tampered models", () => {
    const model = fitModel(makeSamples(0.002))!;
    expect(parseModel(JSON.parse(JSON.stringify(model)))).toEqual(model);
    expect(parseModel({ ...model, version: 2 })).toBeNull();
    expect(parseModel({ ...model, wx: [1, 2] })).toBeNull();
    expect(parseModel({ ...model, std: [0, 1, 1, 1, 1] })).toBeNull();
    expect(parseModel({ ...model, mean: [NaN, 0, 0, 0, 0] })).toBeNull();
    expect(parseModel(null)).toBeNull();
  });
});

describe("calibration session", () => {
  const label = { x: 0.5, y: 0.5 };
  const good = featuresFor(0.5, 0.5);

  it("waits for the eyes to settle, then collects, then moves to the next target", () => {
    const s = new CalibrationSession(DEFAULT_TARGETS, 500, 3);
    expect(s.add(good, 0, label)).toBe("settling");
    expect(s.add(good, 400, label)).toBe("settling");
    expect(s.add(good, 500, label)).toBe("collecting");
    expect(s.add(good, 566, label)).toBe("collecting");
    expect(s.add(good, 632, label)).toBe("advanced");
    expect(s.index).toBe(1);
    expect(s.add(good, 700, label)).toBe("settling"); // the new target settles afresh
  });

  it("ignores blinks and lost faces instead of recording them", () => {
    const s = new CalibrationSession(DEFAULT_TARGETS, 0, 3);
    expect(s.add(good, 0, label)).toBe("collecting");
    expect(s.add(null, 66, label)).toBe("ignored");
    expect(s.samples).toHaveLength(1);
  });

  it("finishes after the last target and labels samples with their target index", () => {
    const s = new CalibrationSession([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }], 0, 1);
    expect(s.add(good, 0, label)).toBe("advanced");
    expect(s.add(good, 10, label)).toBe("done");
    expect(s.done).toBe(true);
    expect(s.target).toBeNull();
    expect(s.samples.map((x) => x.group)).toEqual([0, 1]);
    expect(s.add(good, 20, label)).toBe("done");
  });
});

describe("attention", () => {
  const f = (o: Partial<GazeFeatures> = {}): GazeFeatures => ({ gx: 0.5, gy: 0.5, yaw: 0, pitch: 0.7, roll: 0, size: 0.3, ...o });

  it("calls a centred face looking, and a turned head or extreme eyes away", () => {
    expect(rawAttention(true, f())).toBe("looking");
    expect(rawAttention(true, f({ yaw: 0.6 }))).toBe("away");
    expect(rawAttention(true, f({ gx: 0.9 }))).toBe("away");
    expect(rawAttention(true, f({ gy: 0.05 }))).toBe("away");
  });

  it("treats a blink as 'hold' and no face as 'none'", () => {
    expect(rawAttention(true, null)).toBe("hold");
    expect(rawAttention(false, null)).toBe("none");
  });

  it("uses the predicted point once calibrated, with a small margin around the screen", () => {
    expect(rawAttention(true, f(), { x: 0.5, y: 0.5 })).toBe("looking");
    expect(rawAttention(true, f(), { x: 1.05, y: 0.5 })).toBe("looking");
    expect(rawAttention(true, f(), { x: 1.4, y: 0.5 })).toBe("away");
    expect(rawAttention(true, f({ yaw: 0.9 }), { x: 0.5, y: 0.5 })).toBe("away");
  });

  it("needs a few steady frames to change state, so flicker does nothing", () => {
    const t = new AttentionTracker();
    expect(t.state).toBe("no-face");
    t.update("looking", 0); t.update("looking", 66);
    expect(t.state).toBe("no-face");
    t.update("looking", 132);
    expect(t.state).toBe("looking");
    for (let i = 0; i < 20; i++) t.update(i % 2 ? "away" : "looking", 200 + i * 66);
    expect(t.state).toBe("looking"); // alternating frames never accumulate
    for (let i = 0; i < 6; i++) t.update("away", 2000 + i * 66);
    expect(t.state).toBe("away");
  });

  it("holds through blinks and only reports no-face after a short absence", () => {
    const t = new AttentionTracker();
    for (let i = 0; i < 3; i++) t.update("looking", i * 66);
    for (let i = 0; i < 10; i++) t.update("hold", 200 + i * 66);
    expect(t.state).toBe("looking");
    t.update("none", 1000);
    expect(t.state).toBe("looking"); // 0.8 s grace not yet over
    t.update("none", 1900);
    expect(t.state).toBe("no-face");
    t.update("looking", 2000); t.update("looking", 2066);
    expect(t.state).toBe("no-face"); // needs the full run again
  });
});
