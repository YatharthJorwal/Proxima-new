/**
 * Window control command — "maximize", "minimize", "restore", "snap window
 * left/right".
 *
 * Acts on whatever window is currently in the foreground when the command
 * actually runs — which, because Proxy is triggered by pressing Enter in
 * this terminal, is usually the terminal itself. Practical workaround for
 * now: press Enter, then Alt-Tab (or click) to the window you want to
 * control *during* the ~4 second recording window, then speak the command —
 * by the time this script runs, your target app is back in the foreground.
 * A bit clunky, but it's a direct consequence of the Enter-key trigger (see
 * CLAUDE.md); this gets much more natural once we're on a true global
 * hotkey in the Electron dashboard phase, since you'll never need to focus
 * a terminal at all.
 *
 * Implementation: standard Win32 window APIs (GetForegroundWindow,
 * MoveWindow, ShowWindowAsync) via inline C# through Add-Type — same
 * "compile a bit of .NET on the fly, no extra binaries" approach as
 * volume.ts. Snap left/right uses the monitor's *work area* (screen minus
 * taskbar), not the raw screen size, so snapped windows don't get tucked
 * under the taskbar.
 */

import { spawn } from "child_process";
import { CommandHandler } from "./types";

export type WindowAction = "snap-left" | "snap-right" | "maximize" | "minimize" | "restore";

const SNAP_LEFT_PATTERN = /\b(snap|move)\b.*\bleft\b/i;
const SNAP_RIGHT_PATTERN = /\b(snap|move)\b.*\bright\b/i;
const MAXIMIZE_PATTERN = /\bmaximize\b/i;
const MINIMIZE_PATTERN = /\bminimize\b/i;
const RESTORE_PATTERN = /\brestore\b|\bun-?maximize\b/i;

const REPLIES: Record<WindowAction, string> = {
  "snap-left": "Snapping the window left.",
  "snap-right": "Snapping the window right.",
  maximize: "Maximizing the window.",
  minimize: "Minimizing the window.",
  restore: "Restoring the window.",
};

// Shared C# type, defined fresh for each script invocation. All four calls
// are standard Win32 user32.dll functions — nothing exotic.
const CSHARP_TYPE = `
using System;
using System.Runtime.InteropServices;
public class ProxyWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref RECT pvParam, uint fWinIni);
    public const uint SPI_GETWORKAREA = 0x0030;
    public const int SW_MINIMIZE = 6;
    public const int SW_MAXIMIZE = 3;
    public const int SW_RESTORE = 9;
}
`;

function buildScript(action: WindowAction): string {
  const snapBody = (side: "left" | "right") => `
$hwnd = [ProxyWindow]::GetForegroundWindow()
$rect = New-Object ProxyWindow+RECT
[ProxyWindow]::SystemParametersInfo([ProxyWindow]::SPI_GETWORKAREA, 0, [ref]$rect, 0) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$halfWidth = [int]($width / 2)
$x = ${side === "left" ? "$rect.Left" : "$rect.Left + $halfWidth"}
[ProxyWindow]::MoveWindow($hwnd, $x, $rect.Top, $halfWidth, $height, $true) | Out-Null
`;

  const showBody = (cmd: string) => `
$hwnd = [ProxyWindow]::GetForegroundWindow()
[ProxyWindow]::ShowWindowAsync($hwnd, [ProxyWindow]::${cmd}) | Out-Null
`;

  let body: string;
  switch (action) {
    case "snap-left":
      body = snapBody("left");
      break;
    case "snap-right":
      body = snapBody("right");
      break;
    case "maximize":
      body = showBody("SW_MAXIMIZE");
      break;
    case "minimize":
      body = showBody("SW_MINIMIZE");
      break;
    case "restore":
      body = showBody("SW_RESTORE");
      break;
  }

  return `Add-Type -TypeDefinition '${CSHARP_TYPE}'\n${body}`.trim();
}

function runScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-WindowStyle", "Hidden", "-Command", script]);

    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`window script exited with code ${code}`));
    });
  });
}

/**
 * Does the actual work of controlling the window, given an action. Shared
 * by the regex handler below and the LLM tool-call path (originally
 * commands/intentRouter.ts as of Milestone 5; that file was deleted once
 * Milestone 9's orchestrator.ts/tools.ts replaced it — see decisions.md).
 */
export async function executeWindow(action: WindowAction): Promise<string> {
  try {
    await runScript(buildScript(action));
    return REPLIES[action];
  } catch (err) {
    console.error("Failed to control window:", err);
    return "I tried to control the window but something went wrong.";
  }
}

export const tryHandleWindow: CommandHandler = async (text) => {
  let action: WindowAction | null = null;

  if (SNAP_LEFT_PATTERN.test(text)) action = "snap-left";
  else if (SNAP_RIGHT_PATTERN.test(text)) action = "snap-right";
  else if (MAXIMIZE_PATTERN.test(text)) action = "maximize";
  else if (MINIMIZE_PATTERN.test(text)) action = "minimize";
  else if (RESTORE_PATTERN.test(text)) action = "restore";

  if (!action) return null;
  return executeWindow(action);
};