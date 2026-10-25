/**
 * Camera + hand tracking, kept in a module-level store (like the engine
 * state) so it keeps running while the person is on another page — the pinch
 * trigger must not die just because the Camera page was closed.
 *
 * Hand tracking runs on a hidden <video> that this module owns; pages that
 * want to *show* the camera attach their own <video> to the same stream.
 * MediaPipe is imported lazily so a missing model or wasm file only breaks
 * hand tracking, never the rest of the dashboard.
 */
import { useSyncExternalStore } from "react";
import { triggerVoice } from "../bridge/store";
import { isPinch, Landmark, PinchTrigger } from "./pinch";

export type CameraPhase = "off" | "starting" | "on";
export type HandPhase = "off" | "loading" | "on";

export interface CameraState {
  camera: CameraPhase;
  hand: HandPhase;
  pinch: boolean;
  hands: number;
  /** Errors and one-off notices ("" when there is nothing to say). */
  message: string;
  stream: MediaStream | null;
}

export interface HandFrame {
  hands: Landmark[][];
  connections: { start: number; end: number }[];
}

const MODEL_MISSING = 'Hand-tracking model not found. Run "npm run setup:cv", then rebuild.';
const FRAME_MS = 33; // ~30 fps is plenty for detection and half the CPU of 60

let state: CameraState = { camera: "off", hand: "off", pinch: false, hands: 0, message: "", stream: null };
const listeners = new Set<() => void>();
const frameListeners = new Set<(frame: HandFrame) => void>();

let video: HTMLVideoElement | null = null;
let landmarker: { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: Landmark[][] }; close?: () => void } | null = null;
let connections: HandFrame["connections"] = [];
let raf = 0;
let lastRun = 0;
const trigger = new PinchTrigger();

function set(patch: Partial<CameraState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useCamera = (): CameraState => useSyncExternalStore(subscribe, () => state);
export function onHandFrame(cb: (frame: HandFrame) => void): () => void {
  frameListeners.add(cb);
  return () => { frameListeners.delete(cb); };
}
const emitFrame = (hands: Landmark[][]) => frameListeners.forEach((cb) => cb({ hands, connections }));

function loop(): void {
  if (state.hand !== "on" || !landmarker || !video) return;
  raf = requestAnimationFrame(loop);
  const now = performance.now();
  if (now - lastRun < FRAME_MS || video.readyState < 2) return;
  lastRun = now;
  let hands: Landmark[][];
  try {
    hands = landmarker.detectForVideo(video, now).landmarks;
  } catch {
    return; // skip a bad frame rather than spamming the UI
  }
  emitFrame(hands);
  if (hands.length !== state.hands) set({ hands: hands.length });
  if (state.pinch && trigger.update(hands.length > 0 && isPinch(hands[0]), now)) triggerVoice();
}

export async function startCamera(): Promise<void> {
  if (state.camera !== "off") return;
  set({ camera: "starting", message: "Requesting camera…" });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "error";
    set({ camera: "off", message: name === "NotAllowedError" ? "Camera permission was denied. Check Windows camera privacy settings." : `Camera unavailable (${name}).` });
    return;
  }
  video ??= Object.assign(document.createElement("video"), { muted: true, playsInline: true });
  video.srcObject = stream;
  try { await video.play(); } catch { /* the display <video> will play it */ }
  set({ camera: "on", stream, message: "" });
}

export function stopCamera(): void {
  stopHand();
  state.stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
  set({ camera: "off", stream: null, message: "", pinch: false, hands: 0 });
}

function stopHand(): void {
  cancelAnimationFrame(raf);
  trigger.reset();
  set({ hand: "off", pinch: false, hands: 0 });
  emitFrame([]);
}

export async function setHandTracking(on: boolean): Promise<void> {
  if (!on) { stopHand(); return; }
  if (state.camera !== "on" || state.hand !== "off") return;
  set({ hand: "loading", message: "Loading hand-tracking model…" });
  if (!landmarker) {
    try {
      const mp = await import("@mediapipe/tasks-vision");
      const fileset = await mp.FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
      landmarker = await mp.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "./vendor/mediapipe/hand_landmarker.task" },
        runningMode: "VIDEO",
        numHands: 2,
      });
      connections = mp.HandLandmarker.HAND_CONNECTIONS;
    } catch {
      set({ hand: "off", message: MODEL_MISSING });
      return;
    }
  }
  if (state.camera !== "on") { set({ hand: "off", message: "" }); return; } // camera was turned off while loading
  set({ hand: "on", message: "" });
  raf = requestAnimationFrame(loop);
}

export function setPinchTrigger(on: boolean): void {
  if (state.hand !== "on") return;
  trigger.reset();
  set({ pinch: on });
}
