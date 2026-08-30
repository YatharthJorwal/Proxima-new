/**
 * System usage tool — "what's eating my RAM", "how's my CPU doing", and
 * similar. Milestone 19 Part A (the tool half; the sidebar's aesthetic
 * "Task Manager" tile is Part B, blocked on Milestone 14's sidebar
 * navigation existing at all — see project-status.md).
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
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$totalMemMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)
$freeMemMB = [math]::Round($os.FreePhysicalMemory / 1024, 0)
$usedMemMB = $totalMemMB - $freeMemMB
$usedMemPercent = [math]::Round(($usedMemMB / $totalMemMB) * 100, 1)

$cpuSample = (Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue
$cpuPercent = [math]::Round($cpuSample, 1)

$topByMemory = Get-Process | Sort-Object -Descending WorkingSet64 | Select-Object -First 5 -Property Name, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB,0)}}
$topByCpuTime = Get-Process | Sort-Object -Descending CPU | Select-Object -First 5 -Property Name, @{N='CpuSeconds';E={[math]::Round($_.CPU,0)}}

$result = [PSCustomObject]@{
    cpuPercent = $cpuPercent
    totalMemMB = $totalMemMB
    usedMemMB = $usedMemMB
    usedMemPercent = $usedMemPercent
    topByMemory = $topByMemory
    topByCpuTime = $topByCpuTime
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
}

export interface SystemUsage {
  cpuPercent: number;
  totalMemMB: number;
  usedMemMB: number;
  usedMemPercent: number;
  topByMemory: { name: string; memMB: number }[];
  topByCpuTime: { name: string; cpuSeconds: number }[];
}

// PowerShell's ConvertTo-Json collapses a single-element array to a bare
// object instead of a one-item array - real, well-documented PowerShell
// behavior, not a bug in the script above. Normalizes either shape to
// always an array so callers never need to know this quirk exists.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
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
  const stdout = await runScript();
  const raw: RawUsageResult = JSON.parse(stdout);
  return {
    cpuPercent: raw.cpuPercent,
    totalMemMB: raw.totalMemMB,
    usedMemMB: raw.usedMemMB,
    usedMemPercent: raw.usedMemPercent,
    topByMemory: asArray(raw.topByMemory).map((p) => ({ name: p.Name, memMB: p.MemMB ?? 0 })),
    topByCpuTime: asArray(raw.topByCpuTime).map((p) => ({ name: p.Name, cpuSeconds: p.CpuSeconds ?? 0 })),
  };
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
