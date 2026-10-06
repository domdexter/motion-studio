import { api } from "@/server/http/api";
import { testElevenLabsConnection } from "@/server/providers/elevenlabs";

export const dynamic = "force-dynamic";

/** Connection test: key validity plus each read permission, and usage when the key may read it. */
export const GET = api(async () => ({ status: await testElevenLabsConnection() }));
