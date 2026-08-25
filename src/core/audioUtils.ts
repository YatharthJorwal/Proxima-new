/**
 * Audio helpers: recording a clip from the mic and converting it into
 * the Float32Array format Whisper expects.
 */

import { PvRecorder } from "@picovoice/pvrecorder-node";

export function framesToFloat32(frames: Int16Array[]): Float32Array {
  const totalLength = frames.reduce((sum, frame) => sum + frame.length, 0);
  const merged = new Float32Array(totalLength);

  let offset = 0;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      merged[offset++] = frame[i] / 32768;
    }
  }

  return merged;
}

const SAMPLE_RATE = 16000;
const FRAME_LENGTH = 512; // samples per frame, at 16kHz mono
const FRAME_MS = (FRAME_LENGTH / SAMPLE_RATE) * 1000; // 32ms per frame

// Milestone 8 defaults — all overridable per-call (engine.ts wires the
// PROXY_VAD_* env vars into these, see engine.ts for why the env reads
// live there rather than here).
const DEFAULT_CALIBRATION_MS = 300;
const DEFAULT_SILENCE_HANG_MS = 900;
const DEFAULT_MAX_WAIT_FOR_SPEECH_MS = 6000;
const DEFAULT_MAX_RECORD_MS = 15000;

// How the adaptive threshold is derived from the calibration phase:
// threshold = clamp(measuredNoiseFloor, ceiling) * multiplier, floored at
// MIN_THRESHOLD. The ceiling matters more than it might look: if the user
// starts talking immediately (before the calibration window ends), the
// "noise floor" sample includes real speech and would otherwise inflate
// the threshold so high the rest of their own sentence never crosses it.
// Capping it means the worst case degrades to a fixed, conservative
// threshold instead of a broken one.
const NOISE_MULTIPLIER = 3;
const MIN_THRESHOLD = 0.02;
const NOISE_FLOOR_CEILING = 0.05;

function frameRms(frame: Int16Array): number {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i] / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / frame.length);
}

export interface VadOptions {
  /** Leading ms sampled to estimate the room's ambient noise floor. */
  calibrationMs?: number;
  /** Once speech has started, how long a stretch of quiet has to last before we consider the utterance over. */
  silenceHangMs?: number;
  /** If speech never starts, give up after this long and report speechDetected: false. */
  maxWaitForSpeechMs?: number;
  /** Hard cap on total recording length regardless of what's happening — safety net if the threshold misjudges this mic/room. */
  maxRecordMs?: number;
  /** Skips adaptive calibration and uses this fixed RMS threshold instead (escape hatch — see PROXY_VAD_THRESHOLD in engine.ts). */
  fixedThreshold?: number;
  /** Fires once, the moment recorded energy first crosses the speech threshold. */
  onSpeechStart?: () => void;
}

export interface VadResult {
  audio: Float32Array;
  /** False means nothing ever crossed the speech threshold — caller should skip STT rather than transcribe near-silence. */
  speechDetected: boolean;
}

/**
 * Records from the default mic until the user stops talking, replacing
 * the old fixed-duration recordSeconds() (Milestone 8 — see CLAUDE.md).
 *
 * Simple energy/amplitude-threshold VAD, deliberately — no new ML model
 * or dependency. Three phases:
 *   1. Calibrate — sample a short lead-in to estimate ambient noise and
 *      derive a speech threshold from it (or use `fixedThreshold`
 *      directly, bypassing this). These frames are still kept as part of
 *      the returned audio, not discarded — a fast talker who starts
 *      speaking immediately shouldn't lose the start of their sentence.
 *   2. Wait for speech — read frames until one crosses the threshold, or
 *      give up after `maxWaitForSpeechMs` (-> speechDetected: false).
 *   3. Record until silence — once speech starts, keep going until a
 *      continuous quiet stretch lasts `silenceHangMs`, or `maxRecordMs`
 *      is hit regardless.
 */
export async function recordUntilSilence(opts: VadOptions = {}): Promise<VadResult> {
  const calibrationMs = opts.calibrationMs ?? DEFAULT_CALIBRATION_MS;
  const silenceHangMs = opts.silenceHangMs ?? DEFAULT_SILENCE_HANG_MS;
  const maxWaitForSpeechMs = opts.maxWaitForSpeechMs ?? DEFAULT_MAX_WAIT_FOR_SPEECH_MS;
  const maxRecordMs = opts.maxRecordMs ?? DEFAULT_MAX_RECORD_MS;

  const recorder = new PvRecorder(FRAME_LENGTH, -1);
  recorder.start();

  const collected: Int16Array[] = [];
  let speechDetected = false;

  try {
    // --- Phase 1: calibrate ---
    const calibrationFrames = Math.max(1, Math.round(calibrationMs / FRAME_MS));
    let noiseSum = 0;
    for (let i = 0; i < calibrationFrames; i++) {
      const frame = await recorder.read();
      collected.push(frame);
      noiseSum += frameRms(frame);
    }

    let speechThreshold: number;
    if (opts.fixedThreshold && opts.fixedThreshold > 0) {
      speechThreshold = opts.fixedThreshold;
    } else {
      const noiseFloor = Math.min(noiseSum / calibrationFrames, NOISE_FLOOR_CEILING);
      speechThreshold = Math.max(noiseFloor * NOISE_MULTIPLIER, MIN_THRESHOLD);
    }

    // --- Phases 2 & 3: wait for speech, then record until silence ---
    let silenceStreakMs = 0;
    let waitedForSpeechMs = 0;
    let totalMs = calibrationMs;

    while (true) {
      const frame = await recorder.read();
      collected.push(frame);
      totalMs += FRAME_MS;

      const isSpeechFrame = frameRms(frame) > speechThreshold;

      if (isSpeechFrame) {
        if (!speechDetected) {
          speechDetected = true;
          opts.onSpeechStart?.();
        }
        silenceStreakMs = 0;
      } else if (speechDetected) {
        silenceStreakMs += FRAME_MS;
      } else {
        waitedForSpeechMs += FRAME_MS;
      }

      if (speechDetected && silenceStreakMs >= silenceHangMs) break;
      if (!speechDetected && waitedForSpeechMs >= maxWaitForSpeechMs) break;
      if (totalMs >= maxRecordMs) break;
    }
  } finally {
    recorder.stop();
    recorder.release();
  }

  return { audio: framesToFloat32(collected), speechDetected };
}
