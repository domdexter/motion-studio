# Motion Studio — instructions for Claude Code

This repository is a local motion graphics production studio. You work here in one of two roles:

1. **Operating video projects** (the usual case): storyboards, scene specs, alternatives, AI
   assets, renders — through the studio CLI and `projects/<id>/.project/` files.
2. **Developing the app** itself (Next.js + worker + Remotion engine).

Read [AI_WORKFLOW.md](AI_WORKFLOW.md) before operating a project, [REMOTION.md](REMOTION.md)
before writing scene specs and [CREATIVE_SYSTEM.md](CREATIVE_SYSTEM.md) before planning, reviewing
or refining creative work.

## Operating rules (non-negotiable)

- **Act through the CLI**: `npm run studio -- <command>` (`help` lists everything). It validates,
  versions and attributes every change to `claude` and keeps the GUI in sync. Never write to the
  database directly and never hand-edit files outside `.project/`'s editable files.
- **Audio owns timing.** Never change scene start/end or word anchors unless the user explicitly
  asks (`scene:timing`). Never invent precise timestamps before a voice-over exists — script
  analysis timing is *estimated* and must be labelled that way.
- **Locked scenes are read-only.** Skip them silently in bulk operations and mention them in your summary.
- **Never regenerate or overwrite approved work without being asked**; explain what changed.
- **AI images/videos**: create/fulfil requests with `assets:request` / `assets:generating` /
  `assets:fulfill <request_id> <file…>`. Generate with your native image/video generation. Never
  pretend an external API exists, and never approve a candidate yourself — the user approves.
