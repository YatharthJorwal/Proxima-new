# Eye tracking: scope

Status: **scoped, not built.** Written alongside the Camera page, which already
does hand tracking (MediaPipe `HandLandmarker`) and the pinch trigger.

## What I checked in this repo

- `@mediapipe/tasks-vision` 1.0.1 is already a dependency, and it ships
  `FaceLandmarker` in the same bundle the hand tracker uses. No new package.
- `FaceLandmarker` returns 478 landmarks per face. The last ten (468–477) are
  the two irises, so pupil position inside the eye opening is available.
- It can also return **blendshapes** (`eyeLookInLeft`, `eyeLookOutLeft`,
  `eyeLookUpLeft`, `eyeLookDownLeft` and the right-eye equivalents, 0–1 each)
  and a **facial transformation matrix** (head pose). Both are options on the
  same call, not extra models.
- The model is a separate file, `face_landmarker.task` (a few MB), the same way
  `hand_landmarker.task` is. `scripts/download-hand-model.js` is the pattern to
  copy. I could not download it from this sandbox, so its exact URL and size
  are **unverified**; confirm them from the MediaPipe docs when building.

## What a laptop webcam can and cannot do

| Goal | Realistic? | Notes |
|---|---|---|
| Are you looking at the screen or away? | **Yes** | Blendshapes + head pose are enough. Robust, needs no calibration. |
| Coarse direction (left / right / up / down, or a 3×3 region of the screen) | **Yes, after a short calibration** | Expect a few degrees of error, i.e. regions the size of a big button, not a text cursor. |
| Moving the mouse pointer by gaze | **Poor** | Webcam gaze is jittery and drifts with head movement and lighting. Dwell-clicking small targets will frustrate. |
| Looking at one specific word or icon | **No** | Needs an infrared eye tracker (Tobii-class hardware). |

Accuracy gets worse with glasses glare, dim light, the camera being low or off
to the side, and a big range of head movement. Calibration has to be redone if
the person or camera position changes.

## Proposed phases

1. **Attention (1–2 days).** Run `FaceLandmarker` next to the hand tracker in
   `ui/src/vision/`. Expose "looking at screen" / "looking away" as state. Use
   cases: don't start listening if you are looking elsewhere; a small "I see you"
   indicator on the Camera page.
2. **Region gaze (2–3 days).** A nine-point calibration screen (look at a dot,
   store the mapped blendshape + head-pose values), then a smoothed gaze region.
   Use cases: look at a dashboard card to focus it; look at the orb to wake.
3. **Optional: dwell actions (open-ended).** Only for large targets, always with
   a visible dwell ring and a confirm step for anything that acts on the PC.

## Decisions I'd want from you before building

- Is "attention" (phase 1) enough, or do you want region gaze (phase 2)?
- Should looking at the screen ever *start* something, or only *suppress* it
  (e.g. ignore the pinch trigger when you are looking away)? Suppressing is
  much safer.
- Is it acceptable to run face and hand models at the same time? On a CPU-only
  machine that is the main cost; I'd measure it on yours first and drop to
  roughly 15 fps for the face model if needed.

## Design rules (same as the pinch trigger)

- Off by default; separate toggle from hand tracking; camera stays local.
- No gaze data is stored or logged. Only the derived state ("looking",
  "region 4") leaves the vision module.
- Gaze alone must never trigger an action that runs a program, sends a message
  or changes files. Those keep requiring an explicit confirmation.
- A visible indicator while the face model is running.

## Not covered

Anything that needs real pixel-accurate gaze, multiple people in frame,
or running without a camera.
