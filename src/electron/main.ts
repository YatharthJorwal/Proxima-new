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
 *      triggering no longer requires focusing a terminal at all. As of
 *      Milestone 9 step 6, a second press while Proxy is busy cancels
 *      the in-flight orchestrator run instead of being ignored — see
 *      ProxyEngine.cancel()'s docs in core/engine.ts.
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
 * A fourth job as of Milestone 7 (CV): allowlist the "media" permission
 * (camera) so the dashboard's Camera card can call getUserMedia() at all
 * — Electron denies permission requests by default for a file:// origin.
 * See wireCameraPermission().
 *
 * A fifth job as of Milestone 13: persist the SESSION LOG card's entries
 * (via "proxy:persist-log-entry" from the renderer) so they survive a
 * relaunch, and replay them back once at startup (see "proxy:log-history"
 * below) — closing the "everything resets" rough edge project-status.md
 * flagged for this milestone. main.ts doesn't format anything here; it
 * just relays already-formatted {kind, text} pairs the renderer already
 * rendered, straight through to core/sessionLog.ts.
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
import { getEffectiveSettings, saveSettings, SettingsMap, SETTINGS_KEYS } from "../core/settings";
import { app, BrowserWindow, globalShortcut, ipcMain, session } from "electron";
import * as path from "path";
import { ProxyEngine, RouteInfo } from "../core/engine";
import { appendLogEntry, loadLogHistory, clearLogHistory } from "../core/sessionLog";

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
  engine.on("listening", (info) => send("proxy:listening", info));
  engine.on("speech-start", () => send("proxy:speech-start"));
  engine.on("transcribing", () => send("proxy:transcribing"));
  engine.on("transcribed", (text) => send("proxy:transcribed", text));
  engine.on("no-speech", () => send("proxy:no-speech"));
  // Milestone 9 step 6 — orchestrator-path-only events, see
  // EngineEvents in core/engine.ts.
  engine.on("deciding", (tier) => send("proxy:deciding", tier));
  engine.on("tool-start", (name) => send("proxy:tool-start", name));
  engine.on("tool-result", (name, result) => send("proxy:tool-result", { name, result }));
  engine.on("thinking", (trace) => send("proxy:thinking", trace));
  engine.on("responding", () => send("proxy:responding"));
  engine.on("routed", (info: RouteInfo) => send("proxy:routed", info));
  engine.on("awaiting-confirmation", (info) => send("proxy:awaiting-confirmation", info));
  engine.on("reply", (text) => send("proxy:reply", text));
  engine.on("speaking", () => send("proxy:speaking"));
  engine.on("cancelled", () => send("proxy:cancelled"));
  engine.on("idle", () => send("proxy:idle"));
  engine.on("error", (err: Error) => send("proxy:error", err.message));
}

