import type { EngineState } from "../bridge/engineState";
import { Panel } from "./Panel";
import { Sparkline } from "./Sparkline";

function Meter({ label, value, text }: { label: string; value: number | null; text: string }) {
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><span className="num">{text}</span></div>
      <div className="meter-track" role="presentation"><div className="meter-fill" style={{ width: `${value ?? 0}%` }} /></div>
    </div>
  );
}

export function MonitorCard({ state, detailed = false }: { state: EngineState; detailed?: boolean }) {
  const u = state.usage;
  const last = state.usageHistory[state.usageHistory.length - 1];
  const updated = last ? new Date(last.at).toLocaleTimeString([], { hour12: false }) : null;
  const unavailable = u === null;
  return (
    <Panel title={detailed ? "System monitor" : "System"} className="monitor" status={detailed || unavailable ? <span className="chip">{unavailable ? "No sample" : updated ? `Updated ${updated}` : "Waiting"}</span> : undefined}>
      <Meter label="CPU" value={u ? Math.min(100, Math.max(0, u.cpuPercent)) : null} text={u ? `${u.cpuPercent.toFixed(1)}%` : unavailable ? "Unavailable" : "—"} />
      <Meter label="Memory" value={u ? Math.min(100, Math.max(0, u.usedMemPercent)) : null}
        text={u ? (detailed ? `${u.usedMemPercent.toFixed(1)}% · ${u.usedMemMB} / ${u.totalMemMB} MB` : `${u.usedMemPercent.toFixed(1)}%`) : unavailable ? "Unavailable" : "—"} />
      <Sparkline points={state.usageHistory} height={detailed ? 84 : 44} />
      {detailed && <p className="legend"><span className="key key-cpu" />CPU <span className="key key-mem" />Memory</p>}
      {detailed && u && (
        <div className="proc-grid">
          <div>
            <h3>Top memory use</h3>
            {u.topByMemory.length ? u.topByMemory.slice(0, 5).map((p) => <div className="proc" key={p.name}><span>{p.name}</span><span className="num">{p.memMB} MB</span></div>) : <p className="empty">No process data</p>}
          </div>
          <div>
            <h3>Top cumulative CPU time</h3>
            {u.topByCpuTime.length ? u.topByCpuTime.slice(0, 5).map((p) => <div className="proc" key={p.name}><span>{p.name}</span><span className="num">{p.cpuSeconds} s</span></div>) : <p className="empty">No process data</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}
