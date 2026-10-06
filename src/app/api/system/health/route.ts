import { api } from "@/server/http/api";
import { getSystemHealth } from "@/server/services/system";

export const dynamic = "force-dynamic";

export const GET = api(async () => ({ health: await getSystemHealth() }));
