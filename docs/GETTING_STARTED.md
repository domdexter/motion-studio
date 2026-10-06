# Getting started

From a fresh machine to your first project in about 15 minutes. Everything runs locally; the only
outside services are the ones you choose to connect (Claude Code, and optionally ElevenLabs).

- [1. What you need](#1-what-you-need)
- [2. Get the code](#2-get-the-code)
- [3. Install and start](#3-install-and-start)
- [4. Keys and settings](#4-keys-and-settings)
- [5. Connect Claude Code](#5-connect-claude-code)
- [6. Check everything works](#6-check-everything-works)
- [7. Updating your fork](#7-updating-your-fork)
- [Troubleshooting](#troubleshooting)

---

## 1. What you need

| | Required? | Notes |
| --- | --- | --- |
| **Node.js 20.9+** | Yes | 22 LTS recommended — <https://nodejs.org> |
| **Docker Desktop** | Yes* | Runs Postgres only — <https://www.docker.com/products/docker-desktop> |
| **Git** | Yes | <https://git-scm.com> |
| **Claude Code** | For AI work | The AI operator: storyboards, scene design, edits, reviews, AI images — <https://docs.claude.com/en/docs/claude-code/overview> |
| **ElevenLabs account** | Optional | AI voice-over with word timing, music beds, sound effects — <https://elevenlabs.io> |
| Disk space | ~1 GB | Remotion's headless browser, render cache, optional whisper.cpp |

\* If you already run Postgres 14+ yourself you can skip Docker and point `DATABASE_URL` at it.

Works on Windows, macOS and Linux. The "system voice" scratch-take option is Windows only; everything
else is cross-platform.

## 2. Get the code

**Fork it** (recommended — you get your own copy to customise and keep):

1. Open <https://github.com/domdexter/motion-studio> and click **Fork**.
2. Clone your fork:

   ```bash
   git clone https://github.com/<your-username>/motion-studio.git
   cd motion-studio
   ```

**Or let Claude Code do it.** Open Claude Code in the folder where you keep projects and say:

> Clone https://github.com/<your-username>/motion-studio and set it up by following
> docs/GETTING_STARTED.md. Stop and tell me when you need an API key.

Claude Code will run the steps below, start the studio and tell you what's left for you to do.

## 3. Install and start

Start **Docker Desktop** first, then:

```bash
npm install
npm run bootstrap
npm run dev
```

| Step | What it does |
| --- | --- |
| `npm install` | Installs dependencies and generates the database client |
| `npm run bootstrap` | Creates `.env` from `.env.example`, starts Postgres in Docker on `127.0.0.1:5488`, applies migrations |
| `npm run dev` | Starts the web app on <http://localhost:3210> and the background worker (renders, voice, transcription) |

Open <http://localhost:3210>. You should see an empty dashboard with **New project**.

Stop it with `Ctrl C`. Postgres keeps running in Docker (`npm run db:down` stops it). Next time just
run `npm run dev`.

## 4. Keys and settings

The studio works with **no keys at all**: you can import your own voice-over and transcribe it
locally. Add keys for the extras you want.

### `.env`

`npm run bootstrap` creates `.env` for you. You normally don't need to touch it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | local Docker Postgres | Change only if you run your own Postgres |
| `STUDIO_PROJECTS_DIR` | `./projects` | Where project folders (audio, assets, renders) are stored |
| `ELEVENLABS_API_KEY` | *(empty)* | Optional — or save the key in Settings instead |

`.env` is gitignored. **Never commit it.**

### ElevenLabs (optional)

1. Create a key at <https://elevenlabs.io/app/settings/api-keys>.
2. Either paste it into **Settings → ElevenLabs** and click **Test connection**, or put it in `.env` as
   `ELEVENLABS_API_KEY="…"` and restart `npm run dev`.
3. If you restrict the key, enable: *Text to Speech*, *Voices (read)*, *Models (read)*, *Forced
   Alignment*, *Speech to Text*, *Music Generation*, *Sound Effects*, and optionally *User (read)*.
4. Pick a default voice in **Settings → ElevenLabs**.

Keys saved in Settings are stored in `storage/config/secrets.json` (gitignored) and are only ever
read by the local server — the browser never receives them. Details: [ELEVENLABS.md](../ELEVENLABS.md).

### Without ElevenLabs

- **Voice-over:** record your own and import MP3/WAV/M4A, or use the Windows system voice for a scratch take.
- **Word timing:** **Settings → Alignment → Install whisper.cpp**, then transcribe locally. Or import
  SRT/VTT/JSON timestamps from any other tool.
- **Music/SFX:** upload your own files on the Audio page.

### Other settings worth a look

| Settings section | What to set |
| --- | --- |
| **Brand kits** | Your logo, colours, fonts and references — set once, reused by every project |
| **Rendering** | Default frame rate, output format, render concurrency, an optional folder to copy finals to |
| **AI & Claude Code** | Headless mode (the worker runs Claude Code for you), model, allowed tools, image style |
| **Storage** | Where projects live |

## 5. Connect Claude Code

Claude Code is the studio's AI operator. It reads each project's context from
`projects/<id>/.project/` and acts through a validated CLI, so every change it makes is versioned,
attributed and shows up in the GUI live.

1. Install Claude Code and sign in (<https://docs.claude.com/en/docs/claude-code/overview>).
2. Open **this repository folder** in Claude Code (terminal, desktop app or IDE extension). It
   picks up [CLAUDE.md](../CLAUDE.md), the `motion-studio` skill and the slash commands in
   `.claude/` automatically.
3. Try it:

   ```text
   /studio-tasks            # do the AI tasks you queued with "Ask Claude" in the GUI
   /storyboard <project>    # plan scenes from the voice-over timeline
   /edit-scene <project> scene_03 make the headline land on "faster"
   /creative-review <project>
   /render <project>
   ```

   Or just talk to it: *"Make a 30-second launch video for my app from this script…"*

**Two ways to run AI tasks**

| Mode | How |
| --- | --- |
| **Interactive** (default) | Click **Ask Claude** in the GUI → a task is queued → in Claude Code run `/studio-tasks` |
| **Headless** | **Settings → AI & Claude Code → headless** — the worker runs `claude -p` for each task automatically |

> **PowerShell:** npm's PowerShell shim drops flags after `--`. Use `npx tsx cli/studio.ts <command> …`
> (or `npm.cmd run studio -- …`). Bash, Git Bash, zsh and cmd work as documented.

## 6. Check everything works

```bash
npm run studio -- doctor
```

It checks the database, the worker, ffmpeg and the Claude CLI and tells you how to fix anything
missing. Then follow [USER_GUIDE.md](USER_GUIDE.md) to make your first video.

To try a finished project straight away, import an example package: **Import package** on the
dashboard, then choose a `.zip` from [`examples/`](../examples/).

## 7. Updating your fork

```bash
git remote add upstream https://github.com/domdexter/motion-studio.git   # once
git pull upstream main
npm install
npm run dev        # applies new database migrations automatically
```

Your projects live in `projects/` and `storage/`, which are gitignored — updating never touches them.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Database unavailable" | Start Docker Desktop, then `npm run db:up` |
| Port 5488 or 3210 already in use | Stop the other process, or change the port in `docker-compose.yml` + `.env` / `package.json` |
| Worker offline badge | `npm run dev` starts it; read the `worker` lines in the terminal |
| "Voice generation failed." | Check the key and quota in **Settings → ElevenLabs → Test connection**, or import audio |
| First render is slow | It downloads Remotion's headless Chrome and bundles once; later renders reuse both |
| Render failed | Render page → open the row → **Show logs**; the failing scene is linked |
| Claude Code ignores `--flags` on Windows | Use `npx tsx cli/studio.ts …` |
| Anything else | `npm run studio -- doctor` |
