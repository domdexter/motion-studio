# Contributing

Thanks for helping improve Motion Studio. Forks are welcome — customise it for your own studio.

## Development

```bash
npm install
npm run bootstrap
npm run dev          # web on 127.0.0.1:3210 + worker
npm run typecheck
npm test
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The short version:

- `src/core` is pure, isomorphic domain logic (no Node or React APIs). `src/core` and `src/remotion`
  use **relative imports only** — they are bundled by Turbopack, Remotion's webpack, tsx and Vitest.
- Every mutation goes through `src/server/services/*` via `mutateProject()` (transaction, revision
  bump, activity, `.project/` materialization). Route handlers use the `api()` wrapper.
- Animatable properties are defined once in `src/core/spec/animatable.ts` — never add a second list.
- Slow or failure-prone work is a worker job (`src/server/jobs/queue.ts`, `worker/handlers.ts`).
- The worker never imports Next.js code; Next.js never imports `@remotion/renderer` or `@remotion/bundler`.
- Keep the security posture: loopback only, validated ids/paths, no shell interpolation of user
  text, secrets server-side only.

## Pull requests

- One focused change per PR, with tests for domain logic in `src/core/__tests__`.
- `npm run typecheck` and `npm test` must pass.
- Update the relevant doc (`REMOTION.md`, `PROJECT_SCHEMA.md`, …) when behaviour changes.
- Never commit `.env`, `storage/`, `projects/` or API keys.
