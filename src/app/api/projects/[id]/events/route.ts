import { db } from "@/server/db";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { assertProjectExists } from "@/server/services/projects";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: pushes the project revision (any mutation by the GUI, Claude Code CLI,
 * file imports or the worker) and live job/render progress. The GUI refetches on "revision".
 */
export const GET = api<{ id: string }>(async (req, { id }) => {
  assertProjectId(id);
  await assertProjectExists(id);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastRevision = -1;
      let lastProgressKey = "";
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      const tick = async () => {
        if (closed) return;
        try {
          const project = await db.project.findUnique({ where: { id }, select: { revision: true } });
          if (!project) {
            send("deleted", {});
            close();
            return;
          }
          const [jobs, renders] = await Promise.all([
            db.job.findMany({
              where: { projectId: id, status: { in: ["queued", "running"] } },
              select: { id: true, type: true, status: true, progress: true, stage: true },
              orderBy: { createdAt: "asc" },
            }),
            db.render.findMany({
              where: { projectId: id, status: { in: ["queued", "bundling", "rendering", "encoding"] } },
              select: { id: true, status: true, progress: true, stage: true, renderedFrames: true, totalFrames: true },
            }),
          ]);
          if (project.revision !== lastRevision) {
            lastRevision = project.revision;
            send("revision", { revision: project.revision });
          }
          const progressKey = JSON.stringify([jobs, renders]);
          if (progressKey !== lastProgressKey) {
            lastProgressKey = progressKey;
            send("progress", { jobs, renders });
          }
        } catch {
          send("sync-error", { message: "Database unavailable" });
        }
      };
      send("hello", { at: Date.now() });
      void tick();
      timer = setInterval(() => void tick(), 1000);
      ping = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15_000);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      clearInterval(timer);
      clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
