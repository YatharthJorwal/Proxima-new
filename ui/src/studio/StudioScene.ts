import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ADDITION, SUBTRACTION, Brush, Evaluator } from "three-bvh-csg";
import { CameraRig } from "./rig";
import {
  baseGeometry, defaultPlan, DEFAULT_SNAP, describePlan, GroundPoint, MAX_COORD, MAX_SIZE, MIN_SIZE, needsHeight,
  planFromDrag, PrimitivePlan, ShapeKind, Vec3,
} from "./primitives";
import { analyzeMesh, exportAsciiStl, formatReport, MAX_BOOLEAN_TRIANGLES, StlUnit, triangleCount } from "./analysis";
import { RefTable, validatePlan, type SceneObjectSummary, type StudioOp } from "../../../src/core/modelOps";

export type GizmoMode = "translate" | "rotate" | "scale";
export type Axis = 0 | 1 | 2;
export type NavMode = "orbit" | "pan" | "zoom";

export interface SelectionInfo {
  kind: string;
  position: Vec3;
  rotation: Vec3; // degrees
  dimensions: Vec3;
  scale: Vec3;
  cornerRadius: number | null;
  isBox: boolean;
}

export interface StudioSnapshot {
  selection: SelectionInfo | null;
  hasSecondary: boolean;
  objectCount: number;
  tool: ShapeKind | null;
  stage: "idle" | "footprint" | "height";
  gizmo: GizmoMode;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  /** Oldest first: what Undo would step back through. */
  history: string[];
  objects: { index: number; kind: string; selected: boolean; secondary: boolean }[];
  busy: boolean;
  status: string;
}

interface SnapMesh { geometry: THREE.BufferGeometry; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; userData: Record<string, unknown> }
/** Geometries are shared with the live scene (never mutated in place), so a snapshot is cheap. */
interface Snapshot { label: string; meshes: SnapMesh[]; selected: number; secondary: number }
const HISTORY_LIMIT = 40;

export interface Draft { text: string; x: number; y: number }
export interface StudioHooks {
  onChange: (snapshot: StudioSnapshot) => void;
  onDraft: (draft: Draft | null) => void;
}

const TEAL = 0x42c8bd;
const SELECT_GLOW = 0x164d56;
const SECOND_GLOW = 0x6b4b1c;
const CLICK_SLOP = 4; // px of movement that still counts as a click
const KIND_NAMES: Record<string, string> = { box: "box", sphere: "sphere", cylinder: "cylinder", cone: "cone", torus: "torus" };

