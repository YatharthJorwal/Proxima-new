/**
 * Standing instructions: a short note the user writes once ("call me sir",
 * "keep answers brief") that is added to the assistant's system prompt on
 * every normal conversation turn. Unlike memory facts (which the model may or
 * may not recall), this is always applied. User-authored, so it is trusted
 * the way the built-in persona is; it is NOT added to internal calls that
 * replace the prompt (memory extraction, 3D planning, image description).
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { writeFileAtomically } from "./atomicFile";

export const MAX_INSTRUCTIONS_LENGTH = 2000;

function file(): string {
  return process.env.PROXY_INSTRUCTIONS_FILE || path.join(os.homedir(), ".proxima", "instructions.txt");
}

let cached: string | null = null;

export function normalizeInstructions(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const t = text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
  return t.length <= MAX_INSTRUCTIONS_LENGTH ? t : null;
}

export async function getInstructions(): Promise<string> {
  if (cached !== null) return cached;
  try {
    cached = normalizeInstructions(await fs.readFile(file(), "utf-8")) ?? "";
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("Failed to read instructions, treating as empty:", err);
    cached = "";
  }
  return cached;
}

export async function setInstructions(text: unknown): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const clean = normalizeInstructions(text);
  if (clean === null) return { ok: false, error: `Instructions can be up to ${MAX_INSTRUCTIONS_LENGTH} characters.` };
  await fs.mkdir(path.dirname(file()), { recursive: true });
  await writeFileAtomically(file(), clean);
  cached = clean;
  return { ok: true, text: clean };
}

/** The block appended to the system prompt, or "" when there is nothing to add. */
export function instructionsBlock(text: string): string {
  return text
    ? `\n\nStanding instructions from the user (follow them in every reply unless they conflict with the rules above or with safety):\n${text}`
    : "";
}
