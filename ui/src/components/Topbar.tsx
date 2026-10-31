import type { EngineState } from "../bridge/engineState";
import { useClock } from "../bridge/store";
import { useGaze } from "../vision/gazeStore";
import { ATTENTION_LABEL } from "./EyeTrackingCard";
import { Icon, Logo } from "./icons";

export function Topbar({ state, onToggleNav, navOpen, onSettings }: { state: EngineState; onToggleNav: () => void; navOpen: boolean; onSettings: () => void }) {
  const clock = useClock();
  const gaze = useGaze();
  const a = state.activation;
  const clap = a?.listening ? "Double-clap: listening" : a?.paused ? "Double-clap: paused" : a?.enabled ? "Double-clap: unavailable" : "Double-clap: off";
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label="Toggle navigation labels" aria-expanded={navOpen} onClick={onToggleNav}><Icon name="menu" /></button>
      <div className="brand"><Logo /><span>PROXIMA</span></div>
      <div className="topbar-right">
        {/* Shown whenever the camera is being used for eye tracking, so it is never running unseen. */}
        {gaze.phase === "on" && <span className="chip chip-live" title="The webcam is being used for eye tracking. Turn it off on the Camera page."><Icon name="eye" size={13} />Eye tracking · {ATTENTION_LABEL[gaze.attention]}</span>}
        {state.hotkey && <span className="chip">Hotkey {state.hotkey}</span>}
        <span className={`chip ${a?.listening ? "chip-live" : ""}`}>{clap}</span>
        <time className="clock num">{clock}</time>
        <button type="button" className="icon-btn" aria-label="Open settings" onClick={onSettings}><Icon name="settings" /></button>
      </div>
    </header>
  );
}
