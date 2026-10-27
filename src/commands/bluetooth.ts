/**
 * Bluetooth device management for the dashboard's "Bluetooth & devices" card:
 * list paired devices, scan for new ones, pair, remove, connect, disconnect.
 *
 * Everything goes through ONE Windows PowerShell script (powershell.exe 5.1,
 * the only PowerShell that can reach the Windows Runtime Bluetooth APIs).
 * What the script is asked to do and which device it acts on travel in
 * environment variables, never inside the script text, so a device name can
 * never become code. The TypeScript side also refuses any device id that was
 * not in the last list or scan Windows returned.
 *
 * NOT verified against real hardware: this was developed without a Windows
 * machine. The shaping, dispatch and safety logic is unit tested, and the
 * script was run under PowerShell 7 with the Windows calls mocked.
 */
import { spawn } from "child_process";

export interface BtDevice {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  /** "classic" = Bluetooth BR/EDR (headphones, speakers, phones); "le" = Bluetooth Low Energy. */
  kind: "classic" | "le";
}

export type BtAction = "list" | "scan" | "pair" | "remove" | "connect" | "disconnect";
export type BtResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

export const SCAN_TIMEOUT_MS = 40_000;
export const ACTION_TIMEOUT_MS = 45_000;

// Everything above the "dispatch" marker only defines functions, so tests can
// replace the Windows-specific ones with mocks before the dispatch part runs.
export const DEFINITIONS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$action = $env:PROXIMA_BT_ACTION
$deviceId = $env:PROXIMA_BT_ID

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)) }

function Load-WinRt {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceInformationCollection,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DevicePairingResult,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceUnpairingResult,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.BluetoothDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
}

# Waits for a Windows Runtime async operation (IAsyncOperation<T>) from a script.
function Await($op, [Type]$type, [int]$ms = 30000) {
  $asTaskName = 'IAsyncOperation' + [char]96 + '1'
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $asTaskName } | Select-Object -First 1
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'Windows did not answer in time.' }
  $task.Result
}

function Get-Props { [string[]]@('System.Devices.Aep.IsConnected', 'System.Devices.Aep.IsPaired') }
function Get-Kind { [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint }

function Get-Devices([bool]$paired) {
  $found = @()
  $selectors = @(
    @('classic', [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($paired)),
    @('le', [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($paired))
  )
  foreach ($s in $selectors) {
    $col = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($s[1], (Get-Props), (Get-Kind))) ([Windows.Devices.Enumeration.DeviceInformationCollection])
    foreach ($d in $col) {
      if ([string]::IsNullOrWhiteSpace($d.Name)) { continue }
      $found += [PSCustomObject]@{ id = $d.Id; name = $d.Name; paired = [bool]$d.Pairing.IsPaired; connected = [bool]$d.Properties['System.Devices.Aep.IsConnected']; kind = $s[0] }
    }
  }
  $found
}

function Get-DeviceInfo([string]$id) {
  Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync($id, (Get-Props), (Get-Kind))) ([Windows.Devices.Enumeration.DeviceInformation])
}

function Invoke-Pair([string]$id) {
  $di = Get-DeviceInfo $id
  if ($di.Pairing.IsPaired) { return 'AlreadyPaired' }
  $res = Await ($di.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult]) 40000
  $res.Status.ToString()
}

function Invoke-Unpair([string]$id) {
  $di = Get-DeviceInfo $id
  $res = Await ($di.Pairing.UnpairAsync()) ([Windows.Devices.Enumeration.DeviceUnpairingResult]) 30000
  $res.Status.ToString()
}

