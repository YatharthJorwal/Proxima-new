/**
 * Milestone 10 Part D bug fix — regression test for the memory
 * overclaiming issue confirmed on the real machine: Proxy said "Got it.
 * I've noted that you like teacher" and separately offered to "forget"
 * a detail on request, when no tool exists anywhere in this codebase to
 * write, correct, or delete a stored fact (see core/memory.ts and
 * commands/tools.ts's recall_facts - read-only, capture is automatic
 * and asynchronous). The fix lives in buildSystemPrompt(), which isn't
 * exported, so this exercises it indirectly through chat() with a
 * mocked Ollama client - same spirit as orchestrator.test.ts mocking
 * chat() itself one layer up.
 *
 * First test file for this module - no prior llm.test.ts existed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() so mockOllamaChat is safe to reference inside vi.mock()'s
// factory, which gets hoisted above this import — same reason
// orchestrator.test.ts does it for mockChat. No env vars are involved
// here, but the hoisting requirement for anything a mocked module
// depends on applies regardless (see decisions.md's testing pitfall
// writeup).
const { mockOllamaChat } = vi.hoisted(() => ({
  mockOllamaChat: vi.fn(),
}));

vi.mock("ollama", () => ({ default: { chat: mockOllamaChat } }));

import { chat } from "./llm";

const FAKE_TOOL = {
  type: "function",
  function: { name: "some_tool", description: "does something", parameters: { type: "object", properties: {} } },
};

function systemPromptSent(): string {
  const call = mockOllamaChat.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
  return call.messages.find((m) => m.role === "system")?.content ?? "";
}

beforeEach(() => {
  mockOllamaChat.mockReset();
  mockOllamaChat.mockResolvedValue({ message: { content: "ok", tool_calls: undefined, thinking: undefined } });
});

describe("buildSystemPrompt() memory guidance", () => {
  it("tells the model there's no write/delete tool for memory, only when tools are present", async () => {
    await chat({
      tier: "fast",
      messages: [{ role: "user", content: "remember that I like pizza" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [FAKE_TOOL as any],
    });

    const prompt = systemPromptSent();
    expect(prompt).toMatch(/no tool that writes, updates, or deletes a stored fact/i);
    expect(prompt).toMatch(/don't have a direct way to do that/i);
  });

  it("omits the memory guidance (like all tool guidance) when no tools are passed", async () => {
    await chat({ tier: "fast", messages: [{ role: "user", content: "hello" }] });

    expect(systemPromptSent()).not.toMatch(/stored fact/i);
  });
});

describe("buildSystemPrompt() anti-substitution guidance", () => {
  it("tells the model not to silently substitute a lesser action and describe it as done", async () => {
    // Real-machine regression: "click the times of india link" got
    // silently turned into a Google search for the same phrase, described
    // as if it fulfilled the request, when the browser tools weren't
    // actually working. This rule exists so the model says that plainly
    // instead of dressing up a different action as the one asked for.
    await chat({
      tier: "fast",
      messages: [{ role: "user", content: "click the times of india link" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [FAKE_TOOL as any],
    });

    const prompt = systemPromptSent();
    expect(prompt).toMatch(/never silently do something different instead/i);
  });
});
