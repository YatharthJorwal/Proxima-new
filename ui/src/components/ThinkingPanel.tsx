import { useEffect, useRef, useState } from "react";
import type { EngineState, Step } from "../bridge/engineState";
import { useNow } from "../bridge/store";
import { Icon } from "./icons";
import { Panel } from "./Panel";

const SMART_WORDS = ["Thinking it over", "Working the problem", "Weighing the options", "Doing the math", "Mulling it over"];
const elapsed = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)}s`;

function StepRow({ step, now, last }: { step: Step; now: number; last: boolean }) {
  const [open, setOpen] = useState(false);
  const end = step.endedAt ?? now;
  const label = step.smart && step.status === "active" ? SMART_WORDS[Math.floor((now - step.startedAt) / 1400) % SMART_WORDS.length] : step.label;
  return (
    <li className={`step step-${step.status} step-${step.kind}${last ? " step-last" : ""}`}>
      <span className="step-node" aria-hidden="true">
        {step.status === "done" ? <Icon name="check" size={11} strokeWidth={2.6} /> : step.status === "stopped" ? <Icon name="x" size={11} strokeWidth={2.6} /> : <i className="step-spinner" />}
      </span>
      <div className="step-body">
        <div className="step-label">{label}</div>
        {step.sub && <div className="step-sub">{step.sub}</div>}
        {step.trace && (
          <>
            <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide reasoning" : "Show reasoning"}
            </button>
            {open && <pre className="step-trace">{step.trace}</pre>}
          </>
        )}
      </div>
      <span className="step-time">{elapsed(end - step.startedAt)}</span>
    </li>
  );
}

export function ThinkingPanel({ state }: { state: EngineState }) {
  const active = state.steps.some((s) => s.status === "active");
  const now = useNow(active, 100);
  const endRef = useRef<HTMLLIElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [state.steps.length]);
  return (
    <Panel title="Thinking process" className="thinking" status={active ? <span className="chip chip-live">Working</span> : undefined}>
      {state.steps.length === 0 ? (
        <p className="empty">
          Nothing running. {state.hotkey ? <>Press <kbd>{state.hotkey}</kbd>, use the mic, or type below.</> : "Waiting for Proxima to start."}
        </p>
      ) : (
        <ol className="steps" aria-live="polite">
          {state.steps.map((step, i) => <StepRow key={step.id} step={step} now={now} last={i === state.steps.length - 1} />)}
          <li ref={endRef} aria-hidden="true" />
        </ol>
      )}
    </Panel>
  );
}
