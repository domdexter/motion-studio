import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PROJECT_ID_RE } from "../ids";
import { mimeForPath } from "../storage/mime";
import { existingProjectFile } from "../storage/paths";

/**
 * Private loopback file server used only by the worker while rendering. Remotion's headless
 * browser and compositor fetch project media from
 *   http://127.0.0.1:<random port>/<token>/<projectId>/<relative path>
 * Bound to loopback, guarded by a per-process random token, and every path is resolved inside
 * the project folder (no traversal, no access to anything else on disk).
 */

export interface MediaServer {
  origin: string;
  urlFor: (projectId: string, relPath: string, version?: string) => string;
  close: () => Promise<void>;
}

let current: Promise<MediaServer> | null = null;

export function getMediaServer(): Promise<MediaServer> {
  if (!current) {
    current = startMediaServer().catch((err) => {
      current = null;
      throw err;
    });
  }
  return current;
}

async function startMediaServer(): Promise<MediaServer> {
  const token = randomBytes(24).toString("hex");
  const tokenBuf = Buffer.from(token);

  const end = (res: http.ServerResponse, status: number) => {
    res.statusCode = status;
    res.end();
  };

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return end(res, 405);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 3) return end(res, 404);
    const given = Buffer.from(parts[0]);
    if (given.length !== tokenBuf.length || !timingSafeEqual(given, tokenBuf)) return end(res, 403);
    let projectId: string;
    let rel: string;
    try {
      projectId = decodeURIComponent(parts[1]);
      rel = parts.slice(2).map(decodeURIComponent).join("/");
    } catch {
      return end(res, 400);
    }
    if (!PROJECT_ID_RE.test(projectId)) return end(res, 400);
    let abs: string;
    try {
      abs = await existingProjectFile(projectId, rel);
    } catch {
      return end(res, 404);
    }
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return end(res, 404);

    res.setHeader("Content-Type", mimeForPath(abs));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-cache");

    let start = 0;
    let last = stat.size - 1;
    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (m[1] === "" && m[2] === "")) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        return end(res, 416);
      }
      if (m[1] === "") start = Math.max(0, stat.size - Number(m[2]));
      else {
        start = Number(m[1]);
        if (m[2] !== "") last = Math.min(Number(m[2]), stat.size - 1);
      }
      if (start > last || start >= stat.size) {
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        return end(res, 416);
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${last}/${stat.size}`);
    } else {
      res.statusCode = 200;
    }
    res.setHeader("Content-Length", String(Math.max(0, last - start + 1)));
    if (req.method === "HEAD" || stat.size === 0) {
      res.end();
      return;
    }
    createReadStream(abs, { start, end: last })
      .on("error", () => res.destroy())
      .pipe(res);
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  server.unref();
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    urlFor: (projectId, relPath, version) =>
      `${origin}/${token}/${encodeURIComponent(projectId)}/${relPath.split("/").map(encodeURIComponent).join("/")}${version ? `?v=${encodeURIComponent(version)}` : ""}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
