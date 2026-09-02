/**
 * Volume command — "turn the volume up/down", "mute", "unmute".
 *
 * Windows doesn't expose absolute volume ("set volume to 50%") through
 * plain PowerShell without installing an extra module (e.g.
 * AudioDeviceCmdlets). Sticking with the no-extra-install philosophy for
 * now, this simulates the same hardware volume-up/down/mute keys a
 * keyboard would send, via a bit of inline C# (Add-Type + user32.dll's
 * keybd_event) — no separate binary to install or manage, just standard
 * .NET compiled on the fly. keybd_event is the older/simpler of the two
 * Win32 APIs for this (Microsoft's newer recommendation is SendInput), but
 * it's a single function call with no struct marshaling, which keeps this
 * file simple — fine for synthetic key presses like this.
 *
 * Trade-off: this only gives *relative* control (nudge up, nudge down,
 * toggle mute), not an exact percentage. Each simulated key press changes
 * system volume by whatever step Windows is configured to use (~2% by
 * default) — we send several presses per command so a single "turn it up"
 * produces an audible change. If precise "set to X%" control is needed
 * later, that's the point where we'd bring in the Core Audio API instead.
 *
 * Also note: mute/unmute are the *same* physical key (it toggles). We
 * don't track current mute state, so "mute" and "unmute" both just press
 * that key — if state and command ever mismatch, saying it again fixes it.
 */

import { spawn } from "child_process";
import { CommandHandler } from "./types";

// How many simulated key presses per "up"/"down" command. Windows' default
// volume step is small (~2%), so one press barely registers — a handful
// feels like an actual response to "turn it up".
const PRESSES_PER_STEP = 5;

const UP_PATTERN =
  /\bvolume\s+up\b|\bturn\s+(the\s+)?volume\s+up\b|\bincrease\s+(the\s+)?volume\b|\braise\s+(the\s+)?volume\b/i;
const DOWN_PATTERN =
  /\bvolume\s+down\b|\bturn\s+(the\s+)?volume\s+down\b|\bdecrease\s+(the\s+)?volume\b|\blower\s+(the\s+)?volume\b/i;
const MUTE_PATTERN = /\bmute\b/i;
const UNMUTE_PATTERN = /\bunmute\b/i;

// The C# gets compiled fresh each time PowerShell starts, which adds a bit
// of latency (roughly on top of PowerShell's own startup time). Acceptable
// for now; if it ever feels sluggish, the fix would be keeping a
// persistent automation process running instead of spawning a new
// PowerShell per command — not worth the complexity yet.
function buildScript(vkConstant: string, presses: number): string {
  return `
Add-Type -TypeDefinition '
using System;
using System.Runtime.InteropServices;
public class ProxyVolume {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    public const byte VK_VOLUME_MUTE = 0xAD;
    public const byte VK_VOLUME_DOWN = 0xAE;
    public const byte VK_VOLUME_UP = 0xAF;
}
'
for ($i = 0; $i -lt ${presses}; $i++) {
    [ProxyVolume]::keybd_event([ProxyVolume]::${vkConstant}, 0, 0, [UIntPtr]::Zero)
    [ProxyVolume]::keybd_event([ProxyVolume]::${vkConstant}, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
}
`.trim();
}

function runScript(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-WindowStyle", "Hidden", "-Command", script]);

    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`volume script exited with code ${code}`));
    });
  });
}

export type VolumeDirection = "up" | "down" | "mute" | "unmute";

/**
 * Does the actual work of adjusting volume, given a direction. Shared by
 * the regex handler below and the LLM tool-call path (originally
 * commands/intentRouter.ts as of Milestone 5; deleted once Milestone 9's
 * orchestrator.ts/tools.ts replaced it — see decisions.md).
 */
export async function executeVolume(direction: VolumeDirection): Promise<string> {
  let vk: string;
  let presses = 1;
  let reply: string;

  switch (direction) {
    case "mute":
    case "unmute":
      vk = "VK_VOLUME_MUTE";
      reply = "Toggling mute.";
      break;
    case "up":
      vk = "VK_VOLUME_UP";
      presses = PRESSES_PER_STEP;
      reply = "Turning the volume up.";
      break;
    case "down":
      vk = "VK_VOLUME_DOWN";
      presses = PRESSES_PER_STEP;
      reply = "Turning the volume down.";
      break;
  }

  try {
    await runScript(buildScript(vk, presses));
    return reply;
  } catch (err) {
    console.error("Failed to adjust volume:", err);
    return "I tried to change the volume but something went wrong.";
  }
}

export const tryHandleVolume: CommandHandler = async (text) => {
  let direction: VolumeDirection | null = null;

  if (UNMUTE_PATTERN.test(text)) direction = "unmute";
  else if (MUTE_PATTERN.test(text)) direction = "mute";
  else if (UP_PATTERN.test(text)) direction = "up";
  else if (DOWN_PATTERN.test(text)) direction = "down";

  if (!direction) return null;
  return executeVolume(direction);
};