# Motion Studio — Architecture

A local, project-based production studio for animated explainer, product, ad and social
videos. Everything runs on one machine: a Next.js app (GUI + local API), a worker process,
Postgres in Docker, and project folders on disk that **Claude Code** reads and edits directly.

> Companion docs: [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md) (data model & files) ·
> [AI_WORKFLOW.md](AI_WORKFLOW.md) (how Claude Code operates projects) ·
> [REMOTION.md](REMOTION.md) (scene specs & motion library) ·
> [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md) (creative direction, shots, motion grammar, Creative QA) ·
> [ELEVENLABS.md](ELEVENLABS.md)

## 1. Boundaries of authority

| Concern | Authority | Stored in |
| --- | --- | --- |
| **Timing** | The actual voice-over audio → normalized word timings → master timeline | `VoiceTake`, `Transcript`, `Timeline` |
| **Global creative intent** | The creative plan: direction, story arc, visual language, visual distribution, asset strategy | `CreativeRevision` → `.project/creative.json` |
| **Storytelling intent** | The storyboard: per scene voice text, visual concept, animation notes, on-screen text and `creative` intent (purpose, beat, metaphor, treatment, composition, motion, shot plan) | `Scene` storyboard fields + `Scene.creative` |
| **Implementation** | Structured scene specs: elements, shots, word/shot triggers, motion density and roles | `Scene.spec` |
| **Final visuals** | Remotion rendering the specs deterministically (it never reads creative intent) | `src/remotion` |
| **Creative judgment** | Written reviews with advisory scores backed by issues; creative metrics only measure | `CreativeReview`, `.project/creative-metrics.json` |
| **Reasoning & orchestration** | Claude Code, through explicit tasks and validated CLI actions | `AiTask`, `cli/studio.ts` |

Consequences enforced in code:

- No precise timestamp exists before audio exists. Script analysis only produces **estimated**
  timing (labelled as such everywhere).
- Visual edits never move audio-locked scene boundaries unless explicitly requested.
- The voice timeline is never modified by timeline-editor operations; scenes reference it.
- Locked scenes are never regenerated or overwritten (GUI, CLI and file-import all check).
- Creative work never moves timing: shots resolve inside the scene, reviews change nothing, and
  refinements are explicit tasks that skip locked scenes ([CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md)).

## 2. Processes

```
 Browser GUI ──HTTP 127.0.0.1:3210──▶ Next.js app (pages + /api route handlers)
     ▲                                     │
     └──── SSE: project revision events ───┤          src/server/services  (single service layer)
                                           ├───────▶  Postgres 16 (Docker, 127.0.0.1:5488)
 Claude Code ──npm run studio …──▶ CLI ────┤
     │                                     │
     └─ reads/edits projects/<id>/.project/*  ◀── materialized after every mutation
                                           │
                     Worker (worker/index.ts)
                     • job queue: voice generation, alignment, renders, exports, thumbnails
                     • file watcher: imports valid edits of .project/*.json|md
                     • optional headless Claude Code runner for AI tasks (claude -p)
```

- **Next.js** only does short synchronous work. Anything slow or failure-prone (network calls,
  rendering) becomes a `Job` row the worker claims (`FOR UPDATE SKIP LOCKED`).
- **CLI** (`cli/studio.ts`) calls the same services directly — it is the explicit action surface
  Claude Code uses (`context`, `storyboard:apply`, `scene:apply`, `assets:fulfill`, `render`, …).
- **Sync**: every mutation bumps `Project.revision`, appends an `Activity`, and re-materializes
  `.project/`. The GUI subscribes to `/api/projects/:id/events` (SSE) and refetches on change.
  Claude edits to `.project/` files are validated and imported by the worker watcher (or
  synchronously via `npm run studio -- apply`). Invalid edits become `SyncIssue`s in the GUI.

## 3. The model is the product

Everything — the editor, the CLI, Claude and the renderer — is a client of one validated scene model.

