# SahurLock — project context for Claude Code

## What it does
SahurLock is a browser-based focus enforcement app that uses your webcam and client-side face tracking to estimate attention. If you're off-screen too long (outside allowed breaks), it triggers a fullscreen **LOCK IN** punishment overlay and optionally plays a local meme clip.

## Stack
Next.js 14 App Router, React 18, TypeScript, Tailwind CSS. Everything runs in the browser, and MediaPipe FaceMesh tracks attention client-side.

## Commands
```bash
npm ci
npm run dev
npm run lint
npm run build
```

## Conventions
- Conventional Commits, one logical change per commit, Mohammed as sole author with no AI trailers. No secrets in the repo. External calls go through a service layer that normalizes errors.
- TypeScript: strict mode, zero `any`, interfaces in `types.ts` first, CSS variables only.

