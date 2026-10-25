/** One or more thin lines from real samples. Draws nothing until there are two samples. */
export interface SparkSeries { values: number[]; cls: string }

export function Spark({ series, height = 44, max, label }: { series: SparkSeries[]; height?: number; max?: number; label: string }) {
  const n = Math.min(...series.map((s) => s.values.length));
  if (!Number.isFinite(n) || n < 2) return <div className="spark spark-empty" style={{ height }}>Collecting samples…</div>;
  const w = 200;
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => height - 3 - (Math.min(v, top) / top) * (height - 6);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
      {series.map((s, k) => (
        <path key={k} className={s.cls} d={s.values.slice(-n).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")} />
      ))}
    </svg>
  );
}
