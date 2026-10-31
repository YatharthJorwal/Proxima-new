import { useEffect, useRef } from "react";
import { getGazeState, onGazePoint, useGaze } from "../vision/gazeStore";

const DWELL_MS = 350;
const CLEAR_MS = 600;

/**
 * Draws the optional gaze dot and highlights the card being looked at. Both
 * are cosmetic, driven straight from the engine's point stream (no React
 * re-render per frame), and only while eye tracking is on AND calibrated AND
 * the person is actually looking at the screen. A card must be looked at for
 * a moment before it lights up, so it doesn't flicker as your eyes move.
 */
export function GazeLayer() {
  const g = useGaze();
  const dot = useRef<HTMLDivElement>(null);
  const active = g.phase === "on" && g.calibrated && !g.calibrating;

  useEffect(() => {
    let candidate: Element | null = null;
    let since = 0;
    let current: Element | null = null;
    const clear = () => { current?.classList.remove("gaze-focus"); current = null; candidate = null; };
    if (!active) { dot.current?.classList.remove("on"); return clear; }

    const off = onGazePoint((p) => {
      const el = dot.current;
      const state = getGazeState();
      if (!p || state.attention !== "looking") { el?.classList.remove("on"); clear(); return; } // looking away or lost: nothing stays lit
      if (el && state.settings.showDot) { el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.classList.add("on"); } else el?.classList.remove("on");
      if (!state.settings.highlightCards) { clear(); return; }
      const now = performance.now();
      const panel = document.elementsFromPoint(p.x, p.y).map((e) => e.closest(".panel")).find(Boolean) ?? null;
      if (panel !== candidate) { candidate = panel; since = now; }
      if (panel && panel !== current && now - since >= DWELL_MS) { current?.classList.remove("gaze-focus"); panel.classList.add("gaze-focus"); current = panel; }
      else if (!panel && current && now - since >= CLEAR_MS) { current.classList.remove("gaze-focus"); current = null; }
    });
    return () => { off(); dot.current?.classList.remove("on"); clear(); };
  }, [active]);

  return <div className="gaze-dot" ref={dot} aria-hidden="true" />;
}
