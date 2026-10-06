// One-time setup: `npm install && npm run bootstrap`, then `npm run dev`.
import fs from "node:fs";
import path from "node:path";
import { ROOT, color, ensureDatabase, ensureDirs, ensureEnvFile, fail, log, prisma, run } from "./lib/infra.mjs";

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) fail(`Node ${process.versions.node} is too old.`, "Install Node.js 20.9 or newer (22 LTS recommended).");

if (!fs.existsSync(path.join(ROOT, "node_modules"))) fail("Dependencies are not installed.", "Run `npm install` first.");

ensureEnvFile();
ensureDirs();

const docker = run("docker", ["--version"], { silent: true });
if (docker.error) log(color.yellow("Docker CLI not found — using DATABASE_URL as configured."));

await ensureDatabase();
prisma(["generate"]);
prisma(["migrate", "deploy"]);

log(color.green("Motion Studio is set up."));
log(`Start it with ${color.bold("npm run dev")} and open ${color.bold("http://localhost:3210")}`);
