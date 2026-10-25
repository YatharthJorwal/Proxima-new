import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CameraRig } from "./rig";
import { baseGeometry, defaultPlan, MIN_SIZE, needsHeight, planFromDrag, snapValue } from "./primitives";
import { analyzeMesh, exportAsciiStl, formatReport, triangleCount } from "./analysis";
import { isPinch, PinchTrigger, pinchRatio, Landmark } from "../vision/pinch";
import { coverMapper } from "../vision/mapper";

const rig = () => new CameraRig(new THREE.PerspectiveCamera(45, 1.5, 0.1, 1000));

describe("camera rig", () => {
  it("keeps its distance from the target while orbiting and clamps pitch", () => {
    const r = rig();
    const d = r.camera.position.distanceTo(r.target);
    r.orbit(120, -9999);
    expect(r.camera.position.distanceTo(r.target)).toBeCloseTo(d, 5);
    expect(r.pitch).toBeGreaterThanOrEqual(-CameraRig.MAX_PITCH);
    r.orbit(0, 99999);
    expect(r.pitch).toBeLessThanOrEqual(CameraRig.MAX_PITCH);
  });

  it("pans in the view plane without changing distance or heading", () => {
    const r = rig();
    const before = r.camera.quaternion.clone();
    const d = r.distance;
    r.pan(100, 0, 800);
    expect(r.distance).toBe(d);
    expect(r.camera.quaternion.angleTo(before)).toBeLessThan(1e-6);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(r.camera.quaternion);
    const moved = r.target.clone().sub(new THREE.Vector3(0, 0.5, 0));
    expect(moved.dot(right)).toBeLessThan(0); // dragging right moves the scene right = target left
    expect(Math.abs(moved.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(r.camera.quaternion)))).toBeLessThan(1e-6);
  });

  it("clamps zoom", () => {
    const r = rig();
    r.zoom(1e-9);
    expect(r.distance).toBe(CameraRig.MIN_DISTANCE);
    r.zoom(1e9);
    expect(r.distance).toBe(CameraRig.MAX_DISTANCE);
  });

  it("frames a box and falls back to the default view for nothing", () => {
    const r = rig();
    r.frame(new THREE.Box3(new THREE.Vector3(10, 0, 10), new THREE.Vector3(12, 2, 12)));
    expect(r.target.x).toBeCloseTo(11);
    expect(r.distance).toBeGreaterThan(2);
    r.frame(null);
    expect(r.target.toArray()).toEqual([0, 0.5, 0]);
  });

  it("re-derives yaw/pitch/distance from an externally moved camera", () => {
    const r = rig();
    r.camera.position.set(0, 8, 0.0001);
    r.syncFromCamera();
    expect(r.pitch).toBeGreaterThan(1.4);
    expect(r.distance).toBeCloseTo(7.5, 1);
  });
});

describe("drawing shapes with the mouse", () => {
  it("sizes a box corner to corner and sits it on the ground", () => {
    const p = planFromDrag("box", { x: 0, z: 0 }, { x: 4, z: 2 }, 3, 0);
    expect(p.dimensions).toEqual({ x: 4, y: 3, z: 2 });
    expect(p.position).toEqual({ x: 2, y: 1.5, z: 1 });
  });

  it("works when dragging up and to the left", () => {
    const p = planFromDrag("box", { x: 4, z: 2 }, { x: 0, z: 0 }, 1, 0);
    expect(p.dimensions.x).toBe(4);
    expect(p.position.x).toBe(2);
  });

  it("grows round shapes from their centre by radius", () => {
    const c = planFromDrag("cylinder", { x: 1, z: 1 }, { x: 4, z: 1 }, 2, 0);
    expect(c.dimensions).toEqual({ x: 6, y: 2, z: 6 });
    expect(c.position).toEqual({ x: 1, y: 1, z: 1 });
    const s = planFromDrag("sphere", { x: 0, z: 0 }, { x: 0, z: 1.5 }, 0, 0);
    expect(s.dimensions).toEqual({ x: 3, y: 3, z: 3 });
    expect(s.position.y).toBe(1.5);
  });

  it("snaps to the grid and never makes a zero-size shape", () => {
    expect(snapValue(1.12, 0.25)).toBe(1);
    const p = planFromDrag("box", { x: 0, z: 0 }, { x: 0.001, z: 0.001 }, 0.001, 0.25);
    expect(p.dimensions.x).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(p.dimensions.y).toBeGreaterThanOrEqual(MIN_SIZE);
    const raw = planFromDrag("box", { x: 0, z: 0 }, { x: 0.001, z: 0.001 }, 0.001, 0);
    expect(raw.dimensions.x).toBe(MIN_SIZE);
  });

  it("clamps absurd sizes and positions", () => {
    const p = planFromDrag("box", { x: -9999, z: 0 }, { x: 9999, z: 0 }, 1, 0);
    expect(p.dimensions.x).toBeLessThanOrEqual(1000);
    expect(Math.abs(p.position.x)).toBeLessThanOrEqual(100);
  });

  it("a plain click drops a default 1-unit shape", () => {
    const p = defaultPlan("box", { x: 3.1, z: -2.4 }, 0.25);
    expect(p.dimensions).toEqual({ x: 1, y: 1, z: 1 });
    expect(p.position).toEqual({ x: 3, y: 0.5, z: -2.5 });
  });

  it("only extruded shapes need the height stage", () => {
    expect(["box", "cylinder", "cone"].every((k) => needsHeight(k as never))).toBe(true);
    expect(needsHeight("sphere")).toBe(false);
    expect(needsHeight("torus")).toBe(false);
  });

  it("every base shape has a unit bounding box (torus is flat)", () => {
    for (const kind of ["box", "sphere", "cylinder", "cone"] as const) {
      const g = baseGeometry(kind);
      g.computeBoundingBox();
      const s = g.boundingBox!.getSize(new THREE.Vector3());
      expect([s.x, s.y, s.z].map((v) => +v.toFixed(2))).toEqual([1, 1, 1]);
    }
    const t = baseGeometry("torus");
    t.computeBoundingBox();
    const ts = t.boundingBox!.getSize(new THREE.Vector3());
    expect(+ts.x.toFixed(2)).toBe(1);
    expect(+ts.y.toFixed(2)).toBe(0.3);
  });
});

