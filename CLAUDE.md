# SahurLock — project context for Claude Code

> Project-specific context layered on top of the global standards in `~/.claude/CLAUDE.md`.

## What it does
SahurLock is a browser-based focus enforcement app that uses your webcam and client-side face tracking to estimate attention. If you're off-screen too long (outside allowed breaks), it triggers a fullscreen **LOCK IN** punishment overlay and optionally plays a local meme clip.

## Stack
node, ts

## Commands
```bash
npm ci
npm run dev
npm test
npm run build
```

## Conventions
- Conventional commits, one logical change each; secrets never hardcoded; external API calls via a service layer; errors normalized before the client.
- TypeScript: strict mode, zero `any`, interfaces in `types.ts` first, CSS variables only.

