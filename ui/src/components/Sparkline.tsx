import type { UsagePoint } from "../bridge/engineState";

/** Two thin lines (CPU, memory) from real samples. Draws nothing until there are two samples. */
export function Sparkline({ points, height = 44 }: { points: UsagePoint[]; height?: number }) {
  if (points.length < 2) return <div className="spark spark-empty" style={{ height }}>Collecting samples…</div>;
  const w = 200;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => height - 3 - (v / 100) * (height - 6);
  const path = (key: "cpu" | "mem") => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label="CPU and memory over the last samples">
      <path d={path("mem")} className="spark-mem" />
      <path d={path("cpu")} className="spark-cpu" />
    </svg>
  );
}
