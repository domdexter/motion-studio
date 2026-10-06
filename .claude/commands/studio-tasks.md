---
description: Process pending Motion Studio AI tasks created in the GUI
argument-hint: "[project id]"
---

Process the pending Motion Studio AI tasks $ARGUMENTS.

1. Run `npm run studio -- tasks $ARGUMENTS` to list pending tasks (oldest first).
2. For each task, one at a time:
   - `npm run studio -- task:show <taskId>` and read the brief completely.
   - `npm run studio -- task:start <taskId>`.
   - Read `AI_WORKFLOW.md` (once per session), `projects/<project>/.project/project.json` and the files the brief names. Read `REMOTION.md` before writing scene specs.
   - Do the work only through the studio CLI actions named in the brief. Keep timing and the voice-over unchanged unless the brief says otherwise; never touch locked scenes.
   - Log meaningful progress with `npm run studio -- task:log <taskId> "…"`.
   - `npm run studio -- validate <project>` and fix any issues you introduced.
   - Finish with `npm run studio -- task:complete <taskId> --summary "<what changed, which scenes, anything the user should review>"`, or `task:fail <taskId> --error "<reason>"`.
3. Summarize all tasks you processed.
