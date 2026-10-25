/**
 * The contract between the dashboard and the Proxima core.
 *
 * Everything the UI can receive or ask for is listed here, once. It mirrors
 * EngineEvents in src/core/engine.ts, the channel allowlist in
 * src/electron/preload.ts and the payload interfaces in src/commands/* —
 * if you add an engine event, add it here, in preload.ts and in main.ts.
 * Nothing in the UI talks to Electron except through `window.proxy`.
 */

export type ModelTier = "fast" | "smart";

export type RouteInfo =
  | { source: "regex"; handler: string }
  | { source: "llm-tool"; tools: string[] }
  | { source: "conversation" }
  | { source: "confirmation"; confirmed: boolean };

export type ConfirmationInfo = { path: string } | { description: string };

export interface SystemUsage {
  cpuPercent: number;
  totalMemMB: number;
  usedMemMB: number;
  usedMemPercent: number;
  topByMemory: { name: string; memMB: number }[];
  topByCpuTime: { name: string; cpuSeconds: number }[];
  /** null / missing = the counters could not be read (shown as unavailable, never as zeros). */
  disk?: { readBytesPerSec: number; writeBytesPerSec: number; busyPercent: number } | null;
  network?: { rxBytesPerSec: number; txBytesPerSec: number } | null;
  cpuCores?: number | null;
  processCount?: number | null;
  uptimeSeconds?: number | null;
}

export interface PresentDevice {
  name: string;
  kind: string;
  status: string;
}

export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  published: string;
  source: string;
  /** https image URL from the feed, or "". */
  image: string;
}

export interface MemoryFact {
  id: string;
  text: string;
  timestamp: string;
  /** Written or edited by you; automatic pruning never removes these first. */
  pinned?: boolean;
}

export type MemoryEdit = { ok: true; facts: MemoryFact[] } | { ok: false; error: string };

export interface LogEntry {
  kind: string;
  text: string;
  timestamp: string;
}

export interface Activation {
  enabled: boolean;
  listening: boolean;
  paused?: boolean;
}

export interface EngineEventPayloads {
  ready: { hotkey: string };
  busy: undefined;
  queued: string;
  listening: { maxMs: number };
  "speech-start": undefined;
  transcribing: undefined;
  transcribed: string;
  "no-speech": undefined;
  deciding: ModelTier;
  "tool-start": string;
  "tool-result": { name: string; result: string };
  thinking: string;
  responding: undefined;
  routed: RouteInfo;
  "awaiting-confirmation": ConfirmationInfo;
  reply: string;
  speaking: undefined;
  cancelled: undefined;
  idle: undefined;
  error: string;
  "log-history": LogEntry[];
  "system-usage": SystemUsage | null;
  "present-devices": PresentDevice[] | null;
  activation: Activation;
}

export type EngineEventName = keyof EngineEventPayloads;

export const ENGINE_EVENT_NAMES: EngineEventName[] = [
  "ready", "busy", "queued", "listening", "speech-start", "transcribing", "transcribed",
  "no-speech", "deciding", "tool-start", "tool-result", "thinking", "responding", "routed",
  "awaiting-confirmation", "reply", "speaking", "cancelled", "idle", "error", "log-history",
  "system-usage", "present-devices", "activation",
];

export type SettingsValues = Record<string, string>;

export type { SceneObjectSummary, StudioOp } from "../../../src/core/modelOps";
import type { SceneObjectSummary, StudioOp } from "../../../src/core/modelOps";

export interface PlanRequest {
  prompt: string;
  sceneUnit?: string;
  scene: SceneObjectSummary[];
  selected: number | null;
}
export type PlanResult = { ok: true; ops: StudioOp[]; summary: string } | { ok: false; error: string };

export interface ProximaBridge {
  on<K extends EngineEventName>(channel: K, callback: (payload: EngineEventPayloads[K]) => void): (() => void) | undefined;
  submitText(text: string): void;
  triggerVoice(): void;
  persistLogEntry(kind: string, text: string): void;
  clearLog(): void;
  getSettings(): Promise<SettingsValues>;
  saveSettings(values: SettingsValues): Promise<{ ok: boolean }>;
  fetchNews(): Promise<NewsItem[] | { error: string }>;
  getMemory(): Promise<MemoryFact[] | { error: string }>;
  clearMemory(): Promise<{ ok: boolean }>;
  addMemory(text: string): Promise<MemoryEdit>;
  updateMemory(id: string, text: string): Promise<MemoryEdit>;
  deleteMemory(ids: string[]): Promise<MemoryEdit>;
  getInstructions(): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  setInstructions(text: string): Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  /** Opens an https URL in the system browser. */
  openExternal(url: string): void;
  /** Sends a PNG of the 3D view (base64, no data: prefix) to the local vision model. */
  analyzeModelPreview(imageBase64: string): Promise<{ text?: string; error?: string }>;
  /** One validated JSON plan of 3D edit operations from the local model. */
  planModelEdit(request: PlanRequest): Promise<PlanResult>;
}

declare global {
  interface Window {
    proxy?: ProximaBridge;
  }
}
