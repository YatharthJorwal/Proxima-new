/**
 * Preload script — the ONLY bridge between the untrusted-by-default
 * renderer (index.html/renderer.js) and the main process. With
 * contextIsolation on and nodeIntegration off (see main.ts), the renderer
 * has no Node/Electron access at all except what's explicitly exposed
 * here via contextBridge.
 *
 * Deliberately narrow: the renderer can listen to proxy:* events (via
 * `on`), and can submit typed text (via `submitText`) — that's it. No
 * generic "invoke any channel" passthrough, no filesystem/process access.
 * submitText goes out over ipcRenderer.send to a single fixed channel;
 * main.ts (see wireRendererCommands) is what actually validates and acts
 * on it, so preload's job here is just "don't expose more than this one
 * verb."
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
  "reply",
  "speaking",
  "cancelled",
  "idle",
  "error",
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
});
