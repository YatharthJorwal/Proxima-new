import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineState } from "../bridge/engineState";
import type { BtAction, BtDevice } from "../bridge/types";
import { matchesQuery, otherDevices } from "../lib/devices";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon, IconName } from "./icons";
import { Panel } from "./Panel";

const POLL_MS = 30_000;
const iconFor = (kind: string, name = ""): IconName => (/audio|speaker|headphone|headset|mic/i.test(kind + name) ? "audio" : /camera|image/i.test(kind) ? "camera" : /bluetooth/i.test(kind) ? "bluetooth" : "device");

type Notice = { ok: boolean; text: string } | null;
interface ScanState { phase: "scanning" | "done"; results: BtDevice[]; error?: string }

/**
 * "Bluetooth & devices", modelled on the Windows Settings page: paired
 * devices with Connect / Disconnect / Remove, a search box, and Add device
 * (scan and pair). Windows does the work; this card only asks and reports.
 */
export function BluetoothCard({ state }: { state: EngineState }) {
  const [paired, setPaired] = useState<BtDevice[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [removing, setRemoving] = useState<BtDevice | null>(null);
  const idle = useRef(true);
  idle.current = !busyId && !scan && !loading;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.proxy?.btList();
      if (!r) { setError("Bluetooth management is unavailable."); return; }
      if (r.ok) { setPaired(r.devices); setError(""); } else setError(r.error);
    } catch { setError("Bluetooth management is unavailable."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => { if (!document.hidden && idle.current) void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (action: BtAction, d: BtDevice, doneText?: string) => {
    setBusyId(d.id); setNotice(null);
    try {
      const r = await window.proxy?.btAction(action, d.id);
      if (!r) setNotice({ ok: false, text: "Bluetooth management is unavailable." });
      else if (r.ok) { setNotice({ ok: true, text: doneText ?? r.message }); if (action === "pair") setScan((s) => (s ? { ...s, results: s.results.filter((x) => x.id !== d.id) } : s)); }
      else setNotice({ ok: false, text: r.error });
    } catch { setNotice({ ok: false, text: "Windows did not answer." }); }
    finally { setBusyId(null); await refresh(); }
  };

  const startScan = async () => {
    setNotice(null);
    setScan({ phase: "scanning", results: [] });
    try {
      const r = await window.proxy?.btScan();
      if (!r) setScan({ phase: "done", results: [], error: "Bluetooth management is unavailable." });
      else if (r.ok) setScan({ phase: "done", results: r.devices });
      else setScan({ phase: "done", results: [], error: r.error });
    } catch { setScan({ phase: "done", results: [], error: "Windows did not answer." }); }
  };

  const shown = useMemo(() => (paired ?? []).filter((d) => matchesQuery(d.name, query)), [paired, query]);
  const others = useMemo(() => otherDevices(state.devices, paired).filter((d) => matchesQuery(d.name, query)), [state.devices, paired, query]);
  const total = (paired?.length ?? 0) + others.length;

  const row = (d: BtDevice) => {
    const busy = busyId === d.id;
    return (
      <li key={d.id} className="bt-row">
        <span className="device-icon"><Icon name={iconFor("Bluetooth", d.name)} size={20} /></span>
        <span className="device-main">
          <span className="device-name" title={d.name}>{d.name}</span>
          <span className="device-kind">{busy ? "Working…" : d.connected ? "Connected" : "Paired, not connected"}{d.kind === "le" ? " · Low Energy" : ""}</span>
        </span>
        <span className="bt-actions">
          {d.kind === "classic" && (
            <button type="button" className="btn btn-small" disabled={!!busyId} onClick={() => void act(d.connected ? "disconnect" : "connect", d)}>{d.connected ? "Disconnect" : "Connect"}</button>
          )}
          <button type="button" className="icon-btn danger" aria-label={`Remove ${d.name}`} title="Remove device" disabled={!!busyId} onClick={() => setRemoving(d)}><Icon name="trash" size={16} /></button>
        </span>
      </li>
    );
  };

  return (
    <Panel title="Bluetooth & devices" className="metric bt-card"
      status={total ? <span className="chip">{total}</span> : undefined}
      actions={
        <>
          <button type="button" className="btn btn-small btn-primary" disabled={!!scan || !!busyId} onClick={() => void startScan()}>Add device</button>
          <button type="button" className="icon-btn" aria-label="Refresh devices" title="Refresh" disabled={loading || !!busyId} onClick={() => void refresh()}><Icon name="refresh" size={16} /></button>
        </>}>
      <label className="sr-only" htmlFor="bt-search">Search devices</label>
      <input id="bt-search" className="text-field bt-search" type="search" value={query} placeholder="Search devices" onChange={(e) => setQuery(e.target.value)} />
      {notice && (
        <p className={`bt-notice ${notice.ok ? "ok" : "bad"}`} role="status">
          <span>{notice.text}</span>
          <button type="button" className="link-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}
      <div className="bt-scroll">
        {scan ? (
          <section className="bt-scan" aria-live="polite">
            <header className="bt-section-head">
              <h4>{scan.phase === "scanning" ? "Looking for nearby devices…" : "Nearby devices"}</h4>
              <button type="button" className="link-btn" onClick={() => setScan(null)}>{scan.phase === "scanning" ? "Hide" : "Done"}</button>
            </header>
            {scan.phase === "scanning" && <p className="note"><i className="step-spinner inline-spinner" aria-hidden="true" /> This takes about 10 seconds. Put the device in pairing mode and keep it close.</p>}
            {scan.error && <p className="bt-notice bad" role="alert">{scan.error}</p>}
            {scan.phase === "done" && !scan.error && scan.results.length === 0 && <p className="empty">No new devices found. Make sure it is in pairing mode, then try again.</p>}
            <ul className="bt-list">
              {scan.results.map((d) => (
                <li key={d.id} className="bt-row">
                  <span className="device-icon"><Icon name="bluetooth" size={20} /></span>
                  <span className="device-main"><span className="device-name" title={d.name}>{d.name}</span><span className="device-kind">Ready to pair{d.kind === "le" ? " · Low Energy" : ""}</span></span>
                  <span className="bt-actions"><button type="button" className="btn btn-small btn-primary" disabled={!!busyId} onClick={() => void act("pair", d)}>{busyId === d.id ? "Pairing…" : "Pair"}</button></span>
                </li>
              ))}
            </ul>
            <div className="row wrap">
              {scan.phase === "done" && <button type="button" className="btn btn-small" onClick={() => void startScan()}>Scan again</button>}
              <button type="button" className="btn btn-small" onClick={() => window.proxy?.openBluetoothSettings()}>Open Windows Bluetooth settings</button>
            </div>
          </section>
        ) : (
          <>
            {error && (
              <div className="bt-notice bad" role="alert">
                <span>{error}</span>
                <button type="button" className="link-btn" onClick={() => window.proxy?.openBluetoothSettings()}>Open Windows Bluetooth settings</button>
              </div>
            )}
            {paired === null && !error && <p className="empty">Asking Windows for your Bluetooth devices…</p>}
            {paired !== null && (
              <section>
                <header className="bt-section-head"><h4>Paired</h4><span className="note">{shown.length}</span></header>
                {shown.length ? <ul className="bt-list">{shown.map(row)}</ul> : <p className="empty">{query ? "No paired device matches your search." : "No paired Bluetooth devices."}</p>}
              </section>
            )}
            {others.length > 0 && (
              <section>
                <header className="bt-section-head"><h4>Other devices</h4><span className="note">{others.length}</span></header>
                <ul className="bt-list">
                  {others.map((d, i) => (
                    <li key={`${d.name}-${i}`} className="bt-row">
                      <span className="device-icon"><Icon name={iconFor(d.kind, d.name)} size={20} /></span>
                      <span className="device-main"><span className="device-name" title={d.name}>{d.name}</span><span className="device-kind">{d.kind}</span></span>
                      <span className="bt-actions"><span className={`status-pill ${d.status === "OK" ? "ok" : "warn"}`} title={`Windows status: ${d.status}`}>{d.status === "OK" ? "Connected" : d.status}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {removing && (
        <ConfirmDialog message={`Remove “${removing.name}”? You will need to pair it again to use it.`} confirmLabel="Remove device"
          onResult={(ok) => { const d = removing; setRemoving(null); if (ok && d) void act("remove", d); }} />
      )}
    </Panel>
  );
}
