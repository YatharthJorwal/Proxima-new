import { beforeEach, describe, expect, it, vi } from "vitest";
import { actOnDevice, listPairedDevices, normalizeDevices, parseScriptOutput, Runner, scanForDevices, _testing, explainStatus, SCRIPT, DEFINITIONS, DISPATCH } from "./bluetooth";

const dev = (over: Record<string, unknown> = {}) => ({ id: "Bluetooth#A", name: "JBL TUNE770NC", paired: true, connected: true, kind: "classic", ...over });
const answer = (obj: unknown): Runner => vi.fn().mockResolvedValue(`noise\n${JSON.stringify(obj)}\n`);

beforeEach(() => _testing.reset());

describe("script output", () => {
  it("finds the JSON line among other output and prefers the last one", () => {
    expect(parseScriptOutput('WARNING: x\n{"ok":false}\n{"ok":true,"devices":[]}\n')).toEqual({ ok: true, devices: [] });
    expect(parseScriptOutput("nothing here")).toBeNull();
    expect(parseScriptOutput("{broken")).toBeNull();
  });
  it("never lets device names reach the script text (they travel in env vars)", () => {
    expect(SCRIPT).toContain("$env:PROXIMA_BT_ID");
    expect(SCRIPT).not.toContain("`"); // no backticks: it is a String.raw template and PowerShell escapes would break
    expect(SCRIPT).toBe(`${DEFINITIONS}\n${DISPATCH}`);
  });
});

describe("normalizeDevices", () => {
  it("accepts one object or an array (PowerShell collapses single items) and drops junk", () => {
    expect(normalizeDevices(dev())).toHaveLength(1);
    expect(normalizeDevices([dev(), null, 5, { id: 3 }, dev({ id: "x", name: "   " })])).toHaveLength(1);
    expect(normalizeDevices(undefined)).toEqual([]);
  });
  it("lists a device that appears as classic and LE once, keeping connected if either is", () => {
    const out = normalizeDevices([dev({ id: "le1", kind: "le", connected: false }), dev({ id: "c1", kind: "classic", connected: false }), dev({ id: "le2", kind: "le", connected: true })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "c1", kind: "classic", connected: true });
  });
  it("puts connected devices first, then by name", () => {
    const out = normalizeDevices([dev({ id: "1", name: "Zed", connected: false }), dev({ id: "2", name: "Alpha", connected: false }), dev({ id: "3", name: "Mid", connected: true })]);
    expect(out.map((d) => d.name)).toEqual(["Mid", "Alpha", "Zed"]);
  });
  it("trims and caps names", () => {
    expect(normalizeDevices(dev({ name: ` ${"x".repeat(300)} ` }))[0].name).toHaveLength(120);
  });
});

describe("listing and scanning", () => {
  it("returns devices and remembers their ids", async () => {
    const r = await listPairedDevices(answer({ ok: true, devices: [dev()] }), "win32");
    expect(r).toMatchObject({ ok: true, devices: [{ name: "JBL TUNE770NC" }] });
    expect(_testing.known.has("Bluetooth#A")).toBe(true);
  });
  it("reports script, parse and runner failures as errors, never throws", async () => {
    expect(await listPairedDevices(answer({ ok: false, error: "Bluetooth is off" }), "win32")).toEqual({ ok: false, error: "Bluetooth is off" });
    expect(await listPairedDevices(vi.fn().mockResolvedValue("garbage"), "win32")).toMatchObject({ ok: false });
    expect(await scanForDevices(vi.fn().mockRejectedValue(new Error("Windows took too long to answer.")), "win32")).toEqual({ ok: false, error: "Windows took too long to answer." });
  });
  it("is Windows-only", async () => {
    const runner = vi.fn();
    expect(await listPairedDevices(runner, "linux")).toMatchObject({ ok: false });
    expect(runner).not.toHaveBeenCalled();
  });
  it("gives scan a longer timeout than a normal action", async () => {
    const runner = vi.fn().mockResolvedValue('{"ok":true,"devices":[]}');
    await scanForDevices(runner, "win32");
    await listPairedDevices(runner, "win32");
    expect(runner.mock.calls[0][2]).toBeLessThan(runner.mock.calls[1][2] + 1);
    expect(runner.mock.calls[0][0]).toBe("scan");
  });
});

describe("acting on a device", () => {
  const seed = async () => { await listPairedDevices(answer({ ok: true, devices: [dev()] }), "win32"); };

  it("refuses ids Windows never returned, and unknown actions", async () => {
    const runner = vi.fn();
    expect(await actOnDevice("remove", "Bluetooth#EVIL", runner, "win32")).toMatchObject({ ok: false });
    await seed();
    expect(await actOnDevice("format", "Bluetooth#A", runner, "win32")).toMatchObject({ ok: false });
    expect(await actOnDevice("remove", 42, runner, "win32")).toMatchObject({ ok: false });
    expect(runner).not.toHaveBeenCalled();
  });

  it("passes the action and id through as data", async () => {
    await seed();
    const runner = answer({ ok: true, status: "Unpaired" });
    const r = await actOnDevice("remove", "Bluetooth#A", runner, "win32");
    expect(r).toEqual({ ok: true, message: "Device removed." });
    expect(runner).toHaveBeenCalledWith("remove", "Bluetooth#A", expect.any(Number));
    expect(_testing.known.has("Bluetooth#A")).toBe(false); // gone from the whitelist
  });

  it("explains Windows error codes from the Win32 pairing call", () => {
    expect(explainStatus("Code1223")).toBe("Pairing was cancelled.");
    expect(explainStatus("Code1244")).toContain("Windows Settings");
    expect(explainStatus("Code9999")).toContain("code 9999");
  });

  it("reports a failed removal with its code instead of pretending it worked", async () => {
    await seed();
    expect(await actOnDevice("remove", "Bluetooth#A", answer({ ok: true, status: "Code5" }), "win32")).toMatchObject({ ok: false, error: expect.stringContaining("code 5") });
    expect(_testing.known.has("Bluetooth#A")).toBe(true); // still in the list
  });

  it("translates pairing outcomes into plain language", async () => {
    await seed();
    expect(await actOnDevice("pair", "Bluetooth#A", answer({ ok: true, status: "Paired" }), "win32")).toMatchObject({ ok: true });
    const needs = await actOnDevice("pair", "Bluetooth#A", answer({ ok: true, status: "RequiredHandlerNotRegistered" }), "win32");
    expect(needs).toMatchObject({ ok: false, error: expect.stringContaining("Windows Settings") });
    expect(explainStatus("Weird")).toBe("Windows answered: Weird.");
  });

  it("surfaces connect errors from Windows", async () => {
    await seed();
    const r = await actOnDevice("connect", "Bluetooth#A", answer({ ok: false, error: "The device did not accept the request." }), "win32");
    expect(r).toEqual({ ok: false, error: "The device did not accept the request." });
    expect(await actOnDevice("disconnect", "Bluetooth#A", answer({ ok: true, status: "3" }), "win32")).toMatchObject({ ok: true });
  });

  it("runs one Windows call at a time", async () => {
    await seed();
    let active = 0, peak = 0;
    const runner: Runner = async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; return '{"ok":true,"status":"Unpaired"}'; };
    await Promise.all([actOnDevice("connect", "Bluetooth#A", runner, "win32"), actOnDevice("disconnect", "Bluetooth#A", runner, "win32"), listPairedDevices(runner, "win32")]);
    expect(peak).toBe(1);
  });
});
