/**
 * Bluetooth device management for the dashboard's "Bluetooth & devices" card:
 * list paired devices, scan for new ones, pair, remove, connect, disconnect.
 *
 * Everything goes through ONE Windows PowerShell script (powershell.exe 5.1).
 * Classic Bluetooth uses the Win32 API in BluetoothApis.dll; Low Energy
 * devices are listed (best effort) through the Windows Runtime.
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
/** Pairing can wait on the person (a prompt on screen, a button on the device). */
export const PAIR_TIMEOUT_MS = 120_000;

// Everything above the "dispatch" marker only defines functions, so tests can
// replace the Windows-specific ones with mocks before the dispatch part runs.
export const DEFINITIONS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$action = $env:PROXIMA_BT_ACTION
$deviceId = $env:PROXIMA_BT_ID

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6)) }

# Classic Bluetooth (headphones, speakers, phones) goes through the Win32 Bluetooth API in
# BluetoothApis.dll: device list, nearby-device inquiry, pairing, removal and service state.
# It has no overload surprises and has been stable since Windows Vista.
function Add-BtInterop {
  if ('ProximaBt' -as [type]) { return }
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class BtDeviceRow {
  public string Name;
  public string Address;
  public bool Connected;
  public bool Paired;
}

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

  [StructLayout(LayoutKind.Sequential)]
  public struct BLUETOOTH_DEVICE_SEARCH_PARAMS {
    public uint dwSize;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnAuthenticated;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnRemembered;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnUnknown;
    [MarshalAs(UnmanagedType.Bool)] public bool fReturnConnected;
    [MarshalAs(UnmanagedType.Bool)] public bool fIssueInquiry;
    public byte cTimeoutMultiplier;
    public IntPtr hRadio;
  }

  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern IntPtr BluetoothFindFirstDevice(ref BLUETOOTH_DEVICE_SEARCH_PARAMS p, ref BLUETOOTH_DEVICE_INFO info);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool BluetoothFindNextDevice(IntPtr h, ref BLUETOOTH_DEVICE_INFO info);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool BluetoothFindDeviceClose(IntPtr h);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothGetDeviceInfo(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothSetServiceState(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info, ref Guid service, uint flags);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothRemoveDevice(ref ulong address);
  [DllImport("BluetoothApis.dll", SetLastError = true)]
  static extern uint BluetoothAuthenticateDeviceEx(IntPtr hwndParent, IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info, IntPtr oobData, int requirement);
  [DllImport("BluetoothApis.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint BluetoothAuthenticateDevice(IntPtr hwndParent, IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info, string passkey, uint passkeyLength);

  static readonly string[] Services = {
    "0000110b-0000-1000-8000-00805f9b34fb", "0000110a-0000-1000-8000-00805f9b34fb",
    "0000110e-0000-1000-8000-00805f9b34fb", "0000110c-0000-1000-8000-00805f9b34fb",
    "0000111e-0000-1000-8000-00805f9b34fb", "00001108-0000-1000-8000-00805f9b34fb",
    "00001124-0000-1000-8000-00805f9b34fb"
  };

  static BLUETOOTH_DEVICE_INFO NewInfo() {
    BLUETOOTH_DEVICE_INFO info = new BLUETOOTH_DEVICE_INFO();
    info.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));
    return info;
  }

  // known = devices this PC has paired or remembered; otherwise, with inquiry, only newly discovered ones.
  // timeoutMultiplier is in units of 1.28 seconds (6 is about 8 seconds).
  public static BtDeviceRow[] Find(bool known, bool inquiry, int timeoutMultiplier) {
    BLUETOOTH_DEVICE_SEARCH_PARAMS p = new BLUETOOTH_DEVICE_SEARCH_PARAMS();
    p.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_SEARCH_PARAMS));
    p.fReturnAuthenticated = known; p.fReturnRemembered = known; p.fReturnConnected = known;
    p.fReturnUnknown = inquiry; p.fIssueInquiry = inquiry;
    p.cTimeoutMultiplier = (byte)timeoutMultiplier;
    p.hRadio = IntPtr.Zero;
    BLUETOOTH_DEVICE_INFO info = NewInfo();
    List<BtDeviceRow> rows = new List<BtDeviceRow>();
    IntPtr h = BluetoothFindFirstDevice(ref p, ref info);
    if (h == IntPtr.Zero) {
      int err = Marshal.GetLastWin32Error();
      if (err == 259) { return rows.ToArray(); }
      throw new Exception("Windows could not search for Bluetooth devices (code " + err + "). Is Bluetooth turned on?");
    }
    try {
      do {
        BtDeviceRow row = new BtDeviceRow();
        row.Name = info.szName;
        row.Address = info.Address.ToString("X12");
        row.Connected = info.fConnected;
        row.Paired = info.fAuthenticated || info.fRemembered;
        rows.Add(row);
        info = NewInfo();
      } while (BluetoothFindNextDevice(h, ref info));
    } finally {
      BluetoothFindDeviceClose(h);
    }
    return rows.ToArray();
  }

  // How many of the audio / hands-free / input services accepted the change, or -1 if Windows does not know the device.
  public static int SetServices(ulong address, bool enable) {
    BLUETOOTH_DEVICE_INFO info = NewInfo();
    info.Address = address;
    if (BluetoothGetDeviceInfo(IntPtr.Zero, ref info) != 0) { return -1; }
    int ok = 0;
    foreach (string s in Services) {
      Guid g = new Guid(s);
      if (BluetoothSetServiceState(IntPtr.Zero, ref info, ref g, enable ? 1u : 0u) == 0) { ok++; }
    }
    return ok;
  }

  // Windows may not have this device cached (it is a fresh process, and the device may have stopped
  // advertising for a moment), so a failed lookup is not fatal: the address alone is enough to pair.
  static BLUETOOTH_DEVICE_INFO InfoFor(ulong address) {
    BLUETOOTH_DEVICE_INFO info = NewInfo();
    info.Address = address;
    BluetoothGetDeviceInfo(IntPtr.Zero, ref info);
    info.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));
    info.Address = address;
    return info;
  }

  // Secure Simple Pairing (most devices made since 2010). 0 = paired, otherwise a Windows error code
  // (1223 = cancelled, 1400 = the owner window was rejected, 1244 = needs a prompt Windows could not show).
  // requirement: 0 = no MITM protection, 2 = dedicated bonding, 4 = general bonding.
  public static int PairSsp(ulong address, long ownerWindow, int requirement) {
    BLUETOOTH_DEVICE_INFO info = InfoFor(address);
    return (int)BluetoothAuthenticateDeviceEx(new IntPtr(ownerWindow), IntPtr.Zero, ref info, IntPtr.Zero, requirement);
  }

  // Legacy PIN pairing (older headsets and keyboards). 0 = paired.
  public static int PairPin(ulong address, long ownerWindow, string pin) {
    BLUETOOTH_DEVICE_INFO info = InfoFor(address);
    return (int)BluetoothAuthenticateDevice(new IntPtr(ownerWindow), IntPtr.Zero, ref info, pin, (uint)pin.Length);
  }

  public static bool IsPaired(ulong address) {
    BLUETOOTH_DEVICE_INFO info = NewInfo();
    info.Address = address;
    if (BluetoothGetDeviceInfo(IntPtr.Zero, ref info) != 0) { return false; }
    return info.fAuthenticated || info.fRemembered;
  }

  public static bool IsConnected(ulong address) {
    BLUETOOTH_DEVICE_INFO info = NewInfo();
    info.Address = address;
    if (BluetoothGetDeviceInfo(IntPtr.Zero, ref info) != 0) { return false; }
    return info.fConnected;
  }

  public static int Remove(ulong address) {
    ulong a = address;
    return (int)BluetoothRemoveDevice(ref a);
  }
}
'@
}

