---
description: Refine one scene's visuals without changing its timing or voice-over
argument-hint: "<project id> <scene_key> <instruction>"
---

Edit a Motion Studio scene: $ARGUMENTS

1. `npm run studio -- scene:show <project> <scene_key>` — read the storyboard fields, the current spec, the spoken words and the resolved trigger times. If the scene is locked, stop and say so.
2. Read `.project/design.json` and `brand.md`; consult `REMOTION.md` for element fields.
3. Write the new SceneSpec (or `{ "spec": …, "visualConcept": …, "onScreenText": … }`) to a temp file. Keep the scene's timing; sync entrances to the relevant spoken words with word triggers.
4. `npm run studio -- scene:apply <project> <scene_key> <file.json> --message "<short description>"`.
5. `npm run studio -- validate <project>`; if useful, render a draft of the scene and inspect it.
6. Summarize what changed. The previous version stays restorable in the Scenes editor.
