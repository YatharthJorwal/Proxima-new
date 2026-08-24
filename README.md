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

Optional additions:
```
# Overrides the dashboard's global hotkey (default F9) if it conflicts
# with something else on your system:
PROXY_HOTKEY=F10

# Optional: use ElevenLabs (paid, more natural voice) instead of Piper.
# If either of these is missing, Proxy uses Piper automatically — no
# cost unless you set both.
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

### 5. Install dependencies
```
npm install
```
If npm warns about pending install scripts (`allow-scripts`), review and
approve them: `npm approve-scripts --allow-scripts-pending`, then
`npm install` again. This happens whenever a dependency with a native
install step (Electron, the Whisper runtime, etc.) changes version.

## Every time you want to run it
Make sure Ollama is running, then in the project folder, pick one:

**Dashboard (recommended)** — a visual window showing what Proxy is doing
in real time: what it heard, how it routed the command, what it replied,
plus a typed-text input as an alternative to voice.
```
npm run dashboard
```
Once it's open, press **F9 anywhere** (the window doesn't need focus) to
talk, or type into the Input box.

**CLI only** — no window, just this terminal.
```
npm run start
```
Press **Enter** in that terminal window, speak your command, and Proxy will
transcribe it, ask the local LLM, and speak the reply back.

## About the hotkey
Earlier versions of this project tried a background global-hotkey library
that Windows Defender flagged and removed (silently hooking every keystroke
system-wide looks like a keylogger to antivirus software, understandably).
The dashboard's F9 hotkey uses Electron's `globalShortcut` API instead,
which isn't a standalone background hook process, so it doesn't have the
same problem. If F9 conflicts with something else on your system, override
it with `PROXY_HOTKEY` in `.env` (see above).

## About npm install
You only run `npm install` once per project setup (or again later if we add
new dependencies to package.json) — not every time you run the app.