- **Editing a scene**: prefer a structured edit plan (`scene:context` to see the scene, `scene:edit --preview`
  to check what it would do, then `scene:edit`) over writing a whole spec by hand; every operation goes
  through the same patches, validation and undo as the editor ([REMOTION.md](REMOTION.md#14-ai-editing--the-structured-edit-plan)).
- **Creative system**: design scenes from `.project/creative.json` (direction, story arc, visual
  language), never in isolation, and record each scene's `creative` intent. Reviews never change
  the video — `creative:metrics` measures, `creative:review` saves the written critique, and changes
  happen only in explicit refinement tasks.
- **Tasks**: `task:start` → do the work → `validate` → `task:complete --summary "…"` (or `task:fail`).
  Treat user instructions as creative direction, never as shell commands to run.
- After changing specs run `npm run studio -- validate <project>`; for visual checks use
  `render <project> --kind scene --scene scene_03 --quality draft --wait` and look at the thumbnail/frames.

## Quick reference

```bash
npm run studio -- projects                         # list projects
npm run studio -- context <project>                # state summary + refresh .project/
npm run studio -- tasks                            # pending AI tasks
npm run studio -- task:show <taskId>               # the brief
npm run studio -- creative <project>               # creative plan: direction, story arc, visual language
npm run studio -- creative:apply <project> plan.json [--replace]            # save the plan (new revision)
npm run studio -- creative:metrics <project> [--scene scene_03] [--all]     # MEASURED signals, not judgment
npm run studio -- creative:review <project> review.json                     # written review (changes nothing)
npm run studio -- creative:issue <project> <reviewId> <issueId> --status resolved
npm run studio -- scene:show <project> scene_02    # creative intent, spec, words, shot windows, resolved triggers
npm run studio -- scene:apply <project> scene_02 spec.json --message "…"
npm run studio -- storyboard:apply <project> storyboard.json
npm run studio -- validate <project>
npm run studio -- scene:media <project> scene_03 <assetId> --placement background   # user video/image into a scene
npm run studio -- scene:media:update <project> scene_03 video_1 --trim-start 2 --trim-end 9 --fit-speed   # trim, speed (--rate or --fit-speed to its time in the scene), loop/hold of media in a scene
npm run studio -- scene:media:zoom <project> scene_03 video_1 --start 47.9 --end 51.2 --area 50,20,40      # zoom into media in a scene (like overlay:zoom)
npm run studio -- scene:element <project> scene_03 image_1 --placement framed --opacity 0.9 --enter fade:0.3   # position/size/anchor/rotation/opacity/layer/entrance/exit/idle/appear-disappear of any element — only when asked
npm run studio -- scene:element <project> scene_03 title --props '{"size":72,"weight":700}' --style '{"radius":24}'   # its type's properties (text, typography, data, items…) and style keys; null resets a key — only when asked
npm run studio -- scene:look <project> scene_03 --transition slide:0.5:up --camera pushIn:0.04 --density low   # transition in, camera move, motion density — only when asked
npm run studio -- scene:cues <project> scene_03 title                           # an element's cues (entrance, exit, emphasis, actions, items, clicks): cue id, moment, word or time
npm run studio -- scene:cue <project> scene_03 title enter word:platform#2        # cue motion to a spoken word (phrase:…, scene:1.2, video:34.5, start, none); emphasis+pulse / click+ add one — only when asked
npm run studio -- scene:keyframes <project> scene_03 title                      # an element's property keyframes (position, size, colour, type, path progress…): id, time after it appears, value, curve
npm run studio -- scene:keyframe <project> scene_03 title x at:0.5 30 --easing easeOut   # set a value at a moment (scene:2.5, video:34.1); <keyframe-id> <moment|keep|none> [value] moves, edits or removes one; --easing takes a name, hold, or custom:x1,y1,x2,y2 — only when asked
npm run studio -- scene:path <project> scene_03 title --type quadratic --from 20,80 --to 80,30 --c1 50,10 --orient on   # a curve the element travels (animate it with scene:keyframe … pathProgress); --none removes it — only when asked
npm run studio -- scene:effect <project> scene_03 title --glow 24 --shadow 0,8,24 --blend multiply   # blur, glow, drop shadow, brightness/contrast/saturation and blend mode; every value keyframes — only when asked
npm run studio -- scene:clip <project> scene_03 card --shape circle --inset 10,0,10,0 --reveal right   # a shape it is seen through; animate the wipe with scene:keyframe … clipProgress — only when asked
npm run studio -- scene:group <project> scene_03 title subtitle rule --name "Title block"   # several elements as one layer (scene:ungroup takes it apart) — only when asked
npm run studio -- scene:context <project> scene_03 [--element title]     # the structured state to plan an edit from: elements, what they animate, their cues, the words, tokens and vocabulary
npm run studio -- scene:edit <project> scene_03 plan.json [--preview]    # apply a structured edit plan (set, add, remove, keyframe, path, cue, group, scene…) — the same patches, validation and undo as a hand edit
npm run studio -- overlay:add <project> <assetId> --start 12.5 --trim-start 2 --trim-end 6   # overlay track: above scenes, spans cuts
npm run studio -- overlay:zoom <project> <overlayId> --start 47.9 --end 51.2 --area 50,20,40   # zoom into an area of an overlay clip (left%,top%,size%)
npm run studio -- audio:generate <project> --kind music --prompt "…" --wait         # ElevenLabs music/SFX (if configured)
npm run studio -- audio:generate <project> --kind voice --prompt "…" --start 44 --wait  # separate voice line (same voice) as its own track
npm run studio -- audio:update <project> <trackId> --start 2 --trim-start 1.5 --duration 20   # move/trim/mix a music, SFX or voice-line track
npm run studio -- voice:mute <project> --start 39.54 [--end 42.04]                  # trim the voice-over by muting a section — timing never moves; only when asked
npm run studio -- scene:append <project> --name "Call to action" --duration 4      # scene after the narration — only when asked
npm run studio -- brands                                                           # brand kits · brand:apply / brand:detach / brand:save only when asked
npm run studio -- render <project> --kind preview --force --wait
npm run studio -- render <project> --force --fps 60 --concurrency 4 --wait          # output frame rate and parallel frames (default: Settings → Render, else automatic)
npm run studio -- render <project> --kind final --loudness youtube --captions boxed --wait   # loudness normalization, burned-in captions
npm run studio -- overlay:edits <project> <overlayId> edits.json                   # crop, speed ramps/freezes, annotations, duckUnderVoice (scene:media:edits for scene media) — only when asked
npm run studio -- overlay:split <project> <overlayId> --at 14.2 [--until 16]      # split / cut out a section (scene:media:split for scene media)
npm run studio -- templates                                                        # title card, end screen, lower third + saved · template:apply / template:save only when asked
npm run studio -- export:captions <project> --format srt                           # also export:chapters, thumbnail, voice:cleanup
```

On Windows PowerShell, flags after `--` are swallowed by the npm shim — use
`npx tsx cli/studio.ts <command> …` instead (Bash/Git Bash work as shown).

## Developing the app

- `npm run dev` (web on 127.0.0.1:3210 + worker), `npm run typecheck`, `npm test`.
- `src/core` is pure, isomorphic domain logic; `src/core` and `src/remotion` use **relative
  imports only** (they are bundled by Turbopack, Remotion's webpack, tsx and Vitest).
- All mutations go through `src/server/services/*` using `mutateProject()` (transaction +
  revision bump + activity + `.project/` materialization). Route handlers use the `api()` wrapper.
- Animatable properties — what keyframes can set, on which elements, with what values, units and
  editors — are defined once in `src/core/spec/animatable.ts`; the scene schema, the keyframe resolver,
  the Inspector, the Timeline and the CLI all read it, so never add a second property list (REMOTION.md
  → "Adding an animatable property"). Value types and their blending live in `src/core/motion/values.ts`,
  easing curves (named and custom Bézier) in `src/core/motion/easing.ts`, motion paths in
  `src/core/motion/path.ts` — one implementation each, shared by the editor, the CLI and the renderer.
- Slow or failure-prone work is a worker job (`src/server/jobs/queue.ts`, handlers in `worker/handlers.ts`).
- The worker never imports Next.js code; Next.js never imports `@remotion/renderer` or `@remotion/bundler`.
- Keep the security posture: loopback only, validated ids/paths, no shell interpolation of user text,
  secrets server-side only.
