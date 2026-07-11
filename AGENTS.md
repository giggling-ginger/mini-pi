# mini-pi project notes

This repository is a **learning** coding-agent harness (inspired by Pi, not affiliated).

## Conventions

- Keep the core small: agent loop + four tools + optional sessions/streaming/context files.
- Prefer TypeScript ESM (`"type": "module"`) and Node 20+.
- Do not commit `.env` or `.mini-pi/sessions/`.
- When adding features, match the style of existing `src/*.ts` modules.
- Docs for humans/agents live under `docs/*.html` (GitHub Pages from `/docs`).

## Commands

```bash
npm install
npm run typecheck
npx tsx src/tools.test.ts
npx tsx src/session.test.ts
npx tsx src/context-files.test.ts
npm run dev -- -p "your task"
```

## Scope

- Real work may use other agents (Codex, etc.); mini-pi is for understanding harnesses.
- Default LLM is whatever the user configured (often OpenRouter free models).
