---
name: motion-studio
description: Operate Motion Studio video projects — creative direction, storyboards, Remotion scene specs with shots, word-synced animation, Creative QA reviews, AI asset requests and renders — through the studio CLI and .project context files. Use when working on anything under projects/<id>/ or when the user asks to create, edit, review or render a video in this repository.
---

# Operating Motion Studio

Motion Studio stores each video project in Postgres and mirrors it to `projects/<id>/.project/`.
You change projects only through validated CLI actions: `npm run studio -- <command>`
(on PowerShell use `npx tsx cli/studio.ts <command>` so flags survive).

## Always

1. `npm run studio -- context <project>` first — it refreshes `.project/` and prints the pipeline state and next action.
2. Timing belongs to the voice-over. Keep scene start/end and word anchors unless the user explicitly asks.
3. Locked scenes are read-only; approvals are the user's decisions.
4. Design from the creative plan, never scene by scene in isolation: read `.project/creative.json` (`creative <project>`); if it is missing, plan it and save it with `creative:apply <project> plan.json`. Every scene carries `creative` intent (purpose, beat, act, metaphor, treatment, composition, motion density and hierarchy, shots). See `CREATIVE_SYSTEM.md`.
5. Scene specs follow `REMOTION.md`. Sync entrances to meaningful spoken words with `{ "type": "word", "value": "…" }` triggers; use `spec.shots` for rhythm inside longer scenes, `motionRole`/`motionIntent` for hierarchy, and design tokens for colors.
6. After changes: `npm run studio -- validate <project>` and `npm run studio -- creative:metrics <project>` (measured signals — verify against frames). For visual QA render a draft scene: `render <project> --kind scene --scene <key> --quality draft --wait`.
7. Creative reviews change nothing: write the critique and save it with `creative:review <project> review.json`. After a refinement task, mark addressed issues with `creative:issue <project> <reviewId> <issueId> --status resolved`.
8. AI images/videos: `assets:request` (with `--brief brief.json` for a composition brief) → `assets:generating` → generate natively from the request's `generationBrief` → `assets:fulfill <request_id> <file>`; the user approves in the GUI. Place existing images/videos into a scene with `scene:media <project> <scene> <assetId> --placement background|fullscreen|framed|pip`; generate music/SFX with `audio:generate <project> --kind music|sfx --prompt "…"` (ElevenLabs, only when configured).
9. Tasks from the GUI: `tasks` → `task:show` → `task:start` → work → `task:complete --summary`.

## Key files (`projects/<id>/.project/`)

| File | Use |
| --- | --- |
| `project.json` | status, stages, staleness, next action, locked scenes |
| `timeline.json` | ACTUAL word timings, segments, pauses (read-only) |
| `creative.json` | creative plan: direction, story arc, visual language, distribution, asset strategy (editable) |
| `creative-metrics.json` | MEASURED creative signals and findings (read-only) |
| `creative-review.json` | latest written creative review and its issues (via CLI) |
| `storyboard.json` | creative intent per scene, incl. `creative` (creative fields editable) |
| `scenes.json` | Remotion specs (spec editable) |
| `design.json` | design system tokens (editable) |
| `brand.md`, `creative-brief.md`, `script.md` | direction and copy |
| `assets.json` | asset library and AI requests (with `brief` and `generationBrief`) |
| `tasks/<id>.md` | task briefs |

Full guides: `AI_WORKFLOW.md`, `CREATIVE_SYSTEM.md`, `REMOTION.md`, `PROJECT_SCHEMA.md`.
