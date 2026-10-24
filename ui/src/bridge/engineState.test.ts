import { describe, expect, it } from "vitest";
import { Action, EngineState, initialState, reducer } from "./engineState";
import type { EngineEventName, EngineEventPayloads } from "./types";

function run(events: [EngineEventName, unknown?][], start: EngineState = initialState(), t0 = 1000): EngineState {
  let now = t0;
  return events.reduce((s, [name, payload]) => {
    now += 100;
    const action: Action = { type: "engine", name, payload, now };
    return reducer(s, action);
  }, start);
}

describe("engine state", () => {
  it("walks a voice turn through the real stages, in order", () => {
    const s = run([
      ["ready", { hotkey: "F9" } satisfies EngineEventPayloads["ready"]],
      ["listening", { maxMs: 15000 }],
      ["speech-start"],
      ["transcribing"],
      ["transcribed", "open notepad"],
      ["routed", { source: "regex", handler: "open_app" }],
      ["reply", "Opening Notepad"],
      ["speaking"],
      ["idle"],
    ]);
    expect(s.steps.map((x) => x.label)).toEqual(["Listening", "Understanding your words"]);
    expect(s.steps.every((x) => x.status === "done")).toBe(true);
    expect(s.output).toEqual({ mode: "reply", text: "Opening Notepad" });
    expect(s.lastRoute).toBe("regex → open_app");
    expect(s.orb).toBe("idle");
    expect(s.turnActive).toBe(false);
    expect(s.log.map((l) => l.kind)).toEqual(["status", "status", "heard", "routed", "reply"]);
    expect(s.hotkey).toBe("F9");
  });

  it("typed input starts a fresh turn on the first event and creates no invented steps for the regex path", () => {
    const s = run([["transcribed", "what time is it"], ["routed", { source: "regex", handler: "time" }], ["reply", "9:41"], ["idle"]]);
    expect(s.steps).toEqual([]);
    expect(s.flashAt).toBeGreaterThan(0);
  });

  it("orchestrator turn: tool step, reasoning trace attaches to the analyzing step", () => {
    const s = run([
      ["transcribed", "check my cpu"],
      ["deciding", "smart"],
      ["tool-start", "get_system_usage"],
      ["tool-result", { name: "get_system_usage", result: "CPU 12%" }],
      ["thinking", "the user wants cpu"],
      ["responding"],
      ["routed", { source: "llm-tool", tools: ["get_system_usage"] }],
      ["reply", "CPU is at 12%."],
      ["idle"],
    ]);
    const labels = s.steps.map((x) => x.label);
    expect(labels).toEqual(["Analyzing Input", "Running: get_system_usage", "Responding"]);
    expect(s.steps[0].smart).toBe(true);
    expect(s.steps[0].trace).toBe("the user wants cpu");
    expect(s.steps[1].sub).toBe("CPU 12%");
    expect(s.steps[1].kind).toBe("tool");
    expect(s.lastRoute).toBe("LLM tool → get_system_usage");
  });

  it("holds an awaiting-confirmation step open until the next event", () => {
    const s = run([["transcribed", "run it"], ["awaiting-confirmation", { path: "C:\\x.bat" }]]);
    const last = s.steps[s.steps.length - 1];
    expect(last.label).toBe('Awaiting confirmation: run C:\\x.bat');
    expect(last.status).toBe("active");
  });

  it("marks the interrupted step as stopped on cancel and drops queued text", () => {
    let s = run([["transcribed", "long task"], ["deciding", "fast"]]);
    s = reducer(s, { type: "typed", text: "next thing" });
    expect(s.queued).toBe("next thing");
    s = run([["cancelled"]], s, 5000);
    expect(s.steps[s.steps.length - 1].status).toBe("stopped");
    expect(s.queued).toBeNull();
  });

  it("clears queued text only when it actually starts, and signals the input box", () => {
    let s = run([["transcribed", "first"]]);
    s = reducer(s, { type: "typed", text: "second" });
    s = run([["idle"]], s, 3000);
    expect(s.queued).toBe("second");
    const before = s.queuedStartSeq;
    s = run([["transcribed", "second"]], s, 4000);
    expect(s.queued).toBeNull();
    expect(s.queuedStartSeq).toBe(before + 1);
  });

  it("does not queue typed text when idle", () => {
    expect(reducer(initialState(), { type: "typed", text: "hi" }).queued).toBeNull();
  });

  it("errors flash the orb, survive idle, and clear on the timer action", () => {
    let s = run([["listening", { maxMs: 1000 }], ["error", "mic failed"], ["idle"]]);
    expect(s.orb).toBe("error");
    expect(s.output).toEqual({ mode: "error", text: "mic failed" });
    s = reducer(s, { type: "clear-error" });
    expect(s.orb).toBe("idle");
  });

  it("no-speech relabels the listening step", () => {
    const s = run([["listening", { maxMs: 1000 }], ["no-speech"], ["idle"]]);
    expect(s.steps[0]).toMatchObject({ label: "Nothing heard", status: "stopped" });
    expect(s.output).toEqual({ mode: "nothing" });
  });

  it("replays persisted history before live lines and marks it as history", () => {
    let s = run([["log-history", [{ kind: "reply", text: "old", timestamp: "2026-10-01T10:00:00.000Z" }]]]);
    s = run([["listening", { maxMs: 1000 }]], s, 9000);
    expect(s.log[0]).toMatchObject({ text: "old", history: true, at: "2026-10-01T10:00:00.000Z" });
    expect(s.log[1].history).toBeUndefined();
  });

  it("never turns a failed or malformed system sample into zeros", () => {
    let s = run([["system-usage", null]]);
    expect(s.usage).toBeNull();
    expect(s.usageHistory).toHaveLength(0);
    s = run([["system-usage", { cpuPercent: "x", usedMemPercent: 10 }]], s);
    expect(s.usage).toBeNull();
    s = run([["system-usage", { cpuPercent: 140, totalMemMB: 100, usedMemMB: 50, usedMemPercent: 50, topByMemory: [], topByCpuTime: [] }]], s);
    expect(s.usageHistory[0].cpu).toBe(100);
  });

  it("distinguishes 'no inventory yet' from 'inventory unavailable'", () => {
    expect(initialState().devices).toBeUndefined();
    expect(run([["present-devices", null]]).devices).toBeNull();
    expect(run([["present-devices", [{ name: "Mic", kind: "AudioEndpoint", status: "OK" }]]]).devices).toHaveLength(1);
  });
});
