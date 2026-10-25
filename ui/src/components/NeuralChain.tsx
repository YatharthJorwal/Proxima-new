import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { pipelineStage, STAGES } from "../bridge/pipeline";
import type { EngineState } from "../bridge/engineState";
import { Panel } from "./Panel";

const LAYERS = [3, 5, 6, 5, 4, 3];
const DIM = new THREE.Color(0x2b5f98);
const LIT = new THREE.Color(0xa8f0ff);
const PULSE_MS = 650;
const MAX_PULSES = 32;

/** Small deterministic PRNG so the graph looks the same every launch. */
function rng(seed: number) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function glow(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.3, "rgba(255,255,255,.6)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Pulse { from: THREE.Vector3; to: THREE.Vector3; start: number }

/**
 * A 3D chain of node layers, one per pipeline stage. The layer for the stage
 * the engine is really in lights up, and a handful of pulses travel in from
 * the previous layer when the stage changes. Idle = dim and still; no
 * made-up activity.
 */
export function NeuralChain({ state }: { state: EngineState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stage = pipelineStage(state);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    camera.position.set(0, 1.1, 6);
    const root = new THREE.Group();
    scene.add(root);
    const sprite = glow();
    const disposables: { dispose(): void }[] = [sprite];

    // --- layout ---
    const rand = rng(11);
    const layers: THREE.Vector3[][] = LAYERS.map((count, li) => {
      const x = (li / (LAYERS.length - 1) - 0.5) * 9.6;
      return Array.from({ length: count }, (_, i) => new THREE.Vector3(x, ((i + 0.5) / count - 0.5) * 2.7 + (rand() - 0.5) * 0.3, (rand() - 0.5) * 2.4));
    });

    // --- nodes: one Points object per layer, so each layer lights independently ---
    const nodeMats: THREE.PointsMaterial[] = layers.map((pts) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.PointsMaterial({ color: DIM.clone(), size: 0.6, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      root.add(new THREE.Points(geo, mat));
      disposables.push(geo, mat);
      return mat;
    });

    // --- edges between neighbouring layers; remember them for the pulses ---
    const pairs: [THREE.Vector3, THREE.Vector3][][] = [];
    const edgeMats: THREE.LineBasicMaterial[] = [];
    for (let li = 0; li < layers.length - 1; li++) {
      const a = layers[li], b = layers[li + 1];
      const segs: [THREE.Vector3, THREE.Vector3][] = [];
      const seen = new Set<string>();
      const link = (i: number, j: number) => { const k = `${i}:${j}`; if (!seen.has(k)) { seen.add(k); segs.push([a[i], b[j]]); } };
      const nearest = (from: THREE.Vector3, to: THREE.Vector3[]) => to.map((p, idx) => ({ idx, d: Math.hypot(p.y - from.y, p.z - from.z) })).sort((x, y) => x.d - y.d);
      a.forEach((p, i) => nearest(p, b).slice(0, 2).forEach((n) => link(i, n.idx)));
      b.forEach((p, j) => nearest(p, a).slice(0, 1).forEach((n) => link(n.idx, j)));
      pairs.push(segs);
      const pts: THREE.Vector3[] = [];
      for (const [p, q] of segs) pts.push(p, q);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: DIM.clone(), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
      root.add(new THREE.LineSegments(geo, mat));
      disposables.push(geo, mat);
      edgeMats.push(mat);
    }

    // --- pulses ---
    const pulseGeo = new THREE.BufferGeometry();
    const pulsePos = new Float32Array(MAX_PULSES * 3).fill(9999);
    pulseGeo.setAttribute("position", new THREE.BufferAttribute(pulsePos, 3));
    const pulseMat = new THREE.PointsMaterial({ color: 0xeaffff, size: 0.4, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    root.add(new THREE.Points(pulseGeo, pulseMat));
    disposables.push(pulseGeo, pulseMat);
    const pulses: Pulse[] = [];
    const spawn = (toLayer: number, now: number) => {
      if (toLayer < 1) return;
      const segs = pairs[toLayer - 1];
      for (let i = 0; i < 8; i++) {
        const [from, to] = segs[Math.floor(Math.random() * segs.length)];
        if (pulses.length < MAX_PULSES) pulses.push({ from, to, start: now + i * 45 });
      }
    };

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Back off just far enough that the whole chain fits both ways, whatever the card's shape.
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.z = Math.max((5.2 + 0.6) / (tan * camera.aspect), 1.75 / tan);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tmp = new THREE.Color();
    let prevStage = -1;
    let raf = 0;
    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const s = stageRef.current;
      if (s !== prevStage) { if (s > 0 && s !== prevStage) spawn(s, nowMs); prevStage = s; }
      nodeMats.forEach((m, i) => {
        const lit = i === s;
        m.color.lerp(lit ? LIT : tmp.copy(DIM).multiplyScalar(i < s ? 1.5 : 1), 0.12);
        m.size += ((lit ? 1.15 : i < s ? 0.75 : 0.6) - m.size) * 0.12;
      });
      edgeMats.forEach((m, i) => {
        const active = i + 1 === s;
        m.color.lerp(active ? LIT : DIM, 0.12);
        m.opacity += ((active ? 0.85 : i + 1 < s ? 0.42 : 0.3) - m.opacity) * 0.12;
      });
      for (let i = 0; i < MAX_PULSES; i++) {
        const p = pulses[i];
        if (!p) { pulsePos[i * 3] = pulsePos[i * 3 + 1] = pulsePos[i * 3 + 2] = 9999; continue; }
        const t = (nowMs - p.start) / PULSE_MS;
        if (t < 0) { pulsePos[i * 3] = pulsePos[i * 3 + 1] = pulsePos[i * 3 + 2] = 9999; continue; }
        if (t > 1) { pulses.splice(i, 1); i--; continue; }
        pulsePos[i * 3] = p.from.x + (p.to.x - p.from.x) * t;
        pulsePos[i * 3 + 1] = p.from.y + (p.to.y - p.from.y) * t;
        pulsePos[i * 3 + 2] = p.from.z + (p.to.z - p.from.z) * t;
      }
      pulseGeo.attributes.position.needsUpdate = true;
      root.rotation.y = reduce ? 0.25 : Math.sin(nowMs / 4200) * 0.38;
      root.rotation.x = 0;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <Panel title="Neural chain" className="neural" status={<span className={`chip ${stage >= 0 ? "chip-live" : ""}`}>{stage >= 0 ? STAGES[stage] : "Idle"}</span>}>
      <div className="neural-stage">
        {failed ? <p className="empty">3D view unavailable.</p> : <div className="neural-canvas" ref={hostRef} />}
      </div>
      <ol className="neural-labels" aria-label="Pipeline stages">
        {STAGES.map((name, i) => <li key={name} className={i === stage ? "on" : i < stage ? "past" : ""}>{name}</li>)}
      </ol>
    </Panel>
  );
}
