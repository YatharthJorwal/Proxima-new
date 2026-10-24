import type { EngineState } from "../bridge/engineState";
import { useNow } from "../bridge/store";
import { DevicesCard } from "../components/DevicesCard";
import { MonitorCard } from "../components/MonitorCard";
import { Panel } from "../components/Panel";
import { engineLabel } from "../components/Sidebar";

function uptime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function SystemPage({ state }: { state: EngineState }) {
  const now = useNow(state.startedAt !== null, 1000);
  const e = engineLabel(state);
  const a = state.activation;
  return (
    <div className="page-grid two">
      <div className="span-all"><MonitorCard state={state} detailed /></div>
      <Panel title="Status">
        <dl className="kv">
          <div><dt>State</dt><dd><span className={`status-pill ${e.tone === "ok" ? "ok" : e.tone === "error" ? "bad" : "warn"}`}>{e.text}</span></dd></div>
          <div><dt>Hotkey</dt><dd>{state.hotkey ?? "—"}</dd></div>
          <div><dt>Uptime</dt><dd className="num">{state.startedAt ? uptime(now - state.startedAt) : "—"}</dd></div>
          <div><dt>Double-clap</dt><dd>{a?.listening ? "Listening" : a?.paused ? "Paused" : a?.enabled ? "Unavailable" : "Off"}</dd></div>
        </dl>
      </Panel>
      <DevicesCard state={state} />
    </div>
  );
}
