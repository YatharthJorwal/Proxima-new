import { useState } from "react";
import { Icon } from "./icons";
import { Panel } from "./Panel";

const ZOOM = 14;
const TILE = 256;

interface Fix { lat: number; lon: number; x: number; y: number; fx: number; fy: number }

function toTile(lat: number, lon: number): Fix {
  const scale = 2 ** ZOOM;
  const fxAbs = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const fyAbs = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale;
  const x = Math.floor(fxAbs), y = Math.floor(fyAbs);
  return { lat, lon, x, y, fx: fxAbs - x, fy: fyAbs - y };
}

type Status = { kind: "off" | "waiting" | "ready" | "error"; text: string };

/**
 * Location is requested only after the person clicks. Tiles come from
 * OpenStreetMap for the viewed area, which discloses that area to the
 * provider — said plainly in the card. The dark look is a CSS filter on the
 * tiles; the tiles themselves are unchanged.
 */
export function MapCard({ compact = false }: { compact?: boolean }) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "off", text: "Location is off until you enable it." });

  const locate = () => {
    if (!navigator.geolocation) { setStatus({ kind: "error", text: "Location is unavailable in this runtime." }); return; }
    setStatus({ kind: "waiting", text: "Waiting for location permission…" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setFix(toTile(coords.latitude, coords.longitude)); setStatus({ kind: "ready", text: `Centered near ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}` }); },
      (err) => setStatus({ kind: "error", text: err.code === err.PERMISSION_DENIED ? "Location permission denied." : "Could not get the current location." }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  const scale = 2 ** ZOOM;
  const tiles: { key: string; src: string; left: number; top: number }[] = [];
  if (fix) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = (fix.x + dx + scale) % scale;
      const ty = Math.max(0, Math.min(scale - 1, fix.y + dy));
      tiles.push({ key: `${dx},${dy}`, src: `https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`, left: (dx + 1) * TILE, top: (dy + 1) * TILE });
    }
  }
  // Shift the 3×3 grid so the exact position (not just the centre tile) sits in the middle of the frame.
  const shift = fix ? { transform: `translate(${-(1 + fix.fx) * TILE}px, ${-(1 + fix.fy) * TILE}px)` } : undefined;

  return (
    <Panel title="Live map" className={`map-card${compact ? " compact" : ""}`}
      status={fix ? <span className="chip chip-live">Live</span> : undefined}
      actions={<button type="button" className="btn btn-small" onClick={locate} disabled={status.kind === "waiting"}><Icon name="pin" size={14} />{fix ? "Update location" : "Enable location"}</button>}>
      <div className="map-frame" aria-label="Map">
        {fix ? (
          <>
            <div className="map-grid" style={shift}>{tiles.map((t) => <img key={t.key} alt="" src={t.src} style={{ left: t.left, top: t.top }} />)}</div>
            <span className="map-pin" aria-hidden="true" />
          </>
        ) : <p className="empty map-empty">{status.text}</p>}
      </div>
      <p className="note" role="status">{fix ? status.text : ""}{fix ? " · " : ""}Proxima requests location only when you enable it. Map tiles tell OpenStreetMap which area you view. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
    </Panel>
  );
}
