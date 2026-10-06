---
description: Plan a project's creative direction, story arc and visual language before scenes are designed
argument-hint: "<project id> [creative direction]"
---

Plan the creative direction for Motion Studio project $ARGUMENTS.

1. `npm run studio -- context <project>` and `npm run studio -- creative <project>` — the pipeline state and the current plan, if any (`creative:revisions <project>` lists earlier versions).
2. Read `.project/script.md`, `timeline.json` (ACTUAL timing — never invent timestamps when there is no voice-over), `creative-brief.md`, `brand.md`, `design.json`, `storyboard.json` (existing scene keys) and reference assets in `assets.json`.
3. Write `plan.json` following CREATIVE_SYSTEM.md:
   - `direction`: `concept` (required), core message, tone, emotional direction, pacing, motion / composition / typography / color / transition philosophy, imagery, brand treatment, `avoid`.
   - `storyArc`: acts derived from THIS script — each with `id`, `name`, purpose, `beat`, emotion, visual language, planned `intensity` 1–5 and the scene keys it covers.
   - `visualLanguage`: typography (incl. `maxWordsOnScreen`), layout, composition, color (incl. `gradients` / `glow`), imagery, motion energy, transitions (`frequency`, `allowed`), camera `behavior`, `density`.
   - `visualDistribution` (target share per treatment family), `assetStrategy` (`approach` + `consistency`), `references` (principles, never copies).
4. For every act ask what the strongest visual representation of the idea is — not which objects the sentence mentions. Plan peaks and valleys; reserve intensity 5 for one or two moments.
5. `npm run studio -- creative:apply <project> plan.json --note "<short note>"` (sections in the file replace those sections; `--replace` stores exactly the file). Fix validation errors and read the warnings (unknown scene keys, a scene in two acts, distribution not adding up to 1).
6. Do not change scenes here. If scenes already exist, run `npm run studio -- creative:metrics <project>` and note where the current storyboard departs from the plan.
7. Summarize the concept, the acts with their scenes and intensity, and the key visual language rules.
