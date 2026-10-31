/**
 * One Euro filter (Casiez et al.): smooths hard when the signal is still,
 * and lets go of the smoothing when it moves fast, so a gaze dot is steady
 * while you look at something and still catches up when you look elsewhere.
 */
const alpha = (cutoff: number, dtSeconds: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSeconds);
};

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(private readonly minCutoff = 1.0, private readonly beta = 0.02, private readonly dCutoff = 1.0) {}

  reset(): void { this.x = null; this.dx = 0; }

  filter(value: number, timeMs: number): number {
    if (this.x === null) { this.x = value; this.t = timeMs; return value; }
    const dt = Math.max(1e-3, (timeMs - this.t) / 1000);
    this.t = timeMs;
    const rawSpeed = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawSpeed - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

export class PointFilter {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;
  constructor(minCutoff = 1.0, beta = 0.02) { this.fx = new OneEuroFilter(minCutoff, beta); this.fy = new OneEuroFilter(minCutoff, beta); }
  reset(): void { this.fx.reset(); this.fy.reset(); }
  filter(x: number, y: number, timeMs: number): { x: number; y: number } { return { x: this.fx.filter(x, timeMs), y: this.fy.filter(y, timeMs) }; }
}
