/**
 * Main assistant loop — press Enter (in this terminal) to talk to Proxy.
 *
 * Flow:
 *   1. Wait for you to press Enter in this terminal window.
 *   2. Record a few seconds of audio.
 *   3. Transcribe it locally with Whisper.
 *   4. Try to match the text against a hardcoded PC-automation command
 *      (open app, etc.) — if it matches, run it.
 *   5. Otherwise, send the text to your local qwen3.5:9b model via Ollama.
 *   6. Speak the reply back with Piper.
 *   7. Go back to waiting.
 *
 * We originally tried a true global hotkey (works from anywhere, no need to
 * focus the terminal) via node-global-key-listener, but its background
 * key-hook binary got blocked/removed — likely flagged by antivirus, since
 * global keyboard hooking looks like a keylogger to AV heuristics. Pressing
 * Enter in the terminal is simpler and fully reliable; a true global hotkey
 * can come back later once we build a proper desktop app shell (e.g.
 * Electron), which has trusted, built-in support for that.
 *
 * Run with: npm run start
 */

import "dotenv/config";
import * as readline from "readline";
import { initSTT, transcribe } from "./stt";
import { speak } from "./tts";
import { recordSeconds } from "./audioUtils";
import { tryHandleCommand } from "../commands";
import { handleWithIntent } from "../commands/intentRouter";

const RECORD_SECONDS = 4;

let busy = false; // prevents overlapping triggers while one request is in flight

async function handleTrigger() {
  if (busy) {
    console.log("(still working on the last request, hang on)");
    return;
  }
  busy = true;

  try {
    console.log(`\n>>> Listening for ${RECORD_SECONDS}s...`);
    const audio = await recordSeconds(RECORD_SECONDS);

    console.log("Transcribing...");
    const text = await transcribe(audio);
    console.log(`You said: "${text}"`);

    if (text) {
      // Deterministic regex commands get first crack at the text — fast,
      // zero LLM latency, for exact phrasing. Anything that doesn't match
      // goes to the LLM intent router, which can EITHER recognize a
      // fuzzier-phrased command and dispatch it (Milestone 5) OR just
      // reply conversationally — one call covers both cases now.
      const commandReply = await tryHandleCommand(text);

      let reply: string;
      if (commandReply !== null) {
        reply = commandReply;
      } else {
        console.log("Thinking...");
        reply = await handleWithIntent(text);
      }

      console.log(`Proxy: ${reply}`);
      await speak(reply);
    } else {
      console.log("(didn't catch anything)");
    }
  } catch (err) {
    console.error("Error handling request:", err);
  } finally {
    console.log("\nPress Enter to talk to Proxy again.\n");
    busy = false;
  }
}

async function main() {
  await initSTT();

  const rl = readline.createInterface({ input: process.stdin });

  console.log("\nReady — press Enter in this window to talk to Proxy. (Ctrl+C to quit)\n");

  rl.on("line", () => {
    handleTrigger();
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});