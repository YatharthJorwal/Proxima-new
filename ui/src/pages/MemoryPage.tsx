import { useCallback, useEffect, useMemo, useState } from "react";
import type { EngineState } from "../bridge/engineState";
import { clearLog } from "../bridge/store";
import type { MemoryEdit, MemoryFact } from "../bridge/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Icon } from "../components/icons";
import { LogView } from "../components/LogView";
import { Panel } from "../components/Panel";

const MAX_INSTRUCTIONS = 2000;
const MAX_FACT = 300;
type Confirm = null | { kind: "log" } | { kind: "all" } | { kind: "selected"; ids: string[] };

function InstructionsCard() {
  const [saved, setSaved] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Loading…");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.proxy?.getInstructions().then((r) => {
      if (r.ok) { setSaved(r.text); setText(r.text); setStatus(""); } else setStatus(r.error);
      setLoaded(true);
    }).catch(() => { setStatus("Instructions are unavailable."); setLoaded(true); });
  }, []);

  const save = async (value: string) => {
    setStatus("Saving…");
    try {
      const r = await window.proxy?.setInstructions(value);
      if (r?.ok) { setSaved(r.text); setText(r.text); setStatus(r.text ? "Saved. Applies from your next message." : "Cleared."); }
      else setStatus(r?.error ?? "Could not save.");
    } catch { setStatus("Could not save."); }
  };

  return (
    <Panel title="Standing instructions" className="instructions"
      status={saved ? <span className="chip chip-live">Active</span> : <span className="chip">Empty</span>}>
      <p className="note">Written once, added to the assistant's instructions on every normal reply. For example: “Keep answers short. Call me sir.” It is not used for 3D planning or memory extraction.</p>
      <label className="sr-only" htmlFor="instructions-box">Standing instructions</label>
      <textarea id="instructions-box" className="text-area" rows={6} maxLength={MAX_INSTRUCTIONS} value={text} disabled={!loaded}
        onChange={(e) => setText(e.target.value)} placeholder="Tell Proxima how you want it to behave…" />
      <div className="row between">
        <span className="note num" role="status">{status || `${text.length} / ${MAX_INSTRUCTIONS}`}</span>
        <div className="row">
          <button type="button" className="btn btn-small" disabled={!text && !saved} onClick={() => void save("")}>Clear</button>
          <button type="button" className="btn btn-small btn-primary" disabled={text.trim() === saved} onClick={() => void save(text)}>Save</button>
        </div>
      </div>
    </Panel>
  );
}

