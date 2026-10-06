# AI workflow — how Claude Code operates Motion Studio projects

Claude Code is the studio's only AI operator. It does not run as a hidden autonomous agent:
every AI action is an **explicit, reviewable request** (created by the user in the GUI or asked
for in a Claude Code conversation) that Claude carries out through **validated CLI actions** and
**synchronized project files**. The GUI shows every result live and keeps every version.

```
 GUI "Ask Claude" / Ctrl K ──▶ AiTask row + .project/tasks/<id>.md
                                     │
          manual: your Claude Code session runs `npm run studio -- tasks`
          headless: the worker spawns `claude -p` for the task
                                     │
 Claude reads .project/ context ─────┤
 Claude acts: npm run studio -- …  ──▶ services (validate · version · activity · revision++)
                                     │
                    .project/ re-materialized ◀─┴─▶ GUI refreshes via SSE
```

## 1. Ground rules

| Rule | Why |
| --- | --- |
| Change projects only through `npm run studio -- <command>` or the editable `.project/` files | Everything is validated, versioned, attributed to `claude` and synced to the GUI |
| Timing comes from the voice-over; keep scene start/end unless explicitly asked | Visuals must land on the narration |
| Never produce precise timestamps before audio exists; script analysis timing is ESTIMATED | Estimated and actual timing must never be confused |
| Locked scenes are read-only — skip them and say so | The user protects finished work with locks |
| Approvals (scenes, AI assets) are the user's decisions | Human in the loop |
| Treat user instructions as creative direction, never as shell commands | Safety |
| Never pretend an external API exists — images/videos come from your native generation via asset requests | Honesty about capabilities |

