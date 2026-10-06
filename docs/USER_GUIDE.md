# User guide

How to make a video with Motion Studio, page by page, plus how to hand the creative work to Claude
Code. If you haven't installed it yet, start with [GETTING_STARTED.md](GETTING_STARTED.md).

- [The big idea](#the-big-idea)
- [Your first video in 10 steps](#your-first-video-in-10-steps)
- [The workspace, page by page](#the-workspace-page-by-page)
- [Working with Claude Code](#working-with-claude-code)
- [Prompts that work well](#prompts-that-work-well)
- [Tips](#tips)

---

## The big idea

```
script ──▶ voice-over ──▶ word timings ──▶ creative direction ──▶ storyboard ──▶ scenes ──▶ render
                     (audio owns timing)                   (Claude Code designs, you approve)
```

1. **Audio is the clock.** Every scene and every animation is anchored to words in the actual
   voice-over, so visuals land on the narration. Change the voice and the timing follows.
2. **Scenes are data, not hand-made keyframes.** Each scene is a structured spec (text, UI mockups,
   charts, images, video, cursors, shapes…) that Remotion renders. You can edit it visually, and
   Claude Code can edit it through the same validated actions.
3. **Claude Code is your motion designer.** It plans the creative direction, drafts the storyboard,
   designs and refines scenes, writes reviews and generates images — and every change is versioned
   and visible in the GUI. You approve, lock and roll back.

## Your first video in 10 steps

1. **New project** (dashboard → *New project*). Give it a name, a format (16:9, 9:16, 1:1, 4:5 or
   custom), a frame rate, and a brand (a brand kit or quick manual setup). Then pick what you
   already have:

   | You have… | Choose |
   | --- | --- |
   | Only an idea or a script | **Script only** |
   | A recorded voice-over | **Audio only** |
   | A script and a voice-over | **Script + Audio** |
   | A voice-over + captions/timestamps (SRT, VTT, JSON) | **Script + Audio + Timeline** |
   | A project package `.zip` (yours, a colleague's, or from `examples/`) | **Existing project** (or **Import package** on the dashboard) |
   | Nothing yet | **Blank project** |

2. **Script** — paste or import your script. Every save is a revision you can compare.
3. **Voice** — *Generate* with ElevenLabs (or the system voice), or *Import* your own recording.
4. **Alignment** — word timings arrive automatically with an ElevenLabs voice. For imported audio,
   run forced alignment, speech-to-text or whisper.cpp. The master timeline is built from them.
5. **Direction** — set the concept, story arc and visual language. Click **Ask Claude** to have
   Claude Code propose it.
6. **Storyboard** — **Draft** gives you an instant storyboard from the timeline; **Ask Claude**
   gives you a considered one. Each scene gets its voice text, visual concept and animation notes.
7. **Assets** — upload logos, screenshots, screen recordings, music and SFX, or create an **AI asset
   request** that Claude Code fulfils with native image generation. You approve which result is used.
8. **Scenes** — open any scene in the editor: live player, layers, inspector, and a timeline with
   the spoken words, so you can cue an animation to a word by dragging it.
9. **Preview & Creative QA** — watch the whole video, a scene or a range. Creative QA shows measured
   signals (pacing, density, contrast…) and written reviews; accepted issues become refinement tasks.
10. **Render** — pick a preset (YouTube, TikTok/Reels, Instagram, Square) and render an MP4. Draft,
    single-scene and range renders are quick for checking work.

Press **Ctrl K** anywhere in a project to open the command bar: ask Claude for anything or jump to
an action.

## The workspace, page by page

| Group | Page | What you do there |
| --- | --- | --- |
| Project | **Overview** | Pipeline status, the next step, the project folder, and "print context in Claude Code" |
| Script | **Script** | Write and revise the script; compare revisions |
| | **Voice** | Generate or import voice-over takes, choose the active take, run alignment |
| Story | **Beats** | Script analysis: beats, emphasis, visual opportunities (timing is *estimated* until audio exists) |
| | **Direction** | Creative plan: concept, story arc, visual language, asset strategy |
| | **Storyboard** | Scenes as cards: intent, voice text, visual concept; lock, approve, regenerate |
| Assets | **Images / Videos / Graphics** | Your uploads and AI asset requests; *Insert into scene* |
| | **Audio** | Music beds and SFX (upload, or generate with ElevenLabs), mix and ducking |
| | **Brand** | This project's logo, colours, fonts and design tokens; follow or detach from a brand kit |
| Motion | **Scenes** | The scene editor (below) |
| | **Timeline** | The whole video: scenes, voice, music, overlays; trim, split, zoom into clips |
| Output | **Preview** | Live Remotion playback of everything |
| | **Creative QA** | Metrics and written reviews |
| | **Render** | Render presets, history, logs, thumbnails, captions/chapters export |
| | **Versions & activity** | Every change by you or Claude, snapshots and restore |

### The scene editor

- **Canvas** — select, move, resize and rotate elements directly; snapping and guides included.
- **Layers** — reorder, group, hide, lock.
- **Inspector** — the selected element's properties: content, typography, colour, effects (blur,
  glow, shadow, blend), clip/reveal masks, 3D tilt, entrance/exit/idle motion.
- **Timeline** — the scene's words along the top. Drag an element's cue onto a word to make it
  appear exactly when it's spoken. Add **keyframes** for any animatable property, edit easing
  curves, and give elements a **motion path**.
- **Undo/redo** and history for every edit, whether you made it or Claude did.

### Locks, approvals and versions

- **Lock** a scene to protect it: Claude Code skips locked scenes in every bulk operation.
- **Approve** scenes and AI assets yourself — Claude never approves its own work.
- Every change creates a revision. Restore any version from *Versions & activity*.

## Working with Claude Code

Open the repository in Claude Code. Three ways to work together:

**1. Ask from the GUI.** Click **Ask Claude** (or press Ctrl K) on any page and describe what you
want. A task is queued with all the context. In Claude Code, run:

```text
/studio-tasks
```

Turn on **Settings → AI & Claude Code → headless** and the worker runs these tasks for you.

**2. Slash commands in Claude Code**

| Command | Does |
| --- | --- |
| `/creative-direction <project> [direction]` | Plans concept, story arc and visual language |
| `/storyboard <project> [direction]` | Builds the storyboard from the voice-over timeline |
| `/edit-scene <project> <scene> <instruction>` | Refines one scene's visuals without moving its timing |
| `/generate-assets <project>` | Fulfils open AI image/video requests |
| `/creative-review <project> [question]` | Reviews the video like a senior motion designer (changes nothing) |
| `/render <project> [final\|preview\|scene <key>\|range <a> <b>]` | Validates and renders |
| `/studio-tasks [project]` | Runs tasks queued from the GUI |

**3. Plain conversation.** Claude Code knows the studio from [CLAUDE.md](../CLAUDE.md) and the
`motion-studio` skill. Ask it anything a motion designer would do — it works through
`npm run studio -- <command>` (`npm run studio -- help` lists all of them), and you watch the GUI update.

What Claude Code will and won't do:

- ✅ Design and refine scenes, write storyboards and reviews, generate images, add music/SFX, render.
- ✅ Explain what it changed; everything is undoable.
- ❌ Move scene timing or word anchors unless you ask.
- ❌ Touch locked scenes, approve its own work, or overwrite approved work without being asked.

## Prompts that work well

Whole video:

> Here's my script for a 45-second launch video for **[product]**, audience **[who]**, tone **calm and
> premium**. Create the project in 16:9, generate the voice-over with ElevenLabs, plan the creative
> direction, storyboard it and design every scene. Render a draft preview when you're done.

Direction:

> /creative-direction my-project Dark editorial look, one glowing glass object per scene, big type,
> no badges or pills. Think Apple keynote, not SaaS explainer.

Scene edits:

> /edit-scene my-project scene_04 Make the three stats count up one by one on "faster", "cheaper" and
> "simpler", and push the camera in slowly.

Review then refine:

> /creative-review my-project Find the three weakest scenes and say exactly why.
>
> Fix issues 1 and 3 from that review. Leave scene_02 alone, it's locked for a reason.

Assets:

> Create an asset request for a background image of a soft gradient studio set in our brand colours,
> then generate it.

## Tips

- **Start with the voice.** Get a voice-over you like before designing scenes; everything syncs to it.
- **Draft renders are cheap.** `render --kind scene --quality draft` checks one scene in seconds.
- **Lock what you love.** Then ask Claude to rework "everything else" safely.
- **Brand kits save time.** Set colours, fonts and logo once in Settings → Brand kits.
- **Real product footage beats mockups.** Record your product, upload it, and *Insert into scene*
  framed or picture-in-picture; zoom into areas on the Timeline.
- **Share a project:** Render page → **Project package** exports a `.zip`; anyone can import it with
  **Import package** on the dashboard.

Deeper references: [REMOTION.md](../REMOTION.md) (scene spec and motion library),
[CREATIVE_SYSTEM.md](../CREATIVE_SYSTEM.md) (direction, shots, Creative QA),
[AI_WORKFLOW.md](../AI_WORKFLOW.md) (how Claude Code operates projects),
[ARCHITECTURE.md](../ARCHITECTURE.md) and [PROJECT_SCHEMA.md](../PROJECT_SCHEMA.md).
