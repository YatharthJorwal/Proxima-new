/** Web-Mercator "slippy map" maths: pure functions, so pan/zoom behaviour is unit tested. */

export const TILE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 18;
const MAX_LAT = 85.0511;

export interface MapView { lat: number; lon: number; zoom: number }
export interface TileSpec { key: string; src: string; left: number; top: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const worldSize = (zoom: number) => TILE * 2 ** zoom;

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** lat/lon to world pixel coordinates at a zoom level. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = worldSize(zoom);
  const sin = Math.sin((clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * size, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size };
}

export function unproject(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const size = worldSize(zoom);
  const n = Math.PI - (2 * Math.PI * clamp(y, 0, size)) / size;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: wrapLon((x / size) * 360 - 180) };
}

export function panBy(view: MapView, dx: number, dy: number): MapView {
  const c = project(view.lat, view.lon, view.zoom);
  const next = unproject(c.x - dx, c.y - dy, view.zoom);
  return { ...view, lat: clamp(next.lat, -MAX_LAT, MAX_LAT), lon: next.lon };
}

/** Change zoom by `dz` keeping the point under (px, py) fixed on screen. */
export function zoomAt(view: MapView, width: number, height: number, px: number, py: number, dz: number): MapView {
  const zoom = clamp(Math.round(view.zoom + dz), MIN_ZOOM, MAX_ZOOM);
  if (zoom === view.zoom) return view;
  const c = project(view.lat, view.lon, view.zoom);
  const anchor = unproject(c.x + (px - width / 2), c.y + (py - height / 2), view.zoom);
  const a = project(anchor.lat, anchor.lon, zoom);
  const center = unproject(a.x - (px - width / 2), a.y - (py - height / 2), zoom);
  return { lat: clamp(center.lat, -MAX_LAT, MAX_LAT), lon: center.lon, zoom };
}

/** Tiles covering a width × height viewport centred on the view, with their on-screen pixel positions. */
export function visibleTiles(view: MapView, width: number, height: number): TileSpec[] {
  const c = project(view.lat, view.lon, view.zoom);
  const n = 2 ** view.zoom;
  const left = c.x - width / 2, top = c.y - height / 2;
  const x0 = Math.floor(left / TILE), x1 = Math.floor((left + width) / TILE);
  const y0 = Math.max(0, Math.floor(top / TILE)), y1 = Math.min(n - 1, Math.floor((top + height) / TILE));
  const out: TileSpec[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wrapped = ((tx % n) + n) % n;
      out.push({ key: `${view.zoom}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${view.zoom}/${wrapped}/${ty}.png`, left: Math.round(tx * TILE - left), top: Math.round(ty * TILE - top) });
    }
  }
  return out;
}

/** Where a lat/lon lands on screen for this view (for the location marker). */
export function toScreen(view: MapView, width: number, height: number, lat: number, lon: number): { x: number; y: number } {
  const c = project(view.lat, view.lon, view.zoom);
  const p = project(lat, lon, view.zoom);
  const size = worldSize(view.zoom);
  let dx = p.x - c.x;
  if (dx > size / 2) dx -= size; else if (dx < -size / 2) dx += size; // nearest copy of the world
  return { x: width / 2 + dx, y: height / 2 + (p.y - c.y) };
}
