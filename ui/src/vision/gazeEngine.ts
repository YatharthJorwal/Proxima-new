/**
 * Eye tracking, minus the browser. Everything the browser provides (time,
 * frame scheduling, the camera frame, storage, window geometry, the MediaPipe
 * model) is injected, so the whole thing - attention, calibration, saving,
 * the pinch gate - is tested with synthetic faces in gazeEngine.test.ts.
 *
 * Privacy rules this file enforces: nothing about where you look is stored or
 * logged; only the calibration numbers are saved. Gaze is never an input that
 * starts an action - the only effect it has on anything is to SUPPRESS the
 * camera pinch trigger, and only if the person turned that option on.
 */
import { Attention, AttentionTracker, rawAttention } from "./attention";
import { CalibrationSession, DEFAULT_TARGETS, fitCalibration, GazeModel, parseModel, predict } from "./calibration";
import { PointFilter } from "./filter";
import { gazeFeatures, P } from "./gaze";
import { clientToScreenNorm, sameScreen, screenNormToClient, ScreenGeometry, WindowGeometry } from "./screen";

export interface VideoLike { videoWidth: number; videoHeight: number }
export interface FaceSource { detect(video: VideoLike, timestampMs: number): P[] | null; close?(): void }
export interface KeyValueStore { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }

export interface EngineDeps {
  now(): number;
  schedule(cb: () => void): () => void;
  getVideo(): VideoLike | null;
  cameraOn(): boolean;
  createFace(): Promise<FaceSource>;
  storage: KeyValueStore;
  geometry(): { win: WindowGeometry; screen: ScreenGeometry };
}

export interface GazeSettings { gatePinch: boolean; highlightCards: boolean; showDot: boolean }
export type GazePhase = "off" | "loading" | "on";

export interface GazeState {
  phase: GazePhase;
  attention: Attention;
  faceSeen: boolean;
  calibrated: boolean;
  /** Typical error on held-out targets as a fraction of the screen (0.06 = 6%), or null. */
  quality: number | null;
  message: string;
  calibrating: null | { index: number; total: number; progress: number; target: { x: number; y: number } };
  settings: GazeSettings;
}

/** Where the person is looking: in page pixels, and as fractions of the screen. */
export interface GazePoint { x: number; y: number; nx: number; ny: number }

export const FRAME_MS = 66; // ~15 fps: plenty for gaze, and it halves the cost of running next to hand tracking
export const CALIBRATION_STALL_MS = 6000;
export const FACE_MODEL_MISSING = 'Face model not found. Run "npm run setup:cv", then rebuild.';
export const KEYS = { calibration: "proxima.gaze.calibration", settings: "proxima.gaze.settings" } as const;
const DEFAULT_SETTINGS: GazeSettings = { gatePinch: false, highlightCards: true, showDot: false };

export class GazeEngine {
  private state: GazeState;
  private readonly listeners = new Set<() => void>();
  private readonly pointListeners = new Set<(p: GazePoint | null) => void>();
  private source: FaceSource | null = null;
  private cancelLoop: (() => void) | null = null;
  private readonly tracker = new AttentionTracker();
  private readonly filter = new PointFilter(1.2, 0.03);
  private model: GazeModel | null = null;
  private session: CalibrationSession | null = null;
  private lastRun = -Infinity;
  private lastCalEmit = 0;

  constructor(private readonly deps: EngineDeps) {
    const settings = this.loadSettings();
    const saved = this.loadCalibration();
    this.model = saved?.model ?? null;
    this.state = {
      phase: "off", attention: "no-face", faceSeen: false, calibrated: !!saved, quality: saved?.quality ?? null,
      message: saved === undefined ? "The screen setup changed since you calibrated. Calibrate again." : "", calibrating: null, settings,
    };
  }

