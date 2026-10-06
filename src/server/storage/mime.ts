import path from "node:path";

export const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".weba": "audio/webm",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export const UPLOAD_RULES = {
  audio: { exts: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".weba", ".webm"], maxBytes: 1024 ** 3 },
  image: { exts: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"], maxBytes: 100 * 1024 ** 2 },
  video: { exts: [".mp4", ".m4v", ".mov", ".webm"], maxBytes: 4 * 1024 ** 3 },
  font: { exts: [".ttf", ".otf", ".woff", ".woff2"], maxBytes: 20 * 1024 ** 2 },
  document: { exts: [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".md", ".txt"], maxBytes: 200 * 1024 ** 2 },
  timing: { exts: [".srt", ".vtt", ".json"], maxBytes: 20 * 1024 ** 2 },
  script: { exts: [".txt", ".md"], maxBytes: 5 * 1024 ** 2 },
  package: { exts: [".zip"], maxBytes: 8 * 1024 ** 3 },
} as const;

export type UploadCategory = keyof typeof UPLOAD_RULES;
