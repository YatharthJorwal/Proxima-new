const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const extractZip = require("extract-zip");

const ROOT = path.join(__dirname, "..");
const MODELS_DIR = path.join(ROOT, "models");
const MODEL_FILE = path.join(MODELS_DIR, "ggml-model.bin");
const RUNTIME_DIR = path.join(MODELS_DIR, "whisper.cpp-b5454-cuda12.4");
const RUNTIME_ARCHIVE = path.join(MODELS_DIR, "whisper-cuda-12.4.0-x64.zip");
const EXTRACT_DIR = path.join(os.tmpdir(), `proxima-whisper-extract-${process.pid}`);
const RUNTIME_STAGING = path.join(MODELS_DIR, `.whisper-runtime-${process.pid}.tmp`);

const MODEL = {
  url: "https://huggingface.co/distil-whisper/distil-large-v3.5-ggml/resolve/main/ggml-model.bin",
  bytes: 1_519_521_155,
  sha256: "ec2498919b498c5f6b00041adb45650124b3cd9f26f545fffa8f5d11c28dcf26",
};
const RUNTIME = {
  url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip",
  bytes: 684_913_404,
  sha256: "afef0b881c500958921c3f5523b50e59ee2ec9b6f5cbd25b324c51ed308a957a",
};

async function downloadVerified(url, destination, expectedBytes, expectedSha, label) {
  const temp = `${destination}.part-${process.pid}`;
  const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Proxima-Windows-Setup" } });
  if (!response.ok || !response.body) throw new Error(`${label} download failed (HTTP ${response.status}).`);
  const hash = crypto.createHash("sha256");
  let received = 0;
  let lastReport = 0;
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      if (received - lastReport >= 64 * 1024 * 1024) {
        process.stdout.write(`\r${label}: ${(received / 1024 / 1024).toFixed(0)} MB downloaded`);
        lastReport = received;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(response.body, verifier, fs.createWriteStream(temp, { flags: "wx" }));
    process.stdout.write(`\r${label}: verifying download…\n`);
    const digest = hash.digest("hex");
    if (received !== expectedBytes || digest !== expectedSha) {
      throw new Error(`${label} checksum or size mismatch; refusing to use the downloaded file.`);
    }
    await fsp.rename(temp, destination);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function fileMatches(filePath, expectedBytes, expectedSha) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.size === expectedBytes && await sha256File(filePath) === expectedSha;
  } catch { return false; }
}

async function findFile(directory, name) {
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return candidate;
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function copyDirectory(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await fsp.copyFile(from, to);
  }
}

async function main() {
  await fsp.mkdir(MODELS_DIR, { recursive: true });
  const runtimeManifest = path.join(RUNTIME_DIR, "proxima-runtime.json");
  let runtimeReady = false;
  try {
    const manifest = JSON.parse(await fsp.readFile(runtimeManifest, "utf8"));
    runtimeReady = manifest.sha256 === RUNTIME.sha256 && await findFile(RUNTIME_DIR, "whisper-cli.exe") !== null;
  } catch { /* set up below */ }

  if (!runtimeReady) {
    if (!(await fileMatches(RUNTIME_ARCHIVE, RUNTIME.bytes, RUNTIME.sha256))) {
      await fsp.rm(RUNTIME_ARCHIVE, { force: true });
      console.log("Downloading the official whisper.cpp CUDA 12.4 Windows x64 build (about 685 MB)…");
      await downloadVerified(RUNTIME.url, RUNTIME_ARCHIVE, RUNTIME.bytes, RUNTIME.sha256, "whisper.cpp");
    } else {
      console.log("Reusing the previously verified whisper.cpp archive.");
    }
    await fsp.rm(EXTRACT_DIR, { recursive: true, force: true });
    await fsp.mkdir(EXTRACT_DIR, { recursive: true });
    await extractZip(RUNTIME_ARCHIVE, { dir: EXTRACT_DIR });
    const executable = await findFile(EXTRACT_DIR, "whisper-cli.exe");
    if (!executable) throw new Error("The verified release archive did not contain whisper-cli.exe.");
    await fsp.rm(RUNTIME_STAGING, { recursive: true, force: true });
    await copyDirectory(path.dirname(executable), RUNTIME_STAGING);
    await fsp.writeFile(path.join(RUNTIME_STAGING, "proxima-runtime.json"), JSON.stringify({ release: "ggml-org/whisper.cpp b5454 CUDA 12.4 x64", sha256: RUNTIME.sha256 }, null, 2));
    await fsp.rm(RUNTIME_DIR, { recursive: true, force: true });
    await fsp.rename(RUNTIME_STAGING, RUNTIME_DIR);
    await fsp.rm(RUNTIME_ARCHIVE, { force: true });
    await fsp.rm(EXTRACT_DIR, { recursive: true, force: true });
  }

  const modelReady = await fileMatches(MODEL_FILE, MODEL.bytes, MODEL.sha256);
  if (!modelReady) {
    console.log("Downloading Distil-Large-v3.5 GGML weights (about 1.52 GB)…");
    await fsp.rm(MODEL_FILE, { force: true });
    await downloadVerified(MODEL.url, MODEL_FILE, MODEL.bytes, MODEL.sha256, "Distil-Large-v3.5");
  }

  console.log("\nWhisper.cpp setup is ready.");
  console.log(`PROXY_WHISPER_CPP_EXE=${path.join(RUNTIME_DIR, "whisper-cli.exe")}`);
  console.log(`PROXY_WHISPER_CPP_MODEL=${MODEL_FILE}`);
  console.log("From the project root, restart Proxima to auto-detect these files. For an installed app, enter both paths in Settings. CPU STT remains the fallback.");
}

main().catch((error) => {
  console.error("Whisper setup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
  void fsp.rm(EXTRACT_DIR, { recursive: true, force: true }).catch(() => undefined);
  void fsp.rm(RUNTIME_STAGING, { recursive: true, force: true }).catch(() => undefined);
});
