import { describe, expect, it } from "vitest";
import { clientToScreenNorm, sameScreen, screenNormToClient } from "./screen";

const screen = { width: 1920, height: 1080 };
const win = { screenX: 100, screenY: 50, innerWidth: 1280, innerHeight: 700, outerWidth: 1296, outerHeight: 739 };

describe("window <-> screen mapping", () => {
  it("round-trips any point", () => {
    for (const [x, y] of [[0, 0], [640, 350], [1279, 699]]) {
      const n = clientToScreenNorm(x, y, win, screen);
      const back = screenNormToClient(n.x, n.y, win, screen);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it("puts the page below the title bar and inside the side borders", () => {
    const n = clientToScreenNorm(0, 0, win, screen);
    expect(n.x).toBeCloseTo((100 + 8) / 1920, 6); // 8 px side border
    expect(n.y).toBeCloseTo((50 + 31) / 1080, 6); // 739-700-8 = 31 px title bar
  });

  it("keeps a calibrated screen point valid after the window moves", () => {
    const fixed = { x: 0.5, y: 0.5 }; // a spot on the monitor
    const before = screenNormToClient(fixed.x, fixed.y, win, screen);
    const moved = { ...win, screenX: 300, screenY: 120 };
    const after = screenNormToClient(fixed.x, fixed.y, moved, screen);
    expect(after.x).toBeCloseTo(before.x - 200, 6);
    expect(after.y).toBeCloseTo(before.y - 70, 6);
  });

  it("copes with a maximised window (no frame) and a monitor offset", () => {
    const max = { screenX: 0, screenY: 0, innerWidth: 1920, innerHeight: 1080, outerWidth: 1920, outerHeight: 1080 };
    expect(clientToScreenNorm(960, 540, max, screen)).toEqual({ x: 0.5, y: 0.5 });
    const second = { width: 1920, height: 1080, availLeft: 1920, availTop: 0 };
    const w2 = { ...max, screenX: 1920 };
    expect(clientToScreenNorm(960, 540, w2, second).x).toBeCloseTo(0.5, 6);
  });

  it("recognises when the display changed", () => {
    expect(sameScreen(screen, { width: 1920, height: 1080 })).toBe(true);
    expect(sameScreen(screen, { width: 2560, height: 1440 })).toBe(false);
    expect(sameScreen(screen, { ...screen, availLeft: 1920 })).toBe(false);
  });
});