const material = () => new THREE.MeshStandardMaterial({ color: TEAL, metalness: 0.12, roughness: 0.5 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (...v: number[]) => v.every(Number.isFinite);

interface DrawState {
  kind: ShapeKind;
  stage: "footprint" | "height";
  anchor: GroundPoint;
  current: GroundPoint;
  height: number;
  startY: number;
  downX: number;
  downY: number;
  ghost: THREE.Mesh;
}

interface NavState { mode: "orbit" | "pan"; x: number; y: number; moved: number; deselectOnClick: boolean }

/**
 * The 3D Studio engine. One instance lives for the whole session (so the model
 * survives switching pages); the canvas is attached to / detached from the page
 * that shows it, and the render loop only runs while attached.
 *
 * Navigation follows Blender: middle-drag orbits, Shift+middle (or right-drag)
 * pans, the wheel zooms, Alt+left-drag orbits for trackpads, and the view gizmo
 * top-right snaps to an axis. Left-drag on empty space also orbits, and a click
 * on empty space deselects.
 */
export class StudioScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  private readonly rig: CameraRig;
  private readonly gizmo: TransformControls;
  private readonly viewHelper: ViewHelper;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly cursor: THREE.Mesh;

  private meshes: THREE.Mesh[] = [];
  private selected: THREE.Mesh | null = null;
  private secondary: THREE.Mesh | null = null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private geometries = new Set<THREE.BufferGeometry>();
  private lastCheckpointKey = "";
  private lastCheckpointAt = 0;
  private tool: ShapeKind | null = null;
  private snapOn = true;
  private gizmoMode: GizmoMode = "translate";
  private status = "Pick a shape on the left, then drag on the grid to size it.";
  private busy = false;
  private draw: DrawState | null = null;
  private nav: NavState | null = null;
  private spawned = 0;

  private host: HTMLElement | null = null;
  private hooks: StudioHooks | null = null;
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private last = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x060e1c, 1);
    this.renderer.autoClear = false;
    this.renderer.domElement.className = "studio-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "3D model workspace");

    this.rig = new CameraRig(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x18202d, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(5, 8, 6);
    this.scene.add(sun);
    const grid = new THREE.GridHelper(40, 40, 0x35507a, 0x1a2c4a);
    this.scene.add(grid);
    const axisLine = (a: THREE.Vector3, b: THREE.Vector3, color: number) => {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
      line.position.y = 0.002;
      this.scene.add(line);
    };
    axisLine(new THREE.Vector3(-20, 0, 0), new THREE.Vector3(20, 0, 0), 0xff4466);
    axisLine(new THREE.Vector3(0, 0, -20), new THREE.Vector3(0, 0, 20), 0x4488ff);

    this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.16, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x62e0ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.cursor.visible = false;
    this.cursor.position.y = 0.004;
    this.scene.add(this.cursor);

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.setMode("translate");
    this.gizmo.addEventListener("objectChange", () => this.onGizmoChange());
    this.gizmo.addEventListener("dragging-changed", (e) => { if ((e as unknown as { value: boolean }).value) this.checkpoint("Transform"); });
    this.applySnapToGizmo();

    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.location = { top: 12, right: 12, bottom: 0, left: null };
    this.viewHelper.setLabels("X", "Y", "Z");

    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    el.addEventListener("pointerleave", () => { if (!this.draw) this.cursor.visible = false; });
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- lifecycle

  attach(host: HTMLElement, hooks: StudioHooks): void {
    this.detach();
    this.host = host;
    this.hooks = hooks;
    host.appendChild(this.renderer.domElement);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    window.addEventListener("keydown", this.onKeyDown);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.emit();
  }

  detach(): void {
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("keydown", this.onKeyDown);
    this.cancelDraw();
    this.hooks?.onDraft(null);
    this.renderer.domElement.remove();
    this.host = null;
    this.hooks = null;
  }

  private resize(): void {
    if (!this.host) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.viewHelper.animating) {
      this.viewHelper.update(dt);
      this.rig.syncFromCamera();
    }
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.viewHelper.render(this.renderer);
  };

  // ------------------------------------------------------------------ state

  snapshot(): StudioSnapshot {
    return {
      selection: this.selected ? this.selectionInfo(this.selected) : null,
      hasSecondary: !!this.secondary,
      objectCount: this.meshes.length,
      tool: this.tool,
      stage: this.draw?.stage ?? "idle",
      gizmo: this.gizmoMode,
      snap: this.snapOn,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack[this.undoStack.length - 1]?.label ?? "",
      redoLabel: this.redoStack[this.redoStack.length - 1]?.label ?? "",
      history: this.undoStack.map((h) => h.label),
      objects: this.meshes.map((m, index) => ({ index, kind: String(m.userData.kind ?? "object"), selected: m === this.selected, secondary: m === this.secondary })),
      busy: this.busy,
      status: this.status,
    };
  }

  private emit(): void { this.hooks?.onChange(this.snapshot()); }

  private say(text: string): void { this.status = text; this.emit(); }

  private selectionInfo(mesh: THREE.Mesh): SelectionInfo {
    mesh.geometry.computeBoundingBox();
    const base = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    const dims = base.clone().multiply(mesh.scale);
    const deg = (r: number) => THREE.MathUtils.radToDeg(r);
    const kind = String(mesh.userData.kind ?? "object");
    return {
      kind,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: deg(mesh.rotation.x), y: deg(mesh.rotation.y), z: deg(mesh.rotation.z) },
      dimensions: { x: dims.x, y: dims.y, z: dims.z },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
      cornerRadius: kind === "rounded box" ? Number(mesh.userData.cornerRadius || 0) : null,
      isBox: kind === "box" || kind === "rounded box",
    };
  }

  private get snapStep(): number { return this.snapOn ? DEFAULT_SNAP : 0; }

  private applySnapToGizmo(): void {
    this.gizmo.setTranslationSnap(this.snapOn ? DEFAULT_SNAP : null);
    this.gizmo.setRotationSnap(this.snapOn ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(this.snapOn ? 0.1 : null);
  }

  // -------------------------------------------------------------- selection

  private select(mesh: THREE.Mesh | null): void {
    if (this.selected) (this.selected.material as THREE.MeshStandardMaterial).emissive.setHex(0);
    this.setSecondary(null);
    this.selected = mesh;
    if (mesh) {
      this.gizmo.attach(mesh);
      (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(SELECT_GLOW);
      this.status = `Selected ${mesh.userData.kind}. Shift-click another object to combine them; press Delete to remove it.`;
    } else {
      this.gizmo.detach();
      this.status = this.meshes.length ? "Nothing selected. Click an object, or pick a shape to draw." : "Pick a shape on the left, then drag on the grid to size it.";
    }
    this.emit();
  }

  private setSecondary(mesh: THREE.Mesh | null): void {
    if (this.secondary) (this.secondary.material as THREE.MeshStandardMaterial).emissive.setHex(0);
    this.secondary = mesh;
    if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(SECOND_GLOW);
  }

  private pickAt(e: PointerEvent | MouseEvent): THREE.Mesh | null {
    this.setRay(e);
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return (hit?.object as THREE.Mesh) ?? null;
  }

  private setRay(e: PointerEvent | MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
  }

  private groundPoint(e: PointerEvent | MouseEvent): GroundPoint | null {
    this.setRay(e);
    const out = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, out)) return null;
    if (out.distanceTo(this.camera.position) > 600) return null;
    return { x: out.x, z: out.z };
  }

  // ------------------------------------------------------------ primitives

  private track<G extends THREE.BufferGeometry>(g: G): G { this.geometries.add(g); return g; }

  /** Create a shape and add it to the scene without changing the selection. */
  private buildPrimitive(kind: ShapeKind, config?: { dimensions?: Vec3; position?: Vec3; rotation?: Vec3 }): THREE.Mesh {
    const geometry = this.track(baseGeometry(kind));
    const mesh = new THREE.Mesh(geometry, material());
    geometry.computeBoundingBox();
    const base = geometry.boundingBox!.getSize(new THREE.Vector3());
    const d = config?.dimensions;
    if (d && finite(d.x, d.y, d.z)) mesh.scale.set(d.x / base.x, d.y / base.y, d.z / base.z);
    const p = config?.position;
    if (p && finite(p.x, p.y, p.z)) mesh.position.set(p.x, p.y, p.z);
    else {
      const n = this.spawned++;
      mesh.position.set(((n % 3) - 1) * 1.5, (base.y * mesh.scale.y) / 2, Math.floor(n / 3) * 1.5);
    }
    const r = config?.rotation;
    if (r && finite(r.x, r.y, r.z)) mesh.rotation.set(THREE.MathUtils.degToRad(r.x), THREE.MathUtils.degToRad(r.y), THREE.MathUtils.degToRad(r.z));
    mesh.userData.kind = KIND_NAMES[kind] ?? kind;
    this.meshes.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  addPrimitive(kind: ShapeKind, config?: { dimensions?: Vec3; position?: Vec3; rotation?: Vec3 }): THREE.Mesh {
    const mesh = this.buildPrimitive(kind, config);
    this.select(mesh);
    return mesh;
  }

  /** Drop a default-size shape (the "no mouse" path). */
  addDefault(kind: ShapeKind): void {
    this.setTool(null);
    this.checkpoint(`Add ${kind}`);
    this.addPrimitive(kind);
    this.say(`Added a ${kind}. Edit its size on the right, or drag the gizmo.`);
  }

  setTool(kind: ShapeKind | null): void {
    this.cancelDraw();
    this.tool = kind;
    this.cursor.visible = false;
    this.renderer.domElement.style.cursor = kind ? "crosshair" : "";
    if (kind) {
      this.gizmo.detach();
      this.status = needsHeight(kind)
        ? `Drawing a ${kind}: drag on the grid to size its base, release, then move up or down and click to set the height. Esc cancels.`
        : `Drawing a ${kind}: drag outward from its centre to set the size. Esc cancels.`;
    } else if (this.selected) {
      this.gizmo.attach(this.selected);
    }
    this.emit();
  }

  private makeGhost(kind: ShapeKind): THREE.Mesh {
    const geometry = baseGeometry(kind);
    const ghost = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x62e0ff, transparent: true, opacity: 0.3, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0xbff3ff }));
    ghost.add(edges);
    this.scene.add(ghost);
    return ghost;
  }

  private currentPlan(d: DrawState): PrimitivePlan {
    const height = d.stage === "footprint" ? MIN_SIZE : d.height;
    return planFromDrag(d.kind, d.anchor, d.current, height, this.snapStep);
  }

  private updateGhost(e: PointerEvent | null): void {
    const d = this.draw;
    if (!d) return;
    const plan = this.currentPlan(d);
    d.ghost.scale.set(plan.dimensions.x, plan.dimensions.y, plan.dimensions.z);
    d.ghost.position.set(plan.position.x, plan.position.y, plan.position.z);
    if (e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.hooks?.onDraft({ text: describePlan(d.kind, plan, d.stage), x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }

  private cancelDraw(): void {
    if (!this.draw) return;
    this.scene.remove(this.draw.ghost);
    this.draw.ghost.geometry.dispose();
    (this.draw.ghost.material as THREE.Material).dispose();
    this.draw = null;
    this.hooks?.onDraft(null);
  }

  private commitDraw(plan?: PrimitivePlan): void {
    const d = this.draw;
    if (!d) return;
    const final = plan ?? this.currentPlan(d);
    const kind = d.kind;
    this.cancelDraw();
    this.tool = null;
    this.renderer.domElement.style.cursor = "";
    this.cursor.visible = false;
    this.checkpoint(`Draw ${kind}`);
    this.addPrimitive(kind, final);
    const s = final.dimensions;
    this.say(`Added a ${kind} (${s.x.toFixed(2)} × ${s.y.toFixed(2)} × ${s.z.toFixed(2)}). Fine-tune it on the right, or pick a shape to draw another.`);
  }

  // ---------------------------------------------------------------- pointer

  private onPointerDown = (e: PointerEvent): void => {
    this.renderer.domElement.focus({ preventScroll: true });
    if (e.button === 0) {
      this.viewHelper.center.copy(this.rig.target);
      if (this.viewHelper.handleClick(e)) return;
    }
    if (this.gizmo.dragging || (this.gizmo.axis && !this.tool)) return;

    const wantsNav = e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey);
    if (wantsNav) {
      e.preventDefault();
      this.startNav(e, e.button === 2 || e.shiftKey ? "pan" : "orbit", false);
      return;
    }
    if (e.button !== 0) return;

    if (this.tool) {
      if (this.draw?.stage === "height") { this.commitDraw(); return; }
      const g = this.groundPoint(e);
      if (!g) return;
      this.draw = { kind: this.tool, stage: "footprint", anchor: g, current: g, height: MIN_SIZE, startY: e.clientY, downX: e.clientX, downY: e.clientY, ghost: this.makeGhost(this.tool) };
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.updateGhost(e);
      this.emit();
      return;
    }

    const hit = this.pickAt(e);
    if (hit && e.shiftKey && this.selected && hit !== this.selected) {
      this.setSecondary(hit);
      this.say("Two objects selected. Choose Union or Subtract second.");
      return;
    }
    if (hit) { this.select(hit); return; }
    this.startNav(e, "orbit", true);
  };

  private startNav(e: PointerEvent, mode: "orbit" | "pan", deselectOnClick: boolean): void {
    this.nav = { mode, x: e.clientX, y: e.clientY, moved: 0, deselectOnClick };
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.nav) {
      const dx = e.clientX - this.nav.x, dy = e.clientY - this.nav.y;
      this.nav.x = e.clientX; this.nav.y = e.clientY;
      this.nav.moved += Math.abs(dx) + Math.abs(dy);
      this.navigate(this.nav.mode, dx, dy);
      return;
    }
    const d = this.draw;
    if (d) {
      if (d.stage === "footprint") {
        const g = this.groundPoint(e);
        if (g) d.current = g;
      } else {
        d.height = Math.max(0, (d.startY - e.clientY) * this.rig.unitsPerPixel(this.renderer.domElement.clientHeight));
      }
      this.updateGhost(e);
      return;
    }
    if (this.tool) {
      const g = this.groundPoint(e);
      this.cursor.visible = !!g;
      if (g) this.cursor.position.set(this.snapStep ? Math.round(g.x / this.snapStep) * this.snapStep : g.x, 0.004, this.snapStep ? Math.round(g.z / this.snapStep) * this.snapStep : g.z);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (this.nav) {
      if (this.nav.deselectOnClick && this.nav.moved < CLICK_SLOP && this.selected) this.select(null);
      this.nav = null;
      return;
    }
    const d = this.draw;
    if (d && d.stage === "footprint") {
      const moved = Math.hypot(e.clientX - d.downX, e.clientY - d.downY);
      if (moved < CLICK_SLOP) { this.commitDraw(defaultPlan(d.kind, d.anchor, this.snapStep)); return; }
      if (!needsHeight(d.kind)) { this.commitDraw(); return; }
      d.stage = "height";
      d.startY = e.clientY;
      d.height = MIN_SIZE;
      this.status = "Now move up or down to set the height, then click. Esc cancels.";
      this.updateGhost(e);
      this.emit();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  };

  /** Used by the pointer handlers and by the on-screen orbit / pan / zoom handles. */
  navigate(mode: NavMode, dx: number, dy: number): void {
    if (mode === "orbit") this.rig.orbit(dx, dy);
    else if (mode === "pan") this.rig.pan(dx, dy, this.renderer.domElement.clientHeight || 1);
    else this.rig.zoom(Math.exp(dy * 0.01));
    this.viewHelper.center.copy(this.rig.target);
  }

  frameAll(): void {
    const box = new THREE.Box3();
    for (const m of this.meshes) box.expandByObject(m);
    this.rig.frame(this.meshes.length ? box : null);
    this.viewHelper.center.copy(this.rig.target);
  }

  frameSelected(): void {
    if (!this.selected) { this.frameAll(); return; }
    this.rig.frame(new THREE.Box3().setFromObject(this.selected));
    this.viewHelper.center.copy(this.rig.target);
  }

  /** Numpad-style views: 1 front, 3 right, 7 top; with `opposite`, back / left / bottom. */
  snapView(view: "front" | "right" | "top", opposite = false): void {
    const flip = opposite ? 1 : 0;
    if (view === "front") { this.rig.yaw = flip * Math.PI; this.rig.pitch = 0; }
    if (view === "right") { this.rig.yaw = flip ? -Math.PI / 2 : Math.PI / 2; this.rig.pitch = 0; }
    if (view === "top") { this.rig.yaw = this.rig.yaw; this.rig.pitch = opposite ? -CameraRig.MAX_PITCH : CameraRig.MAX_PITCH; }
    this.rig.apply();
    this.viewHelper.center.copy(this.rig.target);
  }

  // --------------------------------------------------------------- keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.key === "Escape") {
      if (this.draw) { this.cancelDraw(); this.say("Cancelled."); } else if (this.tool) this.setTool(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) { e.preventDefault(); this.deleteSelected(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) { this.numpad(e); return; }
    const k = e.key.toLowerCase();
    if (k === "g") this.setGizmoMode("translate");
    else if (k === "r") this.setGizmoMode("rotate");
    else if (k === "s") this.setGizmoMode("scale");
    else if (k === "f" || e.key === "Home") this.frameSelected();
    else this.numpad(e);
  };

  private numpad(e: KeyboardEvent): void {
    const opposite = e.ctrlKey || e.metaKey;
    if (e.code === "Numpad1") this.snapView("front", opposite);
    else if (e.code === "Numpad3") this.snapView("right", opposite);
    else if (e.code === "Numpad7") this.snapView("top", opposite);
    else if (e.code === "NumpadDecimal") this.frameSelected();
  }

  // ------------------------------------------------------------------ edits

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.gizmo.setMode(mode);
    this.say(`${mode === "translate" ? "Move" : mode === "rotate" ? "Rotate" : "Scale"} gizmo active. Drag a coloured handle on the selected object.`);
  }

  toggleSnap(): void {
    this.snapOn = !this.snapOn;
    this.applySnapToGizmo();
    this.say(this.snapOn ? `Snapping on (${DEFAULT_SNAP} units, 15° turns).` : "Snapping off.");
  }

  private onGizmoChange(): void {
    const m = this.selected;
    if (!m) return;
    m.position.set(clamp(m.position.x, -MAX_COORD, MAX_COORD), clamp(m.position.y, -MAX_COORD, MAX_COORD), clamp(m.position.z, -MAX_COORD, MAX_COORD));
    const lim = THREE.MathUtils.degToRad(360);
    m.rotation.set(clamp(m.rotation.x, -lim, lim), clamp(m.rotation.y, -lim, lim), clamp(m.rotation.z, -lim, lim));
    m.geometry.computeBoundingBox();
    const base = m.geometry.boundingBox!.getSize(new THREE.Vector3());
    for (let axis = 0; axis < 3; axis++) {
      const len = base.getComponent(axis);
      if (len > 0) m.scale.setComponent(axis, clamp(Math.abs(m.scale.getComponent(axis)), Math.max(1e-6, 1e-6 / len), Math.min(1e9, MAX_SIZE / len)));
    }
    this.emit();
  }

  setPosition(axis: Axis, value: number): void {
    if (!this.selected) return;
    this.checkpoint("Move", "pos");
    this.selected.position.setComponent(axis, clamp(Number.isFinite(value) ? value : 0, -MAX_COORD, MAX_COORD));
    this.emit();
  }

  setRotation(axis: Axis, degrees: number): void {
    if (!this.selected) return;
    this.checkpoint("Rotate", "rot");
    const d = clamp(Number.isFinite(degrees) ? degrees : 0, -360, 360);
    const key = (["x", "y", "z"] as const)[axis];
    this.selected.rotation[key] = THREE.MathUtils.degToRad(d);
    this.emit();
  }

  setDimension(axis: Axis, value: number): void {
    const m = this.selected;
    if (!m) return;
    if (!Number.isFinite(value) || value <= 0 || value > MAX_SIZE) { this.emit(); return; }
    m.geometry.computeBoundingBox();
    const len = m.geometry.boundingBox!.getSize(new THREE.Vector3()).getComponent(axis);
    if (len <= 0) { this.emit(); return; }
    this.checkpoint("Resize", "dim");
    m.scale.setComponent(axis, value / len);
    this.emit();
  }

  setUniformScale(v: number): void {
    if (!this.selected || !Number.isFinite(v)) return;
    this.checkpoint("Scale", "uni");
    this.selected.scale.setScalar(v);
    this.emit();
  }

  setCornerRadius(radius: number): boolean {
    const m = this.selected;
    if (!m) return false;
    return this.roundCorners(m, radius, true);
  }

  private roundCorners(m: THREE.Mesh, radius: number, record: boolean): boolean {
    if (!["box", "rounded box"].includes(String(m.userData.kind))) return false;
    m.geometry.computeBoundingBox();
    const size = m.geometry.boundingBox!.getSize(new THREE.Vector3());
    const minDim = Math.min(size.x, size.y, size.z);
    if (!Number.isFinite(radius) || radius < 0.005 || radius > minDim * 0.45) {
      this.say("Corner radius must be positive and no more than 45% of the box's shortest side.");
      return false;
    }
    if (record) this.checkpoint("Round corners", "round");
    m.geometry = this.track(new RoundedBoxGeometry(size.x, size.y, size.z, 4, radius));
    m.userData.kind = "rounded box";
    m.userData.cornerRadius = radius;
    if (record) this.say("Corner radius updated. Review the rounded box before export.");
    return true;
  }

  // ------------------------------------------------------- delete / undo / clear

  private removeMesh(m: THREE.Mesh): void {
    this.scene.remove(m);
    const i = this.meshes.indexOf(m);
    if (i >= 0) this.meshes.splice(i, 1);
    (m.material as THREE.Material).dispose(); // the geometry stays: history may still use it
  }

  // ---------------------------------------------------------------- history

  private capture(label: string): Snapshot {
    return {
      label,
      meshes: this.meshes.map((m) => ({ geometry: m.geometry, position: m.position.clone(), quaternion: m.quaternion.clone(), scale: m.scale.clone(), userData: { ...m.userData } })),
      selected: this.selected ? this.meshes.indexOf(this.selected) : -1,
      secondary: this.secondary ? this.meshes.indexOf(this.secondary) : -1,
    };
  }

  /** Save the scene as it is now so the next change can be undone. Same-key edits within a second share one entry. */
  private checkpoint(label: string, coalesceKey = ""): void {
    const now = performance.now();
    if (coalesceKey && coalesceKey === this.lastCheckpointKey && now - this.lastCheckpointAt < 1000) { this.lastCheckpointAt = now; return; }
    this.lastCheckpointKey = coalesceKey;
    this.lastCheckpointAt = now;
    this.undoStack.push(this.capture(label));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.collectGarbage();
  }

  private restore(snap: Snapshot): void {
    this.setSecondary(null);
    this.gizmo.detach();
    this.selected = null;
    for (const m of [...this.meshes]) this.removeMesh(m);
    for (const sm of snap.meshes) {
      const m = new THREE.Mesh(sm.geometry, material());
      m.position.copy(sm.position); m.quaternion.copy(sm.quaternion); m.scale.copy(sm.scale);
      m.userData = { ...sm.userData };
      this.meshes.push(m);
      this.scene.add(m);
    }
    const sel = this.meshes[snap.selected] ?? null;
    if (sel) { this.selected = sel; this.gizmo.attach(sel); (sel.material as THREE.MeshStandardMaterial).emissive.setHex(SELECT_GLOW); }
    this.setSecondary(this.meshes[snap.secondary] ?? null);
  }

  /** Free the GPU buffers of geometries that no live object or history entry uses any more. */
  private collectGarbage(): void {
    const used = new Set<THREE.BufferGeometry>(this.meshes.map((m) => m.geometry));
    for (const h of [...this.undoStack, ...this.redoStack]) for (const m of h.meshes) used.add(m.geometry);
    for (const g of [...this.geometries]) if (!used.has(g)) { g.dispose(); this.geometries.delete(g); }
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) { this.say("Nothing to undo."); return; }
    this.redoStack.push(this.capture(snap.label));
    this.restore(snap);
    this.lastCheckpointKey = "";
    this.say(`Undid: ${snap.label}.`);
  }

  redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) { this.say("Nothing to redo."); return; }
    this.undoStack.push(this.capture(snap.label));
    this.restore(snap);
    this.lastCheckpointKey = "";
    this.say(`Redid: ${snap.label}.`);
  }

  /** Throw away the checkpoint just taken and put the scene back (used when an operation fails half-way). */
  private rollback(): void {
    const snap = this.undoStack.pop();
    if (snap) this.restore(snap);
  }

  // ------------------------------------------------------- delete / clear

  deleteSelected(): void {
    const m = this.selected;
    if (!m) { this.say("Select an object first, then delete it."); return; }
    const targets = [m, ...(this.secondary ? [this.secondary] : [])];
    this.checkpoint(`Delete ${targets.length > 1 ? `${targets.length} objects` : String(m.userData.kind)}`);
    this.setSecondary(null);
    this.select(null);
    for (const t of targets) this.removeMesh(t);
    this.collectGarbage();
    this.say(`Deleted ${targets.length > 1 ? `${targets.length} objects` : `the ${m.userData.kind}`}. Press Ctrl+Z to bring ${targets.length > 1 ? "them" : "it"} back.`);
  }

  clearAll(): void {
    this.checkpoint("Clear workspace");
    this.select(null);
    for (const m of [...this.meshes]) this.removeMesh(m);
    this.spawned = 0;
    this.say("Cleared the workspace. Press Ctrl+Z to bring it back.");
  }

  selectIndex(i: number, additive = false): void {
    const m = this.meshes[i];
    if (!m) return;
    if (additive && this.selected && m !== this.selected) { this.setSecondary(m); this.say("Two objects selected. Choose Union or Subtract."); return; }
    this.select(m);
  }

  // ---------------------------------------------------------------- booleans

  /** Boolean of two meshes into a new mesh (throws a readable Error on failure). The inputs are not touched. */
  private csg(a: THREE.Mesh, b: THREE.Mesh, op: "union" | "subtract"): THREE.Mesh {
    if (triangleCount(a) + triangleCount(b) > MAX_BOOLEAN_TRIANGLES) throw new Error(`Boolean operations are limited to ${MAX_BOOLEAN_TRIANGLES.toLocaleString()} input triangles to keep the workspace responsive.`);
    const brush = (m: THREE.Mesh) => {
      m.updateMatrixWorld(true);
      const br = new Brush(m.geometry.clone(), material());
      br.position.copy(m.position); br.quaternion.copy(m.quaternion); br.scale.copy(m.scale);
      br.updateMatrixWorld(true);
      return br;
    };
    const ba = brush(a), bb = brush(b);
    try {
      const evaluator = new Evaluator();
      evaluator.useGroups = false;
      const result = evaluator.evaluate(ba, bb, op === "union" ? ADDITION : SUBTRACTION) as unknown as THREE.Mesh;
      this.track(result.geometry);
      result.material = material();
      result.userData.kind = op === "union" ? "union" : "subtraction";
      return result;
    } catch (error) {
      throw new Error(`Boolean operation failed: ${error instanceof Error ? error.message : "unsupported geometry"}. Try closed primitive meshes.`);
    } finally {
      ba.geometry.dispose(); (ba.material as THREE.Material).dispose();
      bb.geometry.dispose(); (bb.material as THREE.Material).dispose();
    }
  }

  combine(op: "union" | "subtract"): void {
    const a = this.selected, b = this.secondary;
    if (!a || !b || a === b) { this.say("Select one object, then Shift-click a second object to combine them."); return; }
    try {
      const result = this.csg(a, b, op);
      this.checkpoint(op === "union" ? "Union" : "Subtract");
      this.setSecondary(null);
      this.select(null);
      this.removeMesh(a); this.removeMesh(b);
      this.meshes.push(result); this.scene.add(result);
      this.select(result);
      this.say(`${op === "union" ? "Union" : "Subtraction"} complete. Boolean results are only reliable for closed, well-formed meshes.`);
    } catch (error) {
      this.say(error instanceof Error ? error.message : "Boolean operation failed.");
    }
  }

  // ------------------------------------------------------------ import / export

  async importFile(file: File): Promise<void> {
    if (file.size > 50 * 1024 * 1024) { this.say("Imported model files must be 50 MB or smaller."); return; }
    this.say(`Importing ${file.name}…`);
    try {
      this.checkpoint(`Import ${file.name}`);
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (ext === "stl") {
        const geometry = this.track(new STLLoader().parse(await file.arrayBuffer()));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material());
        mesh.userData.kind = `STL ${file.name}`;
        const centre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        mesh.position.sub(centre);
        this.meshes.push(mesh); this.scene.add(mesh); this.select(mesh);
      } else if (ext === "obj") {
        const group = new OBJLoader().parse(await file.text());
        const centre = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
        group.position.sub(centre);
        group.updateMatrixWorld(true);
        const imported: THREE.Mesh[] = [];
        group.traverse((child) => {
          const c = child as THREE.Mesh;
          if (!c.isMesh) return;
          const geometry = this.track(c.geometry.clone().applyMatrix4(c.matrixWorld));
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, material());
          mesh.userData.kind = `OBJ ${file.name}`;
          imported.push(mesh);
        });
        for (const m of imported) { this.meshes.push(m); this.scene.add(m); }
        this.select(imported[0] ?? null);
      } else { this.say("Choose an STL or OBJ file."); return; }
      this.frameAll();
      this.say(`Imported ${file.name}. Geometry is centred; OBJ materials are not imported.`);
    } catch (error) {
      this.say(`Could not import ${file.name}: ${error instanceof Error ? error.message : "invalid model"}`);
    }
  }

  exportStl(unit: StlUnit): void {
    if (!this.meshes.length) { this.say("Add a shape before exporting."); return; }
    const out = exportAsciiStl(this.meshes, unit);
    if (out.tooLarge) { this.say("This model is too detailed for ASCII STL export here. Simplify it to fewer than 500,000 triangles first."); return; }
    const blob = new Blob([out.text], { type: "model/stl" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "proxima-model.stl";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    const label = unit === "in" ? "1 inch (25.4 mm)" : unit === "cm" ? "1 cm (10 mm)" : "1 mm";
    this.say(`Exported ${this.meshes.length} object(s), ${out.facets.toLocaleString()} triangles. 1 scene unit = ${label}.`);
  }

  measureSelected(): string {
    if (!this.selected) return "Select an object to measure.";
    return formatReport(analyzeMesh(this.selected));
  }

  // --------------------------------------------------------------- local model

  private setBusy(b: boolean): void { this.busy = b; this.emit(); }

  /** PNG (base64, no prefix) of the current view, without the gizmo overlay. */
  private capturePng(): string {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png").split(",")[1];
  }

  async describePreview(): Promise<string> {
    if (!this.meshes.length) return "Add or import geometry first.";
    this.setBusy(true);
    try {
      const result = await window.proxy?.analyzeModelPreview(this.capturePng());
      return result?.text || result?.error || "No description returned.";
    } catch { return "Local vision analysis is unavailable."; }
    finally { this.setBusy(false); }
  }

  // ------------------------------------------------------ operations (model + tray)

  sceneSummary(): { scene: SceneObjectSummary[]; selected: number | null } {
    const scene = this.meshes.map((m, index) => {
      const info = this.selectionInfo(m);
      return { index, kind: info.kind, position: info.position, rotation: info.rotation, dimensions: info.dimensions };
    });
    return { scene, selected: this.selected ? this.meshes.indexOf(this.selected) : null };
  }

  /** The index of the selected object, for direct tools that act on it. */
  private selectedIndex(): number | null { return this.selected ? this.meshes.indexOf(this.selected) : null; }

  private cloneMesh(m: THREE.Mesh): THREE.Mesh {
    const c = new THREE.Mesh(m.geometry, material());
    c.position.copy(m.position); c.quaternion.copy(m.quaternion); c.scale.copy(m.scale);
    c.userData = { ...m.userData };
    this.meshes.push(c);
    this.scene.add(c);
    return c;
  }

  private bakeMirror(m: THREE.Mesh, axis: "x" | "y" | "z"): THREE.Mesh {
    m.updateMatrixWorld(true);
    const g = this.track(m.geometry.clone().applyMatrix4(m.matrixWorld));
    g.applyMatrix4(new THREE.Matrix4().makeScale(axis === "x" ? -1 : 1, axis === "y" ? -1 : 1, axis === "z" ? -1 : 1));
    // A reflection turns triangles inside out; swap two vertices of each to restore outward winding.
    const swap = (arr: ArrayLike<number> & { [i: number]: number }, size: number, i: number, j: number) => { for (let k = 0; k < size; k++) { const t = arr[i * size + k]; arr[i * size + k] = arr[j * size + k]; arr[j * size + k] = t; } };
    if (g.index) {
      const idx = g.index.array as unknown as { [i: number]: number; length: number };
      for (let i = 0; i + 2 < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.index.needsUpdate = true;
    } else {
      for (const name of Object.keys(g.attributes)) {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        for (let v = 0; v + 2 < a.count; v += 3) swap(a.array as unknown as { [i: number]: number; length: number }, a.itemSize, v + 1, v + 2);
        a.needsUpdate = true;
      }
    }
    g.computeVertexNormals();
    // Re-centre the geometry on itself so the copy has a meaningful position and its gizmo sits on it.
    g.computeBoundingBox();
    const centre = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-centre.x, -centre.y, -centre.z);
    const out = new THREE.Mesh(g, material());
    out.position.copy(centre);
    out.userData.kind = `mirrored ${String(m.userData.kind)}`;
    this.meshes.push(out);
    this.scene.add(out);
    return out;
  }

  private runOp(op: StudioOp, refs: RefTable<THREE.Mesh>): THREE.Mesh | null {
    const need = (i: number): THREE.Mesh => { const m = refs.get(i); if (!m) throw new Error(`Object #${i} no longer exists.`); return m; };
    const dimsOf = (m: THREE.Mesh) => { m.geometry.computeBoundingBox(); return m.geometry.boundingBox!.getSize(new THREE.Vector3()); };
    const clampPos = (m: THREE.Mesh) => m.position.set(clamp(m.position.x, -MAX_COORD, MAX_COORD), clamp(m.position.y, -MAX_COORD, MAX_COORD), clamp(m.position.z, -MAX_COORD, MAX_COORD));
    switch (op.op) {
      case "create": { const m = this.buildPrimitive(op.kind, op); refs.add(m); return m; }
      case "set": {
        const m = need(op.target);
        if (op.position) m.position.set(op.position.x, op.position.y, op.position.z);
        if (op.rotation) m.rotation.set(THREE.MathUtils.degToRad(op.rotation.x), THREE.MathUtils.degToRad(op.rotation.y), THREE.MathUtils.degToRad(op.rotation.z));
        if (op.dimensions) { const b = dimsOf(m); m.scale.set(op.dimensions.x / b.x, op.dimensions.y / b.y, op.dimensions.z / b.z); }
        return m;
      }
      case "move": { const m = need(op.target); m.position.add(new THREE.Vector3(op.delta.x, op.delta.y, op.delta.z)); clampPos(m); return m; }
      case "rotate": {
        const m = need(op.target);
        m.rotation.set(m.rotation.x + THREE.MathUtils.degToRad(op.delta.x), m.rotation.y + THREE.MathUtils.degToRad(op.delta.y), m.rotation.z + THREE.MathUtils.degToRad(op.delta.z));
        return m;
      }
      case "scale": { const m = need(op.target); m.scale.multiply(new THREE.Vector3(op.factor.x, op.factor.y, op.factor.z)); return m; }
      case "duplicate": {
        const src = need(op.target);
        let last = src;
        for (let k = 1; k <= op.count; k++) {
          last = this.cloneMesh(src);
          last.position.set(src.position.x + op.offset.x * k, src.position.y + op.offset.y * k, src.position.z + op.offset.z * k);
          clampPos(last);
          refs.add(last);
        }
        return last;
      }
      case "circular_array": {
        const src = need(op.target);
        let last = src;
        for (let k = 1; k < op.count; k++) {
          const angle = (2 * Math.PI * k) / op.count;
          const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
          last = this.cloneMesh(src);
          const rel = new THREE.Vector3(src.position.x - op.center.x, 0, src.position.z - op.center.z).applyQuaternion(spin);
          last.position.set(op.center.x + rel.x, src.position.y, op.center.z + rel.z);
          last.quaternion.premultiply(spin);
          clampPos(last);
          refs.add(last);
        }
        return last;
      }
      case "mirror": { const out = this.bakeMirror(need(op.target), op.axis); refs.add(out); return out; }
      case "align": {
        const m = need(op.target);
        const box = new THREE.Box3().setFromObject(m);
        const c = box.getCenter(new THREE.Vector3());
        if (op.mode === "ground") m.position.y -= box.min.y;
        else if (op.mode === "center") { m.position.x -= c.x; m.position.z -= c.z; }
        else m.position.sub(c);
        clampPos(m);
        return m;
      }
      case "round_corners": {
        const m = need(op.target);
        if (!this.roundCorners(m, op.radius, false)) throw new Error("Corner rounding needs a box and a radius up to 45% of its shortest side.");
        return m;
      }
      case "hole": {
        const m = need(op.target);
        const box = new THREE.Box3().setFromObject(m);
        const c = box.getCenter(new THREE.Vector3());
        const h = box.getSize(new THREE.Vector3()).y + 2;
        const tool = new THREE.Mesh(new THREE.CylinderGeometry(op.diameter / 2, op.diameter / 2, h, 32), material());
        tool.position.set(op.x ?? c.x, c.y, op.z ?? c.z);
        try {
          const result = this.csg(m, tool, "subtract");
          result.userData.kind = `${String(m.userData.kind)} with hole`;
          this.removeMesh(m);
          this.meshes.push(result); this.scene.add(result);
          refs.set(op.target, result);
          return result;
        } finally { tool.geometry.dispose(); (tool.material as THREE.Material).dispose(); }
      }
      case "boolean": {
        const a = need(op.target), b = need(op.tool);
        const result = this.csg(a, b, op.mode);
        this.removeMesh(a); this.removeMesh(b);
        this.meshes.push(result); this.scene.add(result);
        refs.set(op.target, result); refs.kill(op.tool);
        return result;
      }
      case "delete": { const m = need(op.target); this.removeMesh(m); refs.kill(op.target); return null; }
    }
  }

  /**
   * Run a validated plan as ONE undoable step. If any operation throws, the
   * scene is put back exactly as it was and nothing is half-applied.
   */
  applyOps(ops: StudioOp[], label: string): { ok: true } | { ok: false; error: string } {
    const refs = new RefTable<THREE.Mesh>([...this.meshes]);
    this.checkpoint(label);
    this.setSecondary(null);
    let last: THREE.Mesh | null = null;
    try {
      for (const op of ops) { const r = this.runOp(op, refs); if (r) last = r; }
    } catch (error) {
      this.rollback();
      const message = error instanceof Error ? error.message : "An operation failed.";
      this.say(`${message} Nothing was changed.`);
      return { ok: false, error: message };
    }
    const keep = last && this.meshes.includes(last) ? last : this.meshes[this.meshes.length - 1] ?? null;
    this.select(keep);
    this.collectGarbage();
    return { ok: true };
  }

  /** Direct (no model) tool: runs one operation on the selected object. */
  runTool(make: (target: number) => StudioOp, label: string): void {
    const t = this.selectedIndex();
    if (t === null) { this.say("Select an object first."); return; }
    const { scene, selected } = this.sceneSummary();
    const checked = validatePlan({ ops: [make(t)] }, scene, selected);
    if (!checked.ok) { this.say(checked.error); return; }
    const r = this.applyOps(checked.ops, label);
    if (r.ok) this.say(`${label} done. Ctrl+Z undoes it.`);
  }

  async describePlan(prompt: string, sceneUnit: StlUnit): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    const text = prompt.trim();
    if (!text) return { ok: false, error: "Describe the change first." };
    this.setBusy(true);
    this.say("Asking the local model for a plan…");
    try {
      const { scene, selected } = this.sceneSummary();
      const plan = await window.proxy?.planModelEdit({ prompt: text, sceneUnit, scene, selected });
      if (!plan) return { ok: false, error: "Local model editing is unavailable." };
      if (!plan.ok) { this.say(plan.error); return plan; }
      const applied = this.applyOps(plan.ops, `Model: ${plan.summary}`);
      if (!applied.ok) return applied;
      this.say(`Applied: ${plan.summary}. Ctrl+Z undoes the whole plan.`);
      return { ok: true, summary: plan.summary };
    } catch {
      this.say("Local model editing is unavailable.");
      return { ok: false, error: "Local model editing is unavailable." };
    } finally { this.setBusy(false); }
  }
}

let instance: StudioScene | null = null;
/** The one studio for this session. Throws if WebGL is unavailable. */
export function getStudio(): StudioScene {
  if (!instance) instance = new StudioScene();
  return instance;
}
