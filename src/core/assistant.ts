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
import * as readline from "readline";
import { ProxyEngine, RouteInfo } from "./engine";

const engine = new ProxyEngine();

function describeRoute(info: RouteInfo): string {
  switch (info.source) {
    case "regex":
      return `regex router (${info.handler})`;
    case "llm-tool":
      return `LLM tool call (${info.tool})`;
    case "conversation":
      return "plain conversation (no command matched)";
  }
}

engine.on("busy", () => console.log("(still working on the last request, hang on)"));
engine.on("listening", () => console.log("\n>>> Listening — say something (auto-stops after a pause)..."));
engine.on("speech-start", () => console.log("(hearing you...)"));
engine.on("transcribed", (text) => console.log(`You said: "${text}"`));
engine.on("no-speech", () => console.log("(didn't catch anything)"));
engine.on("routed", (info) => console.log(`Routed via: ${describeRoute(info)}`));
engine.on("reply", (text) => console.log(`Proxy: ${text}`));
engine.on("speaking", () => console.log("Speaking..."));
engine.on("error", (err) => console.error("Error handling request:", err));
engine.on("idle", () => console.log("\nPress Enter to talk to Proxy again.\n"));

async function main() {
  await engine.init();

  const rl = readline.createInterface({ input: process.stdin });

  console.log("\nReady — press Enter in this window to talk to Proxy. (Ctrl+C to quit)\n");

  rl.on("line", () => {
    engine.runOnce();
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
