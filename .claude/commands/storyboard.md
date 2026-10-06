---
description: Create or improve a project's storyboard from its audio timeline and creative plan
argument-hint: "<project id> [creative direction]"
---

Create a considered storyboard for Motion Studio project $ARGUMENTS.

1. `npm run studio -- context <project>` — confirm a timeline exists. If not, stop and tell the user: "Generate or import a voice-over before generating an audio-locked storyboard."
2. Read `.project/creative.json`, `creative-brief.md`, `brand.md`, `design.json`, `script.md`, `timeline.json` (words + segments), and the current `storyboard.json`/`scenes.json`. If the creative plan is missing or empty, plan it first (see `/creative-direction`) and save it with `npm run studio -- creative:apply <project> plan.json`.
3. Plan scenes on sentence/phrase boundaries of the ACTUAL timeline (typically 2–6 s each), following the story arc: each scene belongs to an act and serves its purpose. One idea per scene; vary treatments across the arc; follow the visual language; plan density and intensity as peaks and valleys. For every scene ask what the strongest visual representation of the idea is — not which objects the sentence mentions.
4. Write a storyboard document (see AI_WORKFLOW.md → "Storyboard documents"): `mode: "replace"` with contiguous word anchors covering every word for a new structure, or `mode: "update"` to refine existing scenes without changing timing. Per scene include:
   - `creative` (CREATIVE_SYSTEM.md): `purpose`, `narrativeBeat`, `act`, `visualMetaphor`, `interpretation`, `treatment`, `intensity`, `composition`, `motion` (density, primary/secondary/tertiary, `stillness` for intentional silence), `shots` (shot plan), `assets` (source hierarchy).
   - A full SceneSpec (REMOTION.md) that implements it: `spec.shots` with ids matching `creative.shots` for rhythm inside longer scenes (shot `at` triggers on spoken words), `motion.density`, and `motionRole`/`motionIntent` on elements — one primary motion per shot.
5. `npm run studio -- storyboard:apply <project> <file.json>`, then `npm run studio -- validate <project>` and `npm run studio -- creative:metrics <project>`. Fix high/medium findings that are real; metrics are heuristics.
6. Render a draft of one or two scenes to check composition: `npm run studio -- render <project> --kind scene --scene scene_02 --quality draft --wait`.
7. Summarize the storyboard (scene list with act, treatment and the idea of each), the remaining findings, and anything that needs assets or the user's review. Never approve scenes yourself.
