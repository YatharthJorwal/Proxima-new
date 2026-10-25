/**
 * Maps normalised landmark coordinates (0–1 against the FULL camera frame) to
 * canvas pixels for a video shown with `object-fit: cover` (scaled up to fill,
 * then cropped). Without this the skeleton drifts off the hand near the edges.
 */
export function coverMapper(video: { w: number; h: number }, canvas: { w: number; h: number }): ((nx: number, ny: number) => [number, number]) | null {
  if (!video.w || !video.h || !canvas.w || !canvas.h) return null;
  const scale = Math.max(canvas.w / video.w, canvas.h / video.h);
  const offsetX = (video.w - canvas.w / scale) / 2;
  const offsetY = (video.h - canvas.h / scale) / 2;
  return (nx, ny) => [(nx * video.w - offsetX) * scale, (ny * video.h - offsetY) * scale];
}
