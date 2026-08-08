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

- No automated tests. `session-machine.ts` is a pure state-transition function and is the obvious place to start.
- MediaPipe FaceMesh is loaded from a CDN at runtime rather than bundled, so first calibration needs a network round trip and the app will not detect attention offline.
- Browsers require user interaction for media playback. SahurLock primes playback after **Start Session** but still gracefully falls back to visual-only alert if playback is blocked.
- Landmark quality can drop in low light, extreme camera angles, or lower-end devices.
