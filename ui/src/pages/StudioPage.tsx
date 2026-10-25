import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StudioTray } from "../components/StudioTray";
import { Icon, IconName } from "../components/icons";
import { Axis, Draft, getStudio, GizmoMode, NavMode, StudioScene, StudioSnapshot } from "../studio/StudioScene";
import { StlUnit } from "../studio/analysis";
import { SHAPES } from "../studio/primitives";

const AXES = ["X", "Y", "Z"] as const;

/** A number box that doesn't fight you while you type: it only follows the scene when it isn't focused. */
function NumberField({ label, value, step = 0.1, digits = 2, min, max, onCommit }: {
  label: string; value: number; step?: number; digits?: number; min?: number; max?: number; onCommit: (v: number) => void;
}) {
  const format = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : "");
  const [text, setText] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(format(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" step={step} min={min} max={max} value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(format(value)); }}
        onChange={(e) => { setText(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onCommit(n); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

function ToolButton({ icon, label, hint, active, danger, disabled, onClick }: {
  icon: IconName; label: string; hint?: string; active?: boolean; danger?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={`tool-btn${active ? " active" : ""}${danger ? " danger" : ""}`} aria-pressed={active} disabled={disabled} title={hint ? `${label} (${hint})` : label} onClick={onClick}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}

/** Press-and-drag handle for trackpads: no middle mouse needed. */
function NavHandle({ mode, icon, label, studio }: { mode: NavMode; icon: IconName; label: string; studio: StudioScene | null }) {
  const last = useRef<{ x: number; y: number } | null>(null);
  const down = (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = { x: e.clientX, y: e.clientY }; };
  const move = (e: ReactPointerEvent) => {
    if (!last.current || !studio) return;
    studio.navigate(mode, e.clientX - last.current.x, e.clientY - last.current.y);
    last.current = { x: e.clientX, y: e.clientY };
  };
  const up = () => { last.current = null; };
  return (
    <button type="button" className="nav-handle" title={`${label} (drag)`} aria-label={`${label}: press and drag`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <Icon name={icon} size={18} />
    </button>
  );
}

const GIZMOS: { mode: GizmoMode; icon: IconName; label: string; key: string }[] = [
  { mode: "translate", icon: "move", label: "Move", key: "G" },
  { mode: "rotate", icon: "rotate", label: "Rotate", key: "R" },
  { mode: "scale", icon: "scale", label: "Scale", key: "S" },
];

export function StudioPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [studio, setStudio] = useState<StudioScene | null>(null);
  const [snap, setSnap] = useState<StudioSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [unit, setUnit] = useState<StlUnit>("mm");
  const [metrics, setMetrics] = useState("");
  const [analysis, setAnalysis] = useState("");
    const [confirmClear, setConfirmClear] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let s: StudioScene;
    try { s = getStudio(); } catch { setError("The 3D view could not start (WebGL is unavailable)."); return; }
    s.attach(host, { onChange: setSnap, onDraft: setDraft });
    setStudio(s);
    return () => { s.detach(); };
  }, []);

  const sel = snap?.selection ?? null;
  const busy = snap?.busy ?? false;
  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file && studio) await studio.importFile(file);
  };

  return (
    <div className="studio">
      <aside className="studio-tools" aria-label="Tools">
        <div className="tool-group">
          <h3>Draw</h3>
          {SHAPES.map((s) => (
            <ToolButton key={s.kind} icon={s.kind} label={s.label} hint="drag on the grid" active={snap?.tool === s.kind} onClick={() => studio?.setTool(snap?.tool === s.kind ? null : s.kind)} />
          ))}
        </div>
        <div className="tool-group">
          <h3>Transform</h3>
          {GIZMOS.map((g) => (
            <ToolButton key={g.mode} icon={g.icon} label={g.label} hint={g.key} active={snap?.gizmo === g.mode && !snap?.tool} onClick={() => studio?.setGizmoMode(g.mode)} />
          ))}
        </div>
        <div className="tool-group">
          <h3>Edit</h3>
          <ToolButton icon="trash" label="Delete" hint="Del" danger disabled={!sel} onClick={() => studio?.deleteSelected()} />
          <ToolButton icon="undo" label="Undo" hint="Ctrl+Z" disabled={!snap?.canUndo} onClick={() => studio?.undo()} />
          <ToolButton icon="rotate" label="Redo" hint="Ctrl+Shift+Z" disabled={!snap?.canRedo} onClick={() => studio?.redo()} />
          <ToolButton icon="union" label="Union" disabled={!snap?.hasSecondary || busy} onClick={() => studio?.combine("union")} />
          <ToolButton icon="subtract" label="Subtract" disabled={!snap?.hasSecondary || busy} onClick={() => studio?.combine("subtract")} />
        </div>
      </aside>

      <section className={`studio-stage${trayOpen ? " tray-open" : ""}`}>
        <div className="studio-viewport" ref={hostRef} />
        {error && <p className="studio-error empty">{error}</p>}

        <div className="studio-hint" role="status">{snap?.status}</div>
        {draft && <div className="studio-draft" style={{ left: draft.x + 16, top: draft.y + 16 }}>{draft.text}</div>}

        <div className="studio-nav" aria-label="View controls">
          <NavHandle mode="orbit" icon="orbit" label="Orbit" studio={studio} />
          <NavHandle mode="pan" icon="pan" label="Pan" studio={studio} />
          <NavHandle mode="zoom" icon="zoom" label="Zoom" studio={studio} />
        </div>
        <div className="studio-corner">
          <button type="button" className="chip-btn" onClick={() => studio?.frameSelected()} title="Frame selection (F)"><Icon name="frame" size={14} />Frame</button>
          <button type="button" className="chip-btn" aria-pressed={snap?.snap} onClick={() => studio?.toggleSnap()} title="Snap to grid"><Icon name="grid" size={14} />Snap {snap?.snap ? "on" : "off"}</button>
        </div>
        <StudioTray studio={studio} snap={snap} unit={unit} open={trayOpen} onToggle={() => setTrayOpen((v) => !v)} />
        <p className="studio-keys">Middle-drag orbit · Shift+middle or right-drag pan · wheel zoom · Alt+drag orbit · click the gizmo to snap a view</p>
      </section>

      <aside className="studio-inspector" aria-label="Inspector">
        <header className="inspector-head">
          <h2 className={sel ? "cap" : ""}>{sel ? sel.kind : "Nothing selected"}</h2>
          <span className="chip">{snap?.objectCount ?? 0} object{snap?.objectCount === 1 ? "" : "s"}</span>
        </header>

        {sel ? (
          <>
            <section>
              <h3>Position</h3>
              <div className="num-row">{AXES.map((a, i) => <NumberField key={a} label={a} value={[sel.position.x, sel.position.y, sel.position.z][i]} step={0.25} min={-100} max={100} onCommit={(v) => studio?.setPosition(i as Axis, v)} />)}</div>
            </section>
            <section>
              <h3>Rotation (deg)</h3>
              <div className="num-row">{AXES.map((a, i) => <NumberField key={a} label={a} digits={1} step={5} value={[sel.rotation.x, sel.rotation.y, sel.rotation.z][i]} min={-360} max={360} onCommit={(v) => studio?.setRotation(i as Axis, v)} />)}</div>
            </section>
            <section>
              <h3>Size</h3>
              <div className="num-row">{AXES.map((a, i) => <NumberField key={a} label={a} value={[sel.dimensions.x, sel.dimensions.y, sel.dimensions.z][i]} step={0.25} min={0.01} max={1000} onCommit={(v) => studio?.setDimension(i as Axis, v)} />)}</div>
              <label className="slider-row">Uniform scale
                <input type="range" min={0.2} max={3} step={0.1} value={Math.min(3, Math.max(0.2, sel.scale.x))} onChange={(e) => studio?.setUniformScale(Number(e.target.value))} />
              </label>
              {sel.isBox && <NumberField label="Corner radius" digits={3} step={0.05} min={0.005} value={sel.cornerRadius ?? 0} onCommit={(v) => studio?.setCornerRadius(v)} />}
            </section>
            <button type="button" className="btn btn-danger wide" onClick={() => studio?.deleteSelected()}><Icon name="trash" size={16} />Delete {sel.kind}</button>
          </>
        ) : (
          <p className="note">Click an object to select it, or pick a shape on the left and drag on the grid to draw one.</p>
        )}

        <section>
          <h3>Inspect</h3>
          <div className="row wrap">
            <button type="button" className="btn btn-small" disabled={!sel} onClick={() => setMetrics(studio?.measureSelected() ?? "")}><Icon name="ruler" size={14} />Measure</button>
            <button type="button" className="btn btn-small" disabled={!snap?.objectCount || busy} onClick={async () => { setAnalysis("Sending this view to the local model…"); setAnalysis((await studio?.describePreview()) ?? ""); }}><Icon name="eye" size={14} />Describe</button>
          </div>
          {metrics && <p className="note result">{metrics}</p>}
          {analysis && <p className="note result">{analysis}</p>}
        </section>

        <section>
          <h3>File</h3>
          <div className="row wrap">
            <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}><Icon name="import" size={14} />Import STL/OBJ</button>
            <button type="button" className="btn btn-small" disabled={!snap?.objectCount} onClick={() => studio?.exportStl(unit)}><Icon name="export" size={14} />Export STL</button>
          </div>
          <label className="slider-row">1 scene unit =
            <select value={unit} onChange={(e) => setUnit(e.target.value as StlUnit)}>
              <option value="mm">1 mm</option><option value="cm">1 cm</option><option value="in">1 inch</option>
            </select>
          </label>
          <input ref={fileRef} type="file" accept=".stl,.obj,model/stl,text/plain" hidden onChange={onImport} />
          <button type="button" className="btn btn-small btn-danger" disabled={!snap?.objectCount} onClick={() => setConfirmClear(true)}>Clear workspace</button>
        </section>
      </aside>

      {confirmClear && <ConfirmDialog message="Remove every object from the workspace? This cannot be undone." confirmLabel="Clear workspace" onResult={(ok) => { setConfirmClear(false); if (ok) { studio?.clearAll(); setMetrics(""); setAnalysis(""); } }} />}
    </div>
  );
}
