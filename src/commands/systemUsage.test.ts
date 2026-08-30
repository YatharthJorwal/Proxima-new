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

import { fetchSystemUsage, executeGetSystemUsage } from "./systemUsage";

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
