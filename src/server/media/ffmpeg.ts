import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { AudioEnvelope } from "@/core/transcript/normalize";
import { AppError } from "../errors";
import { REPO_ROOT } from "../env";

/**
 * Media probing/decoding with the ffmpeg + ffprobe binaries that ship inside Remotion's
 * compositor package — no system FFmpeg install required. All processes are spawned with
 * fixed argument arrays (never through a shell).
 */

const COMPOSITOR_PACKAGES: Record<string, string> = {
  "win32-x64": "@remotion/compositor-win32-x64-msvc",
  "darwin-arm64": "@remotion/compositor-darwin-arm64",
  "darwin-x64": "@remotion/compositor-darwin-x64",
  "linux-x64": "@remotion/compositor-linux-x64-gnu",
  "linux-arm64": "@remotion/compositor-linux-arm64-gnu",
};

let cachedPaths: { ffmpeg: string; ffprobe: string } | null = null;

export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  if (cachedPaths) return cachedPaths;
  const pkg = COMPOSITOR_PACKAGES[`${process.platform}-${process.arch}`];
  const exe = process.platform === "win32" ? ".exe" : "";
  const candidates: string[] = [];
  if (pkg) {
    try {
      const require = createRequire(path.join(REPO_ROOT, "package.json"));
      candidates.push(path.dirname(require.resolve(`${pkg}/package.json`)));
    } catch {
      // fall through to node_modules lookup
    }
    candidates.push(path.join(REPO_ROOT, "node_modules", pkg));
  }
  for (const dir of candidates) {
    const ffmpeg = path.join(dir, `ffmpeg${exe}`);
    const ffprobe = path.join(dir, `ffprobe${exe}`);
    if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) {
      cachedPaths = { ffmpeg, ffprobe };
      return cachedPaths;
    }
  }
  throw new AppError("PRECONDITION", "FFmpeg binaries from Remotion's compositor were not found.", {
    hint: "Run `npm install` to install Remotion's platform package.",
  });
}

export function ffmpegDirectory(): string {
  return path.dirname(ffmpegPaths().ffmpeg);
}

interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function runBinary(bin: string, args: string[], options: { signal?: AbortSignal; input?: Buffer } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: path.dirname(bin), windowsHide: true, shell: false, signal: options.signal });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < 20_000) err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout: Buffer.concat(out), stderr: err, code }));
    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export interface MediaProbe {
  durationSec: number | null;
  formatName: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  sampleRate: number | null;
  channels: number | null;
  audioCodec: string | null;
  videoCodec: string | null;
  fps: number | null;
}

export async function probeMedia(absPath: string): Promise<MediaProbe> {
  const { ffprobe } = ffmpegPaths();
  const res = await runBinary(ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath]);
  if (res.code !== 0) {
    throw new AppError("UNSUPPORTED_MEDIA", "Could not read this media file.", { details: res.stderr.trim().slice(0, 500) });
  }
  const data = JSON.parse(res.stdout.toString("utf8")) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; channels?: number; duration?: string; avg_frame_rate?: string; disposition?: { attached_pic?: number } }[];
  };
  const streams = data.streams ?? [];
  const audio = streams.find((s) => s.codec_type === "audio");
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const duration = Number(data.format?.duration ?? audio?.duration ?? video?.duration);
  let fps: number | null = null;
  if (video?.avg_frame_rate && video.avg_frame_rate !== "0/0") {
    const [n, d] = video.avg_frame_rate.split("/").map(Number);
    if (n && d) fps = Math.round((n / d) * 1000) / 1000;
  }
  return {
    durationSec: Number.isFinite(duration) ? Math.round(duration * 1000) / 1000 : null,
    formatName: data.format?.format_name ?? null,
    hasAudio: !!audio,
    hasVideo: !!video,
    width: video?.width ?? null,
    height: video?.height ?? null,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio?.channels ?? null,
    audioCodec: audio?.codec_name ?? null,
    videoCodec: video?.codec_name ?? null,
    fps,
  };
}

/**
 * Parses (possibly streamed) WAV bytes into mono float samples. Streamed WAV from a pipe has
 * placeholder chunk sizes, so the data chunk runs to the end of the buffer.
 */
export function wavToFloat32(buf: Buffer): Float32Array {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new AppError("UNSUPPORTED_MEDIA", "The audio decoder did not return WAV data.");
  }
  let offset = 12;
  let channels = 1;
  let bitsPerSample = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      const end = size === 0 || size === 0xffffffff || body + size > buf.length ? buf.length : body + size;
      const bytes = bitsPerSample / 8;
      const frames = Math.floor((end - body) / (bytes * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bytes;
          sum += bitsPerSample === 16 ? buf.readInt16LE(p) / 32768 : bitsPerSample === 32 ? buf.readFloatLE(p) : (buf.readUInt8(p) - 128) / 128;
        }
        out[i] = sum / channels;
      }
      return out;
    }
    if (size === 0xffffffff) break;
    offset = body + size + (size % 2);
  }
  throw new AppError("UNSUPPORTED_MEDIA", "The decoded WAV stream has no audio data.");
}

/** Decodes any audio (or video's audio) to mono float PCM at the given sample rate. */
export async function decodeAudioMono(absPath: string, sampleRate = 16000, signal?: AbortSignal): Promise<Float32Array> {
  const { ffmpeg } = ffmpegPaths();
  // Remotion's ffmpeg build has no raw PCM muxers, but it has wav + pcm_s16le.
  const res = await runBinary(
    ffmpeg,
    ["-v", "error", "-i", absPath, "-vn", "-ac", "1", "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-map_metadata", "-1", "-f", "wav", "pipe:1"],
    { signal },
  );
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not decode audio.", { details: res.stderr.trim().slice(0, 500) });
  return wavToFloat32(res.stdout);
}