```
SCENE MODEL            src/core/spec/scene.ts  (+ animatable.ts: what can be animated, once)
    ↓ validated
SCENE PATCHES          src/core/timeline/spec-patch.ts · element-ops.ts   (one way to change anything)
    ↓
EDITOR · CLI · AI      inspector/canvas/timeline · cli/studio.ts · src/core/ai/edit-plan.ts
    ↓ saved            src/server/services/* (mutateProject: transaction, version, activity, undo step)
RESOLUTION             src/core/motion/keyframes.ts (values over time) · path.ts · values.ts · easing.ts
    ↓ per frame
REMOTION               src/remotion/** (engine: animation, compositing, layout)
    ↓
RENDER / EXPORT        worker → mp4
```

The rules that keep it one system: the scene model is the only source of truth; a property exists once
(the animatable registry) and everything reads it; every change is an element patch; resolution happens
in one place, before any renderer sees an element; and the renderer only consumes the model — it never
reads creative intent, and it never has a value the editor can't show.

## 4. Source layout

```
src/core/        Pure isomorphic domain logic (no Node APIs) — used by GUI, server, CLI, Remotion
  timing/          secondsToFrames & friends (drift-free absolute conversion)
  transcript/      provider → normalized words, segmentation, script↔transcript alignment
  import/          SRT / VTT / JSON timing import
  script/          spoken-text extraction, estimates, rule-based analysis
  spec/            zod schemas: timing, design system, brand, scene spec (incl. shots), triggers, analysis, project files
  creative/        creative plan / scene intent / review schemas, motion grammar & density, measured metrics, generation briefs
  timeline/        scene planning from the timeline, anchor remapping, timeline comparison
  storyboard/      heuristics + rule-based draft storyboard & scene templates
  status/          derived production status + dependency staleness
src/remotion/    Remotion root, StudioVideo composition, scene engine (shot layers), motion component library
src/server/      Server-only: db, storage (safe paths, uploads), services, providers
  services/          the single service layer (projects, script, voice, alignment, timeline, scenes,
                     storyboard-io, creative, creative-reviews, assets, asset-requests, audio-tracks,
                     composition, renders, snapshots, tasks, task-brief…)
  providers/         types.ts (VoiceProvider / AlignmentProvider) · elevenlabs.ts · system-voice/ · whisper.ts
  render/            Remotion bundle cache · loopback media server · worker-side renderMedia/renderStill
  claude/            headless `claude -p` task runner
  sync/              validated 3-way import of edited .project files
src/app/         Next.js App Router: GUI pages and /api route handlers
src/components/  UI (shadcn-style primitives in ui/, studio components elsewhere; studio/creative/: Direction, Creative QA, scene intent)
worker/          Job runner (voice, alignment, renders, exports, headless tasks) + .project watcher
cli/             `npm run studio -- <command>` — Claude Code's action surface
prisma/          Schema + migrations
projects/<id>/   Project folders (gitignored): audio, assets, renders, exports, .project context
storage/         App-level local data (gitignored): secrets, bundle cache, whisper install
```

`src/core` and `src/remotion` use **relative imports only** so the same files compile under
Turbopack (Player preview), webpack (`@remotion/bundler` for renders), tsx (CLI/worker) and Vitest.

## 5. Pipeline & dependency graph

```
SCRIPT ─▶ VOICE ─▶ ALIGNMENT ─▶ TIMELINE ─▶ STORYBOARD ─▶ ASSETS ─▶ SCENES ─▶ RENDER

script + timing + brief + brand ─▶ CREATIVE PLAN ─▶ inherited by storyboard, asset requests and scenes
SCENES ─▶ PREVIEW ─▶ CREATIVE QA (measured metrics + written review) ─▶ refine_creative task ─▶ SCENES
```

