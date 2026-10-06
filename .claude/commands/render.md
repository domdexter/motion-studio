---
description: Validate a project and render it (draft, scene, range or final)
argument-hint: "<project id> [final|preview|scene <key>|range <start> <end>]"
---

Render Motion Studio project $ARGUMENTS.

1. `npm run studio -- validate <project>` and `npm run studio -- composition <project>`. Fix blocking issues (invalid specs, missing assets) or report them — do not render broken projects.
2. Choose the render:
   - draft preview: `npm run studio -- render <project> --kind preview --force --wait`
   - one scene: `npm run studio -- render <project> --kind scene --scene <key> --quality draft --wait`
   - range: `npm run studio -- render <project> --kind range --start <s> --end <s> --wait`
   - final: `npm run studio -- render <project> --kind final --wait` (requires all scenes approved; only add `--force` if the user explicitly wants to render unapproved scenes)
3. Report the output path, size and duration, or the failure (stage, scene, first log lines) from `npm run studio -- renders <project>`.
