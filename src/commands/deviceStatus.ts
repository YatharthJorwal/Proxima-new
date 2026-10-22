/**
 * Milestone 12 — a real Windows inventory snapshot for the dashboard's
 * connected-device card. Windows PnP's PresentOnly filter reports devices
 * currently present in the system inventory; this is not a Bluetooth radio
 * signal-strength or per-protocol connection monitor, so the UI uses the
 * honest label "Detected now" rather than inventing a connection state.
 */
import { spawn } from "child_process";

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$devices = @(Get-PnpDevice -PresentOnly | Where-Object {
  $_.Class -in @('Bluetooth', 'AudioEndpoint') -and
  $_.FriendlyName -and
  $_.FriendlyName -notmatch '^(Generic Bluetooth Adapter|Microsoft Bluetooth Enumerator|Bluetooth Device \(RFCOMM Protocol TDI\))$'
} | Select-Object @{N='name';E={$_.FriendlyName}}, @{N='kind';E={$_.Class}}, @{N='status';E={$_.Status}})
ConvertTo-Json -InputObject $devices -Compress -Depth 3
`.trim();

export interface PresentDevice {
  name: string;
  kind: string;
  status: string;
}

function queryWindowsDevices(): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", SCRIPT]);
    let stdout = "";
    let stderr = "";
    ps.stdout.on("data", (chunk) => (stdout += chunk));
    ps.stderr.on("data", (chunk) => (stderr += chunk));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`device query exited with code ${code}: ${stderr}`));
    });
  });
}

export async function fetchPresentDevices(): Promise<PresentDevice[]> {
  const raw: unknown = JSON.parse(await queryWindowsDevices());
  const entries = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return entries
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).name === "string" &&
        typeof (entry as Record<string, unknown>).kind === "string" &&
        typeof (entry as Record<string, unknown>).status === "string"
    )
    .map((entry) => ({
      name: String(entry.name),
      kind: String(entry.kind),
      status: String(entry.status),
    }));
}
