import { useState } from "react";
import type { StlUnit } from "../studio/analysis";
import type { StudioScene, StudioSnapshot } from "../studio/StudioScene";
import { Icon } from "./icons";

type Tab = "ask" | "arrange" | "shape" | "objects" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "ask", label: "Ask the model" },
  { id: "arrange", label: "Arrange" },
  { id: "shape", label: "Shape" },
  { id: "objects", label: "Objects" },
  { id: "history", label: "History" },
];

const EXAMPLES = [
  "add a table with four legs",
  "make it twice as tall",
  "put six of these around a circle",
  "stack three copies going up",
  "drill a 0.4 hole through the middle",
  "mirror it across x",
];

/** A number input that keeps its own text so typing "0." doesn't get reset. */
function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: string; onChange: (v: string) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="num-field"><span>{label}</span>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
const n = (v: string, fallback = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : fallback; };

function Ask({ studio, snap, unit }: { studio: StudioScene; snap: StudioSnapshot; unit: StlUnit }) {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async () => {
    setResult(null);
    const r = await studio.describePlan(prompt, unit);
    setResult(r.ok ? { ok: true, text: `Applied: ${r.summary}` } : { ok: false, text: r.error });
  };
  return (
    <div className="tray-pane">
      <div className="row">
        <input className="text-field" value={prompt} maxLength={400} disabled={snap.busy} placeholder="Describe what to build or change…" aria-label="Ask the local model"
          onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !snap.busy && prompt.trim()) void go(); }} />
        <button type="button" className="btn btn-primary" disabled={snap.busy || !prompt.trim()} onClick={() => void go()}>{snap.busy ? "Thinking…" : "Plan and apply"}</button>
      </div>
      <div className="chips" aria-label="Examples">{EXAMPLES.map((e) => <button key={e} type="button" className="chip-btn" onClick={() => setPrompt(e)}>{e}</button>)}</div>
      {result && <p className={`note result ${result.ok ? "ok" : "bad"}`} role="status">{result.text}</p>}
      <p className="note">The model returns one plan using the tools in the other tabs (create, move, rotate, scale, duplicate, circular array, mirror, align, round corners, drill hole, union/subtract, delete). It is checked against size and count limits first, applied as a single step, and Ctrl+Z undoes all of it. It sees object numbers, kinds, positions and sizes. If it can't do something it says so and changes nothing.</p>
    </div>
  );
}

function Arrange({ studio, snap }: { studio: StudioScene; snap: StudioSnapshot }) {
  const [dupCount, setDupCount] = useState("3");
  const [dx, setDx] = useState("2"), [dy, setDy] = useState("0"), [dz, setDz] = useState("0");
  const [ringCount, setRingCount] = useState("6");
  const [cx, setCx] = useState("0"), [cz, setCz] = useState("0");
  const off = !snap.selection || snap.busy;
  return (
    <div className="tray-pane grid3">
      <section>
        <h4>Duplicate in a line</h4>
        <div className="num-row4"><Num label="Copies" value={dupCount} onChange={setDupCount} min={1} max={24} />
          <Num label="X step" value={dx} onChange={setDx} step={0.5} /><Num label="Y step" value={dy} onChange={setDy} step={0.5} /><Num label="Z step" value={dz} onChange={setDz} step={0.5} /></div>
        <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "duplicate", target: t, count: Math.round(n(dupCount, 1)), offset: { x: n(dx), y: n(dy), z: n(dz) } }), "Duplicate")}>Duplicate</button>
      </section>
      <section>
        <h4>Circular array</h4>
        <div className="num-row4"><Num label="Total" value={ringCount} onChange={setRingCount} min={2} max={36} /><Num label="Centre X" value={cx} onChange={setCx} step={0.5} /><Num label="Centre Z" value={cz} onChange={setCz} step={0.5} /></div>
        <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "circular_array", target: t, count: Math.round(n(ringCount, 2)), center: { x: n(cx), z: n(cz) } }), "Circular array")}>Spread around the centre</button>
        <p className="note">Count includes the original; copies turn around the vertical axis.</p>
      </section>
      <section>
        <h4>Mirror and align</h4>
        <div className="row wrap">
          {(["x", "y", "z"] as const).map((a) => <button key={a} type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "mirror", target: t, axis: a }), `Mirror ${a.toUpperCase()}`)}>Mirror {a.toUpperCase()}</button>)}
        </div>
        <div className="row wrap">
          <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "align", target: t, mode: "ground" }), "Drop to ground")}>Drop to ground</button>
          <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "align", target: t, mode: "center" }), "Centre on grid")}>Centre on grid</button>
          <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "align", target: t, mode: "origin" }), "Centre at origin")}>Centre at origin</button>
        </div>
        <p className="note">A mirror is a new, separate copy across the plane through the origin.</p>
      </section>
    </div>
  );
}

