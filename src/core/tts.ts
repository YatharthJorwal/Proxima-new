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
 *
 * PLAYBACK — our own spawn(), not the sound-play package:
 * Real-machine feedback: a long reply (several minutes of speech) had no
 * way to be cut off mid-playback — pressing the hotkey/mic button while
 * speaking called cancel(), but cancel() only stopped the orchestrator's
 * tool loop, which had already finished by the time audio starts playing
 * (see engine.ts's process() — speak() is the tail end, after the loop).
 * The sound-play package plays audio via child_process.exec(), which
 * returns only a Promise with no handle to the process it spawned - there
 * was no way to kill playback already in progress through it. playAudioFile()
 * below spawns the same underlying Windows command (PowerShell +
 * PresentationCore's MediaPlayer, same approach sound-play itself uses)
 * directly via spawn(), keeping the ChildProcess reference so
 * stopSpeaking() can actually kill it. cancel() (engine.ts) now calls
 * stopSpeaking() too, so the existing hotkey/mic-button/"stop" mechanism
 * genuinely interrupts speech now, not just a tool loop that's often
 * already done.
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import { randomUUID } from "crypto";

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

interface SpeechSession {
  cancelled: boolean;
  abortController: AbortController;
  synthesizer: ChildProcess | null;
  player: ChildProcess | null;
}

// Proxy has one active turn, so one module-level speech session is enough.
// It covers remote audio generation, local Piper synthesis, and playback.
let activeSpeech: SpeechSession | null = null;

/**
 * Windows-only (this project targets Windows — see README), via
 * PowerShell + PresentationCore's MediaPlayer. Mirrors the sound-play
 * package's own Windows command rather than introducing a new audio
 * dependency; the difference is spawn() instead of exec(), specifically
 * so the ChildProcess handle can be kept for stopSpeaking() to kill.
 */
function playAudioFile(filePath: string, session: SpeechSession, volume = 0.6): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.cancelled) {
      resolve();
      return;
    }
    const script =
      "Add-Type -AssemblyName presentationCore; " +
      "$player = New-Object system.windows.media.mediaplayer; " +
      `$player.open(${toPowerShellLiteral(filePath)}); ` +
      `$player.Volume = ${volume}; ` +
      "$player.Play(); " +
      "Start-Sleep 1; " +
      "Start-Sleep -s $player.NaturalDuration.TimeSpan.TotalSeconds; " +
      "Exit;";

    // -EncodedCommand avoids quoting/injection problems when the Windows
    // temp directory contains spaces, quotes, or non-ASCII characters.
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    const proc = spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", encodedScript]);
    session.player = proc;

    proc.on("error", (err) => {
      if (session.player === proc) session.player = null;
      reject(err);
    });
    proc.on("close", (code, signal) => {
      if (session.player === proc) session.player = null;
      // A signal means stopSpeaking() killed it deliberately - that's an
      // intentional stop, not a playback failure, so resolve rather than
      // reject and have it surface as an "error" event on the dashboard.
      if (signal || code === 0) resolve();
      else reject(new Error(`playback exited with code ${code}`));
    });
  });
}

function toPowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Stops the complete speech job, including network audio generation,
 * Piper synthesis, or active playback. Returns true when it interrupted
 * a live speech job so engine.ts can report cancellation after the
 * orchestrator has already finished.
 */
export function stopSpeaking(): boolean {
  const session = activeSpeech;
  if (!session || session.cancelled) return false;
  session.cancelled = true;
  session.abortController.abort();
  session.synthesizer?.kill();
  session.player?.kill();
  return true;
}

export async function speak(text: string): Promise<void> {
  if (!text) return;

  const session: SpeechSession = {
    cancelled: false,
    abortController: new AbortController(),
    synthesizer: null,
    player: null,
  };
  activeSpeech = session;

  try {
    if (ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID) {
      try {
        await speakWithElevenLabs(text, session);
        return;
      } catch (err) {
        if (session.cancelled) return;
        console.error("[tts] ElevenLabs request failed, falling back to Piper:", err);
        // fall through to Piper below
      }
    }

    if (!session.cancelled) await speakWithPiper(text, session);
  } finally {
    if (activeSpeech === session) activeSpeech = null;
  }
}

async function speakWithElevenLabs(text: string, session: SpeechSession): Promise<void> {
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
      signal: session.abortController.signal,
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${detail}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (session.cancelled) return;
  const outFile = path.join(os.tmpdir(), `proxy-reply-${randomUUID()}.mp3`);
  try {
    fs.writeFileSync(outFile, audioBuffer);
    await playAudioFile(outFile, session);
  } finally {
    fs.unlink(outFile, () => {
      /* best-effort cleanup, ignore errors */
    });
  }
}

async function speakWithPiper(text: string, session: SpeechSession): Promise<void> {
  if (!PIPER_EXE || !PIPER_VOICE) {
    console.warn(
      "[tts] No TTS provider configured — set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID, " +
        "or PIPER_EXE_PATH + PIPER_VOICE_PATH, in .env. Skipping speech playback."
    );
    return;
  }

  const outFile = path.join(os.tmpdir(), `proxy-reply-${randomUUID()}.wav`);
  try {
    await new Promise<void>((resolve, reject) => {
      const piper = spawn(PIPER_EXE, ["--model", PIPER_VOICE, "--output_file", outFile]);
      session.synthesizer = piper;

      piper.stdin.write(text);
      piper.stdin.end();

      piper.on("error", reject);
      piper.on("close", (code) => {
        if (session.synthesizer === piper) session.synthesizer = null;
        if (code === 0) resolve();
        else if (session.cancelled) resolve();
        else reject(new Error(`piper exited with code ${code}`));
      });
    });

    if (!session.cancelled) await playAudioFile(outFile, session);
  } finally {
    fs.unlink(outFile, () => {
      /* best-effort cleanup, ignore errors */
    });
  }
}
