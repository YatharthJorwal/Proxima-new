import type { EngineState } from "./engineState";

export const STAGES = ["Listen", "Understand", "Analyze", "Act", "Respond", "Speak"] as const;

/**
 * Which stage of the request pipeline the engine is in right now, from real
 * events only (-1 = nothing running). Drives the neural-chain graph; nothing
 * about the language model's internals is shown or implied.
 */
export function pipelineStage(s: EngineState): number {
  if (s.orb === "speaking") return 5;
  if (!s.turnActive && s.orb !== "listening") return -1;
  const last = s.steps[s.steps.length - 1];
  if (!last) return s.orb === "listening" ? 0 : s.orb === "thinking" ? 1 : -1;
  if (last.kind === "tool" || last.kind === "confirm") return 3;
  switch (last.label) {
    case "Responding": return 4;
    case "Analyzing Input": return 2;
    case "Listening": return 0;
    default: return 1; // "Understanding your words" and anything else mid-turn
  }
}