function ConvertTo-BtAddress([string]$id) {
  if ($id -notmatch '^bt:([0-9A-F]{12})$') { throw 'This action works on classic Bluetooth devices. Use Windows Settings for Low Energy devices.' }
  [Convert]::ToUInt64($Matches[1], 16)
}

# Low Energy devices (keyboards, mice, trackers) are not visible to the Win32 API. Listing them uses the
# oldest, simplest Windows Runtime overload and is strictly best effort: if anything fails, they are left out.
function Get-LeDevices {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $null = [Windows.Devices.Enumeration.DeviceInformationCollection,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $null = [Windows.Devices.Bluetooth.BluetoothLEDevice,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $null = [Windows.Devices.Bluetooth.BluetoothConnectionStatus,Windows.Devices.Bluetooth,ContentType=WindowsRuntime]
    $type = [Windows.Devices.Enumeration.DeviceInformationCollection]
    $paired = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true))) $type
    $connectedIds = @{}
    try {
      $live = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromConnectionStatus([Windows.Devices.Bluetooth.BluetoothConnectionStatus]::Connected))) $type
      foreach ($d in $live) { $connectedIds[$d.Id] = $true }
    } catch { }
    $out = @()
    foreach ($d in $paired) {
      if ([string]::IsNullOrWhiteSpace($d.Name)) { continue }
      $out += [PSCustomObject]@{ id = 'le:' + $d.Id; name = $d.Name; paired = $true; connected = $connectedIds.ContainsKey($d.Id); kind = 'le' }
    }
    $out
  } catch { @() }
}

