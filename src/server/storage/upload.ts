import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { fileTypeFromFile } from "file-type";
import { AppError } from "../errors";
import { TMP_DIR } from "../env";
import { randomId } from "../ids";
import { UPLOAD_RULES, mimeForPath, type UploadCategory } from "./mime";

/**
 * Streaming multipart uploads (busboy → temp file). Large videos are never buffered in memory.
 * Every file is validated by extension, size and magic bytes before it enters a project.
 */

export interface ReceivedFile {
  field: string;
  originalName: string;
  tmpPath: string;
  size: number;
  ext: string;
}

export interface ReceivedUpload {
  fields: Record<string, string>;
  files: ReceivedFile[];
  cleanup: () => Promise<void>;
}

const formatLimit = (bytes: number) => (bytes >= 1024 ** 3 ? `${Math.round(bytes / 1024 ** 3)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

export async function receiveUpload(req: Request, options: { categories: UploadCategory[]; maxFiles?: number }): Promise<ReceivedUpload> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new AppError("BAD_REQUEST", "Expected a multipart/form-data upload.");
  if (!req.body) throw new AppError("BAD_REQUEST", "The upload is empty.");
  await fs.mkdir(TMP_DIR, { recursive: true });

  const allowedExts = new Set<string>(options.categories.flatMap((c) => [...UPLOAD_RULES[c].exts]));
  const maxBytes = Math.max(...options.categories.map((c) => UPLOAD_RULES[c].maxBytes));
  const fields: Record<string, string> = {};
  const files: ReceivedFile[] = [];
  const writes: Promise<void>[] = [];
  let failure: AppError | null = null;

  const bb = Busboy({
    headers: { "content-type": contentType },
    limits: { files: options.maxFiles ?? 10, fileSize: maxBytes, fields: 50, fieldSize: 1024 * 1024 },
  });
  bb.on("field", (name, value) => {
    fields[name] = value;
  });
  bb.on("file", (field, stream, info) => {
    const originalName = path.basename((info.filename || "upload").replace(/\\/g, "/"));
    const ext = path.extname(originalName).toLowerCase();
    if (!allowedExts.has(ext)) {
      failure ??= new AppError("UNSUPPORTED_MEDIA", `Unsupported file type “${ext || originalName}”.`, { hint: `Allowed: ${[...allowedExts].join(", ")}` });
      stream.resume();
      return;
    }
    const tmpPath = path.join(TMP_DIR, `upload-${Date.now()}-${randomId(8)}${ext}`);
    const file: ReceivedFile = { field, originalName, tmpPath, size: 0, ext };
    stream.on("data", (chunk: Buffer) => {
      file.size += chunk.length;
    });
    stream.on("limit", () => {
      failure ??= new AppError("PAYLOAD_TOO_LARGE", `“${originalName}” is larger than the ${formatLimit(maxBytes)} limit.`);
    });
    files.push(file);
    writes.push(pipeline(stream, createWriteStream(tmpPath)));
  });
  bb.on("filesLimit", () => {
    failure ??= new AppError("BAD_REQUEST", "Too many files in one upload.");
  });

  const cleanup = async () => {
    await Promise.all(files.map((f) => fs.rm(f.tmpPath, { force: true })));
  };
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebReadableStream<Uint8Array>), bb);
    await Promise.all(writes);
  } catch (err) {
    await cleanup();
    throw new AppError("BAD_REQUEST", "Upload was interrupted.", { cause: err });
  }
  if (failure) {
    await cleanup();
    throw failure;
  }
  return { fields, files, cleanup };
}

async function looksLikeText(absPath: string): Promise<boolean> {
  const handle = await fs.open(absPath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return !buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function readHead(absPath: string, bytes = 2048): Promise<string> {
  const handle = await fs.open(absPath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Checks magic bytes against the expected category. Returns the MIME type to store. */
export async function validateFileContent(absPath: string, originalName: string, category: UploadCategory): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  const byExt = mimeForPath(originalName);
  const reject = (what: string) => new AppError("UNSUPPORTED_MEDIA", `“${originalName}” does not look like a valid ${what} file.`);

  if (category === "timing" || category === "script" || ext === ".md" || ext === ".txt") {
    if (!(await looksLikeText(absPath))) throw reject("text");
    return byExt;
  }
  if (ext === ".svg") {
    const head = await readHead(absPath);
    if (!/<svg[\s>]/i.test(head)) throw reject("SVG");
    return "image/svg+xml";
  }
  const detected = await fileTypeFromFile(absPath);
  const mime = detected?.mime ?? "";
  switch (category) {
    case "audio":
      if (!(mime.startsWith("audio/") || mime === "video/mp4" || mime === "video/webm" || mime === "application/ogg")) throw reject("audio");
      return byExt;
    case "video":
      if (!mime.startsWith("video/")) throw reject("video");
      return byExt;
    case "image":
      if (!mime.startsWith("image/")) throw reject("image");
      return byExt;
    case "font":
      if (!mime.startsWith("font/") && mime !== "application/font-woff") throw reject("font");
      return byExt;
    case "document":
      if (ext === ".pdf" ? mime !== "application/pdf" : !mime.startsWith("image/")) throw reject("document");
      return byExt;
    case "package":
      if (mime !== "application/zip") throw reject("zip");
      return "application/zip";
    default:
      return byExt;
  }
}

export function categoryForExt(ext: string, candidates: UploadCategory[]): UploadCategory | null {
  for (const c of candidates) if ((UPLOAD_RULES[c].exts as readonly string[]).includes(ext)) return c;
  return null;
}
