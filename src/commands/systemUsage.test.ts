/**
 * Mocks child_process.spawn directly (not a shared launch.ts wrapper,
 * since this tool needs stdout capture, which is a different invocation
 * shape than the fire-and-forget Start-Process pattern the other
 * command modules use). Exercises the real parsing logic against a fake
 * process lifecycle, not by mocking fetchSystemUsage() itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn: mockSpawn }));

import { fetchSystemUsage, executeGetSystemUsage, parseUsage } from "./systemUsage";

/** A fake child_process-shaped EventEmitter that emits the given stdout then closes with the given exit code. */
function fakeProcess(stdout: string, exitCode = 0) {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
    proc.emit("close", exitCode);
  });
  return proc;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("fetchSystemUsage", () => {
  it("parses a normal multi-process PowerShell response", async () => {
    const json = JSON.stringify({
      cpuPercent: 23.5,
      totalMemMB: 16000,
      usedMemMB: 9000,
      usedMemPercent: 56.3,
      topByMemory: [
        { Name: "chrome", MemMB: 1200 },
        { Name: "Code", MemMB: 800 },
      ],
      topByCpuTime: [{ Name: "chrome", CpuSeconds: 340 }],
    });
    mockSpawn.mockReturnValue(fakeProcess(json));

    const usage = await fetchSystemUsage();
    expect(usage.cpuPercent).toBe(23.5);
    expect(usage.usedMemPercent).toBe(56.3);
    expect(usage.topByMemory).toEqual([
      { name: "chrome", memMB: 1200 },
      { name: "Code", memMB: 800 },
    ]);
  });

  it("normalizes PowerShell's single-item array collapse to a real array", async () => {
    // Real PowerShell ConvertTo-Json behavior: a one-element array
    // serializes as a bare object, not a one-element array - this test
    // is exactly the case that shows up in.
    const json = JSON.stringify({
      cpuPercent: 5,
      totalMemMB: 8000,
      usedMemMB: 4000,
      usedMemPercent: 50,
      topByMemory: { Name: "solo.exe", MemMB: 100 },
      topByCpuTime: { Name: "solo.exe", CpuSeconds: 10 },
    });
    mockSpawn.mockReturnValue(fakeProcess(json));

    const usage = await fetchSystemUsage();
    expect(usage.topByMemory).toEqual([{ name: "solo.exe", memMB: 100 }]);
    expect(usage.topByCpuTime).toEqual([{ name: "solo.exe", cpuSeconds: 10 }]);
  });

  it("rejects when the script exits non-zero", async () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => {
      proc.stderr.emit("data", Buffer.from("not recognized"));
      proc.emit("close", 1);
    });

    await expect(fetchSystemUsage()).rejects.toThrow(/exited with code 1/);
  });
});

describe("executeGetSystemUsage", () => {
  it("summarizes usage into a spoken-friendly reply carrying the real numbers", async () => {
    const json = JSON.stringify({
      cpuPercent: 40,
      totalMemMB: 16000,
      usedMemMB: 8000,
      usedMemPercent: 50,
      topByMemory: [{ Name: "chrome", MemMB: 2000 }],
      topByCpuTime: [{ Name: "chrome", CpuSeconds: 500 }],
    });
    mockSpawn.mockReturnValue(fakeProcess(json));

    const reply = await executeGetSystemUsage();
    expect(reply).toContain("40%");
    expect(reply).toContain("50%");
    expect(reply).toContain("chrome");
    expect(reply).toMatch(/not necessarily busy right now/i);
  });

  it("gives an honest failure message instead of crashing if the script fails to spawn", async () => {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    mockSpawn.mockReturnValue(proc);
    queueMicrotask(() => proc.emit("error", new Error("spawn failed")));

    const reply = await executeGetSystemUsage();
    expect(reply).toMatch(/something went wrong/i);
  });
});

describe("parseUsage (disk and network)", () => {
  const base = { cpuPercent: 5, totalMemMB: 8000, usedMemMB: 4000, usedMemPercent: 50 };

  it("maps disk and network counters when the script returned them", () => {
    const u = parseUsage(JSON.stringify({ ...base, diskReadBytesPerSec: 2_000_000, diskWriteBytesPerSec: 500_000, diskBusyPercent: 37.5, netRxBytesPerSec: 1200, netTxBytesPerSec: 300, cpuCores: 16, processCount: 280, uptimeSeconds: 9000 }));
    expect(u.disk).toEqual({ readBytesPerSec: 2_000_000, writeBytesPerSec: 500_000, busyPercent: 37.5 });
    expect(u.network).toEqual({ rxBytesPerSec: 1200, txBytesPerSec: 300 });
    expect([u.cpuCores, u.processCount, u.uptimeSeconds]).toEqual([16, 280, 9000]);
  });

  it("reports unavailable (null), never zeros, when the extra counters could not be read", () => {
    const u = parseUsage(JSON.stringify({ ...base, diskReadBytesPerSec: null, diskWriteBytesPerSec: null, netRxBytesPerSec: null, netTxBytesPerSec: null }));
    expect(u.disk).toBeNull();
    expect(u.network).toBeNull();
    expect(u.cpuPercent).toBe(5); // CPU survives
  });

  it("still parses output from an older script that has none of the new fields", () => {
    const u = parseUsage(JSON.stringify(base));
    expect(u.disk).toBeNull();
    expect(u.cpuCores).toBeNull();
  });

  it("clamps busy percent (Windows can report over 100) and negative rates", () => {
    const u = parseUsage(JSON.stringify({ ...base, diskReadBytesPerSec: -5, diskWriteBytesPerSec: 10, diskBusyPercent: 340 }));
    expect(u.disk).toEqual({ readBytesPerSec: 0, writeBytesPerSec: 10, busyPercent: 100 });
  });
});
