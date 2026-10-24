import type { EngineState } from "../bridge/engineState";
import { CameraPreview } from "../components/CameraPreview";
import { DevicesCard } from "../components/DevicesCard";
import { InputPanel } from "../components/InputPanel";
import { LogView } from "../components/LogView";
import { MapCard } from "../components/MapCard";
import { MonitorCard } from "../components/MonitorCard";
import { Orb } from "../components/Orb";
import { OutputPanel } from "../components/OutputPanel";
import { Panel } from "../components/Panel";
import type { PageId } from "../components/Sidebar";
import { ThinkingPanel } from "../components/ThinkingPanel";

const ORB_LABEL = { idle: "Idle", listening: "Listening", thinking: "Thinking", speaking: "Speaking", error: "Error" } as const;

export function HomePage({ state, onPage }: { state: EngineState; onPage: (p: PageId) => void }) {
  const label = !state.ready ? "Starting" : ORB_LABEL[state.orb];
  return (
    <div className="home">
      <div className="home-col col-left">
        <ThinkingPanel state={state} />
        <InputPanel state={state} />
        <OutputPanel state={state} />
      </div>
      <div className="home-col col-center">
        <div className="orb-stage">
          <Orb state={state.orb} flashAt={state.flashAt} />
          <div className="orb-caption">
            <span className="orb-title">PROXIMA CORE</span>
            <span className={`orb-state state-${state.orb}`}><i className="dot" />{label}</span>
          </div>
        </div>
        <div className="center-row">
          <CameraPreview compact />
          <MonitorCard state={state} />
        </div>
      </div>
      <div className="home-col col-right">
        <DevicesCard state={state} limit={4} onViewAll={() => onPage("system")} />
        <Panel title="Recent activity" className="recent" actions={<button type="button" className="link-btn" onClick={() => onPage("memory")}>View all</button>}>
          <LogView lines={state.log} limit={30} empty="Requests and replies show up here." />
        </Panel>
        <MapCard compact />
      </div>
    </div>
  );
}