export interface WaveformPeaks {
  peaksPerSecond: number;
  durationSec: number;
  /** Max absolute amplitude per bucket, 0–255. */
  data: number[];
}

export async function computePeaks(absPath: string, peaksPerSecond = 100): Promise<WaveformPeaks> {
  const sampleRate = 8000;
  const samples = await decodeAudioMono(absPath, sampleRate);
  const bucket = Math.max(1, Math.floor(sampleRate / peaksPerSecond));
  const data: number[] = [];
  let globalMax = 0;
  for (let i = 0; i < samples.length; i++) globalMax = Math.max(globalMax, Math.abs(samples[i]));
  const norm = globalMax > 0 ? 1 / globalMax : 1;
  for (let i = 0; i < samples.length; i += bucket) {
    let max = 0;
    const end = Math.min(samples.length, i + bucket);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    data.push(Math.round(Math.min(1, max * norm) * 255));
  }
  return { peaksPerSecond: sampleRate / bucket, durationSec: samples.length / sampleRate, data };
}

/** RMS envelope with a fixed hop (used to refine word end times). */
export async function audioEnvelope(absPath: string, hopSec = 0.01): Promise<AudioEnvelope> {
  const sampleRate = 16000;
  const samples = await decodeAudioMono(absPath, sampleRate);
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const values: number[] = [];
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0;
    const end = Math.min(samples.length, i + hop);
    for (let j = i; j < end; j++) sum += samples[j] * samples[j];
    values.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return { hopSec: hop / sampleRate, values };
}

/** 16 kHz mono 16-bit WAV (whisper.cpp input format). */
export async function convertToWav16k(absIn: string, absOut: string): Promise<void> {
  const { ffmpeg } = ffmpegPaths();
  const res = await runBinary(ffmpeg, ["-v", "error", "-y", "-i", absIn, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", absOut]);
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not convert audio to WAV.", { details: res.stderr.trim().slice(0, 500) });
}

/** Grabs one frame of a video as JPEG (for thumbnails/posters). */
export async function extractVideoFrame(absIn: string, absOut: string, atSec = 0.5, width = 640): Promise<void> {
  const { ffmpeg } = ffmpegPaths();
  const res = await runBinary(ffmpeg, ["-v", "error", "-y", "-ss", String(Math.max(0, atSec)), "-i", absIn, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", absOut]);
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not extract a video frame.", { details: res.stderr.trim().slice(0, 500) });
}

/** Resizes an image to a JPEG thumbnail. */
export async function imageThumbnail(absIn: string, absOut: string, width = 640): Promise<void> {
  const { ffmpeg } = ffmpegPaths();
  const res = await runBinary(ffmpeg, ["-v", "error", "-y", "-i", absIn, "-vf", `scale='min(${width},iw)':-2`, "-frames:v", "1", "-q:v", "3", absOut]);
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not create a thumbnail.", { details: res.stderr.trim().slice(0, 500) });
}

/** Small grayscale frames of part of a video, concatenated (width × height bytes each), for motion analysis. */
export async function grayFrames(absIn: string, options: { startSec: number; durationSec: number; fps: number; width: number; height: number }): Promise<Buffer> {
  const { ffmpeg } = ffmpegPaths();
  const res = await runBinary(ffmpeg, [
    "-v",
    "error",
    "-ss",
    String(Math.max(0, options.startSec)),
    "-t",
    String(Math.max(0.1, options.durationSec)),
    "-i",
    absIn,
    "-an",
    "-vf",
    `scale=${options.width}:${options.height},format=gray`,
    "-r",
    String(options.fps),
    "-f",
    "image2pipe",
    "-c:v",
    "rawvideo",
    "pipe:1",
  ]);
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not read frames from this video.", { details: res.stderr.trim().slice(0, 500) });
  return res.stdout;
}

/** Re-encodes a video's audio with a gain (the picture is copied untouched). */
export async function applyAudioGain(absIn: string, absOut: string, gainDb: number, signal?: AbortSignal): Promise<void> {
  const { ffmpeg } = ffmpegPaths();
  const res = await runBinary(ffmpeg, ["-v", "error", "-y", "-i", absIn, "-map", "0", "-c:v", "copy", "-af", `volume=${gainDb.toFixed(2)}dB`, "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", absOut], { signal });
  if (res.code !== 0) throw new AppError("UNSUPPORTED_MEDIA", "Could not adjust the audio loudness.", { details: res.stderr.trim().slice(0, 500) });
}

/** Encodes mono float32 PCM to a 16-bit WAV file buffer. */
export function encodeWav(samples: Float32Array | Int16Array, sampleRate: number, channels = 1): Buffer {
  const int16 = samples instanceof Int16Array ? samples : Int16Array.from(samples, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767))));
  const dataBytes = int16.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < int16.length; i++) buf.writeInt16LE(int16[i], 44 + i * 2);
  return buf;
}

/** Wraps raw little-endian 16-bit PCM bytes (e.g. ElevenLabs pcm_24000) in a WAV header. */
export function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + (pcm.length - (pcm.length % 2))));
  return encodeWav(samples, sampleRate, channels);
}
