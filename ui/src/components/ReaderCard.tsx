import { useEffect, useRef, useState } from "react";
import type { WebviewElement } from "../webview";
import { Icon } from "./icons";
import { Panel } from "./Panel";

export const READER_PARTITION = "reader";

/**
 * A real browser view (Electron <webview>) for the page behind a headline.
 * main.ts only lets it show https pages, in a throwaway session with every
 * permission denied and no access to Proxima's own API.
 */
export function ReaderCard({ url, title, onClose }: { url: string | null; title: string; onClose: () => void }) {
  const ref = useRef<WebviewElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(url ?? "");
  const [pageTitle, setPageTitle] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = ref.current;
    if (!w) return;
    setCurrent(url ?? ""); setPageTitle(""); setError(""); setReady(false);
    const on = <E extends Event>(name: string, fn: (e: E) => void) => { w.addEventListener(name, fn as EventListener); return () => w.removeEventListener(name, fn as EventListener); };
    const offs = [
      on("dom-ready", () => setReady(true)),
      on("did-start-loading", () => { setLoading(true); setError(""); }),
      on("did-stop-loading", () => setLoading(false)),
      on<Event & { url: string }>("did-navigate", (e) => setCurrent(e.url)),
      on<Event & { url: string }>("did-navigate-in-page", (e) => setCurrent(e.url)),
      on<Event & { title: string }>("page-title-updated", (e) => setPageTitle(e.title)),
      on<Event & { errorCode: number; errorDescription: string; isMainFrame: boolean }>("did-fail-load", (e) => {
        if (e.isMainFrame && e.errorCode !== -3) setError(`This page could not be loaded (${e.errorDescription || e.errorCode}).`); // -3 = cancelled by a redirect
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [url]);

  const call = (fn: (w: WebviewElement) => void) => { const w = ref.current; if (w && ready) { try { fn(w); } catch { /* guest not attached yet */ } } };

  return (
    <Panel title="Reader" className="reader-card"
      status={loading ? <span className="chip chip-live">Loading</span> : undefined}
      actions={url ? (
        <>
          <button type="button" className="icon-btn" aria-label="Back" title="Back" disabled={!ready} onClick={() => call((w) => { if (w.canGoBack()) w.goBack(); })}><span aria-hidden="true">←</span></button>
          <button type="button" className="icon-btn" aria-label={loading ? "Stop" : "Reload"} title={loading ? "Stop" : "Reload"} disabled={!ready} onClick={() => call((w) => (loading ? w.stop() : w.reload()))}><Icon name={loading ? "x" : "refresh"} size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Open in my browser" title="Open in my browser" onClick={() => window.proxy?.openExternal(current || url)}><Icon name="external" size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Close reader" title="Close" onClick={onClose}><Icon name="x" size={16} /></button>
        </>
      ) : undefined}>
      {url ? (
        <div className="reader-body">
          <p className="reader-url" title={current}>{pageTitle || title || current}<span>{current}</span></p>
          <div className="reader-frame">
            <webview ref={ref as never} src={url} partition={READER_PARTITION} className="reader-view" />
            {error && <p className="reader-error" role="alert">{error}</p>}
          </div>
        </div>
      ) : (
        <p className="empty reader-empty">Pick a headline to read the full page here. It opens in a private session: no cookies are kept, and the page cannot use your camera, microphone or location.</p>
      )}
    </Panel>
  );
}