function Add-BtInterop {
  if ('ProximaBt' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ProximaBt {
  [StructLayout(LayoutKind.Sequential)]
  public struct SYSTEMTIME { public ushort a, b, c, d, e, f, g, h; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct BLUETOOTH_DEVICE_INFO {
    public uint dwSize; public ulong Address; public uint ulClassofDevice;
    [MarshalAs(UnmanagedType.Bool)] public bool fConnected;
    [MarshalAs(UnmanagedType.Bool)] public bool fRemembered;
    [MarshalAs(UnmanagedType.Bool)] public bool fAuthenticated;
    public SYSTEMTIME stLastSeen; public SYSTEMTIME stLastUsed;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
  }
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothGetDeviceInfo(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothSetServiceState(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info, ref Guid service, uint flags);
  static readonly string[] Services = {
    "0000110b-0000-1000-8000-00805f9b34fb", "0000110a-0000-1000-8000-00805f9b34fb",
    "0000110e-0000-1000-8000-00805f9b34fb", "0000110c-0000-1000-8000-00805f9b34fb",
    "0000111e-0000-1000-8000-00805f9b34fb", "00001108-0000-1000-8000-00805f9b34fb",
    "00001124-0000-1000-8000-00805f9b34fb"
  };
  // Returns how many of the audio / hands-free / input services accepted the change, or -1 if Windows does not know the device.
  public static int SetServices(ulong address, bool enable) {
    BLUETOOTH_DEVICE_INFO info = new BLUETOOTH_DEVICE_INFO();
    info.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));
    info.Address = address;
    if (BluetoothGetDeviceInfo(IntPtr.Zero, ref info) != 0) return -1;
    int ok = 0;
    foreach (string s in Services) {
      Guid g = new Guid(s);
      if (BluetoothSetServiceState(IntPtr.Zero, ref info, ref g, enable ? 1u : 0u) == 0) ok++;
    }
    return ok;
  }
}
'@
}

function Set-Connection([string]$id, [bool]$connect) {
  $bt = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($id)) ([Windows.Devices.Bluetooth.BluetoothDevice])
  if ($null -eq $bt) { throw 'Windows could not open this device.' }
  $address = [uint64]$bt.BluetoothAddress
  Add-BtInterop
  if ($connect) {
    $null = [ProximaBt]::SetServices($address, $false)
    Start-Sleep -Milliseconds 500
  }
  $n = [ProximaBt]::SetServices($address, $connect)
  if ($n -lt 0) { throw 'Windows does not have this device in its Bluetooth list. Try pairing it again.' }
  if ($n -eq 0) { throw 'The device did not accept the request. It may be switched off or out of range.' }
  "$n"
}

