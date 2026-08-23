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

const FRAME_LENGTH = 512; // samples per frame, at 16kHz mono

/**
 * Records `seconds` of audio from the default mic and returns it as a
 * single Float32Array ready for transcription. Starts and stops its own
 * PvRecorder instance each time — simple, if not the most efficient for
 * rapid back-to-back recordings.
 */
export async function recordSeconds(seconds: number): Promise<Float32Array> {
  const recorder = new PvRecorder(FRAME_LENGTH, -1);
  recorder.start();

  const framesNeeded = Math.ceil((seconds * 16000) / FRAME_LENGTH);
  const collected: Int16Array[] = [];

  for (let i = 0; i < framesNeeded; i++) {
    collected.push(await recorder.read());
  }

  recorder.stop();
  recorder.release();

  return framesToFloat32(collected);
}

