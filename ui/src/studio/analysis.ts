import * as THREE from "three";

export type StlUnit = "mm" | "cm" | "in";
export const STL_UNIT_MM: Record<StlUnit, number> = { mm: 1, cm: 10, in: 25.4 };
export const MAX_EXPORT_TRIANGLES = 500_000;
export const MAX_DIAGNOSTIC_TRIANGLES = 120_000;
export const MAX_BOOLEAN_TRIANGLES = 80_000;

export function triangleCount(mesh: THREE.Mesh): number {
  const g = mesh.geometry;
  return Math.floor((g.index?.count ?? g.getAttribute("position")?.count ?? 0) / 3);
}

export interface MeshReport {
  size: { x: number; y: number; z: number };
  triangles: number;
  /** null when the mesh is too big for the diagnostic pass. */
  volume: number | null;
  topology: {
    boundaryEdges: number;
    nonManifoldEdges: number;
    windingMismatches: number;
    degenerateTriangles: number;
    components: number;
    closed: boolean;
  } | null;
}

/** Bounds, triangle count, signed volume and a topology check (boundary / non-manifold edges, winding, components). */
export function analyzeMesh(mesh: THREE.Mesh): MeshReport {
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.index;
  const total = index ? index.count : position.count;
  const start = geometry.drawRange.start;
  const count = Math.min(total, geometry.drawRange.count);
  const triangles = Math.floor(count / 3);
  const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  if (triangles > MAX_DIAGNOSTIC_TRIANGLES) return { size, triangles, volume: null, topology: null };

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let signedVolume = 0;
  const scale = Math.max(size.x, size.y, size.z, 1e-6);
  const weld = scale * 1e-7;
  const degenerateLimit = scale ** 4 * 1e-20;
  const vertexIds = new Map<string, number>();
  const edges = new Map<string, { uses: number; balance: number }>();
  const firstAtVertex = new Map<number, number>();
  const parents = new Int32Array(triangles);
  for (let i = 0; i < triangles; i++) parents[i] = i;
  const root = (item: number) => {
    let r = item;
    while (parents[r] !== r) r = parents[r];
    while (parents[item] !== item) { const next = parents[item]; parents[item] = r; item = next; }
    return r;
  };
  const join = (l: number, r: number) => { const x = root(l), y = root(r); if (x !== y) parents[y] = x; };
  const vertexId = (i: number) => {
    const key = `${Math.round(position.getX(i) / weld)},${Math.round(position.getY(i) / weld)},${Math.round(position.getZ(i) / weld)}`;
    let id = vertexIds.get(key);
    if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
    return id;
  };

  let degenerate = 0;
  for (let i = start; i + 2 < start + count; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
    signedVolume += a.dot(b.clone().cross(c)) / 6;
    const area2 = b.clone().sub(a).cross(c.clone().sub(a)).lengthSq();
    if (!Number.isFinite(area2) || area2 <= degenerateLimit) degenerate++;
    const tri = Math.floor((i - start) / 3);
    const ids = [vertexId(ia), vertexId(ib), vertexId(ic)];
    for (const id of ids) {
      const prev = firstAtVertex.get(id);
      if (prev === undefined) firstAtVertex.set(id, tri); else join(prev, tri);
    }
    for (let e = 0; e < 3; e++) {
      const from = ids[e], to = ids[(e + 1) % 3];
      const low = Math.min(from, to), high = Math.max(from, to);
      const key = `${low}:${high}`;
      const rec = edges.get(key) ?? { uses: 0, balance: 0 };
      rec.uses++;
      rec.balance += from === low ? 1 : -1;
      edges.set(key, rec);
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, windingMismatches = 0;
  for (const e of edges.values()) {
    if (e.uses === 1) boundaryEdges++;
    else if (e.uses > 2) nonManifoldEdges++;
    else if (e.balance !== 0) windingMismatches++;
  }
  const components = new Set(Array.from({ length: triangles }, (_, i) => root(i))).size;
  return {
    size, triangles, volume: Math.abs(signedVolume),
    topology: { boundaryEdges, nonManifoldEdges, windingMismatches, degenerateTriangles: degenerate, components, closed: boundaryEdges === 0 && nonManifoldEdges === 0 },
  };
}

export function formatReport(r: MeshReport): string {
  const bounds = `Bounds: ${r.size.x.toFixed(3)} × ${r.size.y.toFixed(3)} × ${r.size.z.toFixed(3)} scene units · ${r.triangles.toLocaleString()} triangles.`;
  const volume = r.volume === null ? `Volume estimate skipped for meshes over ${MAX_DIAGNOSTIC_TRIANGLES.toLocaleString()} triangles.` : `Volume estimate: ${r.volume.toFixed(3)} scene units³ (meaningful only for closed, consistently oriented geometry).`;
  let topo = `Topology check skipped for meshes over ${MAX_DIAGNOSTIC_TRIANGLES.toLocaleString()} triangles.`;
  if (r.topology) {
    const t = r.topology;
    const manifold = t.closed ? "no boundary or non-manifold edges" : `${t.boundaryEdges} boundary and ${t.nonManifoldEdges} non-manifold edges`;
    const winding = t.windingMismatches ? `${t.windingMismatches} shared edges have inconsistent face winding` : "shared edge winding is consistent";
    topo = `Topology: ${manifold}; ${winding}; ${t.degenerateTriangles} degenerate triangles; ${t.components} connected component(s).`;
  }
  return `${bounds} ${volume} ${topo} These diagnostics help spot problems; they are not a guarantee the model will print.`;
}

export interface StlExport { text: string; facets: number; tooLarge: boolean }

/** ASCII STL of every mesh, world-space, converted from scene units to millimetres. */
export function exportAsciiStl(meshes: THREE.Mesh[], unit: StlUnit): StlExport {
  const mm = STL_UNIT_MM[unit] ?? 1;
  const lines: string[] = [];
  let facets = 0;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const count = Math.min(index ? index.count : position.count, mesh.geometry.drawRange.count);
    const start = mesh.geometry.drawRange.start;
    for (let i = start; i + 2 < start + count; i += 3) {
      if (facets >= MAX_EXPORT_TRIANGLES) return { text: "", facets, tooLarge: true };
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1, c = index ? index.getX(i + 2) : i + 2;
      vA.fromBufferAttribute(position, a).applyMatrix4(mesh.matrixWorld).multiplyScalar(mm);
      vB.fromBufferAttribute(position, b).applyMatrix4(mesh.matrixWorld).multiplyScalar(mm);
      vC.fromBufferAttribute(position, c).applyMatrix4(mesh.matrixWorld).multiplyScalar(mm);
      const n = vB.clone().sub(vA).cross(vC.clone().sub(vA)).normalize();
      lines.push(`facet normal ${n.x} ${n.y} ${n.z}\n outer loop\n  vertex ${vA.x} ${vA.y} ${vA.z}\n  vertex ${vB.x} ${vB.y} ${vB.z}\n  vertex ${vC.x} ${vC.y} ${vC.z}\n endloop\nendfacet`);
      facets++;
    }
  }
  return { text: `solid proxima\n${lines.join("\n")}\nendsolid proxima`, facets, tooLarge: false };
}
