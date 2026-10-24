/**
 * External store for engine state. The bridge subscribes at module load
 * (see main.tsx), BEFORE React renders: main.ts sends "ready" and
 * "log-history" exactly once after the page loads, and an IPC message with
 * no listener attached yet is silently dropped. Subscribing inside a React
 * effect would reintroduce that race.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Action, EngineState, initialState, reducer } from "./engineState";
import { ENGINE_EVENT_NAMES, EngineEventName, EngineEventPayloads } from "./types";
import { logLinesFor } from "./engineState";

let state: EngineState = initialState();
const listeners = new Set<() => void>();
let errorTimer: ReturnType<typeof setTimeout> | null = null;

export function dispatch(action: Action): void {
  const next = reducer(state, action);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getState = () => state;

export function useEngine(): EngineState {
  return useSyncExternalStore(subscribe, getState);
}

function handle<K extends EngineEventName>(name: K, payload: EngineEventPayloads[K]): void {
  dispatch({ type: "engine", name, payload, now: Date.now() });
  // Mirror what the log now shows to main for persistence (same contract as the classic dashboard).
  if (name !== "log-history") {
    for (const line of logLinesFor(name, payload)) window.proxy?.persistLogEntry(line.kind, line.text);
  }
  if (name === "error") {
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { errorTimer = null; dispatch({ type: "clear-error" }); }, 2200);
  }
}

/** Subscribe to every engine event. Returns an unsubscribe function. */
export function connectBridge(): () => void {
  const bridge = window.proxy;
  if (!bridge) return () => {};
  const offs = ENGINE_EVENT_NAMES.map((name) => bridge.on(name, (payload) => handle(name, payload as never)));
  return () => offs.forEach((off) => off?.());
}

export function submitText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  window.proxy?.submitText(trimmed);
  dispatch({ type: "typed", text: trimmed });
}

export function triggerVoice(): void { window.proxy?.triggerVoice(); }

export function clearLog(): void {
  dispatch({ type: "clear-log" });
  window.proxy?.clearLog();
}

/** Re-renders on an interval while `active`, for live elapsed timers. */
export function useNow(active: boolean, ms = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function useClock(): string {
  const [text, setText] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const id = setInterval(() => setText(formatClock(new Date())), 5000);
    return () => clearInterval(id);
  }, []);
  return text;
}
