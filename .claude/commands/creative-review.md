---
description: Review a video like a senior motion designer and save a written creative review (changes nothing)
argument-hint: "<project id> [question, e.g. Find the three weakest scenes]"
---

Creative review of Motion Studio project $ARGUMENTS. This is read-only: never change scenes, specs, assets, the creative plan or timing.

1. `npm run studio -- context <project>`; read `.project/creative.json` (direction, story arc, visual language), `storyboard.json` (each scene's `creative` intent), `creative-review.json` (the previous review and its issues) and `script.md`.
2. `npm run studio -- creative:metrics <project> --all` — measured signals: detected treatments, layout repetition, motion density, text load, contrast, intensity curve and findings. They are heuristics; verify each one against frames before repeating it.
3. Render a draft preview: `npm run studio -- render <project> --kind preview --quality draft --force --wait`.
4. Look at real frames: the render thumbnail, frames extracted from the MP4, or stills at key moments with `npm run studio -- still <project> --sec <t> --png --wait` (scene and shot times from `scene:show`).
5. Judge composition, typography, motion, pacing, storytelling, consistency, brand and quality against the plan and the story arc, and answer the question asked. Ask whether each visual is the strongest representation of its idea rather than a literal depiction of the narration.
6. Write `review.json` (CREATIVE_SYSTEM.md → Creative QA): `request`, `scope` (`[]` = whole video), `summary`, `strengths`, `issues` (`scene`, optional `shot`, `severity`, `category`, `issue`, `recommendation`, `evidence` — frame time, metric or comparison), `weakestScenes`, `basedOn` (`renderId`, `frames` — the timestamps in seconds you looked at, `notes`). Scores are optional and advisory; include them only together with written issues or strengths.
7. `npm run studio -- creative:review <project> review.json`.
8. Summarize the main issues and point the user to Creative QA, where they accept or dismiss issues and turn accepted ones into refinement tasks. Do not refine anything yourself.
