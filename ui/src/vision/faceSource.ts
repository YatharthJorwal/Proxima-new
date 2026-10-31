import type { FaceSource } from "./gazeEngine";

/**
 * The real face model (MediaPipe FaceLandmarker, 478 landmarks including
 * irises). Imported lazily so a missing model or wasm file only disables eye
 * tracking. Throws if the model can't be loaded; the engine turns that into
 * the "run npm run setup:cv" message.
 */
export async function createFaceLandmarkerSource(): Promise<FaceSource> {
  const mp = await import("@mediapipe/tasks-vision");
  const fileset = await mp.FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
  const landmarker = await mp.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: "./vendor/mediapipe/face_landmarker.task" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return {
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video as unknown as HTMLVideoElement, timestampMs);
      return result.faceLandmarks[0] ?? null;
    },
    close() { landmarker.close(); },
  };
}
