import { beforeEach, describe, expect, it } from "vitest";
import { CALIBRATION_STALL_MS, EngineDeps, FACE_MODEL_MISSING, FRAME_MS, GazeEngine, GazePoint, KEYS, KeyValueStore } from "./gazeEngine";
import { FakeFaceOptions, makeFace } from "./syntheticFace";

const WIN = { screenX: 0, screenY: 0, innerWidth: 1600, innerHeight: 900, outerWidth: 1600, outerHeight: 900 };
const SCREEN = { width: 1920, height: 1080 };

function memoryStore(init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => { data[k] = v; }, remove: (k) => { delete data[k]; } };
}

/** What a person's eyes do when looking at screen point (nx, ny): the inverse of a plausible gaze-to-screen mapping. */
const gazeAt = (nx: number, ny: number, head = 0): FakeFaceOptions => ({ gx: 0.5 + (nx - 0.5) / 1.8, gy: 0.5 + (ny - 0.5) / 2.2, yaw: head, pitch: 0 });

function rig(opts: { camera?: boolean; failFace?: boolean; store?: ReturnType<typeof memoryStore>; screen?: typeof SCREEN } = {}) {
  let t = 0;
  let pending: (() => void) | null = null;
  const store = opts.store ?? memoryStore();
  const view: { face: FakeFaceOptions | null } = { face: gazeAt(0.5, 0.5) };
  let closed = false;
  let detections = 0;
  const deps: EngineDeps = {
    now: () => t,
    schedule: (cb) => { pending = cb; return () => { pending = null; }; },
    getVideo: () => ({ videoWidth: 640, videoHeight: 480 }),
    cameraOn: () => opts.camera !== false,
    createFace: async () => {
      if (opts.failFace) throw new Error("no model");
      return { detect: () => { detections++; return view.face ? makeFace({ ...view.face, aspect: 640 / 480 }) : null; }, close: () => { closed = true; } };
    },
    storage: store,
    geometry: () => ({ win: WIN, screen: opts.screen ?? SCREEN }),
  };
  const engine = new GazeEngine(deps);
  const points: (GazePoint | null)[] = [];
  engine.onPoint((p) => points.push(p));
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { t += FRAME_MS; pending?.(); } };
  const tickBy = (ms: number, n: number) => { for (let i = 0; i < n; i++) { t += ms; pending?.(); } };
  return { engine, view, tick, tickBy, store, points, isClosed: () => closed, now: () => t, detections: () => detections };
}

/** Runs the whole calibration, looking at each target the engine asks for. */
function calibrate(r: ReturnType<typeof rig>, head = 0) {
  r.engine.startCalibration();
  for (let guard = 0; guard < 2000 && r.engine.getState().calibrating; guard++) {
    const t = r.engine.getState().calibrating!.target;
    // The target is a fraction of the page; the screen fraction is what the person's eyes actually follow.
    r.view.face = gazeAt(t.x * 1600 / 1920, (t.y * 900 + 0) / 1080, head);
    r.tick();
  }
}

describe("starting and stopping", () => {
  it("won't start without the camera", async () => {
    const r = rig({ camera: false });
    await r.engine.start();
    expect(r.engine.getState()).toMatchObject({ phase: "off", message: "Turn the camera on first." });
  });

  it("says how to fix a missing face model and stays off", async () => {
    const r = rig({ failFace: true });
    await r.engine.start();
    expect(r.engine.getState()).toMatchObject({ phase: "off", message: FACE_MODEL_MISSING });
  });

  it("runs, and stop() releases the model and clears the point", async () => {
    const r = rig();
    await r.engine.start();
    expect(r.engine.getState().phase).toBe("on");
    r.engine.stop();
    expect(r.engine.getState()).toMatchObject({ phase: "off", attention: "no-face" });
    expect(r.isClosed()).toBe(true);
    expect(r.points[r.points.length - 1]).toBeNull();
    r.tick(5); // nothing is scheduled any more
    expect(r.engine.getState().phase).toBe("off");
  });
});

describe("attention (uncalibrated)", () => {
  it("follows a face looking at the screen, turning away, and leaving", async () => {
    const r = rig();
    await r.engine.start();
    r.tick(4);
    expect(r.engine.getState()).toMatchObject({ attention: "looking", faceSeen: true });
    r.view.face = { ...gazeAt(0.5, 0.5), yaw: 0.6 }; // head turned
    r.tick(8);
    expect(r.engine.getState().attention).toBe("away");
    r.view.face = null; // gone
    r.tick(20);
    expect(r.engine.getState()).toMatchObject({ attention: "no-face", faceSeen: false });
  });

  it("doesn't mistake a blink for looking away", async () => {
    const r = rig();
    await r.engine.start();
    r.tick(4);
    r.view.face = { ...gazeAt(0.5, 0.5), open: 0.1 };
    r.tick(15);
    expect(r.engine.getState().attention).toBe("looking");
  });

  it("limits itself to about 15 detections a second however often the scheduler calls it", async () => {
    const r = rig();
    await r.engine.start();
    r.tickBy(16, 125); // two seconds of ~60 fps scheduler calls
    expect(r.detections()).toBeGreaterThan(20);
    expect(r.detections()).toBeLessThanOrEqual(Math.ceil(2000 / FRAME_MS) + 1);
  });
});

describe("the pinch gate", () => {
  it("only applies when the option is on AND eye tracking is running", async () => {
    const r = rig();
    expect(r.engine.pinchAllowed()).toBe(true);
    r.engine.setSetting("gatePinch", true);
    expect(r.engine.pinchAllowed()).toBe(true); // not running: never blocks
    await r.engine.start();
    r.tick(4);
    expect(r.engine.pinchAllowed()).toBe(true); // looking
    r.view.face = { ...gazeAt(0.5, 0.5), yaw: 0.7 };
    r.tick(8);
    expect(r.engine.pinchAllowed()).toBe(false); // looking away
    r.engine.setSetting("gatePinch", false);
    expect(r.engine.pinchAllowed()).toBe(true);
  });
});

