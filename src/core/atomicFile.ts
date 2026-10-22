import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

/** Write beside the destination, then rename into place so a crash cannot
 * leave a partially-written JSON state file at the canonical path. */
export async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
