/**
 * System usage tool — "what's eating my RAM", "how's my CPU doing", and
 * similar. Milestone 19 Part A (the tool half; the live dashboard tile
 * is Part B and lives in the Electron renderer — see project-status.md).
 *
 * The first *query* tool in this codebase, as opposed to the *action*
 * tools (open_app, volume, window, file tools) that came before it.
 * That distinction matters mechanically: volume.ts/window.ts/openApp.ts
 * all spawn a PowerShell script and just wait for it to exit - none of
 * them need the script's output, only whether it succeeded. This one's
 * whole point is getting real numbers back to reason over, so it
 * captures and parses stdout - a pattern this codebase hasn't needed
 * until now.
 */

import { spawn } from "child_process";

// One PowerShell round-trip, not several - CPU%, memory totals, and the
// top 5 processes by memory and by CPU time, all in one JSON blob.
// -ErrorActionPreference SilentlyContinue so a single failed cmdlet
// (unlikely, but Get-Counter's CPU sample has historically been the
// flakiest of these on some machines) doesn't kill the whole script -
// worse to get a total failure over one soft-failing number.
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$totalMemMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
$freeMemMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
$usedMemMB = $totalMemMB - $freeMemMB
$usedMemPercent = [math]::Round(($usedMemMB / $totalMemMB) * 100, 1)

# One Get-Counter call for CPU, disk and network so the extra counters add no
# extra wait. If any of the extra paths can't be read on this machine the call
# throws, so fall back to the CPU counter alone - CPU must never be lost to a
# disk or network counter that happens to be unavailable.
$cpuPath = '\Processor(_Total)\% Processor Time'
$allPaths = @(
  $cpuPath,
  '\PhysicalDisk(_Total)\Disk Read Bytes/sec',
  '\PhysicalDisk(_Total)\Disk Write Bytes/sec',
  '\PhysicalDisk(_Total)\% Disk Time',
  '\Network Interface(*)\Bytes Received/sec',
  '\Network Interface(*)\Bytes Sent/sec'
)
$samples = $null
try { $samples = (Get-Counter -Counter $allPaths -ErrorAction Stop).CounterSamples } catch { }
if ($null -eq $samples) { $samples = (Get-Counter -Counter $cpuPath).CounterSamples }

function Pick($pattern) { ($samples | Where-Object { $_.Path -like $pattern } | Select-Object -First 1).CookedValue }
function SumOf($pattern) {
  $m = $samples | Where-Object { $_.Path -like $pattern } | Measure-Object -Property CookedValue -Sum
  if ($m.Count -gt 0) { $m.Sum } else { $null }
}
$cpuSample = ($samples | Where-Object { $_.Path -like '*processor(_total)*' } | Select-Object -First 1).CookedValue
$cpuPercent = [math]::Round($cpuSample, 1)

$topByMemory = Get-Process | Sort-Object -Descending WorkingSet64 | Select-Object -First 8 -Property Name, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,0)}}
$topByCpuTime = Get-Process | Sort-Object -Descending CPU | Select-Object -First 8 -Property Name, @{N='CpuSeconds';E={[math]::Round($_.CPU,0)}}

