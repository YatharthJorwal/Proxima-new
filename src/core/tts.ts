/**
 * Text-to-speech: turns Proxy's reply into spoken audio and plays it back.
 *
 * Two providers, tried in order:
 *   1. ElevenLabs (cloud) — used if ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
 *      are set in .env. Much more natural-sounding than Piper.
 *   2. Piper (local) — original MVP engine, kept as a fallback: if
 *      ElevenLabs isn't configured, or the API call fails for any reason
 *      (network hiccup, quota exceeded, etc.), we fall back to it rather
 *      than going silent.
 *   If neither is configured, speak() logs a warning and skips playback so
 *   the rest of the pipeline still works — same graceful-degradation
 *   behavior the file always had.
 *
 * ElevenLabs setup (.env):
 *   ELEVENLABS_API_KEY  - from your ElevenLabs dashboard (Profile -> API Keys)
 *   ELEVENLABS_VOICE_ID - pick a voice at elevenlabs.io/app/voice-library
 *                         (or your own cloned voice), copy its Voice ID.
 *                         Deliberately not defaulted to a hardcoded voice —
 *                         ElevenLabs has changed their default voice lineup
 *                         before, so a baked-in ID could silently 404 later.
 *
 * Piper setup (.env) — unchanged from before:
 *   PIPER_EXE_PATH   - full path to piper.exe
 *   PIPER_VOICE_PATH - full path to a voice .onnx file
 *
 * Requires Node 18+ for global fetch (no extra HTTP dependency needed) —
 * run `node --version` to confirm if anything here errors on `fetch`.
 */

import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
// sound-play has no official types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const soundPlay = require("sound-play");

const PIPER_EXE = process.env.PIPER_EXE_PATH;
const PIPER_VOICE = process.env.PIPER_VOICE_PATH;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

// Flash v2.5 trades a little naturalness for a lot of speed/cost — the
// right tradeoff for a voice assistant that's already fighting latency
// elsewhere in the pipeline (see the CPU-bound STT discussion in
// CLAUDE.md). Swap to "eleven_multilingual_v2" if quality matters more to
// you than snappiness.
const ELEVENLABS_MODEL = "eleven_flash_v2_5";

export async function speak(text: string): Promise<void> {
  if (!text) return;

  if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
    try {
      await speakWithElevenLabs(text);
      return;
    } catch (err) {
      console.error("[tts] ElevenLabs request failed, falling back to Piper:", err);
      // fall through to Piper below
    }
  }

  await speakWithPiper(text);
}

async function speakWithElevenLabs(text: string): Promise<void> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY as string,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${detail}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const outFile = path.join(os.tmpdir(), `proxy-reply-${Date.now()}.mp3`);
  fs.writeFileSync(outFile, audioBuffer);

  await soundPlay.play(outFile);

  fs.unlink(outFile, () => {
    /* best-effort cleanup, ignore errors */
  });
}

async function speakWithPiper(text: string): Promise<void> {
  if (!PIPER_EXE || !PIPER_VOICE) {
    console.warn(
      "[tts] No TTS provider configured — set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID, " +
        "or PIPER_EXE_PATH + PIPER_VOICE_PATH, in .env. Skipping speech playback."
    );
    return;
  }

  const outFile = path.join(os.tmpdir(), `proxy-reply-${Date.now()}.wav`);

  await new Promise<void>((resolve, reject) => {
    const piper = spawn(PIPER_EXE, ["--model", PIPER_VOICE, "--output_file", outFile]);

    piper.stdin.write(text);
    piper.stdin.end();

    piper.on("error", reject);
    piper.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited with code ${code}`));
    });
  });

  await soundPlay.play(outFile);

  fs.unlink(outFile, () => {
    /* best-effort cleanup, ignore errors */
  });
}