import { useEffect, useRef } from "react";
import type { LogLine } from "../bridge/engineState";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });

export function LogView({ lines, limit, empty = "Every step shows up here as it happens." }: { lines: LogLine[]; limit?: number; empty?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = limit ? lines.slice(-limit) : lines;
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  if (shown.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="log" ref={ref} aria-live="polite"
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {shown.map((l, i) => {
        const prev = shown[i - 1];
        return (
          <div key={l.id}>
            {prev?.history && !l.history && <div className="log-divider">New session</div>}
            <div className="log-line">
              <span className="log-time num">{time(l.at)}</span>
              <span className={`log-kind kind-${l.kind}`}>{l.kind}</span>
              <span className="log-text">{l.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
