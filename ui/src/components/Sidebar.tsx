import type { EngineState } from "../bridge/engineState";
import { Icon, IconName } from "./icons";

export type PageId = "home" | "camera" | "memory" | "system" | "tools" | "studio";

export const PAGES: { id: PageId; label: string; icon: IconName }[] = [
  { id: "home", label: "Dashboard", icon: "home" },
  { id: "camera", label: "Camera", icon: "camera" },
  { id: "memory", label: "Memory & Log", icon: "memory" },
  { id: "system", label: "System", icon: "system" },
  { id: "tools", label: "Tools", icon: "tools" },
  { id: "studio", label: "3D Studio", icon: "studio" },
];

export function engineLabel(s: EngineState): { text: string; tone: "ok" | "busy" | "error" | "wait" } {
  if (s.orb === "error") return { text: "Error", tone: "error" };
  if (!s.ready) return { text: "Starting", tone: "wait" };
  if (s.turnActive) return { text: "Working", tone: "busy" };
  return { text: "Ready", tone: "ok" };
}

export function Sidebar({ page, onPage, onSettings, state }: {
  page: PageId; onPage: (p: PageId) => void; onSettings: () => void; state: EngineState;
}) {
  const e = engineLabel(state);
  return (
    <nav className="sidebar" aria-label="Pages">
      <ul>
        {PAGES.map((p, i) => (
          <li key={p.id}>
            <button type="button" className={`nav-item${page === p.id ? " active" : ""}`} aria-current={page === p.id ? "page" : undefined}
              onClick={() => onPage(p.id)} title={`${p.label} (Alt+${i + 1})`}>
              <Icon name={p.icon} /><span className="nav-label">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <button type="button" className="nav-item" onClick={onSettings} title="Settings">
          <Icon name="settings" /><span className="nav-label">Settings</span>
        </button>
        <div className={`engine-tile tone-${e.tone}`} role="status">
          <span className="engine-title">Engine</span>
          <span className="engine-value"><i className="dot" />{e.text}</span>
          {state.hotkey && <span className="engine-hint">Hotkey {state.hotkey}</span>}
        </div>
      </div>
    </nav>
  );
}