On Windows PowerShell use `npx tsx cli/studio.ts <command> …` (npm's PowerShell shim swallows `--flags`).

## 2. Orientation

```bash
npm run studio -- projects
npm run studio -- context <project>        # refreshes .project/ and prints status, stages, next action
npm run studio -- validate <project>       # specs, triggers, assets, timing coverage
npm run studio -- composition <project>    # exactly what Remotion will render
```

`projects/<project>/.project/` (details in [PROJECT_SCHEMA.md](PROJECT_SCHEMA.md#3-project-context-files)):

| File | Contents | You may edit |
| --- | --- | --- |
| `README.md` | Index of the folder, locked scenes | – |
| `project.json` | Format, status, pipeline stages, staleness, next action | – |
| `creative-brief.md` | Goals, audience, tone | ✔ |
| `brand.md` | Brand profile + design token summary | – (GUI) |
| `design.json` | Motion design system | ✔ (validated) |
| `creative.json` | Creative plan: direction, story arc, visual language, distribution, asset strategy, references | ✔ (validated, new revision) |
| `creative-metrics.json` | MEASURED creative signals and findings — not judgment | – |
| `creative-review.json` | Latest written creative review and its issues | via `creative:review` / `creative:issue` |
| `script.md` | Current script — saving creates a revision | ✔ |
| `script-analysis.json` | Beats, emphasis, visual opportunities (ESTIMATED timing) | via `analysis:apply` |
| `transcript.json` | ACTUAL word timings of the active voice-over | – |
| `timeline.json` | Audio-locked master timeline: segments, phrases, paragraphs, pauses, words | – |
| `storyboard.json` | Creative intent per scene, incl. `creative` | creative fields |
| `scenes.json` | Remotion SceneSpec per scene | spec fields |
| `assets.json` | Asset library + AI asset requests (with `brief` and `generationBrief`) | via CLI |
| `audio.json` / `renders.json` | Mix and render history | – |
| `tasks/<id>.md` | Briefs of pending/running AI tasks | – |

Edits to editable files are imported by the worker's file watcher within a second (or run
`npm run studio -- apply <project>`). Imports are validated and **3-way merged** against the last
materialized version: if the GUI changed the same field meanwhile, the GUI version wins and a
conflict is reported. Invalid edits are rejected and shown in the GUI as sync issues. Read-only
fields (timing, lock, status) in files are ignored with a warning. `creative.json` is imported as the
whole plan and saved as a new revision; if the plan changed in the GUI meanwhile, the GUI version wins.

## 3. AI tasks

Task types: `analyze_script`, `plan_creative`, `generate_storyboard`, `regenerate_scenes`,
`edit_scene`, `scene_alternatives`, `generate_assets`, `creative_review` (read-only),
`refine_creative`, `command` (free-form from the command bar).

```bash
npm run studio -- tasks [project]              # pending/running tasks
npm run studio -- task:show <taskId>           # the brief (scope, keep-timing/voice flags, instruction, how-to)
npm run studio -- task:start <taskId>
npm run studio -- task:log <taskId> "Drafted scenes 1–4"
npm run studio -- validate <project>
npm run studio -- task:complete <taskId> --summary "What changed and what to review"
npm run studio -- task:fail <taskId> --error "Why it could not be done"
```

Tasks never include locked scenes in their scope (they are removed and listed as skipped) — except
`creative_review`, which changes nothing and keeps them. Briefs of creative tasks add a *Creative
context* section pointing to `creative.json`, `creative-metrics.json` and `creative-review.json`.

**Execution modes** (Settings → Claude Code):

- **Manual** (default): tasks wait for your interactive Claude Code session. `/studio-tasks`
  (`.claude/commands/studio-tasks.md`) processes them one by one.
- **Headless**: the worker runs `claude -p --output-format stream-json --permission-mode dontAsk
  --no-session-persistence --allowedTools <Read Glob Grep Edit Write Bash(npm run studio *)>` with
  the task prompt on stdin, optional `--model` and `--max-budget-usd`. Output streams into the
  task log in the GUI; the process never receives user text as command-line arguments.

## 4. Script analysis

Write `analysis.json` following `ScriptAnalysisSchema` (`src/core/spec/analysis.ts`): `source:
"claude"`, `summary`, `tone`, `audience`, `wordsPerMinute`, `estimatedDuration`, `beats[]` (`id`,
`title`, `kind`, `text`, `paragraph`, `keyStatement`, `emphasis[]`, `visualOpportunity`,
`suggestedVisualType`, `suggestedAnimation[]`, `assetNeeds[]`, `estimatedStart`, `estimatedEnd`),
`emphasisWords[]`, `sceneBoundaries[]`. Then `npm run studio -- analysis:apply <project> analysis.json`.
All times are estimates from word count — the GUI labels them *Estimated*.

## 5. Creative direction and Creative QA

Scenes are designed from the project's creative plan, never in isolation. Full reference:
[CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md).

1. **Plan first** (`plan_creative`, or before a storyboard when `creative.json` is empty). Read
   `script.md`, `timeline.json`, `creative-brief.md`, `brand.md`, `design.json`; write `direction`,
   `storyArc` (acts derived from this script, mapped to scene keys, with planned intensity),
   `visualLanguage`, `visualDistribution`, `assetStrategy` and `references`:

   ```bash
   npm run studio -- creative <project>                                          # current plan
   npm run studio -- creative:apply <project> plan.json [--replace] [--note "…"]  # sections in the file replace those sections
   npm run studio -- creative:revisions <project>                                # history · creative:restore <project> <version>
   ```

2. **Storyboard documents carry intent**: every scene gets `creative` (purpose, narrativeBeat, act,
   visualMetaphor, interpretation, treatment, intensity, composition, motion, shots, assets) and a
   spec that implements it (§6). Ask what the strongest visual representation of the idea is — not
   which objects the sentence mentions.
3. **Shots** give longer scenes rhythm: `creative.shots` is the plan, `spec.shots` the implementation
   (matching ids, `at` word triggers). Shots cut unless they set `transitionIn`; scene-level elements
   persist across shots (`z < 0` below, `z ≥ 0` above). Use `motionRole` (one primary per shot),
   `motionIntent` and `motion.density` ([REMOTION.md](REMOTION.md#5-shots)).
4. **Measure after every change**: `npm run studio -- creative:metrics <project> [--scene scene_03]
   [--all] [--json]`. Findings are heuristics — confirm them in a draft render before acting on them.
5. **Written reviews** (`creative_review` is read-only): metrics → `npm run studio -- render <project>
   --kind preview --quality draft --force --wait` → look at frames → review JSON →
   `npm run studio -- creative:review <project> review.json`. Scores are advisory and are only
   accepted with written issues or strengths. Answer quality questions ("find the weakest scenes")
   with a saved review, never by changing scenes.
6. **Issues and refinement**: the user accepts or dismisses issues in Creative QA; accepted issues
   become `refine_creative` tasks (`creative:refine <project> <reviewId> <issueId,…>` does the same).
   Refine inside the existing timing and voice, update `creative` and specs, run `validate` and
   `creative:metrics`, then mark each addressed issue:
   `npm run studio -- creative:issue <project> <reviewId> <issueId> --status resolved`.

`creative:reviews <project> --issues` lists the latest review's issues;
`creative:request-review <project> "question…" [--scenes …]` creates a review task.

## 6. Storyboard documents

Requires a timeline (otherwise: “Generate or import a voice-over before generating an audio-locked storyboard.”).

```json
{
  "mode": "replace",
  "note": "Problem → solution arc, UI-led middle",
  "scenes": [
    {
      "name": "Too many tools",
      "wordStart": 7, "wordEnd": 25,
      "visualConcept": "Fragments that never line up, collapsing into one point on 'one place'",
      "visualType": "motion_graphic",
      "animation": ["fragments drift apart on 'juggle'", "collapse on 'one place'"],
      "onScreenText": "Five tools. One week.",
      "assetsRequired": [],
      "notes": "",
      "creative": {
        "purpose": "Make the cost of juggling tools felt",
        "narrativeBeat": "problem",
        "act": "friction",
        "visualMetaphor": "Pieces that never fit together",
        "interpretation": "metaphorical",
        "treatment": "transformation",
        "intensity": 4,
        "motion": { "density": "high", "primary": "fragments collapse into one point" },
        "shots": [
          { "id": "scatter", "purpose": "The pieces don't fit" },
          { "id": "collapse", "purpose": "Many become one", "startWord": "one" }
        ]
      },
      "spec": {
        "version": 1,
        "motion": { "density": "high" },
        "elements": [ … ],
        "shots": [
          { "id": "scatter", "elements": [ … ] },
          { "id": "collapse", "at": { "type": "phrase", "value": "one place" }, "elements": [ … ] }
        ]
      }
    }
  ]
}
```

- `mode: "replace"` — a new scene structure. Word anchors `[wordStart, wordEnd)` index
  `timeline.json → words` and must be **contiguous and cover every word**; boundaries are placed
  in the gap before each first word. A project snapshot is saved first; fails if any scene is locked.
- `mode: "update"` — refine existing scenes by `sceneId` (`scene_01` …). Timing is kept; locked scenes are skipped.
- Apply: `npm run studio -- storyboard:apply <project> storyboard.json [--scenes scene_02,scene_03]`.
- `creative` is optional per scene and validated (`SceneCreativeSchema`); in `update` mode a scene
  without `creative` keeps its current intent.
- Quick deterministic alternative: `npm run studio -- storyboard:draft <project> [--pace fast|medium|slow] [--restructure]`.
- After applying: `validate`, then `creative:metrics` and fix the real high/medium findings.

Good storyboards: one idea per scene (2–6 s), anchored on sentence/phrase boundaries, designed from
the creative plan's story arc, treatments varied across the arc within one visual language, shots
for rhythm inside longer scenes, and visuals synced to the words that matter. See
[CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md) and [REMOTION.md](REMOTION.md#12-creative-quality-rules).

## 7. Scenes

```bash
npm run studio -- scene:show <project> scene_03                     # storyboard fields, creative intent, spec, spoken words, shot windows, resolved events
npm run studio -- scene:apply <project> scene_03 spec.json --message "Slower, premium entrance"
npm run studio -- scenes:apply <project> scenes.json [--scenes …]   # many specs, validated atomically
npm run studio -- scene:timing <project> scene_03 --start 12.4      # ONLY when the user asks; snaps to words unless --free
npm run studio -- scene:lock <project> scene_03 [--unlock]           # ONLY when the user asks
```

`scene:apply` accepts either a bare SceneSpec or `{ "spec": …, "creative": …, "name": …,
"visualConcept": …, "onScreenText": …, "animationNotes": [...], "notes": … }` (`"creative": null`
clears the recorded intent). Every change creates a scene version (restorable in the Scenes editor)
and resets approval so the user reviews it again — except a change to `creative` alone, which isn't
rendered and keeps approval.

**Changing part of a scene — prefer an edit plan.** Rewriting a whole spec to move one element loses
everything the editor knows about it. Read the scene, write the operations, check them, then apply:

```bash
npm run studio -- scene:context <project> scene_03 [--element title]   # elements, what they animate, their cues, the words, tokens
npm run studio -- scene:edit <project> scene_03 plan.json --preview    # what it would do — nothing is saved
npm run studio -- scene:edit <project> scene_03 plan.json             # one scene version, one undo step
```

```json
{ "note": "Land the headline on the product name",
  "edits": [ { "op": "set", "target": "headline", "patch": { "enter": { "type": "slideLeft", "duration": 0.6 } } },
             { "op": "cue", "target": "card", "cue": "emphasis+pop", "at": { "type": "phrase", "value": "our new platform" } } ] }
```

Operations: `set add remove duplicate arrange keyframe clearKeyframes path cue group ungroup scene`.
Targets are ids or places (`#2`, `shot_b/#1`, `#2.1` for a group's child). Every edit goes through the
same patches, validation and undo as a hand edit, and each one reports what it changed in plain words —
quote those lines in the task summary ([REMOTION.md](REMOTION.md#14-ai-editing--the-structured-edit-plan)).

**Alternatives** (`scene_alternatives`): write the variants as separate files, apply the strongest
with `scene:apply`, and describe the others (with their file paths) in the task summary.

**Visual QA**: render a draft of the scene and look at it:

```bash
npm run studio -- render <project> --kind scene --scene scene_03 --quality draft --wait
```

Measured creative signals for the scene: `npm run studio -- creative:metrics <project> --scene scene_03` (§5).

## 8. Design system and brand

- `npm run studio -- design:preset <project> tech_neon [--keep-colors] [--keep-fonts]`
- `npm run studio -- design:apply <project> design.json` (full, validated `DesignSystem`)
- Brand identity (name, logo, guidelines, fonts) is edited in the GUI; read it from `brand.md`.
- **Brand kits** (Settings → Brand kits) are reusable brands. A project either follows a kit (its
  brand, design system and brand files are copied in and re-synced whenever the kit changes) or has
  a custom brand. `npm run studio -- brands` lists kits. Only when the user asks:
  `brand:apply <project> <kitId>` (follow a kit — replaces the project's brand; a version is saved
  first), `brand:detach <project>` (keep the current look as a custom brand), `brand:save <project>
  --name "…"` (save the project's brand as a new kit). Editing a following project's brand or design
  (`design:apply`, `design:preset`) turns it into a custom brand — mention that in your summary.

Prefer design tokens (`"primary"`, `"surface"`, roles, default motion) in specs so the design system
can restyle the whole video.

## 9. AI images and videos

```bash
npm run studio -- assets:request <project> --kind image --prompt "…" --scene scene_02 --aspect 16:9 --style "…" --purpose "…" [--brief brief.json]
npm run studio -- requests <project> --status requested
npm run studio -- assets:generating <request_id>
#   … generate with your native image/video generation, save to a temp file …
npm run studio -- assets:fulfill <request_id> ./out/hero-1.png ./out/hero-2.png
npm run studio -- assets:fail <request_id> --reason "…"
```

States: `requested → generating → generated → approved | rejected` (rejected/approved requests can
be regenerated with feedback; any open request can be cancelled). Candidates appear in Assets →
Images/Videos; **the user approves one**. Reference approved assets in specs by id
(`{ "type": "image", "assetId": "ast_…" }`). Other files: `assets:import <project> <file> --kind image|video|logo|music|sfx …`.

Prefer native Remotion graphics (typography, UI, charts, diagrams) and request AI imagery only when a
scene needs something code can't draw — people, places, products, textures. Follow the asset
hierarchy: existing asset → screenshot → Remotion graphic → component → AI image → AI video.

**Composition briefs.** `--brief brief.json` attaches an `AssetBrief` (purpose, subject, composition,
focal point, negative space, palette, lighting, style, camera, mood, `textInImage`, avoid, …) so the
image serves its scene's composition. `assets.json` then lists the request's `brief` and a
`generationBrief` — the brief merged with the plan's asset consistency. Generate from
`generationBrief` ([CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md#11-asset-strategy)).

**HyperFrames (optional).** When an HTML/CSS motion clip is the best tool (e.g. a complex web-style
animation), and HyperFrames is installed, render the clip to MP4 with it and register the file with
`assets:import <project> clip.mp4 --kind video --name "…"`; use it in a scene with a `video` element.
The Remotion composition stays the single timeline.

**Placing images and videos in scenes.** Clips always live inside a scene (whose timing the voice-over
owns). `scene:media <project> scene_03 <assetId> --placement background|fullscreen|framed|pip
[--trim 2] [--trim-end 9] [--rate 1] [--loop|--no-loop] [--volume 0] [--appear 1.5] [--disappear 4] [--dim 0.35]`
adds a correctly sized `video`/`image` element (appear/disappear are seconds into the scene; a clip
that appears mid-scene starts playing when it appears) and saves a new scene version. The user does
the same from Assets → *Insert into scene* or the Scenes editor's inspector → *Layers* → *+ Media*.
Afterwards (only when asked): `scene:media:list <project> scene_03` shows the scene's media with their
times, and `scene:media:update <project> scene_03 <element> [--trim-start 2] [--trim-end <s|end>]
[--rate 1.5 | --fit-speed] [--loop|--hold] [--volume] [--dim] [--fit cover|contain]` trims a clip,
changes its speed (`--fit-speed` plays the trimmed part in exactly its time in the scene) or what it
does when the trimmed part ends. `scene:media:zoom` / `scene:media:unzoom` take the same flags as
`overlay:zoom` / `overlay:unzoom` (times in video seconds). `<element>` is the element id (`video_1`),
or `shot_id/#2` for media without one. The user does this in the Scenes editor by selecting the clip on the canvas or timeline and using its inspector (Timing, Speed & audio, Trim, Zoom), or
on the Scenes and Timeline pages' *Scene media* lane (drag a clip to move it, drag an edge to change when it
appears or disappears, drag its zoom bars to retime zooms; moves write `sceneTime` enter/exit triggers).
`scene:element <project> scene_03 <element> [--x 50] [--y 50] [--width 40|auto] [--height auto] [--rotation 0]
[--scale 1] [--opacity 0.8] [--z 5] [--placement background|fullscreen|framed|pip] [--enter fade:0.5] [--exit fade:0.4|none]`
moves, sizes, rotates, fades or re-layers any element (x/y are % of the frame at its anchor, width/height % of
the frame) and sets its entrance or exit; `--placement` re-places an image or video with the same presets as
`scene:media`. An entrance or exit of `none` on an element timed to appear or leave mid-scene is stored as a
0.04 s cut so its timing is kept. The user does the same by dragging on the Scenes editor canvas or in its inspector.

**Picture edits for any clip (overlay or scene media, only when asked).** `overlay:edits <project> <overlayId>
edits.json` and `scene:media:edits <project> <scene> <element> edits.json` set any of: `crop`
(`{left,top,right,bottom}` fractions cut from each side, `null` removes it), `speedSegments` (speed ramps
and freezes: `[{id,startSec,endSec,rate}]` in clip seconds, rate 0 = freeze frame), `annotations` (blur,
box, arrow, label, spotlight, click: `[{id,type,startSec,endSec,x,y,w,h,text?,color?}]`, x/y/w/h are
fractions of the clip frame) and `duckUnderVoice` (lower the clip's own sound while the narrator speaks).
See PROJECT_SCHEMA.md. `overlay:split <project> <overlayId> --at 14.2 [--until 16]` and `scene:media:split <project>
<scene> <element> --at 14.2 [--until 16]` split a clip in two or cut a section out (video seconds).
In the GUI: the clip's panel → *Annotations / Crop / Speed ramps & freezes*, *Split at playhead*, and
*Suggest zooms* (finds typing, clicks or menus in one part of a recording and proposes zooms to review).

**Scene templates (only when asked).** `templates` lists built-in templates (`builtin:title-card`,
`builtin:end-screen`, `builtin:lower-third`) and saved ones. `template:apply <project> <scene> <templateId>
[--title … --kicker … --link … --name …] [--at 2 --duration 4 --side left|right]`: scene templates replace
the scene's design (timing stays, the old design is in version history); element templates such as the
lower third are added at `--at` seconds into the scene. `template:save <project> <scene> --name "…"
[--elements id1,id2]` saves a scene (or some elements) for any project; images and videos travel with it.
The user does this from Scenes → *Templates*.

**Overlay track.** For a cutaway or B-roll clip that should run across scene cuts or be trimmed
precisely, use the overlay track instead of a scene element (only when the user asks for an overlay):
`overlay:add <project> <assetId> --start 12.5 [--duration 4] [--placement fullscreen|framed|pip]
[--trim-start 2] [--trim-end 6.5]`, then `overlay:update <project> <overlayId> [--start] [--duration]
[--trim-start] [--trim-end <s|end>] [--rate] [--loop|--hold] [--dim] [--fade-in] [--fade-out] [--hidden|--visible]`
and `overlay:remove`. Times are absolute video seconds; a video's on-screen length defaults to its
trimmed part. To zoom into part of a recording (only when asked): `overlay:zoom <project> <overlayId>
--start 47.9 --end 51.2 --area 50,20,40 [--to 10,20,40] [--ease 0.5]` (area = left%, top%, size% of the
clip frame; `--to` pans to a second area while holding) and `overlay:unzoom <project> <overlayId>
(--index 1 | --all)`. Overlays never change scene or voice-over timing. The user edits them on the Scenes or
Timeline page (drag to move, drag an edge to trim) or via *Add image or video* → *Overlay track*.

**The user's undo history.** On the Scenes and Timeline pages the user can undo/redo their own edits
(Ctrl+Z / Ctrl+Y): scene edits and approval, cuts, split/merge/append, version restores, overlay
clips, audio clips, the voice-over mix (volume, mute, muted sections) and markers. Undo only applies while the touched scenes/overlays still match the edit — if you
change the same scene afterwards, the user's undo of their earlier edit is refused and dropped from
their history (your own changes stay). Your CLI edits are recorded as `claude` steps and never enter
the user's undo stack.

## 10. Audio

- Voice: `npm run studio -- voice:generate <project> [--provider elevenlabs|system] [--voice <id>] --wait`
- Alignment: `npm run studio -- align <project> [--method elevenlabs_forced_alignment|elevenlabs_stt|whisper_cpp] --wait`
- Timeline: `npm run studio -- timeline:recalculate <project>` — re-times audio-locked scenes to the new words (snapshot saved first).
- Music/SFX/voice lines: `audio:tracks <project>`, `audio:add <project> <assetId> [--kind music|sfx|voice] [--start 0] [--volume 0.35] [--duck]`,
  `audio:update <project> <trackId> [--start] [--trim-start] [--duration <s|full>] [--volume] [--fade-in] [--fade-out] [--loop|--no-loop] [--duck|--no-duck] [--mute|--unmute]`.
- Trimming the voice-over (only when the user asks): `voice:mute <project> --start 39.54 [--end 42.04]` mutes a
  section (default: to the end) and `voice:unmute <project> (--start … [--end …] | --all)` removes them. The
  voice-over never moves, so word timing, triggers and scenes stay exactly as they are; muted words don't duck
  the music. Volume changes land on whole frames: a muted section silences every frame it touches, so start
  it in the gap after the last word you keep. Don't re-import an edited audio file for this. The user does the same on the
  Timeline or Scenes page (drag the bracket at either end of the waveform, double-click it to mute a section) and moves or trims
  music/SFX clips in the Audio lane. Muted sections apply to whichever voice-over is active.
- Generate music/SFX with ElevenLabs (only when a key is configured — otherwise ask the user to upload audio):
  `audio:generate <project> --kind music --prompt "calm ambient tech bed" [--duration 45] [--vocals] --wait`
  (music defaults to the video length, instrumental) or `--kind sfx --prompt "soft UI click" [--duration 1.5] [--loop]`.
  The result is added to the audio library and, unless `--no-add`, placed on the timeline (music: 35%, fades, ducking).
- A separate spoken line (e.g. a call to action after the narration), only when the user asks for it:
  `scene:append <project> --name "Call to action" --duration 4 --voice-text "…"` adds a user-adjusted scene
  after the last one, then `audio:generate <project> --kind voice --prompt "…" --start <scene start + lead-in> --wait`
  speaks the words with the active ElevenLabs voice-over's voice, model and settings as its own `voice`
  track (100%, the main take and its timing are untouched) and prints the word timing relative to the
  clip. Those words are not in the transcript, so sync the scene with `sceneTime` triggers
  (track start + word start − scene start), not `word` triggers.

If the voice-over changes, the GUI shows “Voice-over changed. Existing scene timing may no longer
match.” with *Recalculate*, *Keep* and *Compare*. Don't recalculate on the user's behalf unless asked.

## 11. Rendering

```bash
npm run studio -- render <project> --kind preview --force --wait           # fast full-length draft
npm run studio -- render <project> --kind scene --scene scene_02 --wait
npm run studio -- render <project> --kind range --start 4 --end 9 --wait
npm run studio -- render <project> --kind final --preset youtube --wait   # needs approved scenes (or --force when the user says so)
npm run studio -- render <project> --kind final --fps 60 --concurrency 4 --wait   # output frame rate; parallel frames (default: Settings → Render, else automatic, at most 3 with video clips)
npm run studio -- render <project> --kind final --loudness youtube --captions boxed --caption-position bottom --wait   # normalize loudness (youtube -14 / podcast -16 / broadcast -23 LUFS); burn in captions (minimal|boxed|bold|karaoke)
npm run studio -- renders <project>
npm run studio -- still <project> --sec 12.5 --png --wait
npm run studio -- thumbnail <project> --sec 12.5 --title "Stop typing" [--tag "FREE AI DICTATION"] [--layout left|center|bottom] [--darken 0.55] --wait   # YouTube thumbnail JPG from a frame
npm run studio -- export:captions <project> [--format srt|vtt]    # captions file from the transcript (muted sections skipped)
npm run studio -- export:chapters <project>                       # YouTube chapters from scene names
npm run studio -- voice:cleanup <project> [--pauses] [--apply]    # filler words and long silences (only apply when asked)
```

Loudness, captions, frame rate and parallel frames are also on the Render page, with presets (YouTube
upload, Reels with captions, Quick review), extra sizes queued in one go, and caption/chapter/thumbnail exports.

## 12. Versioning & attribution

Every mutation records an Activity (`actor: claude` for CLI actions; `--actor user` when acting on
the user's explicit behalf). History lives in: script revisions, voice takes, transcripts,
timelines, storyboard revisions, scene versions, creative plan revisions, creative reviews, project
snapshots (Versions & activity page) and render history. Nothing is silently overwritten: regenerations and restores create new versions.
