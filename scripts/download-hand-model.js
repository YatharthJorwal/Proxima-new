/**
 * One-time setup: downloads the hand-tracking model MediaPipe's
 * HandLandmarker needs (Milestone 7, CV). Run this once:
 *
 *   npm run setup:cv
 *
 * Why this is a separate manual step instead of happening automatically:
 * the model file (~7-9MB) is hosted on Google's model CDN
 * (storage.googleapis.com), not bundled in the @mediapipe/tasks-vision
 * npm package — same situation as the Piper voice model in README.md
 * (`piper --download en_US-lessac-medium`), just for a different
 * ecosystem. Keeping it a deliberate, visible step rather than an
 * automatic fetch also fits the project's stance on not silently pulling
 * things off the network without telling you.
 *
 * Saves to models/hand_landmarker.task (gitignored — it's a downloaded
 * binary asset, regenerate it by re-running this script rather than
 * committing it; the repo already has one committed-binary precedent
 * with the Piper voice files, this one's just kept out on purpose since
 * nothing about it needs to be shared/versioned).
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Google's official MediaPipe model URL for the float16 HandLandmarker,
// per @mediapipe/tasks-vision's own README example.
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const outDir = path.join(__dirname, "..", "models");
const outPath = path.join(outDir, "hand_landmarker.task");

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error("Too many redirects"));
          res.resume();
          return resolve(download(res.headers.location, dest, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`Downloading hand-tracking model to ${outPath} ...`);
  await download(MODEL_URL, outPath);
  const { size } = fs.statSync(outPath);
  console.log(`Done — ${(size / (1024 * 1024)).toFixed(1)}MB. Run "npm run build" to include it in the dashboard.`);
}

main().catch((err) => {
  console.error("Failed to download the hand-tracking model:", err.message);
  console.error(`You can also download it manually from:\n  ${MODEL_URL}\nand save it as: ${outPath}`);
  process.exit(1);
});
