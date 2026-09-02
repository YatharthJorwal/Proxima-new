/**
 * Unit tests for fileTools.ts's sandboxing: path-traversal rejection,
 * extension allowlists (write vs. open), and the successful write/open
 * happy path. Uses a real temp directory as the workspace root (set via
 * PROXY_WORKSPACE_DIR before the module loads) rather than mocking fs -
 * the whole point of this module is real filesystem confinement, so
 * exercising it against a real (throwaway) directory is more honest
 * coverage than mocking fs would be. launch() is still mocked so
 * "opening" a file doesn't actually spawn PowerShell in the sandbox.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// process.env.PROXY_WORKSPACE_DIR must be set before fileTools.ts's
// module-level WORKSPACE_ROOT constant is computed. Set inside
// vi.hoisted()'s callback rather than as a plain statement below -
// found during Milestone 10 Part B's work that the plain-statement
// version of this exact pattern was silently NOT taking effect in this
// file specifically (this file already has a vi.mock for "./launch"),
// meaning every test run here was actually writing into the real
// ~/ProxyWorkspace on whichever machine ran it, not the throwaway temp
// dir the assertions below appear to describe. The tests still passed
// throughout, because they compare the written path against
// getWorkspaceRoot() on both sides - a self-referential check that
// can't catch getWorkspaceRoot() itself being wrong. See decisions.md
// for the fuller writeup (this is the third time this exact class of
// bug has shown up - vi.hoisted's callback is the only reliable fix,
// not source-code ordering).
const { mockLaunch, TEST_WORKSPACE } = vi.hoisted(() => {
  const workspace = require("path").join(require("os").tmpdir(), `proxy-workspace-test-${Date.now()}`);
  process.env.PROXY_WORKSPACE_DIR = workspace;
  return { mockLaunch: vi.fn(), TEST_WORKSPACE: workspace as string };
});
vi.mock("./launch", () => ({ launch: mockLaunch }));

import { executeWriteFile, executeOpenPath, getWorkspaceRoot } from "./fileTools";

beforeEach(() => {
  mockLaunch.mockReset().mockResolvedValue(undefined);
});

afterAll(async () => {
  await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
});

describe("executeWriteFile", () => {
  it("writes an allowed extension inside the workspace", async () => {
    const result = await executeWriteFile("flappybird.html", "<html>game</html>");
    expect(result).toMatch(/^Wrote flappybird\.html/);
    const written = await fs.readFile(path.join(getWorkspaceRoot(), "flappybird.html"), "utf-8");
    expect(written).toBe("<html>game</html>");
  });

  it("creates intermediate subdirectories", async () => {
    await executeWriteFile("games/snake.js", "// snake game");
    const written = await fs.readFile(path.join(getWorkspaceRoot(), "games", "snake.js"), "utf-8");
    expect(written).toBe("// snake game");
  });

  it("refuses a disallowed extension", async () => {
    const result = await executeWriteFile("virus.exe", "MZ...");
    expect(result).toMatch(/won't write/i);
    await expect(fs.access(path.join(getWorkspaceRoot(), "virus.exe"))).rejects.toThrow();
  });

  it("refuses an absolute path before ever looking at its extension", async () => {
    const result = await executeWriteFile("/etc/passwd", "hacked");
    expect(result).toMatch(/isn't a valid workspace path/i);
  });

  it("refuses a path that escapes the workspace via ..", async () => {
    const result = await executeWriteFile("../../escape.txt", "hacked");
    expect(result).toMatch(/isn't a valid workspace path/i);
    await expect(fs.access(path.join(os.tmpdir(), "escape.txt"))).rejects.toThrow();
  });
});

describe("executeOpenPath", () => {
  it("opens a written safe-extension file", async () => {
    await executeWriteFile("note.txt", "hello");
    const result = await executeOpenPath("note.txt");
    expect(result).toBe("Opening note.txt.");
    expect(mockLaunch).toHaveBeenCalledWith(path.join(getWorkspaceRoot(), "note.txt"));
  });

  it("refuses to auto-open a .js file even though write_file can create one", async () => {
    await executeWriteFile("games/snake.js", "// snake game");
    const result = await executeOpenPath("games/snake.js");
    expect(result).toMatch(/won't auto-open/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses to auto-open a .py file for the same reason", async () => {
    await executeWriteFile("script.py", "print('hi')");
    const result = await executeOpenPath("script.py");
    expect(result).toMatch(/won't auto-open/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("gives an honest reply for a file that doesn't exist yet, instead of a crash", async () => {
    const result = await executeOpenPath("nope.html");
    expect(result).toMatch(/don't have a file/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("refuses a path that escapes the workspace", async () => {
    const result = await executeOpenPath("../../etc/passwd");
    expect(result).toMatch(/isn't a valid workspace path/i);
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
