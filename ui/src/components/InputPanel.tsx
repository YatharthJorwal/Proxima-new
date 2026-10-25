import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { EngineState } from "../bridge/engineState";
import { submitText, triggerVoice } from "../bridge/store";
import { Icon } from "./icons";
import { Panel } from "./Panel";

export const INPUT_ID = "proxima-input";

export function InputPanel({ state }: { state: EngineState }) {
  const [text, setText] = useState("");
  const startSeq = useRef(state.queuedStartSeq);

  // Queued text only clears when the engine actually starts it (so a cancel keeps it for resending).
  useEffect(() => {
    if (state.queuedStartSeq !== startSeq.current) { startSeq.current = state.queuedStartSeq; setText(""); }
  }, [state.queuedStartSeq]);

  const send = () => {
    if (!text.trim() || state.queued !== null) return;
    const wasBusy = state.turnActive;
    submitText(text);
    if (!wasBusy) setText("");
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const listening = state.orb === "listening";

  return (
    <Panel title="Input" className="input-panel">
      <form onSubmit={onSubmit} className="input-form">
        <label htmlFor={INPUT_ID} className="sr-only">Type a command</label>
        <textarea id={INPUT_ID} rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={state.hotkey ? `Type a command, or press ${state.hotkey} to talk` : "Type a command"} />
        <div className="input-actions">
          <button type="button" className={`icon-btn mic${listening ? " is-on" : ""}`} aria-pressed={listening}
            aria-label={state.turnActive ? "Cancel the current request" : "Talk to Proxima"} title={state.turnActive ? "Cancel" : "Talk (same as the hotkey)"} onClick={triggerVoice}>
            <Icon name="mic" size={18} />
          </button>
          <button type="submit" className="icon-btn send" aria-label="Send" disabled={!text.trim() || state.queued !== null}>
            <Icon name="send" size={18} />
          </button>
        </div>
      </form>
      {state.queued !== null && <p className="note" role="status">Queued. It runs when the current request finishes. Type “stop” to cancel.</p>}
    </Panel>
  );
}
