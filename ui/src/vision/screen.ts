/**
 * Window <-> screen coordinates. Gaze is calibrated against the SCREEN, not
 * the window, so moving or resizing the dashboard afterwards doesn't spoil the
 * calibration (the camera and the monitor haven't moved).
 */
export interface WindowGeometry { screenX: number; screenY: number; innerWidth: number; innerHeight: number; outerWidth: number; outerHeight: number }
export interface ScreenGeometry { width: number; height: number; availLeft?: number; availTop?: number }

/** Offset of the page area inside the window frame (title bar on top, thin borders elsewhere). */
function frame(w: WindowGeometry): { left: number; top: number } {
  const side = Math.max(0, (w.outerWidth - w.innerWidth) / 2);
  const top = Math.max(0, w.outerHeight - w.innerHeight - side);
  return { left: side, top };
}

/** A point in the page (CSS px) as a fraction of the screen the window is on. */
export function clientToScreenNorm(x: number, y: number, w: WindowGeometry, s: ScreenGeometry): { x: number; y: number } {
  const f = frame(w);
  return { x: (w.screenX + f.left + x - (s.availLeft ?? 0)) / s.width, y: (w.screenY + f.top + y - (s.availTop ?? 0)) / s.height };
}

export function screenNormToClient(nx: number, ny: number, w: WindowGeometry, s: ScreenGeometry): { x: number; y: number } {
  const f = frame(w);
  return { x: nx * s.width + (s.availLeft ?? 0) - w.screenX - f.left, y: ny * s.height + (s.availTop ?? 0) - w.screenY - f.top };
}

export const sameScreen = (a: ScreenGeometry, b: ScreenGeometry): boolean =>
  a.width === b.width && a.height === b.height && (a.availLeft ?? 0) === (b.availLeft ?? 0) && (a.availTop ?? 0) === (b.availTop ?? 0);
