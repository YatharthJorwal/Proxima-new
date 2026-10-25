import * as THREE from "three";

export type ShapeKind = "box" | "sphere" | "cylinder" | "cone" | "torus";

export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: "box", label: "Box" },
  { kind: "sphere", label: "Sphere" },
  { kind: "cylinder", label: "Cylinder" },
  { kind: "cone", label: "Cone" },
  { kind: "torus", label: "Torus" },
];

export const MIN_SIZE = 0.05;
export const MAX_SIZE = 1000;
export const MAX_COORD = 100;
export const DEFAULT_SNAP = 0.25;
export const DEFAULT_SIZE = 1;

export interface Vec3 { x: number; y: number; z: number }
export interface GroundPoint { x: number; z: number }
export interface PrimitivePlan { dimensions: Vec3; position: Vec3 }

/**
 * Unit shapes: every shape's bounding box is 1 × 1 × 1 (the torus is 1 × 0.3 × 1,
 * lying flat) so `mesh.scale` is exactly the bounding-box size. That is also
 * what the dimension fields and the local-model edit prompt expect.
 */
export function baseGeometry(kind: ShapeKind): THREE.BufferGeometry {
  switch (kind) {
    case "box": return new THREE.BoxGeometry(1, 1, 1);
    case "sphere": return new THREE.SphereGeometry(0.5, 32, 20);
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case "cone": return new THREE.CylinderGeometry(0, 0.5, 1, 32);
    case "torus": {
      const g = new THREE.TorusGeometry(0.35, 0.15, 16, 40);
      g.rotateX(Math.PI / 2); // lie flat on the ground plane
      return g;
    }
  }
}

export function snapValue(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

export const needsHeight = (kind: ShapeKind): boolean => kind === "box" || kind === "cylinder" || kind === "cone";

const clampSize = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v));
const clampCoord = (v: number) => Math.min(MAX_COORD, Math.max(-MAX_COORD, v));

/**
 * Turns a ground-plane drag into a shape. The anchor is where the mouse went
 * down, `current` is where it is now, `height` is the (optional) second stage.
 * Boxes span corner to corner; round shapes grow from their centre.
 * Everything sits on the ground (y = 0). Values snap to `snap` when > 0.
 */
export function planFromDrag(kind: ShapeKind, anchor: GroundPoint, current: GroundPoint, height: number, snap: number): PrimitivePlan {
  const s = (v: number) => clampSize(snapValue(v, snap) || (snap > 0 ? snap : v));
  const ax = clampCoord(anchor.x), az = clampCoord(anchor.z);
  const bx = clampCoord(current.x), bz = clampCoord(current.z);

  if (kind === "box") {
    const w = s(Math.abs(bx - ax)), d = s(Math.abs(bz - az)), h = s(height);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    return { dimensions: { x: w, y: h, z: d }, position: { x: snapValue(cx, snap / 2), y: h / 2, z: snapValue(cz, snap / 2) } };
  }
  const r = Math.hypot(bx - ax, bz - az);
  if (kind === "cylinder" || kind === "cone") {
    const dia = s(r * 2), h = s(height);
    return { dimensions: { x: dia, y: h, z: dia }, position: { x: ax, y: h / 2, z: az } };
  }
  if (kind === "sphere") {
    const dia = s(r * 2);
    return { dimensions: { x: dia, y: dia, z: dia }, position: { x: ax, y: dia / 2, z: az } };
  }
  const dia = s(r * 2);
  const thick = dia * 0.3;
  return { dimensions: { x: dia, y: thick, z: dia }, position: { x: ax, y: thick / 2, z: az } };
}

/** One click without dragging drops a default-sized shape at that spot. */
export function defaultPlan(kind: ShapeKind, at: GroundPoint, snap: number): PrimitivePlan {
  const size = DEFAULT_SIZE;
  const p = { x: snapValue(clampCoord(at.x), snap), z: snapValue(clampCoord(at.z), snap) };
  if (kind === "torus") return { dimensions: { x: size, y: size * 0.3, z: size }, position: { x: p.x, y: size * 0.15, z: p.z } };
  return { dimensions: { x: size, y: size, z: size }, position: { x: p.x, y: size / 2, z: p.z } };
}

export function describePlan(kind: ShapeKind, plan: PrimitivePlan, stage: "footprint" | "height"): string {
  const f = (v: number) => v.toFixed(2);
  const { x, y, z } = plan.dimensions;
  if (kind === "box") return stage === "height" ? `${f(x)} × ${f(z)} × ${f(y)}` : `${f(x)} × ${f(z)}`;
  if (kind === "cylinder" || kind === "cone") return stage === "height" ? `Ø ${f(x)} × ${f(y)} tall` : `Ø ${f(x)}`;
  return `Ø ${f(x)}`;
}