  // ---- state ----
  getState(): GazeState { return this.state; }
  subscribe(l: () => void): () => void { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  onPoint(l: (p: GazePoint | null) => void): () => void { this.pointListeners.add(l); return () => { this.pointListeners.delete(l); }; }
  private set(patch: Partial<GazeState>): void { this.state = { ...this.state, ...patch }; this.listeners.forEach((l) => l()); }
  private emitPoint(p: GazePoint | null): void { this.pointListeners.forEach((l) => l(p)); }

  // ---- persistence ----
  private loadSettings(): GazeSettings {
    try {
      const raw = JSON.parse(this.deps.storage.get(KEYS.settings) ?? "null");
      if (raw && typeof raw === "object") {
        return { gatePinch: raw.gatePinch === true, highlightCards: raw.highlightCards !== false, showDot: raw.showDot === true };
      }
    } catch { /* fall through to defaults */ }
    return { ...DEFAULT_SETTINGS };
  }

  /** undefined = saved calibration exists but is for a different display; null = none saved. */
  private loadCalibration(): { model: GazeModel; quality: number } | null | undefined {
    try {
      const raw = JSON.parse(this.deps.storage.get(KEYS.calibration) ?? "null");
      if (!raw) return null;
      const model = parseModel(raw.model);
      const quality = typeof raw.quality === "number" && Number.isFinite(raw.quality) ? raw.quality : null;
      if (!model || quality === null || !raw.screen) return null;
      return sameScreen(raw.screen, this.deps.geometry().screen) ? { model, quality } : undefined;
    } catch { return null; }
  }

  setSetting<K extends keyof GazeSettings>(key: K, value: GazeSettings[K]): void {
    const settings = { ...this.state.settings, [key]: value };
    try { this.deps.storage.set(KEYS.settings, JSON.stringify(settings)); } catch { /* storage unavailable: the choice lasts for this session */ }
    this.set({ settings });
  }

  // ---- lifecycle ----
  async start(): Promise<void> {
    if (this.state.phase !== "off") return;
    if (!this.deps.cameraOn()) { this.set({ message: "Turn the camera on first." }); return; }
    this.set({ phase: "loading", message: "Loading the face model…" });
    try {
      this.source = await this.deps.createFace();
    } catch {
      this.source = null;
      this.set({ phase: "off", message: FACE_MODEL_MISSING });
      return;
    }
    if (this.currentPhase() !== "loading" || !this.deps.cameraOn()) { this.release(); this.set({ phase: "off", message: "" }); return; } // stopped or camera turned off while loading
    this.tracker.reset();
    this.filter.reset();
    this.lastRun = -Infinity;
    this.set({ phase: "on", message: "", attention: "no-face", faceSeen: false });
    const loop = () => { this.cancelLoop = this.deps.schedule(loop); this.step(this.deps.now()); };
    this.cancelLoop = this.deps.schedule(loop);
  }

  /** Read through a method so TypeScript doesn't assume the phase is unchanged across the await in start(). */
  private currentPhase(): GazePhase { return this.state.phase; }

  stop(message = ""): void {
    this.release();
    this.session = null;
    this.tracker.reset();
    this.emitPoint(null);
    this.set({ phase: "off", attention: "no-face", faceSeen: false, calibrating: null, message });
  }

  private release(): void {
    this.cancelLoop?.();
    this.cancelLoop = null;
    try { this.source?.close?.(); } catch { /* already closed */ }
    this.source = null;
  }

  // ---- calibration ----
  startCalibration(): void {
    if (this.state.phase !== "on") { this.set({ message: "Turn eye tracking on first." }); return; }
    this.session = new CalibrationSession(DEFAULT_TARGETS, 800, 22, this.deps.now());
    this.filter.reset();
    this.emitPoint(null);
    this.set({ calibrating: this.calibrationInfo(), message: "" });
  }

  cancelCalibration(message = ""): void {
    this.session = null;
    this.set({ calibrating: null, message });
  }

  resetCalibration(): void {
    this.model = null;
    try { this.deps.storage.remove(KEYS.calibration); } catch { /* nothing to remove */ }
    this.filter.reset();
    this.emitPoint(null);
    this.set({ calibrated: false, quality: null, message: "" });
  }

  private calibrationInfo(): GazeState["calibrating"] {
    const s = this.session;
    const t = s?.target;
    return s && t ? { index: s.index, total: s.targets.length, progress: s.progress, target: { x: t.x, y: t.y } } : null;
  }

  private finishCalibration(): void {
    const s = this.session!;
    this.session = null;
    const fit = fitCalibration(s.samples);
    if (!fit) {
      this.set({ calibrating: null, message: "That didn't give enough clear samples. Keep your face in view, in good light, and try again." });
      return;
    }
    this.model = fit.model;
    try { this.deps.storage.set(KEYS.calibration, JSON.stringify({ model: fit.model, quality: fit.quality, screen: this.deps.geometry().screen, savedAt: Date.now() })); } catch { /* keep it for this session */ }
    this.filter.reset();
    this.set({ calibrating: null, calibrated: true, quality: fit.quality, message: "" });
  }

  // ---- per-frame work ----
  private step(now: number): void {
    if (this.state.phase !== "on" || !this.source) return;
    if (now - this.lastRun < FRAME_MS) return;
    this.lastRun = now;
    const video = this.deps.getVideo();
    if (!video || !video.videoWidth || !video.videoHeight) return;
    let landmarks: P[] | null;
    try { landmarks = this.source.detect(video, now); } catch { return; } // skip a bad frame
    const faceSeen = !!landmarks;
    const features = landmarks ? gazeFeatures(landmarks, video.videoWidth / video.videoHeight) : null;

    if (this.session) { this.stepCalibration(features, faceSeen, now); return; }

    let point: { x: number; y: number } | null = null;
    if (features && this.model) {
      const raw = predict(this.model, features);
      point = this.filter.filter(raw.x, raw.y, now);
      const { win, screen } = this.deps.geometry();
      const c = screenNormToClient(point.x, point.y, win, screen);
      this.emitPoint({ x: c.x, y: c.y, nx: point.x, ny: point.y });
    } else if (!faceSeen) {
      this.filter.reset();
      this.emitPoint(null);
    }
    const attention = this.tracker.update(rawAttention(faceSeen, features, point), now);
    if (attention !== this.state.attention || faceSeen !== this.state.faceSeen) this.set({ attention, faceSeen });
  }

  private stepCalibration(features: ReturnType<typeof gazeFeatures>, faceSeen: boolean, now: number): void {
    const s = this.session!;
    const t = s.target;
    if (!t) return;
    const { win, screen } = this.deps.geometry();
    const label = clientToScreenNorm(t.x * win.innerWidth, t.y * win.innerHeight, win, screen);
    const event = s.add(features, now, label);
    if (event === "done") { this.finishCalibration(); return; }
    if (now - s.lastSampleAt > CALIBRATION_STALL_MS) { this.cancelCalibration("Calibration stopped: your face wasn't visible long enough. Check the camera and the light, then try again."); return; }
    if (faceSeen !== this.state.faceSeen) this.set({ faceSeen });
    const info = this.calibrationInfo();
    const prev = this.state.calibrating;
    if (event === "advanced" || !prev || info!.index !== prev.index || now - this.lastCalEmit > 100) { this.lastCalEmit = now; this.set({ calibrating: info }); }
  }

  /** Whether the camera pinch trigger may fire right now. */
  pinchAllowed(): boolean {
    if (!this.state.settings.gatePinch || this.state.phase !== "on") return true; // the gate only applies while eye tracking is running
    return this.state.attention === "looking";
  }
}
