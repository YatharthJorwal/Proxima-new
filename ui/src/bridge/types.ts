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
}

export interface MemoryFact {
  id: string;
  text: string;
  timestamp: string;
}

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
export type ClassicView = "camera" | "studio";

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
  /** Opens the classic dashboard on a page that hasn't moved to the new shell yet. */
  openClassic(view: ClassicView): void;
}

declare global {
  interface Window {
    proxy?: ProximaBridge;
  }
}
