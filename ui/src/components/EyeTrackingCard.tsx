import { Attention } from "../vision/attention";
import { useCamera } from "../vision/cameraStore";
import { GazeState } from "../vision/gazeEngine";
import { cameraReadyForGaze, resetCalibration, setGazeSetting, startCalibration, startEyeTracking, stopEyeTracking, useGaze } from "../vision/gazeStore";
import { Panel } from "./Panel";

export const ATTENTION_LABEL: Record<Attention, string> = { looking: "Looking at the screen", away: "Looking away", "no-face": "No face in view" };

export function qualityGrade(q: number): string {
  return q < 0.06 ? "good" : q < 0.12 ? "fair" : "rough, try again with steadier lighting and head";
}

export function eyeStatusLine(g: GazeState, cameraOn: boolean): string {
  if (g.message) return g.message;
  if (g.phase === "loading") return "Loading the face model…";
  if (g.phase === "off") return cameraOn ? "Eye tracking is off." : "Turn the camera on to use eye tracking.";
  const attention = ATTENTION_LABEL[g.attention];
  return g.calibrated ? `${attention}. Calibrated.` : `${attention}. Not calibrated yet.`;
}

export function EyeTrackingCard() {
  const g = useGaze();
  const cam = useCamera();
  const on = g.phase === "on";
  const camOn = cameraReadyForGaze(cam.camera);
  return (
    <Panel title="Eye tracking" className="eye-card" status={<span className={`chip ${on ? "chip-live" : ""}`}>{on ? ATTENTION_LABEL[g.attention] : "Off"}</span>}>
      <div className="toggle-row">
        <button type="button" className="btn" aria-pressed={on} disabled={g.phase === "loading" || (!on && !camOn)} onClick={() => (on ? stopEyeTracking() : void startEyeTracking())}>{on ? "Eye tracking: On" : "Eye tracking: Off"}</button>
        <button type="button" className="btn btn-primary" disabled={!on || !!g.calibrating} onClick={startCalibration}>{g.calibrated ? "Recalibrate" : "Calibrate"}</button>
        {g.calibrated && <button type="button" className="btn" onClick={resetCalibration}>Reset calibration</button>}
      </div>
      <p className="note" role="status">{eyeStatusLine(g, camOn)}</p>
      {g.calibrated && g.quality !== null && (
        <p className="note">Typical error on points it wasn't trained on: <strong>{(g.quality * 100).toFixed(g.quality < 0.1 ? 1 : 0)}% of the screen</strong> ({qualityGrade(g.quality)}).</p>
      )}
      <div className="option-list">
        <label className="check"><input type="checkbox" checked={g.settings.gatePinch} onChange={(e) => setGazeSetting("gatePinch", e.target.checked)} />Only accept the pinch trigger while I'm looking at the screen</label>
        <label className="check"><input type="checkbox" checked={g.settings.highlightCards} onChange={(e) => setGazeSetting("highlightCards", e.target.checked)} />Highlight the card I'm looking at (needs calibration)</label>
        <label className="check"><input type="checkbox" checked={g.settings.showDot} onChange={(e) => setGazeSetting("showDot", e.target.checked)} />Show a dot where it thinks I'm looking (needs calibration)</label>
      </div>
      <p className="note">A webcam can tell roughly which part of the screen you're looking at, not which word. Everything runs on this computer, nothing about where you look is saved (only the calibration numbers), and looking at something never starts an action: the pinch option above can only make the trigger stricter.</p>
    </Panel>
  );
}
