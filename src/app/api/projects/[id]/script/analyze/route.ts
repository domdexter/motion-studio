import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { analyzeScriptWithRules } from "@/server/services/script";

/** Instant rule-based analysis. Claude's richer analysis runs as an AI task (see /tasks). */
export const POST = api<{ id: string }>(async (_req, { id }) => ({ analysis: await analyzeScriptWithRules(assertProjectId(id), "user") }));
