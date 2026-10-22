import { pipeline } from "@huggingface/transformers";

const MODEL_NAME = "Xenova/whisper-small.en";
let transcriber: any = null;

type UtilityParentPort = {
  on(event: "message", listener: (event: { data: WorkerRequest }) => void): void;
  postMessage(message: WorkerResponse): void;
};
interface WorkerRequest { id: number; type: "init" | "transcribe"; audio?: ArrayBuffer; }
interface WorkerResponse { id: number; ok: boolean; value?: unknown; error?: string; }

const utilityParentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
const sendResponse = (response: WorkerResponse) => {
  if (utilityParentPort) utilityParentPort.postMessage(response);
  else if (process.send) process.send(response);
  else throw new Error("Speech recognition child has no parent message channel.");
};

async function handleRequest(message: WorkerRequest): Promise<void> {
  try {
    if (message.type === "init") {
      if (!transcriber) {
        console.log(`Loading speech-to-text model (${MODEL_NAME}) in worker...`);
        transcriber = await (pipeline as any)("automatic-speech-recognition", MODEL_NAME);
        console.log("Speech-to-text model is ready in worker.");
      }
      sendResponse({ id: message.id, ok: true, value: true });
      return;
    }

    if (!transcriber) throw new Error("STT not initialized — send an init request first.");
    if (!message.audio) throw new Error("STT worker received no audio buffer.");
    const start = Date.now();
    const output = await transcriber(new Float32Array(message.audio), { sampling_rate: 16000 });
    console.log(`(transcribed in ${Date.now() - start}ms in worker)`);
    const text = Array.isArray(output) ? output[0]?.text : output.text;
    sendResponse({ id: message.id, ok: true, value: (text ?? "").trim() });
  } catch (error) {
    sendResponse({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

if (utilityParentPort) utilityParentPort.on("message", (event) => { void handleRequest(event.data); });
else if (process.send) process.on("message", (message: WorkerRequest) => { void handleRequest(message); });
else throw new Error("Speech recognition worker requires a utility-process or child-process parent.");
