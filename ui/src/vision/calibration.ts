/**
 * Learns, for one person and one setup, how gaze features map to a point on
 * the screen. Nine targets, a few dozen samples each, a ridge-regularised
 * linear fit, and an honest quality figure: leave-one-TARGET-out error (how
 * well it predicts a target it was not trained on), not the flattering
 * error on its own training data.
 */
import type { GazeFeatures } from "./gaze";

export const featureVector = (f: GazeFeatures): number[] => [f.gx, f.gy, f.yaw, f.pitch, f.roll];
const FEATURES = 5;

export interface GazeModel { version: 1; mean: number[]; std: number[]; wx: number[]; wy: number[] }
export interface CalSample { f: number[]; target: { x: number; y: number }; group: number }
export interface Fit { model: GazeModel; /** Mean error on held-out targets, as a fraction of the screen (0.05 = 5%). */ quality: number; kept: number }

/** Gaussian elimination with partial pivoting. Returns null for a singular system. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = col + 1; r < n; r++) {
      const k = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= k * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

export function fitModel(samples: CalSample[], lambda = 0.1): GazeModel | null {
  if (samples.length < FEATURES + 2) return null;
  const mean = new Array<number>(FEATURES).fill(0);
  for (const s of samples) for (let i = 0; i < FEATURES; i++) mean[i] += s.f[i] / samples.length;
  const std = new Array<number>(FEATURES).fill(0);
  for (const s of samples) for (let i = 0; i < FEATURES; i++) std[i] += (s.f[i] - mean[i]) ** 2 / samples.length;
  for (let i = 0; i < FEATURES; i++) std[i] = Math.sqrt(std[i]) > 1e-9 ? Math.sqrt(std[i]) : 1; // a feature that never varies contributes nothing

  const dim = FEATURES + 1; // + bias
  const ata = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const atx = new Array<number>(dim).fill(0), aty = new Array<number>(dim).fill(0);
  for (const s of samples) {
    const row = [...s.f.map((v, i) => (v - mean[i]) / std[i]), 1];
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) ata[i][j] += row[i] * row[j];
      atx[i] += row[i] * s.target.x;
      aty[i] += row[i] * s.target.y;
    }
  }
  for (let i = 0; i < FEATURES; i++) ata[i][i] += lambda * samples.length / 100; // ridge on the weights, not the bias
  const wx = solveLinear(ata.map((r) => [...r]), atx);
  const wy = solveLinear(ata.map((r) => [...r]), aty);
  if (!wx || !wy || [...wx, ...wy].some((v) => !Number.isFinite(v))) return null;
  return { version: 1, mean, std, wx, wy };
}

export function predict(model: GazeModel, f: GazeFeatures | number[]): { x: number; y: number } {
  const v = Array.isArray(f) ? f : featureVector(f);
  let x = model.wx[FEATURES], y = model.wy[FEATURES];
  for (let i = 0; i < FEATURES; i++) {
    const z = (v[i] - model.mean[i]) / model.std[i];
    x += model.wx[i] * z;
    y += model.wy[i] * z;
  }
  return { x, y };
}

const err = (m: GazeModel, s: CalSample) => { const p = predict(m, s.f); return Math.hypot(p.x - s.target.x, p.y - s.target.y); };

/** Mean error, across targets, of predicting each target from a model trained on all the others. */
export function leaveOneTargetOut(samples: CalSample[], lambda = 0.1): number | null {
  const groups = [...new Set(samples.map((s) => s.group))];
  const perGroup: number[] = [];
  for (const g of groups) {
    const model = fitModel(samples.filter((s) => s.group !== g), lambda);
    const held = samples.filter((s) => s.group === g);
    if (!model || !held.length) continue;
    perGroup.push(held.reduce((a, s) => a + err(model, s), 0) / held.length);
  }
  return perGroup.length ? perGroup.reduce((a, b) => a + b, 0) / perGroup.length : null;
}

