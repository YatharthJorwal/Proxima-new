import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";

type FieldType = "text" | "password" | "number" | "select";
interface Field { group: string; key: string; label: string; type: FieldType }

// Labels and grouping live here (they have no backend equivalent); the key
// names and current values come from window.proxy.getSettings(). Fields are
// grouped by `group` regardless of order, so a group never splits in two.
const FIELDS: Field[] = [
  { group: "Voice", key: "ELEVENLABS_API_KEY", label: "ElevenLabs API key", type: "password" },
  { group: "Voice", key: "ELEVENLABS_VOICE_ID", label: "ElevenLabs voice ID", type: "text" },
  { group: "Voice", key: "PIPER_EXE_PATH", label: "Piper executable path (fallback)", type: "text" },
  { group: "Voice", key: "PIPER_VOICE_PATH", label: "Piper voice path (fallback)", type: "text" },
  { group: "Speech recognition", key: "PROXY_WHISPER_CPP_EXE", label: "whisper.cpp executable path (optional)", type: "text" },
  { group: "Speech recognition", key: "PROXY_WHISPER_CPP_MODEL", label: "GGML model file path (optional)", type: "text" },
  { group: "Voice detection", key: "PROXY_DOUBLE_CLAP_ENABLED", label: "Always listen for double-clap trigger", type: "select" },
  { group: "Voice detection", key: "PROXY_DOUBLE_CLAP_THRESHOLD", label: "Double-clap sensitivity threshold", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_MS", label: "Max recording length (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_MAX_WAIT_MS", label: "Max wait for speech (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_SILENCE_MS", label: "Silence to auto-stop (ms)", type: "number" },
  { group: "Voice detection", key: "PROXY_VAD_THRESHOLD", label: "Silence threshold", type: "number" },
  { group: "Gmail", key: "GMAIL_CLIENT_ID", label: "Client ID", type: "text" },
  { group: "Gmail", key: "GMAIL_CLIENT_SECRET", label: "Client secret", type: "password" },
  { group: "Gmail", key: "GMAIL_REFRESH_TOKEN", label: "Refresh token", type: "password" },
  { group: "Market data", key: "ALPHA_VANTAGE_API_KEY", label: "Alpha Vantage API key (free tier)", type: "password" },
  { group: "Phone calls (Twilio)", key: "TWILIO_ACCOUNT_SID", label: "Account SID", type: "text" },
  { group: "Phone calls (Twilio)", key: "TWILIO_AUTH_TOKEN", label: "Auth token", type: "password" },
  { group: "Phone calls (Twilio)", key: "TWILIO_FROM_NUMBER", label: "Twilio phone number (E.164)", type: "text" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_TOKEN", label: "SMS webhook secret (Bearer token)", type: "password" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_BIND", label: "Webhook bind address (default 127.0.0.1)", type: "text" },
  { group: "iPhone integration", key: "PROXY_IPHONE_WEBHOOK_PORT", label: "Webhook port (default 8787)", type: "number" },
  { group: "iPhone integration", key: "PROXY_IPHONE_MESSAGES_FILE", label: "SMS history file path", type: "text" },
  { group: "Assistant", key: "PROXY_HOTKEY", label: "Hotkey", type: "text" },
  { group: "Assistant", key: "PROXY_START_ON_LOGIN", label: "Start Proxima when I sign in (packaged app)", type: "select" },
  { group: "Assistant", key: "PROXY_NEWS_INTERESTS", label: "News interests (comma-separated keywords)", type: "text" },
  { group: "Assistant", key: "PROXY_ORCHESTRATOR_MAX_STEPS", label: "Max tool steps per request", type: "number" },
  { group: "Assistant", key: "PROXY_SCRIPT_TIMEOUT_MS", label: "Script timeout (ms)", type: "number" },
  { group: "Browser automation", key: "PROXY_CHROME_PROFILE_DIR", label: "Chrome profile directory", type: "text" },
  { group: "Storage", key: "PROXY_WORKSPACE_DIR", label: "Workspace directory", type: "text" },
  { group: "Storage", key: "PROXY_MEMORY_FILE", label: "Memory file path", type: "text" },
  { group: "Storage", key: "PROXY_SESSION_LOG_FILE", label: "Session log file path", type: "text" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Field[]>();
    for (const f of FIELDS) map.set(f.group, [...(map.get(f.group) ?? []), f]);
    return [...map.entries()];
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    window.proxy?.getSettings().then((v) => { setValues(v ?? {}); setLoaded(true); }).catch(() => { setStatus("Could not load settings."); setLoaded(true); });
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    setStatus("Saving…");
    const out: Record<string, string> = {};
    for (const f of FIELDS) out[f.key] = values[f.key] ?? "";
    try {
      const r = await window.proxy?.saveSettings(out);
      setStatus(r?.ok ? "Saved. Restart Proxima to apply." : "Save failed. See the console.");
    } catch { setStatus("Save failed. See the console."); }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-head">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="icon-btn" ref={closeRef} aria-label="Close settings" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <p className="note">A value set here overrides your .env file. Leave a field blank and save to fall back to .env. Changes apply after restarting Proxima.</p>
        <div className="modal-body">
          {!loaded && <p className="empty">Loading…</p>}
          {loaded && groups.map(([group, fields]) => (
            <fieldset key={group} className="settings-group">
              <legend>{group}</legend>
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`s-${f.key}`}>{f.label}</label>
                  {f.type === "select" ? (
                    <select id={`s-${f.key}`} value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>
                      <option value="">Disabled</option><option value="true">Enabled</option>
                    </select>
                  ) : (
                    <input id={`s-${f.key}`} type={f.type === "password" && reveal ? "text" : f.type} value={values[f.key] ?? ""} autoComplete="off" spellCheck={false}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                  )}
                </div>
              ))}
            </fieldset>
          ))}
        </div>
        <footer className="modal-footer split">
          <label className="check"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />Show secret values</label>
          <div className="row">
            <span className="note" role="status">{status}</span>
            <button type="button" className="btn" onClick={onClose}>Close</button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={!loaded}>Save</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
