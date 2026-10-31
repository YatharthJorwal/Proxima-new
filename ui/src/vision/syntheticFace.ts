import { FACE_LANDMARKS, LM, P } from "./gaze";

export interface FakeFaceOptions {
  /** Where the irises sit, 0..1 across (toward image-right) and down the eye opening. */
  gx?: number; gy?: number;
  /** Head turn / tilt proxies (see gaze.ts) and roll in radians. */
  yaw?: number; pitch?: number; roll?: number;
  /** 1 = normal open eyes, 0 = closed. */
  open?: number;
  /** Face centre and eye distance, in image-height units. */
  cx?: number; cy?: number; io?: number;
  /** video width / height. */
  aspect?: number;
}

/**
 * A 478-point face with only the landmarks gaze.ts reads filled in. Used by
 * the unit tests, and by the dashboard's test mode (window.__PROXIMA_FAKE_FACE__)
 * to exercise the calibration screens without a camera. Never used otherwise.
 */
export function makeFace(o: FakeFaceOptions = {}): P[] {
  const { gx = 0.5, gy = 0.5, yaw = 0, pitch = 0, roll = 0, open = 1, cx = 0.5 * (o.aspect ?? 1), cy = 0.5, io = 0.3, aspect = 1 } = o;
  const w = io * 0.3; // eye width
  const lid = 0.3 * w * open; // eye opening
  const pts: P[] = Array.from({ length: FACE_LANDMARKS }, () => ({ x: cx, y: cy }));
  const set = (i: number, x: number, y: number) => { pts[i] = { x, y }; };

  // Right eye (subject's right, image-left): outer corner far from the nose.
  const rOuter = { x: cx - io / 2, y: cy }, rInner = { x: cx - io / 2 + w, y: cy };
  const lOuter = { x: cx + io / 2, y: cy }, lInner = { x: cx + io / 2 - w, y: cy };
  set(LM.rightOuter, rOuter.x, rOuter.y); set(LM.rightInner, rInner.x, rInner.y);
  set(LM.leftOuter, lOuter.x, lOuter.y); set(LM.leftInner, lInner.x, lInner.y);
  const rMid = (rOuter.x + rInner.x) / 2, lMid = (lOuter.x + lInner.x) / 2;
  set(LM.rightTop, rMid, cy - lid / 2); set(LM.rightBottom, rMid, cy + lid / 2);
  set(LM.leftTop, lMid, cy - lid / 2); set(LM.leftBottom, lMid, cy + lid / 2);
  // Iris: gx runs toward image-right in both eyes (so the left eye's own ratio is mirrored).
  set(LM.rightIris, rOuter.x + gx * (rInner.x - rOuter.x), cy - lid / 2 + gy * lid);
  set(LM.leftIris, lOuter.x + (1 - gx) * (lInner.x - lOuter.x), cy - lid / 2 + gy * lid);
  set(LM.nose, cx + yaw * io, cy + (0.7 + pitch) * io);

  // Roll the whole face about its centre, then go back to normalised image coordinates.
  const c = Math.cos(roll), s = Math.sin(roll);
  return pts.map((q) => {
    const dx = q.x - cx, dy = q.y - cy;
    return { x: (cx + dx * c - dy * s) / aspect, y: cy + dx * s + dy * c };
  });
}