function Scan-Devices {
  $seen = @{}
  for ($i = 0; $i -lt 3; $i++) {
    foreach ($d in (Get-Devices $false)) { if (-not $seen.ContainsKey($d.id)) { $seen[$d.id] = $d } }
    if ($i -lt 2) { Start-Sleep -Seconds 3 }
  }
  @($seen.Values)
}
`.trim();

export const DISPATCH = String.raw`
try {
  Load-WinRt
  switch ($action) {
    'list' { Emit @{ ok = $true; devices = @(Get-Devices $true) } }
    'scan' { Emit @{ ok = $true; devices = @(Scan-Devices) } }
    'pair' { Emit @{ ok = $true; status = (Invoke-Pair $deviceId) } }
    'remove' { Emit @{ ok = $true; status = (Invoke-Unpair $deviceId) } }
    'connect' { Emit @{ ok = $true; status = (Set-Connection $deviceId $true) } }
    'disconnect' { Emit @{ ok = $true; status = (Set-Connection $deviceId $false) } }
    default { throw 'Unknown action.' }
  }
} catch {
  Emit @{ ok = $false; error = ($_.Exception.Message -replace '[\r\n]+', ' ') }
}
`.trim();

export const SCRIPT = `${DEFINITIONS}\n${DISPATCH}`;

export type Runner = (action: BtAction, deviceId: string, timeoutMs: number) => Promise<string>;

/** Real runner: powershell.exe with the script passed as -EncodedCommand so no quoting can go wrong. */
export const powershellRunner: Runner = (action, deviceId, timeoutMs) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      env: { ...process.env, PROXIMA_BT_ACTION: action, PROXIMA_BT_ID: deviceId },
      windowsHide: true,
    });
    let out = "";
    let done = false;
    const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(() => { ps.kill(); finish(() => reject(new Error("Windows took too long to answer."))); }, timeoutMs);
    ps.stdout.on("data", (c) => { out += c.toString(); if (out.length > 1_000_000) ps.kill(); });
    ps.on("error", (e) => finish(() => reject(e)));
    ps.on("close", () => finish(() => resolve(out)));
  });

interface RawScript { ok?: boolean; error?: string; devices?: unknown; status?: unknown }

/** Pull the script's one-line JSON answer out of whatever PowerShell printed. */
export function parseScriptOutput(stdout: string): RawScript | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("{") && l.endsWith("}"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const v = JSON.parse(lines[i]); if (v && typeof v === "object") return v as RawScript; } catch { /* try an earlier line */ }
  }
  return null;
}

function asArray(v: unknown): unknown[] { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }

/** Clean up Windows' answer; a device that shows up as both classic and LE is listed once, preferring classic. */
export function normalizeDevices(raw: unknown): BtDevice[] {
  const out: BtDevice[] = [];
  for (const r of asArray(raw)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string" || !o.name.trim() || o.id.length > 400) continue;
    out.push({ id: o.id, name: o.name.trim().slice(0, 120), paired: o.paired === true, connected: o.connected === true, kind: o.kind === "le" ? "le" : "classic" });
  }
  const byName = new Map<string, BtDevice>();
  for (const d of out) {
    const key = d.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev) { byName.set(key, d); continue; }
    const keep = prev.kind === "classic" ? prev : d.kind === "classic" ? d : prev;
    byName.set(key, { ...keep, connected: prev.connected || d.connected });
  }
  return [...byName.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
}

const PAIR_MESSAGES: Record<string, string> = {
  Paired: "Paired.",
  AlreadyPaired: "That device is already paired.",
  Failed: "Pairing failed. Make sure the device is in pairing mode and close to the PC.",
  ConnectionRejected: "The device refused the connection. Put it back in pairing mode and try again.",
  AuthenticationFailure: "Pairing failed: the PIN or confirmation did not match.",
  AuthenticationTimeout: "Pairing timed out. Try again.",
  AuthenticationNotAllowed: "Pairing is not allowed with this device.",
  RejectedByHandler: "Pairing was declined.",
  RequiredHandlerNotRegistered: "This device needs a PIN or confirmation that only Windows Settings can show. Use “Open Windows Bluetooth settings” to finish pairing it.",
  NotReadyToPair: "The device isn't ready to pair yet. Put it in pairing mode.",
  NoSupportedProfiles: "Windows has no driver for this device's type.",
  OperationAlreadyInProgress: "Another pairing is already in progress.",
  ProtectionLevelCouldNotBeMet: "Windows couldn't reach the required security level with this device.",
  AccessDenied: "Windows blocked the request.",
};
export const explainStatus = (s: unknown): string => (typeof s === "string" ? PAIR_MESSAGES[s] ?? `Windows answered: ${s}.` : "Done.");
const PAIR_OK = new Set(["Paired", "AlreadyPaired"]);
const UNPAIR_OK = new Set(["Unpaired", "AlreadyUnpaired"]);

let queue: Promise<unknown> = Promise.resolve();
/** Device ids Windows returned in the last list or scan: the only ones the actions will accept. */
const known = new Set<string>();

export const _testing = { known, reset: () => { known.clear(); queue = Promise.resolve(); } };

async function run(action: BtAction, deviceId: string, runner: Runner, platform: string): Promise<RawScript | { ok: false; error: string }> {
  if (platform !== "win32") return { ok: false, error: "Bluetooth management is only available on Windows." };
  const timeout = action === "scan" ? SCAN_TIMEOUT_MS : ACTION_TIMEOUT_MS;
  // One Windows Bluetooth call at a time: overlapping pairing/enumeration sessions confuse the stack.
  const job = queue.then(async () => {
    try {
      const parsed = parseScriptOutput(await runner(action, deviceId, timeout));
      return parsed ?? { ok: false as const, error: "Windows returned an unreadable answer." };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Bluetooth is unavailable." };
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

async function listLike(action: "list" | "scan", runner: Runner, platform: string): Promise<BtResult<{ devices: BtDevice[] }>> {
  const r = await run(action, "", runner, platform);
  if (!r.ok) return { ok: false, error: r.error || "Bluetooth is unavailable." };
  const devices = normalizeDevices((r as RawScript).devices);
  for (const d of devices) known.add(d.id);
  return { ok: true, devices };
}

export const listPairedDevices = (runner: Runner = powershellRunner, platform = process.platform) => listLike("list", runner, platform);
export const scanForDevices = (runner: Runner = powershellRunner, platform = process.platform) => listLike("scan", runner, platform);

/** pair / remove / connect / disconnect on a device that came from the last list or scan. */
export async function actOnDevice(action: unknown, id: unknown, runner: Runner = powershellRunner, platform = process.platform): Promise<BtResult<{ message: string }>> {
  if (action !== "pair" && action !== "remove" && action !== "connect" && action !== "disconnect") return { ok: false, error: "Unknown Bluetooth action." };
  if (typeof id !== "string" || !known.has(id)) return { ok: false, error: "That device is no longer in the list. Refresh and try again." };
  const r = await run(action, id, runner, platform) as RawScript;
  if (!r.ok) return { ok: false, error: r.error || "Windows could not do that." };
  const status = typeof r.status === "string" ? r.status : "";
  if (action === "pair") return PAIR_OK.has(status) ? { ok: true, message: explainStatus(status) } : { ok: false, error: explainStatus(status) };
  if (action === "remove") {
    if (!UNPAIR_OK.has(status)) return { ok: false, error: status === "Failed" ? "Windows could not remove the device." : explainStatus(status) };
    known.delete(id);
    return { ok: true, message: "Device removed." };
  }
  return { ok: true, message: action === "connect" ? "Connection requested. It may take a few seconds." : "Disconnected." };
}
