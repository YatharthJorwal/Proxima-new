/**
 * Real end-to-end tests, not mocked - actually runs real `node` against
 * real throwaway scripts in a real temp workspace (set via
 * PROXY_WORKSPACE_DIR, same pattern as fileTools.test.ts), rather than
 * mocking child_process. This is the one tool in the codebase where the
 * actual execution behavior (does confirm really run it, does deny
 * really not, does a runaway script really get killed) is the entire
 * point - mocking execFile would test the code's belief about what
 * execFile does, not what it actually does. No vi.mock anywhere in this
 * file, so the "set env var before import" pattern is safe here (see
 * core/memory.ts's docblock for the one case where combining that
 * pattern with vi.mock caused a real, hard-to-spot bug).
 *
 * .py/python tests are skipped if python isn't on PATH in this
 * environment - .js/node coverage (guaranteed available, since these
 * tests themselves run on node) is what actually exercises the shared
 * logic; the interpreter lookup by extension is a one-line map, not
 * worth blocking the whole suite over an unrelated sandbox's PATH.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

// process.env.PROXY_WORKSPACE_DIR and PROXY_SCRIPT_TIMEOUT_MS must be set
// before ./runScript (and transitively ./fileTools) are imported below -
// their module-level constants are computed once at load time. A plain
// statement here, even textually before the imports, is not reliably
// guaranteed to win that race in this toolchain — vi.hoisted's callback
// is the one mechanism actually documented to run before any import
// resolves, so the env vars are set there instead. See core/memory.ts's
// docblock for the first time this exact class of bug showed up (there,
// the trigger was vi.mock; here, empirically, a plain statement wasn't
// enough even without one — vi.hoisted is used defensively rather than
// re-litigating exactly why).
const { TEST_WORKSPACE } = vi.hoisted(() => {
  const os = require("os");
  const path = require("path");
  const workspace = path.join(os.tmpdir(), `proxy-runscript-test-${Date.now()}`);
  process.env.PROXY_WORKSPACE_DIR = workspace;
  process.env.PROXY_SCRIPT_TIMEOUT_MS = "300";
  return { TEST_WORKSPACE: workspace as string };
});

import {
  executeRunScript,
  tryResolvePendingConfirmation,
  getPendingConfirmation,
  clearPendingConfirmation,
} from "./runScript";

function pythonAvailable(): boolean {
  try {
    execFileSync("python", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  clearPendingConfirmation();
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("executeRunScript", () => {
  it("rejects an unsupported extension", async () => {
    const reply = await executeRunScript({ path: "notes.txt" });
    expect(reply).toMatch(/\.js.*node.*\.py.*python/i);
    expect(getPendingConfirmation()).toBeNull();
  });

  it("rejects a path that escapes the workspace", async () => {
    const reply = await executeRunScript({ path: "../../evil.js" });
    expect(reply).toMatch(/valid workspace path/i);
    expect(getPendingConfirmation()).toBeNull();
  });

  it("gives an honest reply when the file doesn't exist yet", async () => {
    const reply = await executeRunScript({ path: "missing.js" });
    expect(reply).toMatch(/don't have a file/i);
    expect(getPendingConfirmation()).toBeNull();
  });

  it("never executes anything itself - only registers a pending confirmation", async () => {
    const scriptPath = path.join(TEST_WORKSPACE, "side-effect.js");
    const markerPath = path.join(TEST_WORKSPACE, "marker.txt");
    await fs.writeFile(scriptPath, `require("fs").writeFileSync(${JSON.stringify(markerPath)}, "ran")`);

    const reply = await executeRunScript({ path: "side-effect.js" });

    expect(reply).toContain("side-effect.js");
    expect(reply).toMatch(/say "yes"/i);
    expect(getPendingConfirmation()).toEqual({ path: "side-effect.js" });
    await expect(fs.access(markerPath)).rejects.toThrow(); // confirms nothing ran yet
  });
});

describe("tryResolvePendingConfirmation", () => {
  it("is a no-op when nothing is pending", async () => {
    const result = await tryResolvePendingConfirmation("yes");
    expect(result).toEqual({ handled: false });
  });

  it("runs the script and returns its output on a clear yes", async () => {
    await fs.writeFile(path.join(TEST_WORKSPACE, "hello.js"), `console.log("hello from script")`);
    await executeRunScript({ path: "hello.js" });

    const result = await tryResolvePendingConfirmation("yes");

    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.reply).toContain("hello from script");
    expect(getPendingConfirmation()).toBeNull();
  });

  it("cancels without running anything on a clear no", async () => {
    const scriptPath = path.join(TEST_WORKSPACE, "side-effect2.js");
    const markerPath = path.join(TEST_WORKSPACE, "marker2.txt");
    await fs.writeFile(scriptPath, `require("fs").writeFileSync(${JSON.stringify(markerPath)}, "ran")`);
    await executeRunScript({ path: "side-effect2.js" });

    const result = await tryResolvePendingConfirmation("no");

    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.reply).toMatch(/cancelled/i);
    await expect(fs.access(markerPath)).rejects.toThrow();
  });

  it("drops the pending confirmation on an unrelated utterance, without running it", async () => {
    const scriptPath = path.join(TEST_WORKSPACE, "side-effect3.js");
    const markerPath = path.join(TEST_WORKSPACE, "marker3.txt");
    await fs.writeFile(scriptPath, `require("fs").writeFileSync(${JSON.stringify(markerPath)}, "ran")`);
    await executeRunScript({ path: "side-effect3.js" });

    const result = await tryResolvePendingConfirmation("open notepad");

    expect(result).toEqual({ handled: false });
    expect(getPendingConfirmation()).toBeNull();
    await expect(fs.access(markerPath)).rejects.toThrow();

    // A stray later "yes" must not resurrect the dropped confirmation.
    const followUp = await tryResolvePendingConfirmation("yes");
    expect(followUp).toEqual({ handled: false });
  });

  it("reports a script's own error output rather than crashing", async () => {
    await fs.writeFile(path.join(TEST_WORKSPACE, "broken.js"), `throw new Error("boom")`);
    await executeRunScript({ path: "broken.js" });

    const result = await tryResolvePendingConfirmation("yes");

    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.reply).toMatch(/error/i);
  });

  it("kills a script that runs past the timeout and says so honestly", async () => {
    await fs.writeFile(path.join(TEST_WORKSPACE, "hang.js"), `setTimeout(() => {}, 5000)`);
    await executeRunScript({ path: "hang.js" });

    const result = await tryResolvePendingConfirmation("yes");

    expect(result.handled).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.reply).toMatch(/stopped it/i);
  }, 10_000);

  it.runIf(pythonAvailable())("runs a .py file via python", async () => {
    await fs.writeFile(path.join(TEST_WORKSPACE, "hello.py"), `print("hello from python")`);
    await executeRunScript({ path: "hello.py" });

    const result = await tryResolvePendingConfirmation("confirm");

    expect(result.reply).toContain("hello from python");
  });
});
