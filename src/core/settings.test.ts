/**
 * Env var AND the settings file's seed content both set up inside
 * vi.hoisted()'s callback, before this file's one `import` of
 * ./settings — required here even more strictly than the usual rule,
 * since settings.ts applies its file's contents to process.env as a
 * MODULE-LEVEL side effect the instant it's imported (see its own
 * docblock). Seeding the file, or setting PROXY_SETTINGS_FILE, any
 * later than this would test nothing real: the module reads the file
 * exactly once, at import time, before any of this file's own test
 * code could ever run. This is the standing vi.hoisted() rule from
 * decisions.md, applied to exactly the shape of file it exists for.
 */

import { describe, it, expect, vi, afterAll } from "vitest";
import * as fsp from "fs/promises";

const { TEST_SETTINGS_FILE } = vi.hoisted(() => {
  const path = require("path");
  const os = require("os");
  const fsSync = require("fs");
  const file = path.join(os.tmpdir(), `proxy-settings-test-${Date.now()}.json`);
  process.env.PROXY_SETTINGS_FILE = file;
  // Seeded BEFORE ./settings is ever imported below, so its module-level
  // side effect picks this up as this test run's "saved settings."
  fsSync.writeFileSync(file, JSON.stringify({ PROXY_HOTKEY: "F11" }), "utf-8");
  return { TEST_SETTINGS_FILE: file as string };
});

import { getEffectiveSettings, saveSettings, SETTINGS_KEYS } from "./settings";

afterAll(async () => {
  await fsp.rm(TEST_SETTINGS_FILE, { force: true });
});

describe("module import applies saved settings to process.env", () => {
  it("overrides process.env with whatever was in the settings file at import time", () => {
    // Proves the actual point of this file: a saved override reaches
    // process.env before anything else could have read it, exactly the
    // property the module docblock's import-ordering warning depends on.
    expect(process.env.PROXY_HOTKEY).toBe("F11");
  });
});

describe("getEffectiveSettings", () => {
  it("returns every known key, including ones with no saved override", () => {
    const settings = getEffectiveSettings();
    for (const key of SETTINGS_KEYS) {
      expect(settings).toHaveProperty(key);
    }
  });

  it("reflects whatever process.env currently holds, not just settings-file content", () => {
    // Simulates a value that came from .env rather than settings.json —
    // getEffectiveSettings() shouldn't be able to tell the difference,
    // by design (see its docblock on why that's the honest behavior).
    process.env.ELEVENLABS_VOICE_ID = "test-voice-from-env";
    expect(getEffectiveSettings().ELEVENLABS_VOICE_ID).toBe("test-voice-from-env");
    delete process.env.ELEVENLABS_VOICE_ID;
  });
});

describe("saveSettings", () => {
  it("persists non-empty values to the settings file", async () => {
    await saveSettings({ PROXY_HOTKEY: "F10", PROXY_WORKSPACE_DIR: "C:\\Work" });

    const raw = JSON.parse(await fsp.readFile(TEST_SETTINGS_FILE, "utf-8"));
    expect(raw).toEqual({ PROXY_HOTKEY: "F10", PROXY_WORKSPACE_DIR: "C:\\Work" });
  });

  it("omits blank fields instead of persisting them as empty-string overrides", async () => {
    await saveSettings({ PROXY_HOTKEY: "F10", GMAIL_CLIENT_ID: "" });

    const raw = JSON.parse(await fsp.readFile(TEST_SETTINGS_FILE, "utf-8"));
    expect(raw).toEqual({ PROXY_HOTKEY: "F10" });
    expect(raw).not.toHaveProperty("GMAIL_CLIENT_ID");
  });

  it("fully replaces the file rather than merging, so clearing a field actually removes its override", async () => {
    await saveSettings({ PROXY_HOTKEY: "F10", PROXY_WORKSPACE_DIR: "C:\\Work" });
    await saveSettings({ PROXY_HOTKEY: "F10", PROXY_WORKSPACE_DIR: "" });

    const raw = JSON.parse(await fsp.readFile(TEST_SETTINGS_FILE, "utf-8"));
    expect(raw).toEqual({ PROXY_HOTKEY: "F10" });
  });
});
