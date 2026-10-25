import { useEffect, useRef } from "react";
import { onHandFrame, setHandTracking, setPinchTrigger, startCamera, stopCamera, useCamera, HandFrame } from "../vision/cameraStore";
import { coverMapper } from "../vision/mapper";
import { Panel } from "./Panel";

/** The live picture with the hand skeleton drawn over it. */
export function CameraView() {
  const cam = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = cam.stream;
    if (cam.stream) void v.play().catch(() => undefined);
  }, [cam.stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    const ctx = canvas.getContext("2d");
    const off = onHandFrame((frame: HandFrame) => {
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const v = videoRef.current;
      const map = v ? coverMapper({ w: v.videoWidth, h: v.videoHeight }, { w: canvas.width, h: canvas.height }) : null;
      if (!map) return;
      ctx.strokeStyle = "#3fa9ff";
      ctx.fillStyle = "#7cd4ff";
      ctx.lineWidth = 2;
      for (const hand of frame.hands) {
        for (const { start, end } of frame.connections) {
          const [ax, ay] = map(hand[start].x, hand[start].y);
          const [bx, by] = map(hand[end].x, hand[end].y);
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        }
        for (const p of hand) {
          const [x, y] = map(p.x, p.y);
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
    return () => { off(); ro.disconnect(); };
  }, []);

  const on = cam.camera === "on";
  return (
    <div className="camera-frame">
      <video ref={videoRef} autoPlay muted playsInline className={on ? "" : "hidden"} />
      <canvas ref={canvasRef} className={`camera-overlay${on ? "" : " hidden"}`} />
      {!on && <p className="empty">{cam.message || "Preview only. Nothing starts until you turn it on."}</p>}
    </div>
  );
}

export function cameraStatusLine(cam: ReturnType<typeof useCamera>): string {
  if (cam.message) return cam.message;
  if (cam.camera === "starting") return "Requesting camera…";
  if (cam.camera === "off") return "Camera is off.";
  if (cam.hand === "loading") return "Loading hand-tracking model…";
  if (cam.hand === "off") return "Camera on. Hand tracking is off.";
  const seen = cam.hands === 0 ? "No hand detected" : `${cam.hands} hand${cam.hands > 1 ? "s" : ""} detected`;
  return cam.pinch ? `${seen} · pinch thumb and index finger to start or stop voice` : seen;
}

/** Compact camera card for the dashboard. */
export function CameraCard() {
  const cam = useCamera();
  const on = cam.camera === "on";
  return (
    <Panel title="Camera" className="camera-card compact"
      status={on ? <span className="chip chip-live">Live</span> : undefined}
      actions={<button type="button" className="btn btn-small" disabled={cam.camera === "starting"} onClick={() => (on ? stopCamera() : void startCamera())}>{on ? "Turn off" : "Turn on"}</button>}>
      <CameraView />
    </Panel>
  );
}

export function CameraControls() {
  const cam = useCamera();
  const on = cam.camera === "on";
  const handOn = cam.hand === "on";
  return (
    <div className="cam-controls">
      <div className="toggle-row">
        <button type="button" className="btn" aria-pressed={on} disabled={cam.camera === "starting"} onClick={() => (on ? stopCamera() : void startCamera())}>{on ? "Camera: On" : "Camera: Off"}</button>
        <button type="button" className="btn" aria-pressed={handOn} disabled={!on || cam.hand === "loading"} onClick={() => void setHandTracking(!handOn)}>{handOn ? "Hand tracking: On" : "Hand tracking: Off"}</button>
        <button type="button" className="btn" aria-pressed={cam.pinch} disabled={!handOn} onClick={() => setPinchTrigger(!cam.pinch)}>{cam.pinch ? "Pinch trigger: On" : "Pinch trigger: Off"}</button>
      </div>
      <p className="note" role="status">{cameraStatusLine(cam)}</p>
    </div>
  );
}
