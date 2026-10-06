import { z } from "zod";
import { api, readJson } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { generateStoryboardWithRules } from "@/server/services/scenes";
import { createAiTask } from "@/server/services/tasks";

const Body = z.object({
  mode: z.enum(["rules", "claude"]).default("rules"),
  pace: z.enum(["fast", "medium", "slow"]).optional(),
  sceneIds: z.array(z.string()).max(500).optional(),
  restructure: z.boolean().optional(),
  instruction: z.string().max(8000).optional(),
});

/**
 * rules  → instant deterministic draft (or regeneration of selected unlocked scenes)
 * claude → creates an explicit AI task handed to Claude Code
 */
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  const body = await readJson(req, Body);
  if (body.mode === "claude") {
    const type = body.sceneIds?.length ? "regenerate_scenes" : "generate_storyboard";
    const task = await createAiTask(id, { type, instruction: body.instruction ?? "", scope: { sceneIds: body.sceneIds, keepTiming: true, keepVoice: true, section: "storyboard" } }, "user");
    return { task };
  }
  return { result: await generateStoryboardWithRules(id, { pace: body.pace, sceneIds: body.sceneIds, restructure: body.restructure }, "user") };
});
