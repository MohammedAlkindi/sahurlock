# AGENTS.md — SahurLock

Read this and `CLAUDE.md` before working here.

## Scope
Implement features, fix bugs, and refactor within this repo.

## Branch & commits
- Branch names: `<type>/<kebab-description>`, never an agent or tool name.
- Conventional-commit messages; one logical change per commit; PRs via the `gh` CLI.

## Requires explicit confirmation
Destructive git ops (force-push, history rewrite), deploys/publishing, secret or CI changes, and data deletion.

## Before done
Run `npm run lint`, `npx tsc --noEmit`, `npm test` and `npm run build` and confirm all four pass.

