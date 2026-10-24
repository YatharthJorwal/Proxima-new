/**
 * Pure state machine for everything the engine reports. No timers, no
 * Electron, no DOM — time comes in on the action, so the whole thing is
 * unit-testable (engineState.test.ts) and the UI can't drift from what the
 * engine actually did.
 *
 * Honesty rule carried over from the classic dashboard: steps are created
 * only by real events. A regex-matched command skips the orchestrator
 * events entirely, so it shows no "analyzing" step — nothing is invented.
 */

import type {
  Activation, EngineEventName, EngineEventPayloads, LogEntry, PresentDevice, RouteInfo, SystemUsage,
} from "./types";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error";
export type StepKind = "stage" | "tool" | "confirm";
export type StepStatus = "active" | "done" | "stopped";

export interface Step {
  id: number;
  label: string;
  sub?: string;
  kind: StepKind;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  /** Smart-tier "analyzing" step: the UI rotates friendly words while it runs. */
  smart?: boolean;
  /** The model's real reasoning trace, attached after the fact. */
  trace?: string;
}

export interface LogLine {
  id: number;
  kind: string;
  text: string;
  at: string;
  history?: boolean;
}

export type OutputView =
  | { mode: "idle" }
  | { mode: "listening" }
  | { mode: "thinking" }
  | { mode: "nothing" }
  | { mode: "reply"; text: string }
  | { mode: "error"; text: string };

export interface UsagePoint { at: number; cpu: number; mem: number }

export interface EngineState {
  nextId: number;
  ready: boolean;
  hotkey: string | null;
  startedAt: number | null;
  orb: OrbState;
  turnActive: boolean;
  steps: Step[];
  decidingId: number | null;
  output: OutputView;
  lastRoute: string | null;
  log: LogLine[];
  /** Typed text accepted while busy; the engine runs it when the current request ends. */
  queued: string | null;
  /** Bumped when queued text actually starts, so the input box knows to clear. */
  queuedStartSeq: number;
  flashAt: number;
  activation: Activation | null;
  /** undefined = no sample yet, null = the query failed (shown as unavailable, never as zeros). */
  usage: SystemUsage | null | undefined;
  usageHistory: UsagePoint[];
  devices: PresentDevice[] | null | undefined;
}

export type Action =
  | { type: "engine"; name: EngineEventName; payload: unknown; now: number }
  | { type: "typed"; text: string }
  | { type: "clear-error" }
  | { type: "clear-log" };

export const MAX_LOG_LINES = 500;
export const MAX_USAGE_POINTS = 40;

