import type { EngineState, UsagePoint } from "../bridge/engineState";
import { formatBytesPerSec, formatDuration, formatMB } from "../lib/format";
import { Panel } from "./Panel";
import { Spark } from "./Sparkline";

const col = (pts: UsagePoint[], k: keyof UsagePoint) => pts.map((p) => p[k] as number);

function Meter({ label, value, text }: { label: string; value: number | null; text: string }) {
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><span className="num">{text}</span></div>
      <div className="meter-track" role="presentation"><div className="meter-fill" style={{ width: `${value ?? 0}%` }} /></div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "cpu" | "mem" }) {
  return <div className={`stat ${tone ? `stat-${tone}` : ""}`}><span className="stat-label">{label}</span><span className="stat-value num">{value}</span></div>;
}

/** Compact card for the dashboard: CPU, memory, disk and network at a glance. */
export function MonitorCard({ state }: { state: EngineState }) {
  const u = state.usage;
  const unavailable = u === null;
  return (
    <Panel title="System" className="monitor compact" status={unavailable ? <span className="chip">No sample</span> : undefined}>
      <Meter label="CPU" value={u ? u.cpuPercent : null} text={u ? `${u.cpuPercent.toFixed(1)}%` : unavailable ? "Unavailable" : "—"} />
      <Meter label="Memory" value={u ? u.usedMemPercent : null} text={u ? `${u.usedMemPercent.toFixed(1)}%` : unavailable ? "Unavailable" : "—"} />
      <div className="stat-row">
        <Stat label="Disk read" value={u?.disk ? formatBytesPerSec(u.disk.readBytesPerSec) : "—"} />
        <Stat label="Disk write" value={u?.disk ? formatBytesPerSec(u.disk.writeBytesPerSec) : "—"} />
        <Stat label="Down" value={u?.network ? formatBytesPerSec(u.network.rxBytesPerSec) : "—"} />
        <Stat label="Up" value={u?.network ? formatBytesPerSec(u.network.txBytesPerSec) : "—"} />
      </div>
      <Spark label="CPU and memory over the last samples" series={[{ values: col(state.usageHistory, "mem"), cls: "spark-mem" }, { values: col(state.usageHistory, "cpu"), cls: "spark-cpu" }]} max={100} height={36} />
    </Panel>
  );
}

/* ---- full-size cards for the System page: one metric each, all the same size ---- */

export function CpuCard({ state }: { state: EngineState }) {
  const u = state.usage;
  return (
    <Panel title="CPU" className="metric" status={u?.cpuCores ? <span className="chip">{u.cpuCores} logical cores</span> : undefined}>
      <div className="big num">{u ? `${u.cpuPercent.toFixed(1)}%` : u === null ? "—" : "…"}</div>
      <Meter label="Load" value={u ? u.cpuPercent : null} text={u ? `${u.cpuPercent.toFixed(1)}%` : "—"} />
      <Spark label="CPU load over time" series={[{ values: col(state.usageHistory, "cpu"), cls: "spark-cpu" }]} max={100} height={70} />
      <p className="note">{u?.processCount ? `${u.processCount} processes running` : "Process count unavailable"}</p>
    </Panel>
  );
}

export function MemoryCard({ state }: { state: EngineState }) {
  const u = state.usage;
  return (
    <Panel title="Memory" className="metric" status={u ? <span className="chip">{formatMB(u.totalMemMB)} total</span> : undefined}>
      <div className="big num">{u ? `${u.usedMemPercent.toFixed(1)}%` : u === null ? "—" : "…"}</div>
      <Meter label="In use" value={u ? u.usedMemPercent : null} text={u ? `${formatMB(u.usedMemMB)} of ${formatMB(u.totalMemMB)}` : "—"} />
      <Spark label="Memory use over time" series={[{ values: col(state.usageHistory, "mem"), cls: "spark-mem" }]} max={100} height={70} />
      <p className="note">{u ? `${formatMB(Math.max(0, u.totalMemMB - u.usedMemMB))} free` : ""}</p>
    </Panel>
  );
}

export function DiskCard({ state }: { state: EngineState }) {
  const u = state.usage;
  const d = u?.disk;
  return (
    <Panel title="Disk" className="metric" status={d ? <span className="chip">{d.busyPercent.toFixed(0)}% busy</span> : undefined}>
      {d === null || (u && d === undefined) ? <p className="empty">Disk counters are unavailable on this machine.</p> : (
        <>
          <div className="stat-pair">
            <Stat tone="cpu" label="Read" value={d ? formatBytesPerSec(d.readBytesPerSec) : "…"} />
            <Stat tone="mem" label="Write" value={d ? formatBytesPerSec(d.writeBytesPerSec) : "…"} />
          </div>
          <Meter label="Busy" value={d ? d.busyPercent : null} text={d ? `${d.busyPercent.toFixed(0)}%` : "—"} />
          <Spark label="Disk read and write over time" series={[{ values: col(state.usageHistory, "diskWrite"), cls: "spark-mem" }, { values: col(state.usageHistory, "diskRead"), cls: "spark-cpu" }]} height={70} />
        </>
      )}
    </Panel>
  );
}

export function NetworkCard({ state }: { state: EngineState }) {
  const u = state.usage;
  const n = u?.network;
  return (
    <Panel title="Network" className="metric" status={n ? <span className="chip">all adapters</span> : undefined}>
      {n === null || (u && n === undefined) ? <p className="empty">Network counters are unavailable on this machine.</p> : (
        <>
          <div className="stat-pair">
            <Stat tone="cpu" label="Download" value={n ? formatBytesPerSec(n.rxBytesPerSec) : "…"} />
            <Stat tone="mem" label="Upload" value={n ? formatBytesPerSec(n.txBytesPerSec) : "…"} />
          </div>
          <Spark label="Network download and upload over time" series={[{ values: col(state.usageHistory, "netTx"), cls: "spark-mem" }, { values: col(state.usageHistory, "netRx"), cls: "spark-cpu" }]} height={92} />
        </>
      )}
    </Panel>
  );
}

export function ProcessCard({ state, by }: { state: EngineState; by: "memory" | "cpu" }) {
  const u = state.usage;
  const rows = by === "memory" ? u?.topByMemory.map((p) => ({ name: p.name, value: formatMB(p.memMB) })) : u?.topByCpuTime.map((p) => ({ name: p.name, value: formatDuration(p.cpuSeconds) }));
  return (
    <Panel title={by === "memory" ? "Top memory use" : "Top CPU time"} className="metric" status={by === "cpu" ? <span className="chip" title="Total processor time used since each process started, not what is busy right now">since start</span> : undefined}>
      {rows?.length ? <ul className="proc-list">{rows.slice(0, 8).map((r, i) => <li key={`${r.name}-${i}`}><span>{r.name}</span><span className="num">{r.value}</span></li>)}</ul> : <p className="empty">{u === null ? "No process data." : "Waiting for the first sample…"}</p>}
    </Panel>
  );
}

export { formatDuration };
