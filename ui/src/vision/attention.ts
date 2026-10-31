/**
 * "Are they looking at the screen?" from gaze features, with hysteresis so a
 * glance, a blink or one noisy frame doesn't flip the state. Gaze is only
 * ever used to SUPPRESS things (e.g. ignore the pinch trigger while looking
 * away), never to start them.
 */
import type { GazeFeatures } from "./gaze";

export type Attention = "no-face" | "away" | "looking";
/** One frame's verdict: "hold" = a face is there but this frame is unusable (a blink), "none" = no face. */
export type RawAttention = "looking" | "away" | "hold" | "none";

/**
 * Starting values, chosen from geometry and NOT yet tuned on real faces:
 * expect to adjust them after trying it. Uncalibrated, "looking" means the
 * head is roughly facing the camera and the irises are not at the extremes.
 * Calibrated, it means the predicted gaze point is on (or just off) the screen.
 */
export const ATTENTION_DEFAULTS = {
  yawMax: 0.32,
  yawMaxCalibrated: 0.55,
  gx: [0.22, 0.78] as const,
  gy: [0.15, 0.85] as const,
  screenX: [-0.08, 1.08] as const,
  screenY: [-0.12, 1.12] as const,
  lookFrames: 3,
  awayFrames: 6,
  noFaceMs: 800,
};
export type AttentionConfig = typeof ATTENTION_DEFAULTS;

const within = (v: number, r: readonly [number, number]) => v >= r[0] && v <= r[1];

export function rawAttention(faceSeen: boolean, f: GazeFeatures | null, point: { x: number; y: number } | null = null, cfg: AttentionConfig = ATTENTION_DEFAULTS): RawAttention {
  if (!faceSeen) return "none";
  if (!f) return "hold";
  if (point) return Math.abs(f.yaw) <= cfg.yawMaxCalibrated && within(point.x, cfg.screenX) && within(point.y, cfg.screenY) ? "looking" : "away";
  return Math.abs(f.yaw) <= cfg.yawMax && within(f.gx, cfg.gx) && within(f.gy, cfg.gy) ? "looking" : "away";
}

export class AttentionTracker {
  state: Attention = "no-face";
  private lookRun = 0;
  private awayRun = 0;
  private lastFaceAt = -Infinity;

  constructor(private readonly cfg: AttentionConfig = ATTENTION_DEFAULTS) {}

  reset(): void { this.state = "no-face"; this.lookRun = 0; this.awayRun = 0; this.lastFaceAt = -Infinity; }

  update(raw: RawAttention, now: number): Attention {
    if (raw !== "none") this.lastFaceAt = now;
    if (raw === "looking") {
      this.awayRun = 0;
      if (++this.lookRun >= this.cfg.lookFrames) this.state = "looking";
    } else if (raw === "away") {
      this.lookRun = 0;
      if (++this.awayRun >= this.cfg.awayFrames) this.state = "away";
    } else if (raw === "none" && now - this.lastFaceAt >= this.cfg.noFaceMs) {
      this.state = "no-face";
      this.lookRun = this.awayRun = 0;
    }
    return this.state;
  }
}