// Milestone 9 step 6: the two write-paths the renderer has into main
// (hotkey, typed text) both now double as the cancellation trigger
// CLAUDE.md's orchestrator plan calls for — a repeat trigger while busy
// stops the current run instead of being silently ignored. Typed "stop"
// is the practical stand-in for "spoken stop" specifically: recognizing
// a spoken interrupt WHILE Proxy is still mid-pipeline would need a
// second, always-on audio channel running in parallel with the main one
// — real, separate complexity that's out of scope for what CLAUDE.md
// calls "a minimal cancellation path." Everything else typed while busy
// still just disappears — that's the known, already-documented
// Milestone 14 limitation, unchanged here.
function wireRendererCommands() {
  ipcMain.on("proxy:submit-text", (_event, text) => {
    if (typeof text !== "string") return;
    const trimmed = text.trim().slice(0, MAX_TYPED_INPUT_LENGTH);
    if (!trimmed) return;
    if (engine.isBusy() && trimmed.toLowerCase() === "stop") {
      engine.cancel();
      return;
    }
    engine.runWithText(trimmed);
  });

  // Milestone 13 — fire-and-forget from the renderer's side (it's
  // already shown the entry live; persistence is a background write, not
  // something the UI waits on). Validated the same "don't trust our own
  // renderer blindly" way as submit-text above, even though it's our own
  // UI, not third-party input.
  ipcMain.on("proxy:persist-log-entry", (_event, entry) => {
    if (!entry || typeof entry.kind !== "string" || typeof entry.text !== "string") return;
    void appendLogEntry(entry.kind, entry.text);
  });

  // Backs the dashboard's "Clear" button (renderer.js) - the renderer
  // already clears its own DOM the moment the user confirms, so this
  // only needs to wipe the persisted copy; there's nothing to send back.
  ipcMain.on("proxy:clear-log", () => {
    void clearLogHistory();
  });

  // Settings modal (Milestone 13, second half). First request-response
  // pair in this file - every verb above is fire-and-forget, but the
  // modal genuinely needs the current effective values back to populate
  // its fields, so this uses ipcMain.handle/ipcRenderer.invoke instead.
  ipcMain.handle("proxy:get-settings", () => {
    return getEffectiveSettings();
  });

  // Same "don't trust our own renderer blindly" validation as every
  // other handler here - only known keys with string values ever reach
  // saveSettings(); anything else in the payload is silently dropped
  // rather than trusted through to a file write.
  ipcMain.handle("proxy:save-settings", async (_event, values) => {
    if (!values || typeof values !== "object") return { ok: false };
    const filtered: SettingsMap = {};
    for (const key of Object.keys(values)) {
      if (SETTINGS_KEYS.includes(key as (typeof SETTINGS_KEYS)[number]) && typeof values[key] === "string") {
        filtered[key as keyof SettingsMap] = values[key];
      }
    }
    try {
      await saveSettings(filtered);
      return { ok: true };
    } catch (err) {
      console.error("Failed to save settings:", err);
      return { ok: false };
    }
  });
}

// Electron denies permission requests (camera/mic/etc.) by default for a
// file:// origin — needed for the dashboard's Camera card (Milestone 7)
// to call getUserMedia() at all. Allowlist ONLY "media" (camera/mic as a
// combined permission in Electron's model — our own JS only ever
// requests { video: true }, never audio, but Electron doesn't let us
// split that finer here) and deny everything else explicitly, same
// least-privilege instinct as the rest of this app's Electron config.
function wireCameraPermission() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
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
  wireCameraPermission();

  // Bug fixed here: this used to just `await engine.init()` and send
  // "ready" immediately after. webContents.send() is fire-and-forget —
  // if the renderer's ipcRenderer.on() listener isn't attached yet, the
  // message is silently dropped, no queue, no retry. "ready" is the one
  // event that fires seconds after launch, right as the page may still
  // be loading (module script + ~2MB of vendored three.js to parse) —
  // exactly the one most likely to race and lose. Now it waits for BOTH
  // the engine and the actual page load before sending anything.
  const pageLoaded = new Promise<void>((resolve) => {
    mainWindow!.webContents.once("did-finish-load", () => resolve());
  });
  await Promise.all([engine.init(), pageLoaded]);

  // Milestone 13 — same "wait for did-finish-load first" fix "ready"
  // needed below: webContents.send() is fire-and-forget, so sending this
  // any earlier risks the exact silent-drop bug already found and fixed
  // for "ready". Sent before "ready" so history is in place before
  // anything else announces the dashboard is live.
  const history = await loadLogHistory();
  send("proxy:log-history", history);

  send("proxy:ready", { hotkey: HOTKEY });

  const registered = globalShortcut.register(HOTKEY, () => {
    // Milestone 9 step 6: pressing the hotkey again while busy cancels
    // the current run instead of the old silent no-op (runOnce() itself
    // still just emits "busy" and returns for a trigger it can't act on).
    if (engine.isBusy()) {
      engine.cancel();
    } else {
      engine.runOnce();
    }
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
