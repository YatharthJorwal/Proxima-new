/**
 * Gaze features from a MediaPipe face mesh (478 landmarks, the last ten are
 * the irises). Pure maths on normalised landmark coordinates, so it is unit
 * tested with a synthetic face (syntheticFace.ts) rather than a camera.
 *
 * What it produces is NOT a screen position. It is a small set of numbers
 * that vary smoothly with where the eyes point and how the head is turned:
 *   gx, gy   where the irises sit inside the eye openings (0..1 each)
 *   yaw      head turn proxy, pitch  head tilt proxy, roll  eye-line angle
 * calibration.ts learns how those map to the screen for one person and setup.
 */

export interface P { x: number; y: number }

/** MediaPipe face-mesh landmark indices used here. "Right"/"left" are the subject's own eyes. */
export const LM = {
  rightIris: 468, leftIris: 473,
  rightOuter: 33, rightInner: 133, rightTop: 159, rightBottom: 145,
  leftOuter: 263, leftInner: 362, leftTop: 386, leftBottom: 374,
  nose: 1,
} as const;

export const FACE_LANDMARKS = 478;
/** Below this eye-opening-to-width ratio the eye is treated as blinking and the sample is skipped. */
export const BLINK_EAR = 0.14;

export interface GazeFeatures {
  gx: number;
  gy: number;
  yaw: number;
  pitch: number;
  /** Radians. */
  roll: number;
  /** Eye-corner to eye-corner distance in image-height units (how big the face is in frame). */
  size: number;
}

interface EyeReading { h: number; v: number; ear: number }

/** Iris position inside one eye, in the eye's own frame so head roll does not matter. */
function readEye(outer: P, inner: P, top: P, bottom: P, iris: P): EyeReading | null {
  const ax = inner.x - outer.x, ay = inner.y - outer.y;
  const w = Math.hypot(ax, ay);
  if (!(w > 1e-6)) return null;
  const ux = ax / w, uy = ay / w; // along the eye, outer corner to inner corner
  let nx = -uy, ny = ux; // across the eye, pointing down the image
  if (ny < 0) { nx = -nx; ny = -ny; }
  const opening = (bottom.x - top.x) * nx + (bottom.y - top.y) * ny;
  if (!(opening > 1e-6)) return null;
  return {
    h: ((iris.x - outer.x) * ux + (iris.y - outer.y) * uy) / w,
    v: ((iris.x - top.x) * nx + (iris.y - top.y) * ny) / opening,
    ear: opening / w,
  };
}

/**
 * @param landmarks normalised face landmarks (x across the image width, y down its height)
 * @param aspect    video width / height, so distances are measured with square pixels
 * @returns null when the face is unusable (too few points, a blink, degenerate geometry)
 */
export function gazeFeatures(landmarks: P[], aspect = 1): GazeFeatures | null {
  if (!Array.isArray(landmarks) || landmarks.length < FACE_LANDMARKS || !(aspect > 0)) return null;
  const pt = (i: number): P => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const p = {
    rightOuter: pt(LM.rightOuter), rightInner: pt(LM.rightInner), rightTop: pt(LM.rightTop), rightBottom: pt(LM.rightBottom), rightIris: pt(LM.rightIris),
    leftOuter: pt(LM.leftOuter), leftInner: pt(LM.leftInner), leftTop: pt(LM.leftTop), leftBottom: pt(LM.leftBottom), leftIris: pt(LM.leftIris),
    nose: pt(LM.nose),
  };
  for (const q of Object.values(p)) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;

  const r = readEye(p.rightOuter, p.rightInner, p.rightTop, p.rightBottom, p.rightIris);
  const l = readEye(p.leftOuter, p.leftInner, p.leftTop, p.leftBottom, p.leftIris);
  if (!r || !l || r.ear < BLINK_EAR || l.ear < BLINK_EAR) return null;

  // Head pose proxies in the face's own frame (u along the eye line, v across it), divided by eye distance.
  const ex = p.leftOuter.x - p.rightOuter.x, ey = p.leftOuter.y - p.rightOuter.y;
  const io = Math.hypot(ex, ey);
  if (!(io > 1e-6)) return null;
  const ux = ex / io, uy = ey / io;
  const vx = -uy, vy = ux;
  const mx = (p.leftOuter.x + p.rightOuter.x) / 2, my = (p.leftOuter.y + p.rightOuter.y) / 2;
  const dx = p.nose.x - mx, dy = p.nose.y - my;

  return {
    // Both eyes expressed as "how far toward image-right": the right eye's inner corner is on the image-right, the left eye's on the image-left.
    gx: (r.h + (1 - l.h)) / 2,
    gy: (r.v + l.v) / 2,
    yaw: (dx * ux + dy * uy) / io,
    pitch: (dx * vx + dy * vy) / io,
    roll: Math.atan2(ey, ex),
    size: io,
  };
}
