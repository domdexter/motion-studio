import { z } from "zod";
import { api, parseWith } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getScriptRevision, restoreScriptRevision } from "@/server/services/script";

export const dynamic = "force-dynamic";

const Version = z.coerce.number().int().positive();

export const GET = api<{ id: string; version: string }>(async (_req, { id, version }) => ({
  revision: await getScriptRevision(assertProjectId(id), parseWith(Version, version, "Invalid version.")),
}));

/** Restores an old revision by saving its content as a new revision (history is never rewritten). */
export const POST = api<{ id: string; version: string }>(async (_req, { id, version }) => ({
  result: await restoreScriptRevision(assertProjectId(id), parseWith(Version, version, "Invalid version."), "user"),
}));
