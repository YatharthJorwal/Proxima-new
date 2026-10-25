import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { MapView, MAX_ZOOM, MIN_ZOOM, panBy, toScreen, visibleTiles, zoomAt } from "../map/tiles";
import { Icon } from "./icons";
import { Panel } from "./Panel";

const WORLD: MapView = { lat: 20, lon: 10, zoom: 2 };
const LOCATED_ZOOM = 15;

interface Fix { lat: number; lon: number }

/** The draggable, zoomable tile map. Tiles are only requested once this component is mounted. */
function MapView_({ view, onView, marker }: { view: MapView; onView: (v: MapView) => void; marker: Fix | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Non-passive, so the wheel zooms the map instead of scrolling the page.
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 60) return;
      const rect = el.getBoundingClientRect();
      onView(zoomAt(viewRef.current, el.clientWidth, el.clientHeight, e.clientX - rect.left, e.clientY - rect.top, acc < 0 ? 1 : -1));
      acc = 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, [onView]);

  const down = (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY; d.moved = true;
    onView(panBy(viewRef.current, dx, dy));
  };
  const up = () => { drag.current = null; };
  const zoomBy = (dz: number, px = size.w / 2, py = size.h / 2) => onView(zoomAt(view, size.w, size.h, px, py, dz));
  const dbl = (e: ReactPointerEvent | React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoomBy(1, e.clientX - rect.left, e.clientY - rect.top);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = 80;
    if (e.key === "ArrowLeft") onView(panBy(view, step, 0));
    else if (e.key === "ArrowRight") onView(panBy(view, -step, 0));
    else if (e.key === "ArrowUp") onView(panBy(view, 0, step));
    else if (e.key === "ArrowDown") onView(panBy(view, 0, -step));
    else if (e.key === "+" || e.key === "=") zoomBy(1);
    else if (e.key === "-") zoomBy(-1);
    else return;
    e.preventDefault();
  };

  const tiles = size.w ? visibleTiles(view, size.w, size.h) : [];
  const pin = marker && size.w ? toScreen(view, size.w, size.h, marker.lat, marker.lon) : null;
  return (
    <div className="map-interactive" ref={ref} tabIndex={0} role="application" aria-label="Map. Drag to pan, scroll to zoom, arrow keys and plus or minus also work."
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl} onKeyDown={key}>
      <div className="map-tiles">{tiles.map((t) => <img key={t.key} alt="" draggable={false} src={t.src} style={{ left: t.left, top: t.top }} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />)}</div>
      {pin && <span className="map-pin" style={{ left: pin.x, top: pin.y }} aria-hidden="true" />}
      <div className="map-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM} onClick={() => zoomBy(1)}>+</button>
        <button type="button" aria-label="Zoom out" disabled={view.zoom <= MIN_ZOOM} onClick={() => zoomBy(-1)}>−</button>
        {marker && <button type="button" aria-label="Centre on my location" title="Centre on my location" onClick={() => onView({ ...marker, zoom: Math.max(view.zoom, LOCATED_ZOOM - 2) })}><Icon name="pin" size={15} /></button>}
      </div>
    </div>
  );
}

/**
 * Location is requested only after a click, and no map tiles are fetched
 * until the person opens the map. Tiles tell OpenStreetMap which area is on
 * screen, which the note says plainly.
 */
export function MapCard({ compact = false }: { compact?: boolean }) {
  const [view, setView] = useState<MapView | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState("");
  const [waiting, setWaiting] = useState(false);

  const onView = useCallback((v: MapView) => setView(v), []);

  const locate = () => {
    if (!navigator.geolocation) { setStatus("Location is unavailable in this runtime."); return; }
    setWaiting(true);
    setStatus("Waiting for location permission…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setWaiting(false); setFix({ lat: coords.latitude, lon: coords.longitude }); setView({ lat: coords.latitude, lon: coords.longitude, zoom: LOCATED_ZOOM }); setStatus(`Centred near ${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`); },
      (err) => { setWaiting(false); setStatus(err.code === err.PERMISSION_DENIED ? "Location permission denied. You can still browse the map." : "Could not get the current location."); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <Panel title="Live map" className={`map-card${compact ? " compact" : ""}`}
      status={fix ? <span className="chip chip-live">Live</span> : undefined}
      actions={
        <>
          {!view && <button type="button" className="btn btn-small" onClick={() => setView(WORLD)}>Browse map</button>}
          <button type="button" className="btn btn-small" onClick={locate} disabled={waiting}><Icon name="pin" size={14} />{fix ? "Update location" : "Enable location"}</button>
        </>}>
      <div className="map-frame">
        {view ? <MapView_ view={view} onView={onView} marker={fix} /> : <p className="empty map-empty">The map is off until you open it.</p>}
      </div>
      {!compact && (
        <p className="note" role="status">{status ? `${status} · ` : ""}Drag to pan, scroll or double-click to zoom. Proxima asks for your location only when you click. Map tiles tell OpenStreetMap which area you are viewing. © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></p>
      )}
    </Panel>
  );
}
