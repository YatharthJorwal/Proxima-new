import { useCallback, useEffect, useRef, useState } from "react";
import { Panel } from "./Panel";

/**
 * Plain camera preview — off until the person turns it on, stream stopped
 * the moment they turn it off or leave the page. Hand tracking and the
 * pinch trigger are NOT here yet; they still live in the classic window.
 */
export function CameraPreview({ compact = false }: { compact?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setOn(false);
  }, []);

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setOn(true);
    } catch (e) {
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera permission was denied." : "No camera could be opened.");
    }
  };

  useEffect(() => stop, [stop]);

  return (
    <Panel title={compact ? "Camera" : "Camera feed"} className={`camera-card${compact ? " compact" : ""}`}
      status={on || !compact ? <span className={`chip ${on ? "chip-live" : ""}`}>{on ? "Live" : "Off"}</span> : undefined}
      actions={<button type="button" className="btn btn-small" onClick={on ? stop : start}>{on ? "Turn off" : "Turn on"}</button>}>
      <div className="camera-frame">
        <video ref={videoRef} autoPlay muted playsInline className={on ? "" : "hidden"} />
        {!on && <p className="empty">{error || "Preview only. Nothing starts until you turn it on."}</p>}
      </div>
    </Panel>
  );
}
