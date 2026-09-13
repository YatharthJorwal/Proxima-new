/**
 * CLI entry point — press Enter (in this terminal) to talk to Proxy.
 *
 * As of Milestone 6, the actual pipeline (record -> STT -> route -> reply
 * -> speak) lives in ./engine.ts as an EventEmitter, shared with the
 * Electron dashboard (see ../../electron/main.ts). This file just wires
 * the Enter-key trigger to engine.runOnce() and logs the events to the
 * console — it no longer contains any pipeline logic itself.
 *
 * Kept around (not replaced by the dashboard) as a lightweight way to run
 * Proxy without launching Electron — useful for quick testing, or if you
 * ever want to run headless. The dashboard is the recommended way to run
 * Proxy day-to-day going forward (real global hotkey instead of needing
 * this terminal focused, see electron/main.ts for why).
 *
 * Run with: npm run start
 */

import "dotenv/config";
import "../core/settings";
import * as readline from "readline";
import { ProxyEngine, RouteInfo } from "./engine";

const engine = new ProxyEngine();

function describeRoute(info: RouteInfo): string {
  switch (info.source) {
    case "regex":
      return `regex router (${info.handler})`;
    case "llm-tool":
      return `LLM tool call (${info.tools.join(", ")})`;
    case "conversation":
      return "plain conversation (no command matched)";
    case "confirmation":
      // Milestone 10 Part B — the follow-up turn that resolves a
      // run_script confirmation request. See runScript.ts's docblock.
      return info.confirmed ? "run_script confirmation (confirmed)" : "run_script confirmation (cancelled)";
  }
}

engine.on("busy", () => console.log("(still working on the last request — press Enter again to stop it)"));
engine.on("listening", () => console.log("\n>>> Listening — say something (auto-stops after a pause)..."));
engine.on("speech-start", () => console.log("(hearing you...)"));
engine.on("transcribing", () => console.log("(transcribing...)"));
engine.on("transcribed", (text) => console.log(`You said: "${text}"`));
engine.on("no-speech", () => console.log("(didn't catch anything)"));
// Milestone 9 step 6: these four only fire for the orchestrator path —
// see engine.ts's EngineEvents docs for why a regex-matched command
// doesn't get them.
engine.on("deciding", (tier) => console.log(`(deciding — ${tier} tier)`));
engine.on("tool-start", (name) => console.log(`(running: ${name})`));
engine.on("tool-result", (name, result) => console.log(`(${name} -> ${result})`));
engine.on("thinking", (trace) => console.log(`(reasoning trace)\n${trace}\n`));
engine.on("responding", () => console.log("(putting together a reply...)"));
engine.on("routed", (info) => console.log(`Routed via: ${describeRoute(info)}`));
// Milestone 10 Part B — the reply text right after this already says
// "say yes/no", so this line is just a heads-up that the CLI is now
// waiting on that, not new information the reply doesn't already carry.
engine.on("awaiting-confirmation", (info) =>
  console.log(`(awaiting confirmation: ${"path" in info ? `run ${info.path}` : `click "${info.description}"`})`)
);
engine.on("reply", (text) => console.log(`Proxy: ${text}`));
engine.on("speaking", () => console.log("Speaking..."));
engine.on("cancelled", () => console.log("(stopped)"));
engine.on("error", (err) => console.error("Error handling request:", err));
engine.on("idle", () => console.log("\nPress Enter to talk to Proxy again.\n"));

async function main() {
  await engine.init();

  const rl = readline.createInterface({ input: process.stdin });

  console.log("\nReady — press Enter in this window to talk to Proxy. (Ctrl+C to quit)\n");

  rl.on("line", () => {
    // Milestone 9 step 6: a second Enter press while busy stops the
    // current run instead of being silently ignored (the previous
    // behavior — runOnce() itself still just emits "busy" and returns
    // for a trigger it can't act on).
    if (engine.isBusy()) {
      engine.cancel();
    } else {
      engine.runOnce();
    }
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
