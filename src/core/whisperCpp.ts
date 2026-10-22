import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

function floatAudioToWav(audio: Float32Array): Buffer {
  const dataSize = audio.length * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < audio.length; i++) {
    const sample = Math.max(-1, Math.min(1, audio[i]));
    wav.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  return wav;
}

export async function transcribeWithWhisperCpp(audio: Float32Array, executable: string, model: string): Promise<string> {
  const input = path.join(os.tmpdir(), `proxima-stt-${randomUUID()}.wav`);
  await fs.writeFile(input, floatAudioToWav(audio));
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(executable, ["-m", model, "-f", input, "-l", "en", "-nt", "-np"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, Number(process.env.PROXY_STT_TIMEOUT_MS) || 90_000);
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-200_000); });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-20_000); });
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) { reject(new Error("whisper.cpp transcription timed out and was stopped.")); return; }
        if (code !== 0) { reject(new Error(`whisper.cpp exited with code ${code}: ${stderr.slice(-1500)}`)); return; }
        resolve(stdout.trim());
      });
    });
  } finally {
    await fs.rm(input, { force: true }).catch(() => undefined);
  }
}
