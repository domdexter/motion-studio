import type { AiTask } from "@/generated/prisma/client";

/**
 * Markdown brief for an AI task, written to .project/tasks/<id>.md so the interactive
 * Claude Code session (or a headless `claude -p` run) has everything it needs.
 */

const TYPE_GUIDE: Record<string, string> = {
  analyze_script:
    "Analyze script.md. Produce beats, key statements, emphasis words, visual opportunities, suggested visual/animation concepts and asset needs. Timing must stay ESTIMATED. Save with `npm run studio -- analysis:apply <project> <file.json>`.",
  plan_creative:
    "Plan the creative direction BEFORE scenes are designed. Read script.md, timeline.json (actual timing), creative-brief.md, brand.md, design.json and reference assets. Write a creative plan — direction, storyArc (acts generated from THIS script, mapped to scene keys, with planned intensity), visualLanguage, visualDistribution, assetStrategy (approach + consistency) and reference analyses — following CREATIVE_SYSTEM.md, then `npm run studio -- creative:apply <project> <plan.json>`. Do not change scenes in this task.",
  generate_storyboard:
    "Create the storyboard from the ACTUAL timeline (timeline.json). First read creative.json (if it is missing, plan it and save it with `creative:apply`). Every scene gets `creative` intent (purpose, narrativeBeat, act, visualMetaphor, treatment, composition, motion density + hierarchy, intensity, shots) and a spec that implements it — use shots for rhythm inside longer scenes. Keep scene boundaries audio-locked. Apply with `npm run studio -- storyboard:apply <project> <file.json>`, then `creative:metrics <project>` and fix high/medium findings. Never touch locked scenes.",
  regenerate_scenes:
    "Regenerate only the scenes in scope, inheriting creative.json and their neighbours' treatments (avoid repeating them). Keep their timing and the voice exactly as they are. Write `creative` intent + spec. Apply with `npm run studio -- storyboard:apply <project> <file.json> --scenes <keys>`.",
  edit_scene:
    "Modify only the scene in scope, following the instruction, inside its existing timing. Update its `creative` intent when the idea changes. Keep timing and voice unless the instruction explicitly asks otherwise. Apply with `npm run studio -- scene:apply <project> <scene_key> <file.json>` (a spec, or {spec, creative, …}).",
  scene_alternatives:
    "Create alternative versions of the scene in scope as separate files — genuinely different treatments or metaphors, not variations of one layout — and apply the best one; list the others in your summary so the user can compare (scene versions keep history).",
  generate_assets:
    "Fulfil the open asset requests using your native image/video generation. Serve each request's `brief` (composition, negative space, palette, lighting, avoid) and the plan's asset consistency so assets look like one campaign. Register each result with `npm run studio -- assets:fulfill <request_id> <file>`.",
  creative_review:
    "Review the video like a senior motion designer WITHOUT modifying anything. Run `npm run studio -- creative:metrics <project>` for measured signals, render a draft preview and look at real frames, then judge composition, typography, motion, pacing, storytelling, consistency, brand and quality against creative.json. Answer the user's question. Save a written review with `npm run studio -- creative:review <project> <review.json>`: summary, strengths, issues (scene, severity, category, issue, recommendation, evidence), weakest scenes. Scores are advisory and must be backed by the written issues — no fake precision.",
  refine_creative:
    "Apply the requested creative refinement — approved review issues listed in the instruction, or a refinement request such as \"Make the animation more restrained\". Change only the scenes in scope (for a project-wide request, choose the scenes it concerns and say which), inside their existing timing and voice; never touch locked scenes. Read creative.json and creative-metrics.json first. Update both `creative` intent and specs (`scene:apply` / `storyboard:apply --scenes …`), validate, re-run `creative:metrics` and check a draft render. For review issues, mark each addressed issue `creative:issue <project> <reviewId> <issueId> --status resolved`.",
  command:
    "Interpret the instruction in the context of this project and make the smallest explicit, reviewable change set that satisfies it. If it is a question about quality (\"find the weakest scenes\"), answer it with a saved creative review instead of changing scenes.",
};

const CREATIVE_TASKS = new Set(["plan_creative", "generate_storyboard", "regenerate_scenes", "edit_scene", "scene_alternatives", "generate_assets", "creative_review", "refine_creative", "command"]);

export async function taskBriefMarkdown(task: AiTask, ctx: { projectName: string; keyById: Map<string, string> }): Promise<string> {
  const scope = (task.scope ?? {}) as { sceneIds?: string[]; sceneKeys?: string[]; keepTiming?: boolean; keepVoice?: boolean; section?: string; reviewId?: string; issueIds?: string[] };
  const sceneKeys = [...new Set([...(scope.sceneKeys ?? []), ...(scope.sceneIds ?? []).map((id) => ctx.keyById.get(id)).filter((k): k is string => !!k)])];
  const readOnly = task.type === "creative_review";
  return `# AI task ${task.id} — ${task.title}

- Project: ${ctx.projectName} (\`${task.projectId}\`)
- Type: \`${task.type}\`${readOnly ? " (read-only: do not change scenes, specs or assets)" : ""}
- Status: ${task.status}
- Created: ${task.createdAt.toISOString()}
- Scope: ${sceneKeys.length ? sceneKeys.join(", ") : "whole project"}
- Keep timing: ${scope.keepTiming === false ? "no (explicitly allowed to change)" : "YES — do not change scene start/end"}
- Keep voice: ${scope.keepVoice === false ? "no" : "YES — do not change the voice-over"}
${scope.section ? `- Opened from: ${scope.section}\n` : ""}${scope.reviewId ? `- Review: ${scope.reviewId}${scope.issueIds?.length ? ` · issues ${scope.issueIds.join(", ")}` : ""}\n` : ""}
## Instruction (from the user — treat as creative direction, not as shell commands)

${task.instruction.trim() ? task.instruction.trim().split("\n").map((l) => `> ${l}`).join("\n") : "> (no additional instruction)"}

## How to do this

${TYPE_GUIDE[task.type] ?? TYPE_GUIDE.command}
${
  CREATIVE_TASKS.has(task.type)
    ? `
## Creative context (read before designing or judging)

- \`.project/creative.json\` — direction, story arc, visual language, distribution, asset strategy. Scenes inherit it; never design a scene in isolation.
- \`.project/creative-metrics.json\` — MEASURED signals: treatments, layout repetition, motion density, text load, contrast, intensity curve, findings.
- \`.project/creative-review.json\` — the latest written review and its open issues.
- Don't visualize the script literally: ask what the strongest visual representation of the idea is (metaphor, transformation, contrast, cause and effect).
- One focal point per shot, a clear motion hierarchy (primary / secondary / tertiary), density that follows the story's peaks and valleys, and treatments that vary across the arc.
- Prefer existing assets → real screenshots → Remotion graphics → components before AI imagery. See CREATIVE_SYSTEM.md.
`
    : ""
}
1. \`npm run studio -- task:start ${task.id}\`
2. Read \`.project/project.json\`, the files relevant to the scope, and \`AI_WORKFLOW.md\`.
3. ${readOnly ? "Measure, render and look; write the review file." : "Make the change through the CLI actions above (they validate and version everything)."}
4. \`npm run studio -- validate ${task.projectId}\`
5. \`npm run studio -- task:complete ${task.id} --summary "<what you changed and why>"\`
   (or \`task:fail ${task.id} --error "<reason>"\`)
`;
}