describe("calibration", () => {
  it("won't start unless eye tracking is on", () => {
    const r = rig();
    r.engine.startCalibration();
    expect(r.engine.getState().calibrating).toBeNull();
    expect(r.engine.getState().message).toContain("on first");
  });

  it("walks the nine targets, fits a model, saves it, and reports quality", async () => {
    const r = rig();
    await r.engine.start();
    r.engine.startCalibration();
    expect(r.engine.getState().calibrating).toMatchObject({ index: 0, total: 9 });
    calibrate(r);
    const s = r.engine.getState();
    expect(s.calibrating).toBeNull();
    expect(s.calibrated).toBe(true);
    expect(s.quality).toBeLessThan(0.08);
    expect(JSON.parse(r.store.data[KEYS.calibration]).model.version).toBe(1);
  });

  it("then locates gaze on the screen and smooths it", async () => {
    const r = rig();
    await r.engine.start();
    calibrate(r);
    r.points.length = 0;
    r.view.face = gazeAt(0.25, 0.7);
    r.tick(40);
    const p = r.points[r.points.length - 1]!;
    expect(Math.hypot(p.nx - 0.25, p.ny - 0.7)).toBeLessThan(0.06);
    // and reports it in page pixels for the UI
    expect(p.x).toBeCloseTo(p.nx * 1920 - WIN.screenX, 3);
    expect(p.y).toBeCloseTo(p.ny * 1080 - WIN.screenY, 3);
  });

  it("uses the predicted point for attention once calibrated: looking at the screen edge counts, far off doesn't", async () => {
    const r = rig();
    await r.engine.start();
    calibrate(r);
    r.view.face = gazeAt(0.95, 0.5);
    r.tick(10);
    expect(r.engine.getState().attention).toBe("looking");
    r.view.face = gazeAt(1.6, 0.5);
    r.tick(12);
    expect(r.engine.getState().attention).toBe("away");
  });

  it("gives up with a clear message if the face isn't visible", async () => {
    const r = rig();
    await r.engine.start();
    r.engine.startCalibration();
    r.view.face = null;
    r.tick(Math.ceil(CALIBRATION_STALL_MS / FRAME_MS) + 5);
    expect(r.engine.getState().calibrating).toBeNull();
    expect(r.engine.getState().message).toContain("face wasn't visible");
    expect(r.engine.getState().calibrated).toBe(false);
  });

  it("can be cancelled and reset", async () => {
    const r = rig();
    await r.engine.start();
    calibrate(r);
    expect(r.engine.getState().calibrated).toBe(true);
    r.engine.resetCalibration();
    expect(r.engine.getState()).toMatchObject({ calibrated: false, quality: null });
    expect(r.store.data[KEYS.calibration]).toBeUndefined();
    r.engine.startCalibration();
    r.engine.cancelCalibration("Cancelled.");
    expect(r.engine.getState()).toMatchObject({ calibrating: null, message: "Cancelled." });
  });

  it("rejects a calibration that is mostly noise rather than saving a bad one", async () => {
    const r = rig();
    await r.engine.start();
    r.engine.startCalibration();
    let seed = 5;
    for (let g = 0; g < 3000 && r.engine.getState().calibrating; g++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      r.view.face = null;
      if (g % 2 === 0) r.view.face = { gx: (seed / 4294967296), gy: ((seed >> 3) % 1000) / 1000, yaw: 0 };
      r.tick();
    }
    // it either gave up or finished, and if it finished it must not claim to be good
    const s = r.engine.getState();
    expect(s.calibrating).toBeNull();
    if (s.calibrated) expect(s.quality!).toBeGreaterThan(0.1);
  });
});

describe("saved calibration", () => {
  it("is restored by a new engine on the same screen", async () => {
    const a = rig();
    await a.engine.start();
    calibrate(a);
    const b = rig({ store: a.store });
    expect(b.engine.getState()).toMatchObject({ calibrated: true, message: "" });
    expect(b.engine.getState().quality).toBeCloseTo(a.engine.getState().quality!, 10);
  });

  it("is ignored, with a message, if the display changed", async () => {
    const a = rig();
    await a.engine.start();
    calibrate(a);
    const b = rig({ store: a.store, screen: { width: 2560, height: 1440 } });
    expect(b.engine.getState().calibrated).toBe(false);
    expect(b.engine.getState().message).toContain("Calibrate again");
  });

  it("survives damaged storage", () => {
    const bad = memoryStore({ [KEYS.calibration]: "{not json", [KEYS.settings]: "nope" });
    const r = rig({ store: bad });
    expect(r.engine.getState()).toMatchObject({ calibrated: false, settings: { gatePinch: false, highlightCards: true, showDot: false } });
    const tampered = memoryStore({ [KEYS.calibration]: JSON.stringify({ model: { version: 1, mean: [1], std: [1], wx: [], wy: [] }, quality: 0.05, screen: SCREEN }) });
    expect(rig({ store: tampered }).engine.getState().calibrated).toBe(false);
  });

  it("remembers settings, and records nothing about where anyone looked", async () => {
    const a = rig();
    a.engine.setSetting("gatePinch", true);
    a.engine.setSetting("showDot", true);
    const b = rig({ store: a.store });
    expect(b.engine.getState().settings).toEqual({ gatePinch: true, highlightCards: true, showDot: true });
    await a.engine.start();
    a.tick(30);
    expect(Object.keys(a.store.data).sort()).toEqual([KEYS.settings]); // no gaze trail, no calibration yet
  });
});