describe("mesh analysis and STL export", () => {
  const box = () => new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshBasicMaterial());

  it("reports a closed box with the right volume", () => {
    const r = analyzeMesh(box());
    expect(r.triangles).toBe(12);
    expect(r.volume).toBeCloseTo(24, 5);
    expect(r.topology?.closed).toBe(true);
    expect(r.topology?.components).toBe(1);
    expect(r.size.y).toBeCloseTo(3);
    expect(formatReport(r)).toContain("no boundary or non-manifold edges");
  });

  it("detects an open mesh", () => {
    const g = new THREE.PlaneGeometry(1, 1);
    const r = analyzeMesh(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    expect(r.topology?.closed).toBe(false);
    expect(r.topology?.boundaryEdges).toBeGreaterThan(0);
  });

  it("exports one facet per triangle and converts units to millimetres", () => {
    const m = box();
    expect(triangleCount(m)).toBe(12);
    const mm = exportAsciiStl([m], "mm");
    expect(mm.facets).toBe(12);
    expect(mm.text.startsWith("solid proxima")).toBe(true);
    const cm = exportAsciiStl([m], "cm");
    const maxX = (t: string) => Math.max(...[...t.matchAll(/vertex (-?[\d.e+-]+)/g)].map((x) => Number(x[1])));
    expect(maxX(cm.text)).toBeCloseTo(maxX(mm.text) * 10, 3);
  });

  it("bakes the object's transform into the export", () => {
    const m = box();
    m.position.set(10, 0, 0);
    const out = exportAsciiStl([m], "mm");
    const xs = [...out.text.matchAll(/vertex (-?[\d.e+-]+)/g)].map((x) => Number(x[1]));
    expect(Math.min(...xs)).toBeCloseTo(9);
  });
});

describe("pinch trigger", () => {
  const hand = (pinchGap: number): Landmark[] => {
    const h: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    h[0] = { x: 0, y: 0, z: 0 };
    h[9] = { x: 0, y: -1, z: 0 }; // palm size 1
    h[4] = { x: 0, y: 0, z: 0 };
    h[8] = { x: pinchGap, y: 0, z: 0 };
    return h;
  };

  it("measures the thumb-index gap relative to the palm", () => {
    expect(pinchRatio(hand(0.1))).toBeCloseTo(0.1);
    expect(isPinch(hand(0.1))).toBe(true);
    expect(isPinch(hand(0.6))).toBe(false);
    expect(pinchRatio([])).toBeNull();
  });

  it("fires once per pinch, needs the fingers to open, and honours the cooldown", () => {
    const t = new PinchTrigger();
    expect(t.update(true, 0)).toBe(true);
    expect(t.update(true, 100)).toBe(false); // held
    expect(t.update(false, 200)).toBe(false); // opened → re-armed
    expect(t.update(true, 300)).toBe(false); // inside cooldown
    expect(t.update(false, 400)).toBe(false);
    expect(t.update(true, 1500)).toBe(true);
  });
});

describe("object-fit: cover landmark mapping", () => {
  it("maps the centre to the centre and corrects for the crop", () => {
    const map = coverMapper({ w: 1280, h: 720 }, { w: 400, h: 400 })!;
    expect(map(0.5, 0.5)).toEqual([200, 200]);
    const [x] = map(0, 0.5);
    expect(x).toBeLessThan(0); // left edge of the frame is cropped out of view
  });
  it("returns null until sizes are known", () => {
    expect(coverMapper({ w: 0, h: 0 }, { w: 10, h: 10 })).toBeNull();
  });
});
