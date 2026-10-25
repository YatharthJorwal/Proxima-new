import * as THREE from "three";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Blender-style "turntable" camera: orbits a target point, pans in the view
 * plane, zooms by distance. Pure math on a camera — no DOM — so it is unit
 * tested (rig.test.ts). ViewHelper animates the camera directly; call
 * syncFromCamera() afterwards so the next orbit/pan continues from there.
 */
export class CameraRig {
  static readonly MIN_DISTANCE = 0.5;
  static readonly MAX_DISTANCE = 400;
  static readonly MAX_PITCH = 1.5; // just short of straight up/down so lookAt never degenerates

  readonly target = new THREE.Vector3(0, 0.5, 0);
  yaw = 0.7;
  pitch = 0.45;
  distance = 11;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    this.apply();
  }

  apply(): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + this.distance * cp * Math.sin(this.yaw),
      this.target.y + this.distance * Math.sin(this.pitch),
      this.target.z + this.distance * cp * Math.cos(this.yaw),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Drag deltas in pixels. */
  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.008;
    this.pitch = clamp(this.pitch + dy * 0.008, -CameraRig.MAX_PITCH, CameraRig.MAX_PITCH);
    this.apply();
  }

  /** Drag deltas in pixels; viewportHeight converts pixels to scene units at the target's depth. */
  pan(dx: number, dy: number, viewportHeight: number): void {
    const unitsPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.distance) / Math.max(1, viewportHeight);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.target.addScaledVector(right, -dx * unitsPerPixel).addScaledVector(up, dy * unitsPerPixel);
    this.apply();
  }

  /** factor < 1 moves closer, > 1 moves away. */
  zoom(factor: number): void {
    this.distance = clamp(this.distance * factor, CameraRig.MIN_DISTANCE, CameraRig.MAX_DISTANCE);
    this.apply();
  }

  /** Centre on a box and back off far enough to fit it; null resets to the default view. */
  frame(box: THREE.Box3 | null): void {
    if (!box || box.isEmpty()) {
      this.target.set(0, 0.5, 0);
      this.distance = 11;
    } else {
      const size = box.getSize(new THREE.Vector3());
      box.getCenter(this.target);
      const radius = Math.max(size.length() / 2, 0.25);
      const fit = radius / Math.sin(THREE.MathUtils.degToRad(Math.min(this.camera.fov, this.camera.fov * this.camera.aspect)) / 2);
      this.distance = clamp(fit * 1.15, CameraRig.MIN_DISTANCE, CameraRig.MAX_DISTANCE);
    }
    this.apply();
  }

  /** Re-derive yaw/pitch/distance from the camera's current position (after a ViewHelper animation). */
  syncFromCamera(): void {
    const offset = this.camera.position.clone().sub(this.target);
    const d = offset.length();
    if (d < 1e-6) return;
    this.distance = clamp(d, CameraRig.MIN_DISTANCE, CameraRig.MAX_DISTANCE);
    this.yaw = Math.atan2(offset.x, offset.z);
    this.pitch = clamp(Math.asin(clamp(offset.y / d, -1, 1)), -Math.PI / 2, Math.PI / 2);
  }

  /** Scene units per screen pixel at the target — used to turn mouse movement into sizes. */
  unitsPerPixel(viewportHeight: number): number {
    return (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.distance) / Math.max(1, viewportHeight);
  }
}
