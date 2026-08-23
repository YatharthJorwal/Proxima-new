# Setup & Running (Windows)

## One-time setup

### 1. Node.js
Install Node.js LTS from nodejs.org (includes npm).

### 2. Ollama + qwen3.5:9b (the brain)
You already have this — Ollama running with `qwen3.5:9b` pulled. Just make
sure Ollama is running in the background before you start Proxy (it usually
auto-starts on Windows; check with `ollama list` in a terminal).

### 3. Piper (text-to-speech)
Piper's original repo is archived; it now lives at OHF-Voice/piper1-gpl and
installs via pip:
1. In PowerShell: `pip install piper-tts`
2. Find where it installed: `where.exe piper`
3. In your project folder, create a `voices` folder, `cd` into it, and run:
   `piper --download en_US-lessac-medium`
   This downloads a voice model (`.onnx` + `.onnx.json`) into that folder.

### 4. Project config
In the project folder, create a file named `.env`:
```
PIPER_EXE_PATH=<path from step 3.2, or just "piper" if it's on your PATH>
PIPER_VOICE_PATH=<full path to the .onnx file in your voices folder>
```

### 5. Install dependencies
```
npm install
```

## Every time you want to run it
Make sure Ollama is running, then in the project folder:
```
npm run start
```

Press **Enter** in that terminal window, speak your command, and Proxy will
transcribe it, ask the local LLM, and speak the reply back.

## Why "press Enter" instead of a hotkey or voice wake word?
We tried two fancier options first:
- **Picovoice** (say "Jarvis" to activate) — discontinued its free tier for
  personal projects, so this was a dead end for now.
- **A global hotkey** (press a key from anywhere, not just this terminal) —
  the library for this runs a background key-hook process that Windows
  Defender or another antivirus is likely to flag/remove, since silently
  hooking every keystroke system-wide is a classic keylogger pattern.

Pressing Enter in the terminal sidesteps both problems entirely — no account,
no background process, no antivirus drama. A true global hotkey is still on
the roadmap for later, once we build a proper desktop app around this.

## About npm install
You only run `npm install` once per project setup (or again later if we add
new dependencies to package.json) — not every time you run the app.
