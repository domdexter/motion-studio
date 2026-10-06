import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { downloadWhisperModel, installWhisperCpp, toCaptions, transcribe, type WhisperModel } from "@remotion/install-whisper-cpp";
import { wordsFromCaptions } from "@/core/transcript/normalize";
import { AppError } from "../errors";
import { TMP_DIR, TOOLS_DIR } from "../env";
import { randomId } from "../ids";
import type { JobHandlerContext } from "../jobs/types";
import { convertToWav16k } from "../media/ffmpeg";
import { getSettings } from "../services/settings";
import type { AlignmentInput, AlignmentProvider, AlignmentResult, ProviderAvailability } from "./types";

/**
 * Local transcription/alignment with whisper.cpp (via @remotion/install-whisper-cpp).
 * Installation is an explicit, user-triggered job: it downloads a prebuilt binary (Windows) or
 * builds from source (macOS/Linux) and the selected ggml model.
 */

export const WHISPER_VERSION = "1.5.5";
export const WHISPER_DIR = path.join(TOOLS_DIR, "whisper.cpp");

export function whisperStatus() {
  const candidates = process.platform === "win32" ? ["main.exe", "whisper-cli.exe", "build/bin/Release/whisper-cli.exe"] : ["main", "whisper-cli", "build/bin/whisper-cli"];
  const installed = candidates.some((c) => fs.existsSync(path.join(WHISPER_DIR, c)));
  const models = fs.existsSync(WHISPER_DIR)
    ? fs
        .readdirSync(WHISPER_DIR)
        .filter((f) => /^ggml-.+\.bin$/.test(f))
        .map((f) => f.replace(/^ggml-/, "").replace(/\.bin$/, ""))
    : [];
  return { installed, models, version: WHISPER_VERSION, dir: WHISPER_DIR };
}

export async function runWhisperInstall(ctx: JobHandlerContext) {
  const { model } = ctx.job.payload as { model: WhisperModel };
  await fsp.mkdir(WHISPER_DIR, { recursive: true });
  await ctx.progress(0.02, "Installing whisper.cpp");
  await installWhisperCpp({ version: WHISPER_VERSION, to: WHISPER_DIR, printOutput: false, signal: ctx.signal });
  await ctx.progress(0.1, `Downloading ${model} model`);
  let last = 0;
  await downloadWhisperModel({
    model,
    folder: WHISPER_DIR,
    printOutput: false,
    signal: ctx.signal,
    onProgress: ((downloaded: number, total: number | undefined) => {
      const fraction = total ? downloaded / total : 0;
      if (fraction - last >= 0.02) {
        last = fraction;
        void ctx.progress(0.1 + 0.88 * fraction, `Downloading ${model} model`);
      }
    }) as never,
  });
  return whisperStatus();
}

export class WhisperAlignmentProvider implements AlignmentProvider {
  readonly id = "whisper_cpp" as const;
  readonly label = "Local whisper.cpp";
  readonly requiresText = false;

  async isAvailable(): Promise<ProviderAvailability> {
    const status = whisperStatus();
    const model = getSettings().alignment.whisperModel;
    if (!status.installed) return { ok: false, reason: "Local whisper.cpp is not installed. Install it in Settings → Alignment." };
    if (!status.models.includes(model)) return { ok: false, reason: `The whisper “${model}” model is not downloaded. Download it in Settings → Alignment.` };
    return { ok: true };
  }

  async getAlignment(input: AlignmentInput): Promise<AlignmentResult> {
    const availability = await this.isAvailable();
    if (!availability.ok) throw new AppError("NOT_CONFIGURED", availability.reason!, { action: { label: "Open alignment settings", href: "/settings#alignment" } });
    const model = getSettings().alignment.whisperModel as WhisperModel;
    await fsp.mkdir(TMP_DIR, { recursive: true });
    const wav = path.join(TMP_DIR, `whisper-${randomId(8)}.wav`);
    input.onProgress?.(0.05, "Preparing audio");
    await convertToWav16k(input.audioPath, wav);
    try {
      input.onProgress?.(0.1, "Transcribing locally");
      const output = await transcribe({
        inputPath: wav,
        whisperPath: WHISPER_DIR,
        whisperCppVersion: WHISPER_VERSION,
        model,
        tokenLevelTimestamps: true,
        printOutput: false,
        signal: input.signal,
        onProgress: (p: number) => input.onProgress?.(0.1 + 0.85 * p, "Transcribing locally"),
        ...(input.languageCode && !model.endsWith(".en") ? { language: input.languageCode as never } : {}),
      });
      const { captions } = toCaptions({ whisperCppOutput: output });
      const words = wordsFromCaptions(captions, input.durationSec);
      if (!words.length) throw new AppError("PROVIDER_ERROR", "whisper.cpp found no speech in this audio.");
      return {
        words,
        characters: null,
        text: words.map((w) => w.text).join(" "),
        language: output.result?.language ?? null,
        source: "whisper_cpp",
        raw: { model, captions },
        quality: {},
      };
    } finally {
      await fsp.rm(wav, { force: true });
    }
  }
}
