# Motion Studio

A **local AI motion graphics production studio**. Turn a script or an existing voice-over into a
polished animated explainer, product, ad or social video — with **Claude Code** as the AI
operator, **ElevenLabs** (optional) for voice and word timing, and **Remotion** for composition,
preview and rendering. Everything runs on your machine.

- **Audio is the source of truth for timing.** Scenes are anchored to the words of the actual
  voice-over, so visuals land exactly on the narration. Nothing is timed precisely before audio
  exists — script analysis only ever shows *estimated* timing.
- **Start from what you have:** a script, a voice-over, a voice-over + transcript/timestamps
  (SRT, VTT, JSON), or an existing project package.
- **Storyboard → scene specs → Remotion.** Each scene has creative intent (voice text, visual
  concept, animation notes) and a structured spec rendered by a motion component library:
  kinetic typography, UI mockups, dashboards, charts, diagrams, cursors, images and video.
- **Creative direction and Creative QA.** A versioned creative plan (concept, story arc, visual
  language, asset consistency) that every scene inherits; shots, motion hierarchy and density inside
  scenes; measured creative metrics and written reviews whose accepted issues become refinement tasks.
- **Claude Code does the creative work through explicit, reviewable actions** — storyboards,
  scene edits, alternatives, AI images/videos — via a validated CLI and synchronized project
  files. You approve, lock and version everything.
- **Local-first.** Next.js + a worker on `127.0.0.1`, Postgres in Docker, project files on disk.

## Requirements

| | |
| --- | --- |
| Node.js | 20.9+ (22 LTS recommended) |
| Docker | Docker Desktop (runs Postgres only) |
| Claude Code | For AI tasks (storyboards, scene edits, asset generation) |
| ElevenLabs | Optional — API key for voice generation, forced alignment and speech-to-text |
| Disk | ~1 GB for Remotion's headless browser, render cache and whisper.cpp (optional) |

Without ElevenLabs you can import your own voice-over, use the Windows system voice for scratch
takes, and transcribe locally with whisper.cpp (installable from Settings).

## Quick start

```bash
git clone https://github.com/domdexter/motion-studio.git   # or fork it first and clone your fork
cd motion-studio
npm install
npm run bootstrap        # creates .env, starts Postgres in Docker, applies migrations
npm run dev              # web app + worker
```

Open <http://localhost:3210>, then open the same folder in **Claude Code** — it reads
[CLAUDE.md](CLAUDE.md) and the bundled skill and slash commands automatically.

No API keys are required to start. Add an ElevenLabs key in **Settings → ElevenLabs** (or `.env`)
for AI voice-overs, music and sound effects.

**New here?** Read [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) (full setup, keys, Claude Code)
and [docs/USER_GUIDE.md](docs/USER_GUIDE.md) (how to make a video, page by page, and prompts that work).

## Making a video

1. **Create a project** — name, format (16:9, 9:16, 1:1, 4:5 or custom), fps and brand. Pick
   what you already have: script, audio, audio + timestamps, or an existing project. Choose a
   **brand kit** (Settings → Brand kits: identity, design system, logo, fonts and references set up
   once) or set the brand up manually. Projects that follow a kit update when the kit changes; any
   project can switch to a custom brand from its Brand page, or save its brand as a new kit.
2. **Script** — paste, type or import `.txt`/`.md`. Revisions are kept and comparable.
3. **Voice** — generate with ElevenLabs (or the system voice), or import MP3/WAV/M4A.
4. **Alignment** — word timings come from ElevenLabs (with the voice), forced alignment,
   speech-to-text, whisper.cpp, or imported SRT/VTT/JSON. The master timeline is built from them.
5. **Direction & storyboard** — plan the creative direction (concept, story arc, visual language) on
   the Direction page or with *Ask Claude*, then draft instantly from the timeline or *Ask Claude* for
   a considered storyboard. Edit, regenerate, lock and approve scenes.
6. **Assets** — upload images, video, music, SFX and brand files, or create AI asset requests
   that Claude Code fulfils with its native generation. You approve which result is used.
   *Insert into scene* places a clip or image in a scene (background, full frame, framed or
   picture-in-picture, with trim/loop/appear times). On the Audio page, generate music beds and
   sound effects with ElevenLabs straight onto the timeline.
7. **Scenes** — refine each scene's Remotion spec with a live player, a linked timeline and
   word-synced trigger markers, by hand or with Claude.
8. **Preview & Creative QA** — the live Remotion composition: whole video, one scene or any range.
   Creative QA shows measured creative signals and written reviews; accepted issues become refinement tasks.
