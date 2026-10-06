// Runs before `npm run dev` / `npm start`: env file, folders, Postgres (Docker), migrations.
import { color, ensureDatabase, ensureDirs, ensureEnvFile, ensureGeneratedClient, log, prisma } from "./lib/infra.mjs";

ensureEnvFile();
ensureDirs();
await ensureDatabase();
ensureGeneratedClient();
prisma(["migrate", "deploy"]);
log(color.green("Ready → http://localhost:3210"));