export function initialState(): EngineState {
  return {
    nextId: 1, ready: false, hotkey: null, startedAt: null, orb: "idle", turnActive: false,
    steps: [], decidingId: null, output: { mode: "idle" }, lastRoute: null, log: [], queued: null,
    queuedStartSeq: 0, flashAt: 0, activation: null, usage: undefined, usageHistory: [], devices: undefined,
  };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export function describeRoute(info: RouteInfo | null | undefined): string {
  if (!info) return "unknown routing";
  if (info.source === "regex") return `regex → ${info.handler}`;
  if (info.source === "llm-tool") return `LLM tool → ${info.tools.join(", ")}`;
  if (info.source === "confirmation") return info.confirmed ? "confirmation → confirmed" : "confirmation → cancelled";
  return "conversation (no command)";
}

/** The {kind, text} pairs an event adds to the session log (also what gets persisted). */
export function logLinesFor<K extends EngineEventName>(name: K, payload: EngineEventPayloads[K]): { kind: string; text: string }[] {
  switch (name) {
    case "listening": return [{ kind: "status", text: `listening (auto-stops after a pause, max ${Math.round((payload as { maxMs: number }).maxMs / 1000)}s)` }];
    case "speech-start": return [{ kind: "status", text: "hearing you..." }];
    case "busy": return [{ kind: "status", text: 'still working on the last request — press the hotkey again (or type "stop") to cancel it' }];
    case "queued": return [{ kind: "status", text: "queued — will run once the current request finishes" }];
    case "no-speech": return [{ kind: "status", text: "didn't catch anything" }];
    case "transcribed": return [{ kind: "heard", text: payload as string }];
    case "routed": return [{ kind: "routed", text: describeRoute(payload as RouteInfo) }];
    case "reply": return [{ kind: "reply", text: payload as string }];
    case "cancelled": return [{ kind: "status", text: "stopped" }];
    case "error": return [{ kind: "error", text: payload as string }];
    default: return [];
  }
}

const iso = (now: number) => new Date(now).toISOString();

function resolveLast(steps: Step[], now: number, patch: { label?: string; sub?: string; stopped?: boolean } = {}): Step[] {
  const last = steps[steps.length - 1];
  if (!last || last.status !== "active") return steps;
  const next: Step = { ...last, status: patch.stopped ? "stopped" : "done", endedAt: now };
  if (patch.label) next.label = patch.label;
  if (patch.sub) next.sub = patch.sub;
  return [...steps.slice(0, -1), next];
}

function addStep(s: EngineState, label: string, now: number, extra: Partial<Step> = {}): EngineState {
  const steps = resolveLast(s.steps, now);
  const step: Step = { id: s.nextId, label, kind: "stage", status: "active", startedAt: now, ...extra };
  return { ...s, nextId: s.nextId + 1, steps: [...steps, step] };
}

function withLog(s: EngineState, kind: string, text: string, now: number): EngineState {
  const line: LogLine = { id: s.nextId, kind, text, at: iso(now) };
  return { ...s, nextId: s.nextId + 1, log: [...s.log, line].slice(-MAX_LOG_LINES) };
}

function withLogs<K extends EngineEventName>(s: EngineState, name: K, payload: EngineEventPayloads[K], now: number): EngineState {
  return logLinesFor(name, payload).reduce((acc, line) => withLog(acc, line.kind, line.text, now), s);
}

function freshTurn(s: EngineState): EngineState {
  return { ...s, turnActive: true, steps: [], decidingId: null };
}

function reduceEngine(s: EngineState, name: EngineEventName, raw: unknown, now: number): EngineState {
  const payload = raw as never;
  switch (name) {
    case "ready": {
      const p = raw as EngineEventPayloads["ready"];
      return { ...s, ready: true, hotkey: p?.hotkey ?? s.hotkey, startedAt: now };
    }
    case "activation":
      return { ...s, activation: raw as Activation };
    case "log-history": {
      if (!Array.isArray(raw) || raw.length === 0) return s;
      let id = s.nextId;
      const history: LogLine[] = (raw as LogEntry[]).map((e) => ({ id: id++, kind: e.kind, text: e.text, at: e.timestamp, history: true }));
      return { ...s, nextId: id, log: [...history, ...s.log].slice(-MAX_LOG_LINES) };
    }
    case "listening": {
      let n = addStep(freshTurn(s), "Listening", now, { sub: "waiting for you to speak…" });
      n = { ...n, orb: "listening", output: { mode: "listening" } };
      return withLogs(n, name, payload, now);
    }
    case "speech-start": {
      const last = s.steps[s.steps.length - 1];
      const steps = last && last.status === "active" ? [...s.steps.slice(0, -1), { ...last, sub: "hearing you — pause when done" }] : s.steps;
      return withLogs({ ...s, steps }, name, payload, now);
    }
    case "busy":
    case "queued":
      return withLogs(s, name, payload, now);
    case "no-speech": {
      const n: EngineState = { ...s, steps: resolveLast(s.steps, now, { label: "Nothing heard", stopped: true }), orb: "idle", output: { mode: "nothing" } };
      return withLogs(n, name, payload, now);
    }
    case "transcribing":
      return addStep(s, "Understanding your words", now);
    case "transcribed": {
      const text = raw as string;
      // Typed input skips listening/transcribing, so this can be the first event of a turn.
      let n = s.turnActive ? { ...s, steps: resolveLast(s.steps, now, { sub: truncate(text, 60) }) } : freshTurn(s);
      if (n.queued !== null) n = { ...n, queued: null, queuedStartSeq: n.queuedStartSeq + 1 };
      n = { ...n, orb: "thinking", output: { mode: "thinking" } };
      return withLogs(n, name, payload, now);
    }
    case "deciding": {
      const tier = raw as EngineEventPayloads["deciding"];
      const n = addStep(s, "Analyzing Input", now, { sub: tier === "smart" ? "smart tier" : "fast tier", smart: tier === "smart" });
      return { ...n, decidingId: n.nextId - 1 };
    }
    case "tool-start": {
      const n = addStep(s, `Running: ${raw as string}`, now, { kind: "tool" });
      return { ...n, flashAt: now };
    }
    case "tool-result": {
      const p = raw as EngineEventPayloads["tool-result"];
      return { ...s, steps: resolveLast(s.steps, now, { sub: truncate(String(p?.result ?? ""), 70) }) };
    }
    case "awaiting-confirmation": {
      const info = raw as EngineEventPayloads["awaiting-confirmation"];
      const label = "path" in info ? `run ${info.path}` : `click "${info.description}"`;
      const n = addStep(s, `Awaiting confirmation: ${label}`, now, { kind: "confirm" });
      return { ...n, flashAt: now };
    }
    case "thinking": {
      if (s.decidingId === null) return s;
      return { ...s, steps: s.steps.map((st) => (st.id === s.decidingId ? { ...st, trace: raw as string } : st)) };
    }
    case "responding":
      return addStep(s, "Responding", now);
    case "routed": {
      const info = raw as RouteInfo;
      const n: EngineState = { ...s, lastRoute: describeRoute(info), flashAt: info?.source === "regex" ? now : s.flashAt };
      return withLogs(n, name, payload, now);
    }
    case "reply": {
      const n: EngineState = { ...s, steps: resolveLast(s.steps, now), output: { mode: "reply", text: raw as string } };
      return withLogs(n, name, payload, now);
    }
    case "speaking":
      return { ...s, orb: "speaking" };
    case "cancelled": {
      const n: EngineState = { ...s, steps: resolveLast(s.steps, now, { stopped: true }), queued: null };
      return withLogs(n, name, payload, now);
    }
    case "idle": {
      const steps = s.steps.map((st) => (st.status === "active" ? { ...st, status: "done" as const, endedAt: now } : st));
      return { ...s, turnActive: false, steps, orb: s.orb === "error" ? "error" : "idle" };
    }
    case "error": {
      const message = String(raw);
      const n: EngineState = { ...s, steps: resolveLast(s.steps, now, { stopped: true, sub: truncate(message, 70) }), orb: "error", output: { mode: "error", text: message } };
      return withLogs(n, name, payload, now);
    }
    case "system-usage": {
      const u = raw as SystemUsage | null;
      const ok = !!u && typeof u === "object" && Number.isFinite(Number(u.cpuPercent)) && Number.isFinite(Number(u.usedMemPercent));
      if (!ok) return { ...s, usage: null };
      const point: UsagePoint = { at: now, cpu: Math.max(0, Math.min(100, Number(u.cpuPercent))), mem: Math.max(0, Math.min(100, Number(u.usedMemPercent))) };
      return { ...s, usage: u, usageHistory: [...s.usageHistory, point].slice(-MAX_USAGE_POINTS) };
    }
    case "present-devices":
      return { ...s, devices: Array.isArray(raw) ? (raw as PresentDevice[]) : null };
    default:
      return s;
  }
}

export function reducer(s: EngineState, a: Action): EngineState {
  switch (a.type) {
    case "engine": return reduceEngine(s, a.name, a.payload, a.now);
    case "typed": return s.turnActive ? { ...s, queued: a.text } : s;
    case "clear-error": return s.orb === "error" ? { ...s, orb: "idle" } : s;
    case "clear-log": return { ...s, log: [] };
    default: return s;
  }
}
