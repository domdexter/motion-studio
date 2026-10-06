import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import "./env";

declare global {
  var __motionStudioPrisma: { client: PrismaClient; models: string } | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env (npm run bootstrap does this for you).");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/**
 * Single client per process (survives Next.js dev hot reloads). It is recreated when `prisma
 * generate` changes the models or their fields, so a migration doesn't need a dev-server restart.
 */
const MODELS = Object.entries(Prisma as unknown as Record<string, unknown>)
  .filter(([key, value]) => key.endsWith("ScalarFieldEnum") && value && typeof value === "object")
  .map(([key, value]) => `${key}:${Object.keys(value as object).sort().join("|")}`)
  .sort()
  .join(",") || Object.values(Prisma.ModelName).sort().join(",");
const cached = globalThis.__motionStudioPrisma as { client?: PrismaClient; models?: string } | undefined;
if (cached?.client && cached.models !== MODELS) void cached.client.$disconnect().catch(() => undefined);
export const db: PrismaClient = cached?.client && cached.models === MODELS ? cached.client : createPrismaClient();
globalThis.__motionStudioPrisma = { client: db, models: MODELS };

export type Tx = Prisma.TransactionClient;
export type DbOrTx = PrismaClient | Tx;

/** JSON-safe value for Prisma Json columns (drops undefined, converts Dates). */
export function json<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}
