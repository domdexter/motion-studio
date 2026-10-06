import { db, json, type Tx } from "../db";
import { captureEditState, recordEditStep, type HistoryOptions } from "./history-capture";

/**
 * Every significant project mutation goes through mutateProject:
 *   1. runs inside a transaction
 *   2. bumps Project.revision (drives GUI refresh and Claude Code sync)
 *   3. records an Activity row with the actor (user / claude / file / worker / system)
 *   4. with `history`, records an undo step of what the edit changed (see edit-history.ts)
 *   5. re-materializes projects/<id>/.project/ after commit
 */

export type Actor = "user" | "claude" | "system" | "file" | "worker";

export interface ActivityInput {
  type: string;
  message: string;
  data?: unknown;
}

export interface MutationOutput<T> {
  result: T;
  activity: ActivityInput | null;
  /** Replaces options.history.label once the edit knows what it did. */
  historyLabel?: string;
}

export async function mutateProject<T>(
  projectId: string,
  actor: Actor,
  fn: (tx: Tx) => Promise<MutationOutput<T>>,
  options: { materialize?: boolean; history?: HistoryOptions } = {},
): Promise<T> {
  const history = options.history;
  const out = await db.$transaction(
    async (tx) => {
      const before = history ? await captureEditState(tx, projectId, history.scope) : null;
      const r = await fn(tx);
      if (history && before) await recordEditStep(tx, projectId, actor, { ...history, label: r.historyLabel ?? history.label }, before);
      await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
      if (r.activity) {
        await tx.activity.create({
          data: {
            projectId,
            actor,
            type: r.activity.type,
            message: r.activity.message,
            ...(r.activity.data !== undefined ? { data: json(r.activity.data) } : {}),
          },
        });
      }
      return r;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  if (options.materialize !== false) await materializeSafely(projectId);
  return out.result;
}

export async function recordActivity(projectId: string, actor: Actor, activity: ActivityInput): Promise<void> {
  await db.activity.create({
    data: {
      projectId,
      actor,
      type: activity.type,
      message: activity.message,
      ...(activity.data !== undefined ? { data: json(activity.data) } : {}),
    },
  });
}

export async function bumpRevision(projectId: string): Promise<void> {
  await db.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
}

export async function materializeSafely(projectId: string): Promise<void> {
  try {
    const { materializeProject } = await import("./context");
    await materializeProject(projectId);
  } catch (err) {
    console.error(`[context] failed to materialize .project for ${projectId}:`, err);
  }
}
