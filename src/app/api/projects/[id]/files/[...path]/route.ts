import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { AppError } from "@/server/errors";
import { api } from "@/server/http/api";
import { assertProjectId } from "@/server/ids";
import { mimeForPath } from "@/server/storage/mime";
import { existingProjectFile } from "@/server/storage/paths";

export const dynamic = "force-dynamic";

/** Serves project files with HTTP Range support (audio/video seeking in the preview). */
export const GET = api<{ id: string; path: string[] }>(async (req, { id, path: segments }) => {
  assertProjectId(id);
  if (!Array.isArray(segments) || segments.length === 0) throw new AppError("BAD_REQUEST", "Missing file path.");
  const rel = segments.join("/");
  const abs = await existingProjectFile(id, rel);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new AppError("NOT_FOUND", "File not found.");

  const mime = mimeForPath(abs);
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const download = req.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
  };
  // Uploaded SVG/HTML must never execute script when opened directly.
  if (mime.startsWith("image/svg") || mime.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
  }
  if (req.headers.get("if-none-match") === etag && !req.headers.get("range")) {
    return new Response(null, { status: 304, headers });
  }

  const range = req.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (m[1] === "" && m[2] === "")) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }
    let start: number;
    let end: number;
    if (m[1] === "") {
      const suffix = Number(m[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? stat.size - 1 : Math.min(Number(m[2]), stat.size - 1);
    }
    if (start > end || start >= stat.size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${stat.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, "Content-Length": String(stat.size) } });
});

export const HEAD = GET;
