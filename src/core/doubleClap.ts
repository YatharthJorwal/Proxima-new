import { PvRecorder } from "@picovoice/pvrecorder-node";

const FRAME_LENGTH = 512;
const SAMPLE_RATE = 16000;
const FRAME_MS = FRAME_LENGTH / SAMPLE_RATE * 1000;

export class DoubleClapDetector {
  private recorder: PvRecorder | null = null;
  private running = false;
  private readLoop: Promise<void> | null = null;
  private lastClapAt = 0;
  private firstClapAt = 0;
  private quietFrames = 0;
  private readonly threshold = Math.max(0.06, Math.min(0.8, Number(process.env.PROXY_DOUBLE_CLAP_THRESHOLD) || 0.18));

  constructor(private readonly onDoubleClap: () => void) {}

  start(): boolean {
    if (this.running) return true;
    try {
      this.recorder = new PvRecorder(FRAME_LENGTH, -1, 16);
      this.recorder.start();
      this.running = true;
      this.readLoop = this.readFrames(this.recorder);
      return true;
    } catch (error) {
      this.running = false;
      console.warn("Double-clap listener unavailable:", error instanceof Error ? error.message : error);
      return false;
    }
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    this.running = false;
    try { if (recorder.isRecording) recorder.stop(); } catch { /* already stopped */ }
    await this.readLoop?.catch(() => undefined);
    recorder.release();
    if (this.recorder === recorder) this.recorder = null;
    this.readLoop = null;
  }

  private async readFrames(recorder: PvRecorder): Promise<void> {
    try {
      while (this.running && this.recorder === recorder) {
        const frame = await recorder.read();
        if (!this.running || this.recorder !== recorder) break;
        let squares = 0;
        for (const sample of frame) { const normalized = sample / 32768; squares += normalized * normalized; }
        const rms = Math.sqrt(squares / frame.length);
        const now = Date.now();
        // A clap is a loud frame that follows room quiet. Keep the prior
        // frame state before updating the quiet counter; resetting it first
        // made this condition impossible for every loud frame.
        const followedQuiet = this.quietFrames > 0;
        if (rms < this.threshold * 0.45) this.quietFrames++;
        else this.quietFrames = 0;
        const clap = rms >= this.threshold && followedQuiet;
        if (clap && now - this.lastClapAt > 140) {
          if (this.firstClapAt && now - this.firstClapAt <= 850) {
            this.running = false;
            try { recorder.stop(); } catch { /* device may already be stopping */ }
            recorder.release();
            this.recorder = null;
            this.readLoop = null;
            this.onDoubleClap();
            return;
          }
          this.firstClapAt = now;
          this.lastClapAt = now;
        }
        if (this.firstClapAt && now - this.firstClapAt > 850) this.firstClapAt = 0;
        await new Promise((resolve) => setTimeout(resolve, FRAME_MS / 2));
      }
    } catch (error) {
      if (this.running) console.warn("Double-clap listener stopped:", error instanceof Error ? error.message : error);
      this.running = false;
    }
  }
}