function FactRow({ fact, selected, onSelect, onSave, onDelete }: {
  fact: MemoryFact; selected: boolean; onSelect: (on: boolean) => void; onSave: (text: string) => Promise<string | null>; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const [error, setError] = useState("");
  const commit = async () => {
    if (draft.trim() === fact.text) { setEditing(false); return; }
    const err = await onSave(draft);
    if (err) setError(err); else { setEditing(false); setError(""); }
  };
  return (
    <li className={`fact${selected ? " selected" : ""}`}>
      <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select: ${fact.text}`} />
      <div className="fact-main">
        {editing ? (
          <>
            <textarea className="text-area" rows={2} maxLength={MAX_FACT} value={draft} autoFocus aria-label="Edit fact"
              onChange={(e) => { setDraft(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void commit(); } else if (e.key === "Escape") { setEditing(false); setDraft(fact.text); setError(""); } }} />
            {error && <span className="field-error" role="alert">{error}</span>}
          </>
        ) : (
          <span className="fact-text">{fact.text}{fact.pinned && <span className="chip chip-mine" title="You wrote or edited this, so automatic pruning removes it last">yours</span>}</span>
        )}
      </div>
      <div className="fact-actions">
        {editing ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={() => void commit()}>Save</button>
            <button type="button" className="btn btn-small" onClick={() => { setEditing(false); setDraft(fact.text); setError(""); }}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-small" onClick={() => { setDraft(fact.text); setEditing(true); }}>Edit</button>
            <button type="button" className="icon-btn danger" aria-label={`Delete: ${fact.text}`} title="Delete" onClick={onDelete}><Icon name="trash" size={16} /></button>
          </>
        )}
      </div>
    </li>
  );
}

function MemoryCard({ onConfirm, version }: { onConfirm: (c: Confirm) => void; version: number }) {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [message, setMessage] = useState("Loading saved facts…");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState("");

  const apply = useCallback((r: MemoryEdit | undefined): string | null => {
    if (!r) return "Memory is unavailable.";
    if (!r.ok) return r.error;
    setFacts(r.facts); setMessage(r.facts.length ? "" : "Nothing saved yet. Add a fact below, or Proxima will save durable things you tell it.");
    setSel((s) => new Set([...s].filter((id) => r.facts.some((f) => f.id === id))));
    return null;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await window.proxy?.getMemory();
      if (!Array.isArray(r)) { setFacts(null); setMessage(r?.error || "Saved memory is unavailable."); return; }
      setFacts(r); setMessage(r.length ? "" : "Nothing saved yet. Add a fact below, or Proxima will save durable things you tell it.");
    } catch { setFacts(null); setMessage("Saved memory is unavailable."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, version]);

  const ids = useMemo(() => [...sel], [sel]);
  const all = !!facts?.length && sel.size === facts.length;
  const add = async () => {
    const err = apply(await window.proxy?.addMemory(adding));
    if (err) setAddError(err); else { setAdding(""); setAddError(""); }
  };

  return (
    <Panel title="Memory" className="memory-panel" status={facts ? <span className="chip">{facts.length} saved</span> : undefined}
      actions={<button type="button" className="btn btn-small" onClick={() => void refresh()}><Icon name="refresh" size={14} />Refresh</button>}>
      <p className="note">Facts kept on this computer that Proxima can recall later. Edit or delete any of them. Ones you write or edit are marked “yours” and are the last to be pruned.</p>
      <div className="row between memory-toolbar">
        <label className="check"><input type="checkbox" checked={all} disabled={!facts?.length} onChange={(e) => setSel(e.target.checked && facts ? new Set(facts.map((f) => f.id)) : new Set())} />Select all</label>
        <div className="row">
          <button type="button" className="btn btn-small btn-danger" disabled={!ids.length} onClick={() => onConfirm({ kind: "selected", ids })}><Icon name="trash" size={14} />Delete selected{ids.length ? ` (${ids.length})` : ""}</button>
          <button type="button" className="btn btn-small btn-danger" disabled={!facts?.length} onClick={() => onConfirm({ kind: "all" })}>Forget all</button>
        </div>
      </div>
      {message && <p className="empty" role="status">{message}</p>}
      <ul className="facts">
        {facts?.map((f) => (
          <FactRow key={f.id} fact={f} selected={sel.has(f.id)}
            onSelect={(on) => setSel((s) => { const n = new Set(s); if (on) n.add(f.id); else n.delete(f.id); return n; })}
            onSave={async (text) => apply(await window.proxy?.updateMemory(f.id, text))}
            onDelete={() => void window.proxy?.deleteMemory([f.id]).then(apply)} />
        ))}
      </ul>
      <div className="add-fact">
        <input className="text-field" value={adding} maxLength={MAX_FACT} onChange={(e) => { setAdding(e.target.value); setAddError(""); }} placeholder="Add a fact, e.g. “I prefer metric units”" aria-label="New fact"
          onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) void add(); }} />
        <button type="button" className="btn btn-small btn-primary" disabled={!adding.trim()} onClick={() => void add()}>Add</button>
      </div>
      {addError && <span className="field-error" role="alert">{addError}</span>}
    </Panel>
  );
}

export function MemoryPage({ state }: { state: EngineState }) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [version, setVersion] = useState(0);

  const resolve = async (ok: boolean) => {
    const c = confirm;
    setConfirm(null);
    if (!ok || !c) return;
    if (c.kind === "log") clearLog();
    else if (c.kind === "all") { await window.proxy?.clearMemory(); setVersion((v) => v + 1); }
    else { await window.proxy?.deleteMemory(c.ids); setVersion((v) => v + 1); }
  };
  const msg = !confirm ? "" : confirm.kind === "log" ? "Clear the session log, including its saved copy? This cannot be undone."
    : confirm.kind === "all" ? "Forget every saved fact? This cannot be undone."
    : `Delete ${confirm.ids.length} selected fact${confirm.ids.length === 1 ? "" : "s"}? This cannot be undone.`;

  return (
    <div className="memory-layout">
      <div className="stack">
        <InstructionsCard />
        <MemoryCard onConfirm={setConfirm} version={version} />
      </div>
      <Panel title="Session log" className="log-panel" actions={<button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: "log" })} disabled={!state.log.length}><Icon name="trash" size={14} />Clear</button>}>
        <LogView lines={state.log} />
      </Panel>
      {confirm && <ConfirmDialog message={msg} confirmLabel={confirm.kind === "log" ? "Clear log" : confirm.kind === "all" ? "Forget all" : "Delete"} onResult={(ok) => void resolve(ok)} />}
    </div>
  );
}
