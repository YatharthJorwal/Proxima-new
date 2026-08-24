/**
 * Electron main process — Milestone 6 dashboard shell.
 *
 * Two jobs:
 *   1. Own the trigger. Uses Electron's globalShortcut API (default: F9,
 *      matching the hotkey we'd originally picked for node-global-key-listener
 *      before that got flagged) — this is Proxy's first REAL global hotkey.
 *      Unlike node-global-key-listener, globalShortcut isn't a standalone
 *      background key-hook binary; it's a documented, first-party Electron
 *      API implemented via each OS's native accessibility/hotkey
 *      registration, so it isn't the kind of thing AV heuristics flag as
 *      keylogger-shaped. This also incidentally fixes the window-control
 *      focus-timing issue from Milestone 3 — you no longer have to Alt-Tab
 *      to your target app *before* the recording window starts, since
 *      triggering no longer requires focusing a terminal at all.
 *   2. Forward every ProxyEngine event to the renderer over IPC, verbatim.
 *      No summarizing, no filtering, no separate "status string" logic —
 *      the dashboard shows exactly what engine.ts emits. That's the
 *      transparency principle from CLAUDE.md applied structurally, not
 *      just as a UI style choice.
 *
 * A third job as of the visual overhaul: listen for "proxy:submit-text"
 * (the dashboard's typed Input box) and feed it into
 * engine.runWithText(). This is the ONE write-path the renderer has into
 * main — everything else it receives is read-only events. Validated here
 * (must be a non-empty string, capped length) before it ever reaches the
 * engine, same "don't trust input blindly" instinct as the rest of the
 * project, just applied to our own UI instead of a third-party one.
 *
 * contextIsolation stays on and nodeIntegration stays off (Electron
 * security defaults) — the renderer only talks to Node/Electron through
 * the narrow, explicit channels exposed in preload.ts. Not because we
 * expect untrusted content in the renderer (it's our own local HTML), but
 * because "least privilege by default" costs nothing here and is the
 * right habit for a project that's explicitly principled about not
 * blindly trusting/executing more than necessary (see the barehands
 * finding in CLAUDE.md).
 */

import "dotenv/config";
import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import * as path from "path";
import { ProxyEngine, RouteInfo } from "../core/engine";

const HOTKEY = process.env.PROXY_HOTKEY || "F9";
const MAX_TYPED_INPUT_LENGTH = 1000;

let mainWindow: BrowserWindow | null = null;
const engine = new ProxyEngine();

function send(channel: string, payload?: unknown) {
  mainWindow?.webContents.send(channel, payload);
}

// Every engine event gets its own IPC channel, forwarded as-is. This list
// intentionally mirrors EngineEvents in core/engine.ts exactly — if you add
// an event there, add the matching line here so the dashboard can't fall
// out of sync with what the engine actually does.
function wireEngineEvents() {
  engine.on("busy", () => send("proxy:busy"));
  engine.on("listening", (seconds) => send("proxy:listening", seconds));
  engine.on("transcribed", (text) => send("proxy:transcribed", text));
  engine.on("no-speech", () => send("proxy:no-speech"));
  engine.on("routed", (info: RouteInfo) => send("proxy:routed", info));
  engine.on("reply", (text) => send("proxy:reply", text));
  engine.on("speaking", () => send("proxy:speaking"));
  engine.on("idle", () => send("proxy:idle"));
  engine.on("error", (err: Error) => send("proxy:error", err.message));
}

function wireRendererCommands() {
  ipcMain.on("proxy:submit-text", (_event, text) => {
    if (typeof text !== "string") return;
    const trimmed = text.trim().slice(0, MAX_TYPED_INPUT_LENGTH);
    if (!trimmed) return;
    engine.runWithText(trimmed);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    title: "Proxima",
    autoHideMenuBar: true,
    backgroundColor: "#070a12",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(async () => {
  createWindow();
  wireEngineEvents();
  wireRendererCommands();

  await engine.init();
  send("proxy:ready", { hotkey: HOTKEY });

  const registered = globalShortcut.register(HOTKEY, () => {
    engine.runOnce();
  });

  if (!registered) {
    // Doesn't crash the app — just means the hotkey is unavailable (e.g.
    // another app already grabbed it). Surfaced in the dashboard rather
    // than silently doing nothing, so it's actually visible when it
    // happens instead of looking like Proxy is just broken.
    send("proxy:error", `Could not register global hotkey "${HOTKEY}" — it may be in use by another app.`);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
