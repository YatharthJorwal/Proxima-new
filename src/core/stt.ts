/**
 * Speech-to-text dispatch. The optional whisper.cpp runtime already runs
 * in a child process; the Transformers CPU fallback runs in an Electron
 * utility process (or Node child process in CLI mode) so inference cannot
 * block Electron's main event loop or share native runtime state in a thread.
 */

import { ChildProcess, fork } from "child_process";
import { transcribeWithWhisperCpp } from "./whisperCpp";

const WHISPER_CPP_EXE = process.env.PROXY_WHISPER_CPP_EXE || "";
const WHISPER_CPP_MODEL = process.env.PROXY_WHISPER_CPP_MODEL || "";
let whisperCppUnavailable = false;
let cpuWorker: any = null;
let nextRequestId = 1;
let cpuWorkerReady = false;

interface PendingWorkerRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

const pendingRequests = new Map<number, PendingWorkerRequest>();

function rejectPendingWorkerRequests(error: Error): void {
  for (const request of pendingRequests.values()) request.reject(error);
  pendingRequests.clear();
}

function handleWorkerMessage(worker: any, message: { id: number; ok: boolean; value?: unknown; error?: string }): void {
    const request = pendingRequests.get(message.id);
    if (!request) return;
    pendingRequests.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(message.error || "Speech recognition worker failed."));
    if (pendingRequests.size === 0) {
      worker.unref?.();
      worker.channel?.unref?.();
    }
}

function createCpuWorker(): any {
  const modulePath = require.resolve("./sttWorker");
  const worker: any = process.versions.electron
    ? (require("electron") as typeof import("electron")).utilityProcess.fork(modulePath, [], { serviceName: "Proxima Speech Recognition" })
    : fork(modulePath, [], { serialization: "advanced" });
  if (worker instanceof ChildProcess) {
    worker.unref();
    worker.channel?.unref();
  }
  const receive = (message: { id: number; ok: boolean; value?: unknown; error?: string }) => handleWorkerMessage(worker, message);
  if (worker instanceof ChildProcess) worker.on("message", receive);
  else worker.on("message", (_event: unknown, message: { id: number; ok: boolean; value?: unknown; error?: string }) => receive(message));
  worker.on("error", (error: Error) => {
    if (cpuWorker === worker) {
      cpuWorker = null;
      cpuWorkerReady = false;
    }
    rejectPendingWorkerRequests(error);
  });
  worker.on("exit", (code: number) => {
    if (cpuWorker !== worker) return;
    cpuWorker = null;
    cpuWorkerReady = false;
    if (pendingRequests.size > 0) rejectPendingWorkerRequests(new Error(`Speech recognition worker exited with code ${code}.`));
  });
  return worker;
}

function cpuRequest(type: "init" | "transcribe", audio?: Float32Array): Promise<unknown> {
  const worker = cpuWorker ?? (cpuWorker = createCpuWorker());
  const id = nextRequestId++;
  worker.ref?.();
  worker.channel?.ref?.();
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      if (audio) {
        const ownedAudio = audio.slice();
        const message = { id, type, audio: ownedAudio.buffer };
        if (worker instanceof ChildProcess) worker.send(message);
        else worker.postMessage(message);
      } else {
        const message = { id, type };
        if (worker instanceof ChildProcess) worker.send(message);
        else worker.postMessage(message);
      }
    } catch (error) {
      pendingRequests.delete(id);
      if (pendingRequests.size === 0) {
        worker.unref?.();
        worker.channel?.unref?.();
      }
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function initSTT(): Promise<void> {
  if (WHISPER_CPP_EXE && WHISPER_CPP_MODEL) {
    console.log("Using configured whisper.cpp model; CUDA acceleration depends on the installed binary build.");
    return;
  }
  await initCpuTranscriber();
}

async function initCpuTranscriber(): Promise<void> {
  if (cpuWorkerReady) return;
  console.log("Loading the CPU speech-to-text model in an isolated process...");
  await cpuRequest("init");
  cpuWorkerReady = true;
  console.log("Speech-to-text ready (isolated CPU process).");
}

/** Transcribes 16kHz mono audio (Float32Array samples in the range -1..1). */
export async function transcribe(audio: Float32Array): Promise<string> {
  if (WHISPER_CPP_EXE && WHISPER_CPP_MODEL && !whisperCppUnavailable) {
    try {
      return await transcribeWithWhisperCpp(audio, WHISPER_CPP_EXE, WHISPER_CPP_MODEL);
    } catch (error) {
      whisperCppUnavailable = true;
      console.error("whisper.cpp failed; falling back to the CPU Transformers worker:", error);
      await initCpuTranscriber();
    }
  }
  if (!cpuWorkerReady) throw new Error("STT not initialized — call initSTT() first.");
  const output = await cpuRequest("transcribe", audio) as string;
  return output.trim();
}
