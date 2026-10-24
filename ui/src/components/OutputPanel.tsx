import type { EngineState } from "../bridge/engineState";
import { Panel } from "./Panel";

export function OutputPanel({ state }: { state: EngineState }) {
  const o = state.output;
  let body;
  switch (o.mode) {
    case "reply": body = <p className="output-text">{o.text}</p>; break;
    case "error": body = <p className="output-text output-error">{o.text}</p>; break;
    case "listening": body = <p className="empty">Listening…</p>; break;
    case "thinking": body = <p className="empty">Proxima is thinking…</p>; break;
    case "nothing": body = <p className="empty">Didn’t catch anything.</p>; break;
    default: body = <p className="empty">Awaiting a request.</p>;
  }
  return (
    <Panel title="Output" className="output-panel" status={state.lastRoute ? <span className="chip" title="How the last request was handled">{state.lastRoute}</span> : undefined}>
      <div className="output-scroll" aria-live="polite">{body}</div>
    </Panel>
  );
}
