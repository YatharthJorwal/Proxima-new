/**
 * Shared "open this" primitive — shells out through PowerShell's
 * Start-Process to launch an .exe, a registered App-Path name, a
 * ms-settings: URI, or (Milestone 9) a plain https:// URL. One code path
 * for all of these because Start-Process already resolves them the same
 * way the Start Menu / Run box would — no need for a separate branch per
 * target type.
 *
 * Pulled out of openApp.ts (Milestone 9) so browse.ts can share it
 * instead of re-implementing the same PowerShell spawn.
 */

import { spawn } from "child_process";

export function launch(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -WindowStyle Hidden keeps a PowerShell console window from flashing
    // up on screen every time you open something.
    const ps = spawn("powershell.exe", [
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process "${target}"`,
    ]);

    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Start-Process exited with code ${code}`));
    });
  });
}