# Waits for a Windows Runtime async operation (IAsyncOperation<T>) from a script.
function Await($op, [Type]$type, [int]$ms = 30000) {
  $asTaskName = 'IAsyncOperation' + [char]96 + '1'
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $asTaskName } | Select-Object -First 1
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'Windows did not answer in time.' }
  $task.Result
}

function Row-Of($d, [string]$fallback) {
  $name = if ([string]::IsNullOrWhiteSpace($d.Name)) { $fallback } else { $d.Name }
  [PSCustomObject]@{ id = 'bt:' + $d.Address; name = $name; paired = [bool]$d.Paired; connected = [bool]$d.Connected; kind = 'classic' }
}

function Get-PairedDevices {
  Add-BtInterop
  $out = @()
  foreach ($d in [ProximaBt]::Find($true, $false, 0)) { $out += Row-Of $d ('Bluetooth device ' + $d.Address.Substring(8)) }
  @($out) + @(Get-LeDevices)
}

function Scan-Devices {
  Add-BtInterop
  $out = @()
  foreach ($d in [ProximaBt]::Find($false, $true, 6)) { $out += Row-Of $d ('Unnamed device ' + $d.Address.Substring(8)) }
  @($out)
}

# Pairing is where devices differ most, so it tries, in order: the usual modern method (general bonding),
# dedicated bonding, no-MITM, then the legacy PIN 0000 that older headsets and keyboards expect. It stops at
# once if the person cancels, and gives up on a device that does not answer. The Windows prompt is parented
# to the Proxima window (PROXIMA_BT_HWND) so it appears on top instead of hidden behind it.
function Invoke-Pair([string]$id) {
  Add-BtInterop
  $address = ConvertTo-BtAddress $id
  $owner = 0
  if ($env:PROXIMA_BT_HWND -match '^[0-9]{1,18}$') { $owner = [long]$env:PROXIMA_BT_HWND }

  if (-not [ProximaBt]::IsPaired($address)) {
    $attempts = @(@('ssp', 4), @('ssp', 2), @('ssp', 0), @('pin', 0))
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $last = 1
    foreach ($a in $attempts) {
      $began = $clock.Elapsed.TotalSeconds
      $rc = if ($a[0] -eq 'ssp') { [ProximaBt]::PairSsp($address, $owner, $a[1]) } else { [ProximaBt]::PairPin($address, $owner, '0000') }
      if ($rc -eq 1400 -and $owner -ne 0) {
        # Windows refused the owner window: ask again without one.
        $rc = if ($a[0] -eq 'ssp') { [ProximaBt]::PairSsp($address, 0, $a[1]) } else { [ProximaBt]::PairPin($address, 0, '0000') }
      }
      if ($rc -eq 0 -or [ProximaBt]::IsPaired($address)) { $last = 0; break }
      $last = $rc
      if ($rc -eq 1223) { return 'Code1223' }
      if (($clock.Elapsed.TotalSeconds - $began) -gt 20) { break }
    }
    if ($last -ne 0) { return "Code$last" }
  }

  # Paired. Switch the audio / hands-free / input services on and give the device a moment to connect.
  $null = [ProximaBt]::SetServices($address, $true)
  for ($i = 0; $i -lt 16; $i++) {
    if ([ProximaBt]::IsConnected($address)) { return 'Paired' }
    Start-Sleep -Milliseconds 500
  }
  'PairedNotConnected'
}

function Invoke-Unpair([string]$id) {
  if ($id.StartsWith('le:')) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $null = [Windows.Devices.Enumeration.DeviceUnpairingResult,Windows.Devices.Enumeration,ContentType=WindowsRuntime]
    $di = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync($id.Substring(3))) ([Windows.Devices.Enumeration.DeviceInformation])
    $res = Await ($di.Pairing.UnpairAsync()) ([Windows.Devices.Enumeration.DeviceUnpairingResult]) 30000
    return $res.Status.ToString()
  }
  Add-BtInterop
  $rc = [ProximaBt]::Remove((ConvertTo-BtAddress $id))
  if ($rc -ne 0) { return "Code$rc" }
  'Unpaired'
}