function Shape({ studio, snap }: { studio: StudioScene; snap: StudioSnapshot }) {
  const [radius, setRadius] = useState("0.1");
  const [dia, setDia] = useState("0.5");
  const [hx, setHx] = useState(""), [hz, setHz] = useState("");
  const off = !snap.selection || snap.busy;
  const isBox = !!snap.selection?.isBox;
  return (
    <div className="tray-pane grid3">
      <section>
        <h4>Round the corners</h4>
        <div className="num-row4"><Num label="Radius" value={radius} onChange={setRadius} step={0.05} min={0.005} /></div>
        <button type="button" className="btn btn-small" disabled={off || !isBox} onClick={() => studio.runTool((t) => ({ op: "round_corners", target: t, radius: n(radius, 0.1) }), "Round corners")}>Round corners</button>
        <p className="note">{isBox ? "Up to 45% of the shortest side." : "Select a box to use this."}</p>
      </section>
      <section>
        <h4>Drill a hole</h4>
        <div className="num-row4"><Num label="Diameter" value={dia} onChange={setDia} step={0.1} min={0.02} /><Num label="X (blank = centre)" value={hx} onChange={setHx} step={0.5} /><Num label="Z (blank = centre)" value={hz} onChange={setHz} step={0.5} /></div>
        <button type="button" className="btn btn-small" disabled={off} onClick={() => studio.runTool((t) => ({ op: "hole", target: t, diameter: n(dia, 0.5), ...(hx.trim() !== "" && { x: n(hx) }), ...(hz.trim() !== "" && { z: n(hz) }) }), "Drill hole")}>Drill straight down</button>
        <p className="note">Cuts a vertical cylinder through the whole object.</p>
      </section>
      <section>
        <h4>Combine two objects</h4>
        <p className="note">Click one object, Shift-click another (or Shift-click a row in Objects), then:</p>
        <div className="row wrap">
          <button type="button" className="btn btn-small" disabled={!snap.hasSecondary || snap.busy} onClick={() => studio.combine("union")}><Icon name="union" size={14} />Union</button>
          <button type="button" className="btn btn-small" disabled={!snap.hasSecondary || snap.busy} onClick={() => studio.combine("subtract")}><Icon name="subtract" size={14} />Subtract</button>
        </div>
      </section>
    </div>
  );
}

function Objects({ studio, snap }: { studio: StudioScene; snap: StudioSnapshot }) {
  if (!snap.objects.length) return <div className="tray-pane"><p className="empty">No objects yet. Draw one with a shape on the left.</p></div>;
  return (
    <div className="tray-pane">
      <ul className="object-list">
        {snap.objects.map((o) => (
          <li key={o.index}>
            <button type="button" className={`object-row${o.selected ? " active" : ""}${o.secondary ? " second" : ""}`} onClick={(e) => studio.selectIndex(o.index, e.shiftKey)} title="Click to select, Shift-click to add a second object">
              <span className="num">#{o.index}</span><span>{o.kind}</span>{o.selected && <span className="chip">selected</span>}{o.secondary && <span className="chip">second</span>}
            </button>
          </li>
        ))}
      </ul>
      <p className="note">These are the numbers the model uses when it says “object #2”.</p>
    </div>
  );
}

function History({ studio, snap }: { studio: StudioScene; snap: StudioSnapshot }) {
  return (
    <div className="tray-pane">
      <div className="row">
        <button type="button" className="btn btn-small" disabled={!snap.canUndo} onClick={() => studio.undo()}><Icon name="undo" size={14} />Undo{snap.undoLabel ? `: ${snap.undoLabel}` : ""}</button>
        <button type="button" className="btn btn-small" disabled={!snap.canRedo} onClick={() => studio.redo()}>Redo{snap.redoLabel ? `: ${snap.redoLabel}` : ""}</button>
      </div>
      {snap.history.length ? <ol className="history-list">{[...snap.history].reverse().map((h, i) => <li key={`${h}-${i}`}>{h}</li>)}</ol> : <p className="empty">Nothing to undo yet.</p>}
      <p className="note">Keeps the last 40 steps. Undo covers drawing, deleting, moving, resizing, booleans, imports and every model or tray edit.</p>
    </div>
  );
}

export function StudioTray({ studio, snap, unit, open, onToggle }: { studio: StudioScene | null; snap: StudioSnapshot | null; unit: StlUnit; open: boolean; onToggle: () => void }) {
  const [tab, setTab] = useState<Tab>("ask");
  return (
    <div className={`studio-tray${open ? " open" : ""}`}>
      <button type="button" className="tray-handle" aria-expanded={open} onClick={onToggle} title="Tools tray">
        <Icon name={open ? "x" : "tools"} size={14} />{open ? "Close tray" : "Tools tray"}
        {!open && snap?.busy && <span className="chip chip-live">Working</span>}
      </button>
      {open && studio && snap && (
        <div className="tray-body">
          <div className="tray-tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
          </div>
          {tab === "ask" && <Ask studio={studio} snap={snap} unit={unit} />}
          {tab === "arrange" && <Arrange studio={studio} snap={snap} />}
          {tab === "shape" && <Shape studio={studio} snap={snap} />}
          {tab === "objects" && <Objects studio={studio} snap={snap} />}
          {tab === "history" && <History studio={studio} snap={snap} />}
        </div>
      )}
    </div>
  );
}