$result = [PSCustomObject]@{
    cpuPercent = $cpuPercent
    totalMemMB = $totalMemMB
    usedMemMB = $usedMemMB
    usedMemPercent = $usedMemPercent
    topByMemory = $topByMemory
    topByCpuTime = $topByCpuTime
    diskReadBytesPerSec = (Pick '*physicaldisk(_total)*disk read bytes/sec')
    diskWriteBytesPerSec = (Pick '*physicaldisk(_total)*disk write bytes/sec')
    diskBusyPercent = (Pick '*physicaldisk(_total)*% disk time')
    netRxBytesPerSec = (SumOf '*network interface*bytes received/sec')
    netTxBytesPerSec = (SumOf '*network interface*bytes sent/sec')
    cpuCores = [Environment]::ProcessorCount
    processCount = @(Get-Process).Count
    uptimeSeconds = [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds
}
$result | ConvertTo-Json -Compress
`.trim();

interface RawProcessEntry {
  Name: string;
  MemMB?: number;
  CpuSeconds?: number;
}

interface RawUsageResult {
  cpuPercent: number;
  totalMemMB: number;
  usedMemMB: number;
  usedMemPercent: number;
  topByMemory?: RawProcessEntry | RawProcessEntry[];
  topByCpuTime?: RawProcessEntry | RawProcessEntry[];
  diskReadBytesPerSec?: number | null;
  diskWriteBytesPerSec?: number | null;
  diskBusyPercent?: number | null;
  netRxBytesPerSec?: number | null;
  netTxBytesPerSec?: number | null;
  cpuCores?: number | null;
  processCount?: number | null;
  uptimeSeconds?: number | null;
}

export interface SystemUsage {
  cpuPercent: number;
  totalMemMB: number;
  usedMemMB: number;
  usedMemPercent: number;
  topByMemory: { name: string; memMB: number }[];
  topByCpuTime: { name: string; cpuSeconds: number }[];
  /** null = the counters could not be read on this machine (shown as unavailable, never as zeros). */
  disk: { readBytesPerSec: number; writeBytesPerSec: number; busyPercent: number } | null;
  network: { rxBytesPerSec: number; txBytesPerSec: number } | null;
  cpuCores: number | null;
  processCount: number | null;
  uptimeSeconds: number | null;
}

// PowerShell's ConvertTo-Json collapses a single-element array to a bare
// object instead of a one-item array - real, well-documented PowerShell
// behavior, not a bug in the script above. Normalizes either shape to
// always an array so callers never need to know this quirk exists.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Pure mapping from the script's JSON to SystemUsage (exported for tests). */
export function parseUsage(stdout: string): SystemUsage {
  const raw: RawUsageResult = JSON.parse(stdout);
  const read = num(raw.diskReadBytesPerSec), write = num(raw.diskWriteBytesPerSec), busy = num(raw.diskBusyPercent);
  const rx = num(raw.netRxBytesPerSec), tx = num(raw.netTxBytesPerSec);
  return {
    cpuPercent: raw.cpuPercent,
    totalMemMB: raw.totalMemMB,
    usedMemMB: raw.usedMemMB,
    usedMemPercent: raw.usedMemPercent,
    topByMemory: asArray(raw.topByMemory).map((p) => ({ name: p.Name, memMB: p.MemMB ?? 0 })),
    topByCpuTime: asArray(raw.topByCpuTime).map((p) => ({ name: p.Name, cpuSeconds: p.CpuSeconds ?? 0 })),
    disk: read !== null && write !== null ? { readBytesPerSec: Math.max(0, read), writeBytesPerSec: Math.max(0, write), busyPercent: Math.min(100, Math.max(0, busy ?? 0)) } : null,
    network: rx !== null && tx !== null ? { rxBytesPerSec: Math.max(0, rx), txBytesPerSec: Math.max(0, tx) } : null,
    cpuCores: num(raw.cpuCores),
    processCount: num(raw.processCount),
    uptimeSeconds: num(raw.uptimeSeconds),
  };
}

function runScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-WindowStyle", "Hidden", "-Command", SCRIPT]);
    let stdout = "";
    let stderr = "";

    ps.stdout.on("data", (chunk) => (stdout += chunk));
    ps.stderr.on("data", (chunk) => (stderr += chunk));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`system usage script exited with code ${code}: ${stderr}`));
    });
  });
}

/**
 * Fetches current CPU/RAM usage and the top 5 processes by memory and by
 * cumulative CPU time. Note "top by CPU time" is total processor time a
 * process has used since it started, not an instantaneous percentage -
 * Windows doesn't expose reliable per-process instantaneous CPU% as
 * cheaply as it does memory. Reporting cumulative time as if it were
 * "what's using my CPU right now" would be exactly the kind of
 * plausible-but-inaccurate answer this project's transparency principle
 * rules out - a browser that's been open for days will always top this
 * list regardless of what's actually busy right now, and
 * executeGetSystemUsage() below says so explicitly rather than
 * presenting it as live CPU hogging.
 */
export async function fetchSystemUsage(): Promise<SystemUsage> {
  return parseUsage(await runScript());
}

/**
 * Does the actual work for the orchestrator tool - fetches usage and
 * turns it into a short, spoken-friendly summary carrying enough raw
 * numbers that the model can compose a reasonable answer to whichever
 * specific phrasing was actually asked ("what's eating my RAM" vs "how
 * much free memory do I have" vs "is my CPU maxed"), not just one fixed
 * canned response. No regex fast path here (unlike openApp.ts/browse.ts)
 * - "what's eating my RAM" has too many natural phrasings to pattern-
 * match cheaply, and this is exactly what the LLM tool-calling path is
 * for.
 */
export async function executeGetSystemUsage(): Promise<string> {
  try {
    const usage = await fetchSystemUsage();
    const topMem = usage.topByMemory
      .slice(0, 3)
      .map((p) => `${p.name} (${p.memMB}MB)`)
      .join(", ");
    const topCpu = usage.topByCpuTime
      .slice(0, 3)
      .map((p) => `${p.name} (${p.cpuSeconds}s)`)
      .join(", ");
    return (
      `CPU is at ${usage.cpuPercent}% right now. Memory: ${usage.usedMemPercent}% used ` +
      `(${usage.usedMemMB}MB of ${usage.totalMemMB}MB). ` +
      `Biggest memory users: ${topMem}. ` +
      `Most total CPU time used since they started, not necessarily busy right now: ${topCpu}.`
    );
  } catch (err) {
    console.error("Failed to fetch system usage:", err);
    return "I tried to check your system usage but something went wrong.";
  }
}
