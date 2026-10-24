import type { EngineState } from "../bridge/engineState";
import { Icon, IconName } from "./icons";
import { Panel } from "./Panel";

function iconFor(kind: string): IconName {
  const k = kind.toLowerCase();
  if (k.includes("bluetooth")) return "bluetooth";
  if (k.includes("audio") || k.includes("media") || k.includes("sound")) return "audio";
  if (k.includes("camera") || k.includes("image")) return "camera";
  return "device";
}

export function DevicesCard({ state, limit, onViewAll }: { state: EngineState; limit?: number; onViewAll?: () => void }) {
  const d = state.devices;
  let body;
  if (d === undefined) body = <p className="empty">Waiting for the Windows device inventory…</p>;
  else if (d === null) body = <p className="empty">Windows device inventory unavailable.</p>;
  else if (d.length === 0) body = <p className="empty">No Bluetooth or audio devices detected.</p>;
  else {
    const rows = limit ? d.slice(0, limit) : d;
    body = (
      <ul className="devices">
        {rows.map((dev, i) => (
          <li key={`${dev.name}-${i}`}>
            <span className="device-icon"><Icon name={iconFor(dev.kind)} size={20} /></span>
            <span className="device-main"><span className="device-name">{dev.name}</span><span className="device-kind">{dev.kind}</span></span>
            <span className={`status-pill ${dev.status === "OK" ? "ok" : "warn"}`} title={`Windows status: ${dev.status}`}>{dev.status === "OK" ? "Connected" : dev.status}</span>
          </li>
        ))}
        {limit && d.length > limit && <li className="more">+{d.length - limit} more</li>}
      </ul>
    );
  }
  return (
    <Panel title="Connected devices" className="devices-card" actions={onViewAll ? <button type="button" className="link-btn" onClick={onViewAll}>View all</button> : undefined}>
      {body}
    </Panel>
  );
}
