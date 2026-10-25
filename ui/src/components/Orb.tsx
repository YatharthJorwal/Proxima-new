import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbState } from "../bridge/engineState";

const COLORS: Record<OrbState, number> = { idle: 0x3fa9ff, listening: 0x5fe0ff, thinking: 0x8ab4ff, speaking: 0x5fe0ff, error: 0xff5c6c };
const SPIN: Record<OrbState, number> = { idle: 0.16, listening: 0.22, thinking: 0.55, speaking: 0.24, error: 0.45 };
const PULSE: Record<OrbState, { amp: number; rate: number }> = {
  idle: { amp: 0.006, rate: 1.2 }, listening: { amp: 0.03, rate: 3 }, thinking: { amp: 0.02, rate: 5 },
  speaking: { amp: 0.045, rate: 7.5 }, error: { amp: 0.04, rate: 9 },
};
const FLASH_MS = 700;
const FLASH_COLOR = new THREE.Color(0xffc46b);

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Unique vertices of a geodesic sphere (icosahedron subdivided `detail` times). */
function uniqueVertices(geo: THREE.BufferGeometry): THREE.Vector3[] {
  const pos = geo.getAttribute("position");
  const seen = new Map<string, THREE.Vector3>();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()];
}

function build(): { group: THREE.Group; rings: THREE.Group; disposables: { dispose(): void }[]; tinted: THREE.Material[] } {
  const radius = 1.5;
  const sprite = glowTexture();
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [sprite];
  const tinted: THREE.Material[] = [];

  const sphere = new THREE.IcosahedronGeometry(radius, 3);
  const pts = uniqueVertices(sphere);

  const wire = new THREE.WireframeGeometry(sphere);
  const lineMat = new THREE.LineBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(new THREE.LineSegments(wire, lineMat));
  disposables.push(sphere, wire, lineMat);
  tinted.push(lineMat);

  const dotGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const dotMat = new THREE.PointsMaterial({ color: COLORS.idle, size: 0.045, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  group.add(new THREE.Points(dotGeo, dotMat));
  disposables.push(dotGeo, dotMat);
  tinted.push(dotMat);

  // A sparse set of brighter nodes, like the reference's hubs.
  const hubs = pts.filter((_, i) => i % 8 === 0);
  const hubGeo = new THREE.BufferGeometry().setFromPoints(hubs);
  const hubMat = new THREE.PointsMaterial({ color: 0xcfeaff, size: 0.12, map: sprite, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  group.add(new THREE.Points(hubGeo, hubMat));
  disposables.push(hubGeo, hubMat);

  // Soft core glow behind the lattice.
  const coreMat = new THREE.SpriteMaterial({ map: sprite, color: COLORS.idle, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const core = new THREE.Sprite(coreMat);
  core.scale.set(5.2, 5.2, 1);
  group.add(core);
  disposables.push(coreMat);
  tinted.push(coreMat);

  const rings = new THREE.Group();
  [2.05, 2.4, 2.8].forEach((r, i) => {
    const curve = new THREE.EllipseCurve(0, 0, r, r, 0, Math.PI * 2);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(160).map((p) => new THREE.Vector3(p.x, 0, p.y)));
    const mat = new THREE.LineBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0.16 - i * 0.03, blending: THREE.AdditiveBlending, depthWrite: false });
    const loop = new THREE.LineLoop(geo, mat);
    loop.rotation.x = 0.18 + i * 0.07;
    loop.rotation.z = -0.1 + i * 0.12;
    rings.add(loop);
    disposables.push(geo, mat);
    tinted.push(mat);
  });

  return { group, rings, disposables, tinted };
}

export function Orb({ state, flashAt }: { state: OrbState; flashAt: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef({ state, flashAt });
  live.current = { state, flashAt };
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0.35, 7.6);
    camera.lookAt(0, 0, 0);
    const { group, rings, disposables, tinted } = build();
    scene.add(rings, group);

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const color = new THREE.Color(COLORS.idle);
    let spin = SPIN.idle;
    let last = performance.now();
    let t = 0;
    let raf = 0;

    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = nowMs; return; }
      const dt = Math.min(0.05, (nowMs - last) / 1000);
      last = nowMs;
      t += dt;
      const { state: st, flashAt: flash } = live.current;
      const target = new THREE.Color(COLORS[st]);
      const flashing = Date.now() - flash < FLASH_MS;
      if (flashing) target.lerp(FLASH_COLOR, 0.8);
      color.lerp(target, Math.min(1, dt * 6));
      tinted.forEach((m) => (m as THREE.Material & { color: THREE.Color }).color.copy(color));

      const motion = reduceMotion ? 0.12 : 1;
      spin += (SPIN[st] - spin) * Math.min(1, dt * 3);
      group.rotation.y += spin * dt * motion;
      group.rotation.x = Math.sin(t * 0.3) * 0.08 * motion;
      rings.rotation.y -= spin * 0.35 * dt * motion;
      const p = PULSE[st];
      const scale = 1 + (reduceMotion ? 0 : p.amp * Math.sin(t * p.rate));
      group.scale.setScalar(scale);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className={`orb orb-${state}`} data-state={state}>
      <div className="orb-platform" aria-hidden="true"><i /><i /><i /></div>
      {failed ? <div className="orb-fallback" role="img" aria-label="Proxima core (3D view unavailable)" /> : <div className="orb-canvas" ref={hostRef} />}
    </div>
  );
}
