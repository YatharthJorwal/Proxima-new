/**
 * Preload script — the ONLY bridge between the untrusted-by-default
 * renderer (index.html/renderer.js) and the main process. With
 * contextIsolation on and nodeIntegration off (see main.ts), the renderer
 * has no Node/Electron access at all except what's explicitly exposed
 * here via contextBridge.
 *
 * Deliberately narrow: the renderer can listen to proxy:* events (via
 * `on`), submit typed text (via `submitText`), mirror a log line it
 * already rendered back for persistence (via `persistLogEntry`, Milestone
 * 13), clear the persisted log (via `clearLog`), and read/write the
 * Settings modal's values (via `getSettings`/`saveSettings`, Milestone
 * 13's second half) — that's it. No generic "invoke any channel"
 * passthrough, no filesystem/process access. Each verb goes out over
 * ipcRenderer.send or ipcRenderer.invoke to a single fixed channel;
 * main.ts is what actually validates and acts on it, so preload's job
 * here is just "don't expose more than these six verbs."
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Short, friendly names — this is what renderer.js actually calls
// window.proxy.on(...) with. The "proxy:" prefix is an IPC-channel-naming
// convention (keeps main.ts's ipcMain listeners visually distinct from
// other channels), applied internally below, so it never has to be typed
// out at every call site in the renderer.
//
// Bug fixed here (found via a real user report, not caught in review):
// this allowlist used to contain the prefixed names ("proxy:ready" etc.)
// while renderer.js called on("ready", ...) — CHANNELS.includes(channel)
// was always false, so `on()` returned before ever calling
// ipcRenderer.on(...). Every single subscription silently failed: no
// error, just a dashboard that never updated. Lesson: an allowlist that
// disagrees with its only caller fails exactly like this — silently, at
// every call site, with symptoms that look like ten separate bugs.
const CHANNELS = [
  "ready",
  "busy",
  // Milestone 14 bug fix — fires when typed text is accepted while busy
  // and held for after the current request finishes (see engine.ts's
  // pendingText docs), so the dashboard can show "queued" instead of
  // implying the text was lost.
  "queued",
  "listening",
  "speech-start",
  "transcribing",
  "transcribed",
  "no-speech",
  // Milestone 9 step 6 — orchestrator-path-only events.
  "deciding",
  "tool-start",
  "tool-result",
  "thinking",
  "responding",
  "routed",
  // Milestone 10 Part B — fires right after run_script asks for
  // confirmation; the resolution itself arrives via the existing
  // "routed" event (source: "confirmation") on the next turn.
  "awaiting-confirmation",
  "reply",
  "speaking",
  "cancelled",
  "idle",
  "error",
  // Milestone 13 — sent once at startup (after the page finishes
  // loading, same "wait for did-finish-load" fix as "ready" — see
  // main.ts) with the persisted session log from previous runs, so the
  // dashboard's SESSION LOG card doesn't reset to empty on every
  // relaunch.
  "log-history",
] as const;

type ProxyChannel = (typeof CHANNELS)[number];

contextBridge.exposeInMainWorld("proxy", {
  on: (channel: ProxyChannel, callback: (payload: unknown) => void) => {
    if (!CHANNELS.includes(channel)) return; // ignore anything not on the allowlist
    const ipcChannel = `proxy:${channel}`;
    const listener = (_event: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on(ipcChannel, listener);
    // Returns an unsubscribe function so the renderer can clean up if it
    // ever needs to (not required for this single-page dashboard, but
    // cheap to provide and avoids a leaked-listener footgun later).
    return () => ipcRenderer.removeListener(ipcChannel, listener);
  },
  submitText: (text: string) => {
    if (typeof text !== "string") return;
    ipcRenderer.send("proxy:submit-text", text);
  },
  // Milestone 14 — the Input box's mic icon. Same channel-per-verb
  // pattern as submitText: no payload, main.ts's triggerVoiceOrCancel()
  // is the single implementation both this and the F9 hotkey call.
  triggerVoice: () => {
    ipcRenderer.send("proxy:trigger-voice");
  },
  // Milestone 13 — the renderer already knows exactly what it's showing
  // in the SESSION LOG card (appendLog() in renderer.js) and how it's
  // worded (describeRoute() etc. live there too) - this just mirrors
  // that same {kind, text} pair to main.ts for persistence, rather than
  // having main.ts try to reconstruct the same formatting independently
  // and risk the two drifting apart.
  persistLogEntry: (kind: string, text: string) => {
    if (typeof kind !== "string" || typeof text !== "string") return;
    ipcRenderer.send("proxy:persist-log-entry", { kind, text });
  },
  // Backs the dashboard's "Clear" button - fire-and-forget, same shape
  // as persistLogEntry above. No payload needed: it's a single fixed
  // action, not something with a target to validate.
  clearLog: () => {
    ipcRenderer.send("proxy:clear-log");
  },
  // Settings modal - the first two request-response verbs here (every
  // one above is fire-and-forget). ipcRenderer.invoke already returns a
  // Promise, so these just pass it straight through.
  getSettings: () => ipcRenderer.invoke("proxy:get-settings"),
  saveSettings: (values: Record<string, string>) => ipcRenderer.invoke("proxy:save-settings", values),
});
