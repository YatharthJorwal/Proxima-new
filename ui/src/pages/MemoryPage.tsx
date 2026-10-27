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
type LogConfirm = null | { kind: "log" };

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

type FactConfirm = null
  | { kind: "all" }
  | { kind: "selected"; ids: string[] }
  | { kind: "delete-one"; fact: MemoryFact }
  | { kind: "edit-one"; fact: MemoryFact; text: string };

function FactRow({ fact, selecting, selected, onToggle, editing, draft, error, onDraft, onEdit, onCancel, onSave, onDelete }: {
  fact: MemoryFact; selecting: boolean; selected: boolean; onToggle: () => void;
  editing: boolean; draft: string; error: string; onDraft: (t: string) => void; onEdit: () => void; onCancel: () => void; onSave: () => void; onDelete: () => void;
}) {
  const body = (
    <div className="fact-main">
      {editing ? (
        <>
          <textarea className="text-area" rows={2} maxLength={MAX_FACT} value={draft} autoFocus aria-label="Edit fact"
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(); } else if (e.key === "Escape") onCancel(); }} />
          {error && <span className="field-error" role="alert">{error}</span>}
        </>
      ) : (
        <span className="fact-text"><span>{fact.text}</span>{fact.pinned && <span className="chip chip-mine" title="You wrote or edited this, so automatic pruning removes it last">yours</span>}</span>
      )}
    </div>
  );
  if (selecting) {
    return (
      <li className={`fact selectable${selected ? " selected" : ""}`}>
        <label className="fact-select">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select: ${fact.text}`} />
          {body}
        </label>
      </li>
    );
  }
  return (
    <li className={`fact${editing ? " editing" : ""}`}>
      {body}
      <div className="fact-actions">
        {editing ? (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={onSave}>Save</button>
            <button type="button" className="btn btn-small" onClick={onCancel}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-small" onClick={onEdit}>Edit</button>
            <button type="button" className="icon-btn danger" aria-label={`Delete: ${fact.text}`} title="Delete" onClick={onDelete}><Icon name="trash" size={16} /></button>
          </>
        )}
      </div>
    </li>
  );
}

function MemoryCard() {
  const [facts, setFacts] = useState<MemoryFact[] | null>(null);
  const [message, setMessage] = useState("Loading saved facts…");
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editError, setEditError] = useState("");
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState("");
  const [confirm, setConfirm] = useState<FactConfirm>(null);

  const EMPTY = "Nothing saved yet. Add a fact below, or Proxima will save durable things you tell it.";
  const apply = useCallback((r: MemoryEdit | undefined): string | null => {
    if (!r) return "Memory is unavailable.";
    if (!r.ok) return r.error;
    setFacts(r.facts); setMessage(r.facts.length ? "" : EMPTY);
    setSel((s) => new Set([...s].filter((id) => r.facts.some((f) => f.id === id))));
    return null;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await window.proxy?.getMemory();
      if (!Array.isArray(r)) { setFacts(null); setMessage(r?.error || "Saved memory is unavailable."); return; }
      setFacts(r); setMessage(r.length ? "" : EMPTY);
    } catch { setFacts(null); setMessage("Saved memory is unavailable."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const ids = useMemo(() => [...sel], [sel]);
  const all = !!facts?.length && sel.size === facts.length;
  const leaveSelecting = () => { setSelecting(false); setSel(new Set()); };
  const add = async () => {
    const err = apply(await window.proxy?.addMemory(adding));
    if (err) setAddError(err); else { setAdding(""); setAddError(""); }
  };
  const startEdit = (f: MemoryFact) => { setEditingId(f.id); setDraft(f.text); setEditError(""); };
  const stopEdit = () => { setEditingId(null); setEditError(""); };
  const requestSave = (f: MemoryFact) => {
    const text = draft.trim();
    if (text === f.text) { stopEdit(); return; }
    if (!text) { setEditError("A fact can't be empty."); return; }
    setConfirm({ kind: "edit-one", fact: f, text });
  };

  const resolve = async (ok: boolean) => {
    const c = confirm;
    setConfirm(null);
    if (!ok || !c) return;
    if (c.kind === "all") { await window.proxy?.clearMemory(); leaveSelecting(); stopEdit(); await refresh(); }
    else if (c.kind === "selected") { apply(await window.proxy?.deleteMemory(c.ids)); leaveSelecting(); }
    else if (c.kind === "delete-one") { apply(await window.proxy?.deleteMemory([c.fact.id])); }
    else {
      const err = apply(await window.proxy?.updateMemory(c.fact.id, c.text));
      if (err) setEditError(err); else stopEdit();
    }
  };
  const msg = !confirm ? "" : confirm.kind === "all" ? "Forget every saved fact? This cannot be undone."
    : confirm.kind === "selected" ? `Delete ${confirm.ids.length} selected fact${confirm.ids.length === 1 ? "" : "s"}? This cannot be undone.`
    : confirm.kind === "delete-one" ? `Delete this fact?\n\n“${confirm.fact.text}”`
    : `Change this fact?\n\nFrom: “${confirm.fact.text}”\nTo: “${confirm.text}”`;
  const label = !confirm ? "" : confirm.kind === "all" ? "Forget all" : confirm.kind === "edit-one" ? "Save change" : "Delete";

  return (
    <Panel title="Memory" className="memory-panel" status={facts ? <span className="chip">{facts.length} saved</span> : undefined}
      actions={<button type="button" className="btn btn-small" onClick={() => void refresh()}><Icon name="refresh" size={14} />Refresh</button>}>
      <p className="note">Facts kept on this computer that Proxima can recall later. Ones you write or edit are marked “yours” and are the last to be pruned.</p>
      <div className="memory-toolbar">
        <div className="row">
          {selecting ? (
            <>
              <button type="button" className="btn btn-small" onClick={leaveSelecting}>Done</button>
              <label className="check"><input type="checkbox" checked={all} disabled={!facts?.length} onChange={(e) => setSel(e.target.checked && facts ? new Set(facts.map((f) => f.id)) : new Set())} />Select all</label>
              <span className="note num">{ids.length} selected</span>
            </>
          ) : (
            <button type="button" className="btn btn-small" disabled={!facts?.length} onClick={() => { stopEdit(); setSelecting(true); }}>Select</button>
          )}
        </div>
        <div className="row">
          {selecting && <button type="button" className="btn btn-small btn-danger" disabled={!ids.length} onClick={() => setConfirm({ kind: "selected", ids })}><Icon name="trash" size={14} />Delete selected{ids.length ? ` (${ids.length})` : ""}</button>}
          <button type="button" className="btn btn-small btn-danger" disabled={!facts?.length} onClick={() => setConfirm({ kind: "all" })}>Forget all</button>
        </div>
      </div>
      {message && <p className="empty" role="status">{message}</p>}
      <ul className="facts">
        {facts?.map((f) => (
          <FactRow key={f.id} fact={f} selecting={selecting} selected={sel.has(f.id)}
            onToggle={() => setSel((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
            editing={editingId === f.id} draft={draft} error={editError}
            onDraft={(t) => { setDraft(t); setEditError(""); }} onEdit={() => startEdit(f)} onCancel={stopEdit} onSave={() => requestSave(f)}
            onDelete={() => setConfirm({ kind: "delete-one", fact: f })} />
        ))}
      </ul>
      <div className="add-fact">
        <input className="text-field" value={adding} maxLength={MAX_FACT} onChange={(e) => { setAdding(e.target.value); setAddError(""); }} placeholder="Add a fact, e.g. “I prefer metric units”" aria-label="New fact"
          onKeyDown={(e) => { if (e.key === "Enter" && adding.trim()) void add(); }} />
        <button type="button" className="btn btn-small btn-primary" disabled={!adding.trim()} onClick={() => void add()}>Add</button>
      </div>
      {addError && <span className="field-error" role="alert">{addError}</span>}
      {confirm && <ConfirmDialog message={msg} confirmLabel={label} onResult={(ok) => void resolve(ok)} />}
    </Panel>
  );
}

export function MemoryPage({ state }: { state: EngineState }) {
  const [confirm, setConfirm] = useState<LogConfirm>(null);
  return (
    <div className="memory-layout">
      <div className="stack">
        <InstructionsCard />
        <MemoryCard />
      </div>
      <Panel title="Session log" className="log-panel" actions={<button type="button" className="btn btn-small" onClick={() => setConfirm({ kind: "log" })} disabled={!state.log.length}><Icon name="trash" size={14} />Clear</button>}>
        <LogView lines={state.log} />
      </Panel>
      {confirm && <ConfirmDialog message="Clear the session log, including its saved copy? This cannot be undone." confirmLabel="Clear log" onResult={(ok) => { setConfirm(null); if (ok) clearLog(); }} />}
    </div>
  );
}
