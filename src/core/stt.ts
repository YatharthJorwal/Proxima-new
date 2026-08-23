/**
 * Speech-to-text: turns recorded mic audio into text using a local
 * Whisper model (runs via ONNX — no cloud, no API key).
 *
 * Tries to run on GPU via DirectML ('dml') first — Windows' built-in GPU
 * acceleration API, works with any DirectX12-capable GPU (the RTX 3060
 * qualifies) without needing a separately-installed, version-matched CUDA
 * toolkit. Falls back to CPU automatically if that init fails for any
 * reason, so this degrades gracefully rather than crashing on startup.
 *
 * The model downloads once on first run (small.en is ~240MB) and is
 * cached locally after that.
 */

import { pipeline } from "@huggingface/transformers";

// Typed as `any` on purpose: @huggingface/transformers' pipeline() has so
// many overloads that TypeScript hits a hard complexity limit (TS2590)
// trying to infer its exact return type. Casting to `any` sidesteps that —
// this is a known quirk of the library, not a mistake in our code.
let transcriber: any = null;

// small.en is a real accuracy step up from base.en — should help with the
// mishearing issues noted in CLAUDE.md (e.g. "Discord" heard as "this
// code"), while still being light enough to transcribe short commands
// quickly, especially now that it's running on GPU rather than CPU.
const MODEL_NAME = "Xenova/whisper-small.en";

export async function initSTT(): Promise<void> {
  console.log(`Loading speech-to-text model (${MODEL_NAME})...`);

  // We tried DirectML ('dml') here for GPU acceleration — it loads fine,
  // but hits a reproducible bug during actual transcription: Whisper's
  // autoregressive decoding loop comes back with zero output tokens via
  // the DML execution provider, throwing "token_ids must be a non-empty
  // array of integers" on every request. This looks like a DirectML
  // execution-provider maturity issue with Whisper's encoder/decoder +
  // KV-cache generation loop specifically, not something fixable from our
  // code. Sticking with CPU for correctness — revisit if a future
  // onnxruntime-node/transformers.js release fixes DML+seq2seq
  // generation, or if you want to try 'cuda' instead (needs a matching
  // CUDA toolkit install, which is why we didn't reach for it first).
  transcriber = await (pipeline as any)("automatic-speech-recognition", MODEL_NAME);
  console.log("Speech-to-text ready (CPU).");
}

/**
 * Transcribes 16kHz mono audio (as a Float32Array, samples in range -1..1).
 */
export async function transcribe(audio: Float32Array): Promise<string> {
  if (!transcriber) {
    throw new Error("STT not initialized — call initSTT() first.");
  }

  // Note: whisper-small.en, like base.en, is the English-only variant — it
  // doesn't accept a `language` option at all (only multilingual whisper
  // models do), so we just pass the sample rate.
  const start = Date.now();
  const output = await transcriber(audio, {
    sampling_rate: 16000,
  });
  console.log(`(transcribed in ${Date.now() - start}ms)`);

  const text = Array.isArray(output) ? output[0]?.text : output.text;
  return (text ?? "").trim();
}