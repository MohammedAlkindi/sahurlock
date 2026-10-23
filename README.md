# SahurLock

SahurLock is a browser-based focus enforcement app that uses your webcam and client-side face tracking to estimate attention. If you're off-screen too long (outside allowed breaks), it triggers a fullscreen **LOCK IN** punishment overlay and optionally plays a local meme clip.

## Attention detection

- MediaPipe FaceMesh, injected at runtime and run entirely in the page — it tracks yaw, pitch, roll, gaze offset and eyelid-open ratio against a per-user calibrated baseline
- Explicit app states: idle, requesting permission, calibrating, countdown, focused, warning, break, violated, session complete, camera error
- 2.5s calibration and visible 3s countdown before a session starts
- Warning at 50% of the off-screen threshold; clearing a violation requires 2s of continuous attention
- Configurable session duration, thresholds, break count/duration, punishment on/off
- No frame upload — every frame stays in the browser

## Around the timer

The session screen is the core, but the app also carries Pomodoro sessions, flashcards
during breaks, tasks, notes, session scheduling, a four-component focus score, stats
history, ambient sound, and optional Spotify playback.

Settings, history and stats persist locally (`localStorage` under `sahurlock.*`, plus
IndexedDB for custom videos). Nothing is sent to a server.

Built with Next.js App Router, TypeScript and Tailwind CSS.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open http://localhost:3000.

## Punishment media

Six clips ship in `public/media/` (`sahur.mp4` is the default). You can add your own
there, or load one through the UI — custom videos are stored in IndexedDB rather than
in the repo.

## Known limitations

- Unit tests cover the pure modules (session state machine, focus score, flashcard scheduling, formatting). The camera loop and pages have no automated tests yet.
- MediaPipe FaceMesh (about 10 MB of WebAssembly and model data) is served from the app itself, pinned through npm and copied into `public/vendor` by `scripts/copy-mediapipe.mjs` before dev and build. The first calibration downloads it, so expect a short wait on a slow connection.
- Browsers require user interaction for media playback. SahurLock primes playback after **Start Session** but still gracefully falls back to visual-only alert if playback is blocked.
- Landmark quality can drop in low light, extreme camera angles, or lower-end devices.

## Roadmap

SahurLock is becoming a student toolkit, with a handwritten-notes converter as the next major tool. The plan, in shippable steps, is in [docs/ROADMAP.md](docs/ROADMAP.md), and the converter design is in [docs/notes-converter.md](docs/notes-converter.md).
