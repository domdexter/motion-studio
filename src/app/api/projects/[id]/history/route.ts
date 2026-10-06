import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { getEditHistory } from "@/server/services/edit-history";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (_req, { id }) => ({ history: await getEditHistory(assertProjectId(id), "user") }));
