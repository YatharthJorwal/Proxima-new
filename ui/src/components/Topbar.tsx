import type { EngineState } from "../bridge/engineState";
import { useClock } from "../bridge/store";
import { Icon, Logo } from "./icons";

export function Topbar({ state, onToggleNav, navOpen, onSettings }: { state: EngineState; onToggleNav: () => void; navOpen: boolean; onSettings: () => void }) {
  const clock = useClock();
  const a = state.activation;
  const clap = a?.listening ? "Double-clap: listening" : a?.paused ? "Double-clap: paused" : a?.enabled ? "Double-clap: unavailable" : "Double-clap: off";
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Toggle navigation labels" aria-expanded={navOpen} onClick={onToggleNav}><Icon name="menu" /></button>
      <div className="brand"><Logo /><span>PROXIMA</span></div>
      <div className="topbar-right">
        {state.hotkey && <span className="chip">Hotkey {state.hotkey}</span>}
        <span className={`chip ${a?.listening ? "chip-live" : ""}`}>{clap}</span>
        <time className="clock num">{clock}</time>
        <button type="button" className="icon-btn" aria-label="Open settings" onClick={onSettings}><Icon name="settings" /></button>
      </div>
    </header>
  );
}
