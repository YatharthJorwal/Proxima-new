/**
 * Browser wiring for the gaze engine: the real clock and frame loop, the
 * camera's hidden <video>, localStorage, window geometry and the MediaPipe
 * face model. One engine for the whole session, so eye tracking keeps
 * running while you move between pages (like hand tracking does).
 */
import { useSyncExternalStore } from "react";
import { getCameraState, getCameraVideo, setPinchGate, subscribeCamera } from "./cameraStore";
import { createFaceLandmarkerSource } from "./faceSource";
import { EngineDeps, FaceSource, GazeEngine, GazePoint, GazeSettings, GazeState } from "./gazeEngine";
import { FakeFaceOptions, makeFace } from "./syntheticFace";

/**
 * Test mode only: when a page sets window.__PROXIMA_FAKE_FACE__ = true, a
 * synthetic face (window.__PROXIMA_FAKE_GAZE__) stands in for the camera and
 * the model. Nothing in the app sets it; it exists so the calibration screens
 * can be exercised in automated runs without a webcam.
 */
type TestWindow = Window & { __PROXIMA_FAKE_FACE__?: boolean; __PROXIMA_FAKE_GAZE__?: FakeFaceOptions | null };
const fake = () => (window as TestWindow).__PROXIMA_FAKE_FACE__ === true;

const fakeSource: FaceSource = {
  detect: () => {
    const g = (window as TestWindow).__PROXIMA_FAKE_GAZE__;
    return g === null ? null : makeFace({ aspect: 640 / 480, ...(g ?? {}) });
  },
};

const storage = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
  remove: (k: string) => { try { localStorage.removeItem(k); } catch { /* unavailable */ } },
};

const deps: EngineDeps = {
  now: () => performance.now(),
  schedule: (cb) => { const id = requestAnimationFrame(cb); return () => cancelAnimationFrame(id); },
  getVideo: () => (fake() ? { videoWidth: 640, videoHeight: 480 } : getCameraVideo()),
  cameraOn: () => fake() || getCameraState().camera === "on",
  createFace: () => (fake() ? Promise.resolve(fakeSource) : createFaceLandmarkerSource()),
  storage,
  geometry: () => {
    const s = window.screen as Screen & { availLeft?: number; availTop?: number };
    return {
      win: { screenX: window.screenX, screenY: window.screenY, innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight },
      screen: { width: s.width, height: s.height, availLeft: s.availLeft, availTop: s.availTop },
    };
  },
};

const engine = new GazeEngine(deps);

// Eye tracking can veto the camera pinch trigger (only if the person enabled that), and can't outlive the camera.
setPinchGate(() => engine.pinchAllowed());
subscribeCamera(() => {
  if (!fake() && getCameraState().camera !== "on" && engine.getState().phase !== "off") engine.stop("The camera was turned off.");
});

/** Whether eye tracking may start: the camera is on (or the test-only synthetic face is active). */
export const cameraReadyForGaze = (cameraPhase: string): boolean => fake() || cameraPhase === "on";

export const useGaze = (): GazeState => useSyncExternalStore((l) => engine.subscribe(l), () => engine.getState());
export const getGazeState = (): GazeState => engine.getState();
export const onGazePoint = (cb: (p: GazePoint | null) => void): (() => void) => engine.onPoint(cb);
export const startEyeTracking = (): Promise<void> => engine.start();
export const stopEyeTracking = (): void => engine.stop();
export const startCalibration = (): void => engine.startCalibration();
export const cancelCalibration = (message?: string): void => engine.cancelCalibration(message);
export const resetCalibration = (): void => engine.resetCalibration();
export const setGazeSetting = <K extends keyof GazeSettings>(key: K, value: GazeSettings[K]): void => engine.setSetting(key, value);