function Set-Connection([string]$id, [bool]$connect) {
  Add-BtInterop
  $address = ConvertTo-BtAddress $id
  if ($connect) {
    $null = [ProximaBt]::SetServices($address, $false)
    Start-Sleep -Milliseconds 500
  }
  $n = [ProximaBt]::SetServices($address, $connect)
  if ($n -lt 0) { throw 'Windows does not have this device in its Bluetooth list. Try pairing it again.' }
  if ($n -eq 0) { throw 'The device did not accept the request. It may be switched off or out of range.' }
  "$n"
}
`.trim();

export const DISPATCH = String.raw`
try {
  switch ($action) {
    'list' { Emit @{ ok = $true; devices = @(Get-PairedDevices) } }
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

export type Runner = (action: BtAction, deviceId: string, timeoutMs: number, ownerWindow?: string) => Promise<string>;

/** Real runner: powershell.exe with the script passed as -EncodedCommand so no quoting can go wrong. */
export const powershellRunner: Runner = (action, deviceId, timeoutMs, ownerWindow) =>
  new Promise((resolve, reject) => {
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      env: { ...process.env, PROXIMA_BT_ACTION: action, PROXIMA_BT_ID: deviceId, PROXIMA_BT_HWND: ownerWindow && /^\d{1,18}$/.test(ownerWindow) ? ownerWindow : "" },
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
  Paired: "Paired and connected.",
  PairedNotConnected: "Paired, but it hasn't connected yet. Turn the device on (out of pairing mode) and press Connect.",
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
const CODE_MESSAGES: Record<number, string> = {
  1223: "Pairing was cancelled.",
  1168: "Windows hasn't seen this device lately. Scan again with the device in pairing mode.",
  1167: "The device isn't reachable. Make sure it is on, in pairing mode and close to the PC.",
  1244: "This device needs a PIN or confirmation that only Windows Settings can show. Use “Open Windows Bluetooth settings”.",
  1400: "Windows couldn't show the pairing prompt. Use “Open Windows Bluetooth settings” to pair it.",
  1460: "Pairing timed out waiting for a response. Put the device in pairing mode and try again.",
  258: "Pairing timed out waiting for a response. Put the device in pairing mode and try again.",
  87: "Windows rejected the request for this device.",
  5: "Windows blocked the request. Try again, or use Windows Settings.",
};

export const explainStatus = (s: unknown): string => {
  if (typeof s !== "string") return "Done.";
  const code = /^Code(\d+)$/.exec(s);
  if (code) return CODE_MESSAGES[Number(code[1])] ?? `Windows could not do that (code ${code[1]}). Try Windows Settings.`;
  return PAIR_MESSAGES[s] ?? `Windows answered: ${s}.`;
};
const PAIR_OK = new Set(["Paired", "PairedNotConnected", "AlreadyPaired"]);
const UNPAIR_OK = new Set(["Unpaired", "AlreadyUnpaired"]);

let queue: Promise<unknown> = Promise.resolve();
/** Device ids Windows returned in the last list or scan: the only ones the actions will accept. */
const known = new Set<string>();

let ownerWindowProvider: () => string | null = () => null;
/** main.ts supplies the Proxima window's handle so Windows' pairing prompt opens on top of it. */
export function setOwnerWindowProvider(fn: () => string | null): void { ownerWindowProvider = fn; }

export const _testing = { known, reset: () => { known.clear(); queue = Promise.resolve(); ownerWindowProvider = () => null; } };

async function run(action: BtAction, deviceId: string, runner: Runner, platform: string): Promise<RawScript | { ok: false; error: string }> {
  if (platform !== "win32") return { ok: false, error: "Bluetooth management is only available on Windows." };
  const timeout = action === "scan" ? SCAN_TIMEOUT_MS : action === "pair" ? PAIR_TIMEOUT_MS : ACTION_TIMEOUT_MS;
  let owner: string | undefined;
  try { owner = ownerWindowProvider() ?? undefined; } catch { owner = undefined; }
  // One Windows Bluetooth call at a time: overlapping pairing/enumeration sessions confuse the stack.
  const job = queue.then(async () => {
    try {
      const parsed = parseScriptOutput(await runner(action, deviceId, timeout, owner));
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
    if (!UNPAIR_OK.has(status)) return { ok: false, error: /^Code\d+$/.test(status) || status === "Failed" ? `Windows could not remove the device (${status.replace("Code", "code ")}).` : explainStatus(status) };
    known.delete(id);
    return { ok: true, message: "Device removed." };
  }
  return { ok: true, message: action === "connect" ? "Connection requested. It may take a few seconds." : "Disconnected." };
}
