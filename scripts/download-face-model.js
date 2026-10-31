/**
 * Downloads MediaPipe's face_landmarker.task (the model eye tracking uses) to
 * models/face_landmarker.task. Run via `npm run setup:cv`, once.
 *
 * The URL is Google's published location for the float16 face landmarker. It
 * could not be checked from the environment this was written in, so if the
 * download fails, get the file from the MediaPipe "Face Landmarker" docs page
 * and save it as models/face_landmarker.task by hand.
 *
 * Writes to a temp file and renames it only after a size check, so an
 * interrupted download never leaves a broken model behind.
 */
const fs = require("fs");
const https = require("https");
const path = require("path");

const URL_ = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const dir = path.join(__dirname, "..", "models");
const target = path.join(dir, "face_landmarker.task");
const MIN_BYTES = 1_000_000; // the real file is a few MB; anything much smaller is an error page

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    }).on("error", reject);
  });
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(target) && fs.statSync(target).size >= MIN_BYTES) {
    console.log("models/face_landmarker.task is already there.");
    return;
  }
  const tmp = `${target}.download`;
  try {
    console.log("Downloading the face model…");
    await download(URL_, tmp);
    const size = fs.statSync(tmp).size;
    if (size < MIN_BYTES) throw new Error(`downloaded file is only ${size} bytes`);
    fs.renameSync(tmp, target);
    console.log(`Saved models/face_landmarker.task (${(size / 1e6).toFixed(1)} MB).`);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    console.error(`\nCould not download the face model: ${err.message}\nSave face_landmarker.task from the MediaPipe Face Landmarker docs into models/ by hand, then run npm run build.\n`);
    process.exitCode = 1;
  }
})();
