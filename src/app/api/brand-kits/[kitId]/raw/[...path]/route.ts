import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { brandKitFilePath } from "@/server/services/brand-kits";
import { mimeForPath } from "@/server/storage/mime";

export const dynamic = "force-dynamic";

/** Serves brand kit files (logo previews, fonts for the live design preview, guides). */
export const GET = api<{ kitId: string; path: string[] }>(async (req, { kitId, path: segments }) => {
  if (!Array.isArray(segments) || segments.length === 0) throw new AppError("BAD_REQUEST", "Missing file path.");
  const abs = brandKitFilePath(kitId, segments.join("/"));
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) throw new AppError("NOT_FOUND", "File not found.");
  const mime = mimeForPath(abs);
  const download = req.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Length": String(stat.size),
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
  };
  // Uploaded SVG/HTML must never execute script when opened directly.
  if (mime.startsWith("image/svg") || mime.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
  }
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, { status: 200, headers });
});

export const HEAD = GET;
