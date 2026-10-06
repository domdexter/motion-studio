import fs from "node:fs/promises";
import { notFound } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { contextPath, materializeProject } from "@/server/services/context";
import { assertProjectExists } from "@/server/services/projects";
import { captionsFile, chaptersForProject } from "@/server/services/publish";

export const dynamic = "force-dynamic";

const EXPORTABLE: Record<string, string> = {
  "timeline.json": "application/json; charset=utf-8",
  "storyboard.json": "application/json; charset=utf-8",
  "scenes.json": "application/json; charset=utf-8",
  "assets.json": "application/json; charset=utf-8",
  "project.json": "application/json; charset=utf-8",
  "design.json": "application/json; charset=utf-8",
  "script.md": "text/markdown; charset=utf-8",
  "creative-brief.md": "text/markdown; charset=utf-8",
  "brand.md": "text/markdown; charset=utf-8",
};

/** Publishing files built on request (not stored in .project/). */
const GENERATED: Record<string, { contentType: string; build: (projectId: string) => Promise<string> }> = {
  "captions.srt": { contentType: "application/x-subrip; charset=utf-8", build: (projectId) => captionsFile(projectId, "srt") },
  "captions.vtt": { contentType: "text/vtt; charset=utf-8", build: (projectId) => captionsFile(projectId, "vtt") },
  "chapters.txt": { contentType: "text/plain; charset=utf-8", build: async (projectId) => `${(await chaptersForProject(projectId)).text}\n` },
};

/** Downloads a freshly materialized project context file (timeline JSON, storyboard JSON, …), captions or chapters. */
export const GET = api<{ id: string; file: string }>(async (_req, { id, file }) => {
  assertProjectId(id);
  const generated = GENERATED[file];
  const contentType = generated?.contentType ?? EXPORTABLE[file];
  if (!contentType) throw notFound("Export");
  await assertProjectExists(id);
  let content: string;
  if (generated) content = await generated.build(id);
  else {
    await materializeProject(id);
    content = await fs.readFile(contextPath(id, file), "utf8");
  }
  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${id}-${file}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
