import type { EngineState } from "../bridge/engineState";
import { useNow } from "../bridge/store";
import { formatDuration } from "../lib/format";
import { BluetoothCard } from "../components/BluetoothCard";
import { CpuCard, DiskCard, MemoryCard, NetworkCard, ProcessesCard } from "../components/MonitorCard";
import { Panel } from "../components/Panel";
import { engineLabel } from "../components/Sidebar";

function StatusCard({ state }: { state: EngineState }) {
  const now = useNow(state.startedAt !== null, 1000);
  const e = engineLabel(state);
  const a = state.activation;
  const sys = state.usage?.uptimeSeconds;
  return (
    <Panel title="Status" className="metric">
      <dl className="kv">
        <div><dt>State</dt><dd><span className={`status-pill ${e.tone === "ok" ? "ok" : e.tone === "error" ? "bad" : "warn"}`}>{e.text}</span></dd></div>
        <div><dt>Hotkey</dt><dd>{state.hotkey ?? "—"}</dd></div>
        <div><dt>Proxima uptime</dt><dd className="num">{state.startedAt ? formatDuration((now - state.startedAt) / 1000) : "—"}</dd></div>
        <div><dt>Windows uptime</dt><dd className="num">{typeof sys === "number" ? formatDuration(sys) : "—"}</dd></div>
        <div><dt>Double-clap</dt><dd>{a?.listening ? "Listening" : a?.paused ? "Paused" : a?.enabled ? "Unavailable" : "Off"}</dd></div>
      </dl>
    </Panel>
  );
}

/** Six equal metric cards plus a tall Bluetooth & devices card, so the page fills evenly at any width. */
export function SystemPage({ state }: { state: EngineState }) {
  return (
    <div className="metric-grid">
      <CpuCard state={state} />
      <MemoryCard state={state} />
      <DiskCard state={state} />
      <NetworkCard state={state} />
      <ProcessesCard state={state} />
      <StatusCard state={state} />
      <BluetoothCard state={state} />
    </div>
  );
}
