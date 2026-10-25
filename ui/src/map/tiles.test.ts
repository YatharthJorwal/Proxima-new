import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, MapView, panBy, project, toScreen, unproject, visibleTiles, wrapLon, zoomAt } from "./tiles";

const delhi: MapView = { lat: 28.6139, lon: 77.209, zoom: 12 };

describe("slippy map maths", () => {
  it("project and unproject are inverses", () => {
    const p = project(delhi.lat, delhi.lon, 14);
    const back = unproject(p.x, p.y, 14);
    expect(back.lat).toBeCloseTo(delhi.lat, 6);
    expect(back.lon).toBeCloseTo(delhi.lon, 6);
  });

  it("puts (0,0) at the middle of the world", () => {
    const p = project(0, 0, 2);
    expect(p).toEqual({ x: 512, y: 512 });
  });

  it("wraps longitude", () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-190)).toBeCloseTo(170);
    expect(wrapLon(180)).toBeCloseTo(-180);
  });

  it("dragging right moves the map right, i.e. the centre moves west", () => {
    const moved = panBy(delhi, 200, 0);
    expect(moved.lon).toBeLessThan(delhi.lon);
    expect(moved.lat).toBeCloseTo(delhi.lat, 6);
    const down = panBy(delhi, 0, 200);
    expect(down.lat).toBeGreaterThan(delhi.lat); // dragging down shows the area to the north
  });

  it("zooming keeps the point under the cursor fixed", () => {
    const w = 800, h = 500, px = 600, py = 120;
    const before = unproject(project(delhi.lat, delhi.lon, delhi.zoom).x + (px - w / 2), project(delhi.lat, delhi.lon, delhi.zoom).y + (py - h / 2), delhi.zoom);
    const z = zoomAt(delhi, w, h, px, py, 2);
    expect(z.zoom).toBe(14);
    const c = project(z.lat, z.lon, z.zoom);
    const after = unproject(c.x + (px - w / 2), c.y + (py - h / 2), z.zoom);
    expect(after.lat).toBeCloseTo(before.lat, 5);
    expect(after.lon).toBeCloseTo(before.lon, 5);
  });

  it("clamps zoom", () => {
    expect(zoomAt({ ...delhi, zoom: MAX_ZOOM }, 800, 500, 400, 250, 1)).toEqual({ ...delhi, zoom: MAX_ZOOM });
    expect(zoomAt({ ...delhi, zoom: MIN_ZOOM }, 800, 500, 400, 250, -1).zoom).toBe(MIN_ZOOM);
  });

  it("returns tiles that cover the viewport, positioned in pixels", () => {
    const tiles = visibleTiles(delhi, 800, 500);
    expect(tiles.length).toBeGreaterThanOrEqual(8); // at least ceil(800/256) x ceil(500/256)
    expect(tiles.length).toBeLessThanOrEqual(24);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left))).toBeGreaterThanOrEqual(800 - 256);
    expect(tiles.every((t) => /^https:\/\/tile\.openstreetmap\.org\/12\/\d+\/\d+\.png$/.test(t.src))).toBe(true);
  });

  it("wraps tile columns across the date line and skips rows past the poles", () => {
    const tiles = visibleTiles({ lat: 0, lon: 179.9, zoom: 3 }, 1000, 400);
    const xs = tiles.map((t) => Number(t.src.split("/")[4]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(7);
    expect(xs).toContain(0); // wrapped round to the other side
    const polar = visibleTiles({ lat: 85, lon: 0, zoom: 2 }, 800, 1200);
    expect(polar.every((t) => Number(t.src.split("/")[5].replace(".png", "")) >= 0)).toBe(true);
  });

  it("places a marker at the centre when it is the centre", () => {
    const s = toScreen(delhi, 800, 500, delhi.lat, delhi.lon);
    expect(s.x).toBeCloseTo(400, 3);
    expect(s.y).toBeCloseTo(250, 3);
  });
});
