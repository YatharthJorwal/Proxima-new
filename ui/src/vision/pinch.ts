export interface Landmark { x: number; y: number; z: number }

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Thumb tip (4) to index tip (8), relative to palm size (wrist 0 to middle-finger knuckle 9). */
export function pinchRatio(hand: Landmark[]): number | null {
  if (hand.length < 21) return null;
  const palm = dist(hand[0], hand[9]);
  return palm > 0 ? dist(hand[4], hand[8]) / palm : null;
}

export const PINCH_THRESHOLD = 0.28;
export const PINCH_COOLDOWN_MS = 1200;

export function isPinch(hand: Landmark[], threshold = PINCH_THRESHOLD): boolean {
  const r = pinchRatio(hand);
  return r !== null && r < threshold;
}

/**
 * Edge-triggered pinch: fires once when a pinch starts, then waits for the
 * fingers to open (re-arm) and for the cooldown to pass. Same behaviour as the
 * classic dashboard, now testable.
 */
export class PinchTrigger {
  private armed = true;
  private last = -Infinity;

  reset(): void { this.armed = true; this.last = -Infinity; }

  /** Returns true exactly when a trigger should fire. `pinching` is false when no hand is seen. */
  update(pinching: boolean, now: number): boolean {
    if (pinching && this.armed && now - this.last > PINCH_COOLDOWN_MS) {
      this.armed = false;
      this.last = now;
      return true;
    }
    if (!pinching) this.armed = true;
    return false;
  }
}