/** Drop the ~15% of each target's samples that sit furthest from that target's median (stray glances, bad frames). */
export function trimOutliers(samples: CalSample[], keepFraction = 0.85): CalSample[] {
  const globalStd = new Array<number>(FEATURES).fill(1);
  if (samples.length > 1) {
    const mean = new Array<number>(FEATURES).fill(0);
    for (const s of samples) for (let i = 0; i < FEATURES; i++) mean[i] += s.f[i] / samples.length;
    for (let i = 0; i < FEATURES; i++) {
      const v = samples.reduce((a, s) => a + (s.f[i] - mean[i]) ** 2, 0) / samples.length;
      globalStd[i] = Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1;
    }
  }
  const out: CalSample[] = [];
  for (const g of new Set(samples.map((s) => s.group))) {
    const grp = samples.filter((s) => s.group === g);
    const med = Array.from({ length: FEATURES }, (_, i) => { const a = grp.map((s) => s.f[i]).sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; });
    const scored = grp.map((s) => ({ s, d: Math.hypot(...s.f.map((v, i) => (v - med[i]) / globalStd[i])) })).sort((a, b) => a.d - b.d);
    out.push(...scored.slice(0, Math.max(Math.min(8, scored.length), Math.ceil(scored.length * keepFraction))).map((x) => x.s));
  }
  return out;
}

export const MIN_TARGETS = 6;
export const MIN_PER_TARGET = 8;

/** Fit from raw calibration samples. Null if there is not enough good data to trust. */
export function fitCalibration(samples: CalSample[], lambda = 0.1): Fit | null {
  const kept = trimOutliers(samples);
  const groups = new Map<number, number>();
  for (const s of kept) groups.set(s.group, (groups.get(s.group) ?? 0) + 1);
  const usable = [...groups.values()].filter((n) => n >= MIN_PER_TARGET).length;
  if (usable < MIN_TARGETS) return null;
  const model = fitModel(kept, lambda);
  const quality = leaveOneTargetOut(kept, lambda);
  if (!model || quality === null) return null;
  return { model, quality, kept: kept.length };
}

export function parseModel(raw: unknown): GazeModel | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const ok = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((v) => typeof v === "number" && Number.isFinite(v));
  if (m.version !== 1 || !ok(m.mean, FEATURES) || !ok(m.std, FEATURES) || !ok(m.wx, FEATURES + 1) || !ok(m.wy, FEATURES + 1)) return null;
  if ((m.std as number[]).some((v) => v <= 0)) return null;
  return { version: 1, mean: m.mean as number[], std: m.std as number[], wx: m.wx as number[], wy: m.wy as number[] };
}

export interface CalTarget { x: number; y: number }
/** 3 x 3 grid, as fractions of the window's page area, kept off the very edges where gaze is least reliable. */
export const DEFAULT_TARGETS: CalTarget[] = [0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y })));

export type CalEvent = "settling" | "collecting" | "advanced" | "done" | "ignored";

/** Walks through the targets: wait for the eyes to settle, then collect a fixed number of good samples, then move on. */
export class CalibrationSession {
  index = 0;
  samples: CalSample[] = [];
  lastSampleAt: number;
  private enteredAt: number | null = null;
  private count = 0;

  constructor(readonly targets: CalTarget[] = DEFAULT_TARGETS, readonly settleMs = 800, readonly perTarget = 22, startedAt = 0) { this.lastSampleAt = startedAt; }

  get done(): boolean { return this.index >= this.targets.length; }
  get target(): CalTarget | null { return this.targets[this.index] ?? null; }
  get progress(): number { return this.done ? 1 : this.count / this.perTarget; }

  /** `f` is null for a blink or a lost face; `label` is where the current target is, as a fraction of the screen. */
  add(f: GazeFeatures | null, now: number, label: { x: number; y: number }): CalEvent {
    if (this.done) return "done";
    if (this.enteredAt === null) this.enteredAt = now;
    if (now - this.enteredAt < this.settleMs) return "settling";
    if (!f) return "ignored";
    this.samples.push({ f: featureVector(f), target: label, group: this.index });
    this.lastSampleAt = now;
    if (++this.count < this.perTarget) return "collecting";
    this.index++;
    this.count = 0;
    this.enteredAt = null;
    return this.done ? "done" : "advanced";
  }
}