9. **Render** — MP4 (H.264 + AAC) with presets (YouTube, TikTok/Reels, Instagram Feed, Square),
   draft/scene/range renders, render history, thumbnails and JSON exports.

Press **Ctrl K** anywhere in a project to ask Claude or run an action.

## Working with Claude Code

Open this repository in Claude Code. It operates projects through:

- `projects/<id>/.project/` — synchronized context files (script, timeline, creative plan,
  storyboard, scene specs, assets, brand, tasks). Valid edits are imported automatically.
- `npm run studio -- <command>` — validated, versioned actions (`help` lists them all).
- **AI tasks** created in the GUI (“Ask Claude”). Run them in your Claude Code session with
  `npm run studio -- tasks`, or enable **headless** execution in Settings so the worker runs
  `claude -p` for each task.

See [AI_WORKFLOW.md](AI_WORKFLOW.md) and [CLAUDE.md](CLAUDE.md).

> **PowerShell note:** PowerShell's `npm` shim drops flags after `--`. Use `npm.cmd run studio -- …`
> or `npx tsx cli/studio.ts …` when passing `--flags` from PowerShell. Bash, Git Bash and cmd work as documented.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Web app (`127.0.0.1:3210`) + worker with reload |
| `npm run build` / `npm start` | Production build / start web + worker |
| `npm run studio -- <cmd>` | Claude Code's CLI action surface |
| `npm run bootstrap` | First-time setup (env, database, migrations) |
| `npm run db:up` / `db:down` | Start / stop the Postgres container |
| `npm run db:migrate` | Create/apply a migration (development) |
| `npm run typecheck` / `npm test` | TypeScript and unit tests |

## Where things live

```
projects/<id>/            one folder per project (gitignored)
  audio/voice/ audio/music/ audio/sfx/
  assets/images/ assets/videos/ assets/logos/ assets/fonts/ …
  renders/                rendered MP4s + thumbnails
  exports/                stills, packages
  .project/               Claude Code context files (see PROJECT_SCHEMA.md)
storage/                  app-level local data (gitignored)
  config/settings.json    preferences
  config/secrets.json     API keys (server-side only)
  cache/remotion-bundles  cached Remotion bundles
  tools/                  whisper.cpp install
```

## Rendering notes

- The first render downloads Remotion's headless Chrome and bundles the composition; later
  renders reuse both. Progress, stage and failures (with the failing scene and browser logs)
  appear on the Render page.
- Curated fonts load from Google Fonts on first use; brand fonts you upload are served locally.
- Remotion is free for individuals and small teams; companies may need a license — see
  <https://www.remotion.dev/license>.

## Security

Local services bind to `127.0.0.1`; API routes reject foreign `Host`/`Origin` headers. The
ElevenLabs key is read only by server code and never sent to the browser. Uploads are validated
by extension, content and size; project ids and paths are validated so files can never escape a
project folder; user text is never executed as a command. Details in [ARCHITECTURE.md](ARCHITECTURE.md#9-security-local-first).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| “Database unavailable” | Start Docker Desktop, then `npm run db:up` |
| Worker offline badge | `npm run dev` starts it; check the `worker` log lines |
| “Voice generation failed.” | Check the ElevenLabs key/quota in Settings, or import audio |
| Render failed | Open the render row → *Show logs*; the failing scene is linked |
| Flags ignored in PowerShell | Use `npm.cmd run studio -- …` or `npx tsx cli/studio.ts …` |
| `npm run studio -- doctor` | Checks database, worker, ffmpeg and the Claude CLI |

## Documentation

- [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) — install, keys, Claude Code, updating your fork
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) — making a video, the workspace, working with Claude Code
- [ARCHITECTURE.md](ARCHITECTURE.md) — processes, boundaries, pipeline and staleness
- [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md) — database models and `.project/` files
- [AI_WORKFLOW.md](AI_WORKFLOW.md) — how Claude Code operates projects
- [REMOTION.md](REMOTION.md) — scene spec reference, motion library and render pipeline
- [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md) — creative direction, shots, motion grammar, Creative QA and refinement
- [ELEVENLABS.md](ELEVENLABS.md) — voice, alignment and transcription providers
- [CLAUDE.md](CLAUDE.md) — rules for Claude Code in this repository

## Contributing & license

Forks and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Motion Studio is
released under the [MIT License](LICENSE). Remotion, which renders the videos, has
[its own license](https://www.remotion.dev/license): free for individuals and small companies,
paid for larger ones.
