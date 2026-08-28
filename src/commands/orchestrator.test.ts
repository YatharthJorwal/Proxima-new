/**
 * Milestone 9 build order step 5 — a thin slice of orchestrator unit
 * tests. Mocked chat() responses and mocked tool dispatch, exercising
 * the loop's control flow (fast/smart escalation, defer, step cap,
 * cancellation, dispatch-failure resilience) without needing real
 * Ollama, a mic, or Windows-only tool executors. Deliberately not an
 * exhaustive suite — see CLAUDE.md's Milestone 9 plan, item 8, for why
 * this stays scoped small rather than becoming its own milestone.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatResult } from "../core/llm";

// vi.hoisted() so these are safe to reference inside the vi.mock()
// factories below, which get hoisted above the imports themselves —
// a plain module-scope const here would hit the TDZ.
const { mockChat, mockDispatchTool, mockTools, mockGetToolSchemas } = vi.hoisted(() => ({
  mockChat: vi.fn(),
  mockDispatchTool: vi.fn(),
  mockGetToolSchemas: vi.fn(() => []),
  mockTools: {} as Record<string, { resultInformsNextStep?: boolean }>,
}));

vi.mock("../core/llm", () => ({ chat: mockChat }));
vi.mock("./tools", () => ({
  TOOLS: mockTools,
  getToolSchemas: mockGetToolSchemas,
  dispatchTool: mockDispatchTool,
}));

import { Orchestrator } from "./orchestrator";

// --- small helpers for scripting chat() responses ---
function plainReply(text: string): ChatResult {
  return { reply: text, toolCall: null, thinking: null };
}
function toolCallReply(name: string, args: Record<string, unknown> = {}, thinking: string | null = null): ChatResult {
  return { reply: null, toolCall: { name, arguments: args }, thinking };
}

beforeEach(() => {
  mockChat.mockReset();
  mockDispatchTool.mockReset();
  mockGetToolSchemas.mockReset().mockReturnValue([]);
  for (const key of Object.keys(mockTools)) delete mockTools[key];
});

describe("Orchestrator", () => {
  it("resolves a plain conversational reply in one fast-tier call", async () => {
    mockChat.mockResolvedValueOnce(plainReply("Hey there."));

    const result = await new Orchestrator().run("hello");

    expect(result).toEqual({
      reply: "Hey there.",
      toolsUsed: [],
      fastTierOnly: true,
      hitStepCap: false,
      cancelled: false,
    });
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockChat.mock.calls[0][0].tier).toBe("fast");
  });

  it("resolves a confident fast-tier tool call in one call, fire-and-forget", async () => {
    mockTools.open_app = { resultInformsNextStep: false };
    mockChat.mockResolvedValueOnce(toolCallReply("open_app", { app_name: "notepad" }));
    mockDispatchTool.mockResolvedValueOnce("Opening notepad.");

    const result = await new Orchestrator().run("open notepad");

    expect(result.reply).toBe("Opening notepad.");
    expect(result.toolsUsed).toEqual(["open_app"]);
    expect(result.fastTierOnly).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockDispatchTool).toHaveBeenCalledWith("open_app", { app_name: "notepad" });
  });

  it("offers defer_to_planner to the fast tier", async () => {
    mockChat.mockResolvedValueOnce(plainReply("just chatting"));

    await new Orchestrator().run("hello");

    const fastTierTools = mockChat.mock.calls[0][0].tools as Array<{ function: { name: string } }>;
    expect(fastTierTools.some((t) => t.function.name === "defer_to_planner")).toBe(true);
  });

  it("never offers defer_to_planner to the smart tier - it IS the planner", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallReply("defer_to_planner"))
      .mockResolvedValueOnce(plainReply("handled"));

    await new Orchestrator().run("do something complicated");

    const smartTierTools = mockChat.mock.calls[1][0].tools as Array<{ function: { name: string } }>;
    expect(smartTierTools.some((t) => t.function.name === "defer_to_planner")).toBe(false);
  });

  it("escalates to the smart tier when the fast tier defers, and hands off cleanly", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallReply("defer_to_planner"))
      .mockResolvedValueOnce(plainReply("Done thinking it through."));

    const result = await new Orchestrator().run("do something complicated");

    expect(result.reply).toBe("Done thinking it through.");
    expect(result.fastTierOnly).toBe(false);
    expect(mockChat).toHaveBeenCalledTimes(2);
    expect(mockChat.mock.calls[1][0].tier).toBe("smart");
    expect(mockChat.mock.calls[1][0].think).toBe(true);
  });

  it("chains multiple smart-tier tool calls until the model signals done", async () => {
    mockTools.open_app = { resultInformsNextStep: false };
    mockTools.control_window = { resultInformsNextStep: false };
    mockChat
      .mockResolvedValueOnce(toolCallReply("defer_to_planner"))
      .mockResolvedValueOnce(toolCallReply("open_app", { app_name: "notepad" }))
      .mockResolvedValueOnce(toolCallReply("control_window", { action: "snap-left" }))
      .mockResolvedValueOnce(plainReply("Notepad's open and snapped left."));
    mockDispatchTool.mockResolvedValueOnce("Opening notepad.").mockResolvedValueOnce("Window snapped left.");

    const result = await new Orchestrator().run("open notepad and snap it left");

    expect(result.toolsUsed).toEqual(["open_app", "control_window"]);
    expect(result.reply).toBe("Notepad's open and snapped left.");
    expect(result.hitStepCap).toBe(false);
    expect(mockChat).toHaveBeenCalledTimes(4);
  });

  it("gives an honest reply instead of pretending to finish when the step cap is hit", async () => {
    mockTools.open_app = { resultInformsNextStep: false };
    mockChat.mockResolvedValueOnce(toolCallReply("defer_to_planner"));
    // The model just keeps calling the same tool forever - confirms the
    // cap catches a plan that never terminates on its own.
    mockChat.mockResolvedValue(toolCallReply("open_app", { app_name: "notepad" }));
    mockDispatchTool.mockResolvedValue("Opening notepad.");

    const result = await new Orchestrator().run("do something", { maxSteps: 3 });

    expect(result.hitStepCap).toBe(true);
    expect(result.reply).toMatch(/check in/i);
    expect(result.toolsUsed).toHaveLength(3);
    expect(mockChat).toHaveBeenCalledTimes(4); // 1 defer + 3 loop iterations
  });

  it("stops at the next loop boundary and reports cancelled when cancel() is called mid-run", async () => {
    const orch = new Orchestrator();
    mockChat.mockImplementationOnce(async () => {
      // Simulates a stop request (hotkey or typed "stop") arriving while
      // the fast tier is still deciding.
      orch.cancel();
      return toolCallReply("defer_to_planner");
    });

    const result = await orch.run("do something");

    expect(result.cancelled).toBe(true);
    expect(result.reply).toMatch(/stopped/i);
    // Escalation happened, but the loop caught the cancellation at its
    // very next boundary and never made the smart-tier call.
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("keeps the loop alive and reports an honest failure if a tool dispatch throws", async () => {
    mockTools.open_app = { resultInformsNextStep: false };
    mockChat
      .mockResolvedValueOnce(toolCallReply("defer_to_planner"))
      .mockResolvedValueOnce(toolCallReply("open_app", { app_name: "notepad" }))
      .mockResolvedValueOnce(plainReply("Sorted."));
    mockDispatchTool.mockRejectedValueOnce(new Error("PowerShell exited with code 1"));

    const result = await new Orchestrator().run("open notepad");

    expect(result.toolsUsed).toEqual(["open_app"]);
    expect(result.reply).toBe("Sorted.");
    // Confirm the model saw an honest failure message, not a crash.
    const nextCallMessages = mockChat.mock.calls[2][0].messages as Array<{ role: string; content: string }>;
    const toolResultMessage = nextCallMessages.find((m) => m.role === "tool");
    expect(toolResultMessage?.content).toMatch(/something went wrong/i);
  });

  it("escalates a fast-tier tool call to the smart-tier loop when resultInformsNextStep is set", async () => {
    // Forward-looking: no shipped tool sets this flag yet, but the loop
    // needs to already handle it correctly for whenever one does.
    mockTools.check_something = { resultInformsNextStep: true };
    mockChat
      .mockResolvedValueOnce(toolCallReply("check_something", { thing: "disk space" }))
      .mockResolvedValueOnce(plainReply("Based on that, you're fine."));
    mockDispatchTool.mockResolvedValueOnce("42GB free.");

    const result = await new Orchestrator().run("check something for me");

    expect(result.fastTierOnly).toBe(false);
    expect(result.toolsUsed).toEqual(["check_something"]);
    expect(result.reply).toBe("Based on that, you're fine.");
    expect(mockChat).toHaveBeenCalledTimes(2);
    const smartMessages = mockChat.mock.calls[1][0].messages as Array<{ role: string; content: string }>;
    expect(smartMessages.find((m) => m.role === "tool")?.content).toBe("42GB free.");
  });

  it("emits deciding with the correct tier, letting a listener tell fast and smart apart", async () => {
    mockChat
      .mockResolvedValueOnce(toolCallReply("defer_to_planner"))
      .mockResolvedValueOnce(plainReply("done"));

    const orch = new Orchestrator();
    const tiers: string[] = [];
    orch.on("deciding", (tier) => tiers.push(tier));
    await orch.run("do something complicated");

    expect(tiers).toEqual(["fast", "smart"]);
  });
});
