import { createServer, IncomingMessage, Server } from "http";
import { timingSafeEqual } from "crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";

export interface IPhoneMessage { from: string; body: string; receivedAt: string }
const MESSAGE_FILE = process.env.PROXY_IPHONE_MESSAGES_FILE || path.join(os.homedir(), ".proxima", "iphone-messages.json");
let server: Server | null = null;
let appendTail: Promise<void> = Promise.resolve();

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 32_000) { reject(new Error("Payload too large")); req.destroy(); }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function appendMessage(message: IPhoneMessage): Promise<void> {
  const write = appendTail.then(async () => {
  let history: IPhoneMessage[] = [];
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(MESSAGE_FILE, "utf8"));
    if (Array.isArray(parsed)) history = parsed.filter((item) => item && typeof item.from === "string" && typeof item.body === "string");
  } catch { /* missing or malformed history starts a clean log */ }
  history.push(message);
  await fs.mkdir(path.dirname(MESSAGE_FILE), { recursive: true });
  const temp = `${MESSAGE_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(history.slice(-100), null, 2), "utf8");
  await fs.rename(temp, MESSAGE_FILE);
  });
  appendTail = write.catch((error) => { console.error("Failed to store iPhone message:", error); });
  return write;
}

export async function loadIPhoneMessages(limit = 20): Promise<IPhoneMessage[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(MESSAGE_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(-Math.max(1, Math.min(50, limit))).reverse() : [];
  } catch { return []; }
}

export function startIPhoneWebhook(): void {
  const token = process.env.PROXY_IPHONE_WEBHOOK_TOKEN || "";
  if (token.length < 32 || server) {
    if (token && token.length < 32) console.warn("iPhone webhook disabled: PROXY_IPHONE_WEBHOOK_TOKEN must be at least 32 characters.");
    return;
  }
  const host = process.env.PROXY_IPHONE_WEBHOOK_BIND || "127.0.0.1";
  const port = Number(process.env.PROXY_IPHONE_WEBHOOK_PORT) || 8787;
  server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/api/iphone/sms") { res.writeHead(404).end(); return; }
    const auth = req.headers.authorization || "";
    const supplied = Buffer.from(auth.startsWith("Bearer ") ? auth.slice(7) : "");
    const expected = Buffer.from(token);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end(); return; }
    try {
      const parsed = JSON.parse(await readBody(req));
      const from = typeof parsed.from === "string" ? parsed.from.trim().slice(0, 80) : "";
      const body = typeof parsed.body === "string" ? parsed.body.trim().slice(0, 4000) : "";
      if (!from || !body) { res.writeHead(400).end("from and body are required"); return; }
      const receivedAt = new Date().toISOString();
      await appendMessage({ from, body, receivedAt });
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
    } catch { res.writeHead(400).end("invalid message"); }
  });
  server.on("error", (error) => console.error("iPhone webhook failed:", error.message));
  server.listen(port, host, () => console.log(`iPhone SMS webhook listening on ${host}:${port}`));
}

export function stopIPhoneWebhook(): void {
  server?.close();
  server = null;
}
