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

### 4. Hand-tracking model (for the dashboard's Camera card, Milestone 7)
Optional, but the Camera card won't track hands without it (it'll still
show the live camera preview either way). One-time download:
```
npm run setup:cv
```
This saves `hand_landmarker.task` (~7-9MB) into a `models` folder. Re-run
this if that file ever goes missing — it's gitignored on purpose (nothing
about it needs to be shared/versioned), so a fresh clone won't have it.

### 5. Project config
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

# Optional: tune voice activity detection (how long Proxy waits for you
# to stop talking before it considers the command finished). Defaults
# are listed below — only set these if the defaults feel wrong on your
# mic/room (e.g. cutting you off mid-sentence, or hanging for a while
# after you finish).
PROXY_VAD_SILENCE_MS=900
PROXY_VAD_MAX_WAIT_MS=6000
PROXY_VAD_MAX_MS=15000

# Optional: force a fixed speech-detection threshold (0.0-1.0 RMS)
# instead of Proxy's automatic per-session calibration. Only needed if
# calibration is guessing wrong for your specific mic — try without this
# first.
PROXY_VAD_THRESHOLD=
```

### 6. Gmail (optional, so Proxy can check your inbox)
Skip this if you don't want Proxy to answer "do I have any new emails" /
"any emails from X" - everything else in this project works fine without it.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project (or use an existing one).
2. Under **APIs & Services > Library**, search for "Gmail API" and enable it.
3. Under **APIs & Services > OAuth consent screen**, set it up as
   **External**, add yourself as a **test user** (this avoids needing
   Google's app-verification review for a personal project like this).
4. Under **APIs & Services > Credentials**, create an **OAuth client ID**
   of type **Web application**, and add this exact **Authorized redirect
   URI**: `http://localhost:53682/oauth2callback`
5. Copy the **Client ID** and **Client secret** it gives you into `.env`:
   ```
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   ```
6. Run the one-time authorization script:
   ```
   npm run setup:gmail
   ```
   This opens your browser to a Google consent screen, then prints a
   `GMAIL_REFRESH_TOKEN` line for you to paste into `.env` yourself -
   nothing writes `.env` for you, same as every other credential above.

### 7. Install dependencies
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
plus a typed-text input as an alternative to voice, and a live camera
feed with hand tracking (Milestone 7). Windows will prompt for camera
permission the first time it opens — allow it, or the Camera card will
just show "Camera unavailable."
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
