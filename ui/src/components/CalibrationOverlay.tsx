import { useEffect } from "react";
import { cancelCalibration, useGaze } from "../vision/gazeStore";

const R = 20;
const CIRC = 2 * Math.PI * R;

/** Full-window calibration: look at each dot in turn while the ring fills. */
export function CalibrationOverlay() {
  const g = useGaze();
  const c = g.calibrating;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelCalibration("Calibration cancelled."); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!c) return null;
  return (
    <div className="calibration" role="dialog" aria-modal="true" aria-label="Eye tracking calibration">
      <div className="cal-top">
        <strong>Look at the dot and keep your head still</strong>
        <span className="note">Point {Math.min(c.index + 1, c.total)} of {c.total}. Blink normally.</span>
        {!g.faceSeen && <span className="cal-warn" role="alert">I can't see your face. Check the camera and the light.</span>}
      </div>
      <div className="cal-target" style={{ left: `${c.target.x * 100}%`, top: `${c.target.y * 100}%` }} aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48">
          <circle cx="24" cy="24" r={R} className="cal-track" />
          <circle cx="24" cy="24" r={R} className="cal-ring" strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - c.progress)} transform="rotate(-90 24 24)" />
          <circle cx="24" cy="24" r="4" className="cal-dot" />
        </svg>
      </div>
      <button type="button" className="btn cal-cancel" onClick={() => cancelCalibration("Calibration cancelled.")}>Cancel (Esc)</button>
    </div>
  );
}