The creative layer (direction → story arc → visual language → shot plan → storyboard → asset
strategy → scene specs → motion design → Remotion → preview → Creative QA → refinement → render) is
described in [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md#1-pipeline-and-authority).

Every derived artifact stores the identity of its inputs; staleness is **computed**, never
hand-assigned (`src/core/status`):

| Artifact | Records | Stale when |
| --- | --- | --- |
| Voice take (generated) | `scriptHash` | current script's spoken-text hash differs |
| Transcript | `voiceTakeId` | active voice take changed |
| Timeline | `transcriptId` | active transcript changed (unless user chose *Keep existing timeline*) |
| Audio-locked scene | `timelineId` + word anchors | active timeline changed |
| Approved scene | `approvedFingerprint` | spec, timing or a referenced asset's content hash changed |
| Render | `compositionHash` | any Remotion input changed |
| Creative review | `compositionHash` | the composition changed since the review was written (flagged, never rewritten) |

Changing only an image therefore marks *assets → scene → render* stale and nothing upstream.
Production status (`DRAFT … COMPLETE`) is derived from these states.

## 6. Entry workflows

All workflows converge on the same normalized project; users can enter at any stage.

| Start | Path |
| --- | --- |
| Script only | script → generate voice (ElevenLabs or system voice) → provider alignment → timeline |
| Audio only | import audio → speech-to-text (ElevenLabs or local whisper.cpp) → timeline |
| Script + audio | import both → forced alignment (script is kept; differences shown) → timeline |
| Script + audio + timeline | import SRT/VTT/JSON timing → validate/map to script → timeline (fastest) |
| Existing project | open from dashboard or import a project package (.zip) |

## 7. Time & frames

Internal timebase is seconds. Remotion frames are computed from **absolute** master-timeline
times: `from = round(start·fps)`, `duration = round(end·fps) − round(start·fps)`. Adjacent scenes
share boundary frames exactly, so no drift accumulates. Word triggers resolve to absolute
seconds first, then frames.

## 8. AI orchestration

Claude Code is the only AI operator. The app never pretends an AI API exists:

- The GUI creates explicit **AI tasks** (analyze script, plan the creative direction, generate
  storyboard, edit scene N, creative review, creative refinement, command-bar requests) and
  **asset requests** (images/videos, optionally with a composition brief). Each is a DB row plus a
  markdown brief in `.project/tasks/`; creative tasks get a *Creative context* section.
- Tasks run either **manually** (the user's Claude Code session runs `npm run studio -- tasks`)
  or **headless** (worker spawns `claude -p` with a restricted tool allow-list), per Settings.
- Claude works through `.project/` context files and validated CLI actions; results appear in
  the GUI via sync. Every mutation is versioned (scene versions, storyboard revisions,
  snapshots) and logged in Activity with actor `claude`.
- A deterministic rule-based storyboard drafter exists so the pipeline also works offline.
- Creative QA separates measurement from judgment: `src/core/creative/metrics.ts` computes
  deterministic signals; quality is only ever stated in a written `CreativeReview` (task type
  `creative_review`, read-only). Accepted review issues become `refine_creative` tasks.
- **Editing is structured, not free-form.** Claude changes a scene with an *edit plan*
  (`src/core/ai/edit-plan.ts`): a list of operations — set, add, remove, duplicate, arrange, keyframe,
  clearKeyframes, path, cue, group, ungroup, scene — each compiled into the same element patches the
  editor's own controls produce. It is validated by the same schema and property registry, refused on a
  locked scene, previewable without saving (`scene:edit --preview`), explained in the editor's own words,
  and saved as one scene version and one undo step. There is no second mutation path for AI, and no
  request ever reaches the DOM or the renderer directly ([REMOTION.md](REMOTION.md#14-ai-editing--the-structured-edit-plan)).

## 9. Security (local-first)

- Next.js and Postgres bind to `127.0.0.1` only. API routes reject foreign `Host`/`Origin`
  headers (DNS-rebinding / cross-site protection).
- Secrets (ElevenLabs key) live in env or `storage/config/secrets.json`, are read only by
  server code, and the API only ever reports `configured` + last 4 characters.
- Project IDs are validated; every file path is resolved inside its project root
  (no traversal); uploads are checked by extension, magic bytes and size.
- No shell execution of user text: child processes are spawned with fixed argument arrays;
  user text travels via stdin or temp files.
