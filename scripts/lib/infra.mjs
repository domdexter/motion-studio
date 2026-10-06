// Local infrastructure helpers shared by bootstrap and preflight. Plain Node (no deps).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(ROOT, "package.json"));

const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = { green: c(32), red: c(31), yellow: c(33), dim: c(2), bold: c(1), cyan: c(36) };

export function log(msg) {
  console.log(`${color.cyan("[studio]")} ${msg}`);
}

export function fail(msg, hint) {
  console.error(`${color.red("[studio] ✖")} ${msg}`);
  if (hint) console.error(`${color.dim("         ")}${hint}`);
  process.exit(1);
}

export function ensureEnvFile() {
  const env = path.join(ROOT, ".env");
  if (!fs.existsSync(env)) {
    fs.copyFileSync(path.join(ROOT, ".env.example"), env);
    log("Created .env from .env.example");
  }
  for (const line of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function databaseTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set.", "Check .env");
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432) };
}

export function canConnect(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: options.silent ? "pipe" : "inherit", encoding: "utf8", shell: false, ...options });
  return res;
}

export async function ensureDatabase() {
  const { host, port } = databaseTarget();
  if (await canConnect(host, port)) return;
  log(`Postgres not reachable on ${host}:${port} — starting Docker container…`);
  const docker = run("docker", ["compose", "up", "-d", "db"]);
  if (docker.error || docker.status !== 0) {
    fail(
      "Could not start Postgres with Docker.",
      "Make sure Docker Desktop is running, then run `npm run db:up`. (Or point DATABASE_URL at another Postgres.)",
    );
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await canConnect(host, port)) {
      await new Promise((r) => setTimeout(r, 1500));
      log(color.green("Postgres is up."));
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail("Postgres did not become reachable within 90 seconds.", "Check `docker compose logs db`.");
}

function prismaCli() {
  const pkg = require.resolve("prisma/package.json");
  const bin = require("prisma/package.json").bin;
  const entry = typeof bin === "string" ? bin : bin.prisma;
  return path.join(path.dirname(pkg), entry);
}

export function prisma(args) {
  const res = run(process.execPath, [prismaCli(), ...args]);
  if (res.status !== 0) fail(`prisma ${args.join(" ")} failed.`);
}

export function ensureDirs() {
  for (const d of ["projects", "storage", "storage/config", "storage/cache", "storage/tmp", "storage/tools"]) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }
}

export function ensureGeneratedClient() {
  if (!fs.existsSync(path.join(ROOT, "src", "generated", "prisma", "client.ts"))) {
    log("Generating Prisma client…");
    prisma(["generate"]);
  }
}
