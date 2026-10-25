import { CameraControls, CameraView } from "../components/CameraCard";
import { Panel } from "../components/Panel";
import { useCamera } from "../vision/cameraStore";

export function CameraPage() {
  const cam = useCamera();
  return (
    <div className="page-grid two camera-page">
      <Panel title="Camera feed" className="camera-card" status={<span className={`chip ${cam.camera === "on" ? "chip-live" : ""}`}>{cam.camera === "on" ? "Live" : "Off"}</span>}>
        <CameraView />
      </Panel>
      <div className="stack">
        <Panel title="Tracking">
          <CameraControls />
          <p className="note">Everything runs on this computer. The camera only turns on when you press the button, and hand tracking and the pinch trigger stay off until you enable them.</p>
        </Panel>
        <Panel title="Eye tracking" status={<span className="chip">Not built</span>}>
          <p className="note">Scoped but not built yet. See <code>docs/eye-tracking-scope.md</code> for what is feasible with the webcam, how accurate it would be, and the plan.</p>
        </Panel>
      </div>
    </div>
  );
}
