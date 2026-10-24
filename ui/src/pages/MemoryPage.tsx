import { useCallback, useEffect, useState } from "react";
import type { EngineState } from "../bridge/engineState";
import { clearLog } from "../bridge/store";
import type { MemoryFact } from "../bridge/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/icons";
import { LogView } from "../components/LogView";
import { Panel } from "../components/Panel";

export function MemoryPage({ state }: { state: EngineState }) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [message, setMessage] = useState("Loading saved facts…");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "memory" | "log">(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setMessage("Loading saved facts…");
    try {
      const r = await window.proxy?.getMemory();
      if (!Array.isArray(r)) { setFacts(null); setMessage(r?.error || "Saved memory is unavailable."); return; }
      setFacts(r);
      setMessage(r.length ? "" : "No saved facts yet.");
    } catch { setFacts(null); setMessage("Saved memory is unavailable."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const resolve = async (ok: boolean) => {
    const which = confirm;
    setConfirm(null);
    if (!ok) return;
    if (which === "log") { clearLog(); return; }
    setBusy(true);
    try {
      const r = await window.proxy?.clearMemory();
      if (r?.ok) await refresh(); else setMessage("Could not clear saved memory.");
    } catch { setMessage("Could not clear saved memory."); }
    finally { setBusy(false); }
  };

  return (
    <div className="page-grid two">
      <Panel title="Memory" className="memory-panel" actions={
        <>
          <button type="button" className="btn btn-small" onClick={refresh} disabled={busy}><Icon name="refresh" size={14} />Refresh</button>
          <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirm("memory")} disabled={busy || !facts?.length}>Forget all</button>
        </>}>
        <p className="note">Facts saved on this computer that Proxima may use in later conversations.</p>
        {message && <p className="empty" role="status">{message}</p>}
        <ul className="facts">{facts?.map((f) => <li key={f.id}>{f.text}</li>)}</ul>
      </Panel>
      <Panel title="Session log" className="log-panel" actions={<button type="button" className="btn btn-small" onClick={() => setConfirm("log")} disabled={!state.log.length}><Icon name="trash" size={14} />Clear</button>}>
        <LogView lines={state.log} />
      </Panel>
      {confirm && <ConfirmDialog message={confirm === "memory" ? "Forget all saved facts? This cannot be undone." : "Clear the session log, including its saved copy? This cannot be undone."}
        confirmLabel={confirm === "memory" ? "Forget all" : "Clear log"} onResult={resolve} />}
    </div>
  );
}
