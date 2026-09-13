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
 *
 * `args` (browser automation milestone) is optional and additive - every
 * existing call site passes none and behaves exactly as before. Its one
 * current use is launching Chrome with `--remote-debugging-port` so
 * commands/browserAutomation.ts has something to attach to (see that
 * file, and config/commands.json's chrome entry - the port number is
 * duplicated in both places on purpose rather than made configurable,
 * since a JSON config file can't read an env var and the two having to
 * always match is a worse footgun than just keeping it a plain constant
 * commented in both spots).
 */

import { spawn } from "child_process";

export function launch(target: string, args: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    // -ArgumentList only added to the command when actually needed -
    // Start-Process "target" (no -ArgumentList at all) is exactly the
    // command every pre-existing call site already relied on, so this
    // stays byte-for-byte the same for them.
    const argList = args.length > 0 ? ` -ArgumentList ${args.map((a) => `"${a}"`).join(",")}` : "";
    const command = `Start-Process "${target}"${argList}`;

    // -WindowStyle Hidden keeps a PowerShell console window from flashing
    // up on screen every time you open something.
    const ps = spawn("powershell.exe", ["-WindowStyle", "Hidden", "-Command", command]);

    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Start-Process exited with code ${code}`));
    });
  });
}
