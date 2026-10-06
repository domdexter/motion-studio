import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { refineWordEnds, wordsFromSpeechMarks, type SpeechMark } from "@/core/transcript/normalize";
import { AppError } from "../../errors";
import { REPO_ROOT, TMP_DIR } from "../../env";
import { randomId } from "../../ids";
import { audioEnvelope, probeMedia } from "../../media/ffmpeg";
import { getSettings } from "../../services/settings";
import type { GenerateVoiceInput, GeneratedVoice, ProviderAvailability, VoiceInfo, VoiceProvider } from "../types";

/**
 * Windows system voice (SAPI) — an offline "scratch" voice for drafting timing before paying
 * for final VO. Word start times come from SAPI's SpeakProgress events; word ends are refined
 * from the rendered audio's energy envelope.
 */

const SCRIPT_DIR = path.join(REPO_ROOT, "src", "server", "providers", "system-voice");

function runPowerShell(script: string, args: string[], signal?: AbortSignal, timeoutMs = 300_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(SCRIPT_DIR, script), ...args], {
      windowsHide: true,
      shell: false,
      signal,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

let voiceCache: VoiceInfo[] | null = null;

export class SystemVoiceProvider implements VoiceProvider {
  readonly id = "system" as const;
  readonly label = "System voice (scratch)";

  async isAvailable(): Promise<ProviderAvailability> {
    if (process.platform !== "win32") return { ok: false, reason: "The system voice provider is available on Windows only." };
    return { ok: true };
  }

  async listVoices(): Promise<VoiceInfo[]> {
    if (process.platform !== "win32") return [];
    if (voiceCache) return voiceCache;
    const res = await runPowerShell("list-voices.ps1", [], undefined, 60_000);
    if (res.code !== 0) throw new AppError("PROVIDER_ERROR", "Could not list system voices.", { details: res.stderr.slice(0, 500) });
    const parsed = JSON.parse(res.stdout.trim() || "[]") as { name: string; culture: string; gender: string }[] | { name: string; culture: string; gender: string };
    const list = Array.isArray(parsed) ? parsed : [parsed];
    voiceCache = list.map((v) => ({ id: v.name, name: v.name, provider: "system", category: v.gender, language: v.culture }));
    return voiceCache;
  }

  async maxCharacters(): Promise<number | null> {
    return null;
  }

  async generateVoice(input: GenerateVoiceInput): Promise<GeneratedVoice> {
    const available = await this.isAvailable();
    if (!available.ok) throw new AppError("PRECONDITION", available.reason ?? "System voice unavailable.");
    await fs.mkdir(TMP_DIR, { recursive: true });
    const id = randomId(8);
    const requestPath = path.join(TMP_DIR, `sapi-${id}.json`);
    const outputPath = path.join(TMP_DIR, `sapi-${id}.wav`);
    const resultPath = path.join(TMP_DIR, `sapi-${id}.result.json`);
    const settings = getSettings().voice;
    const voiceName = input.voiceId ?? settings.systemVoiceName ?? "";
    await fs.writeFile(requestPath, JSON.stringify({ text: input.text, voiceName, rate: input.rate ?? settings.systemRate, outputPath, resultPath }), "utf8");
    try {
      const res = await runPowerShell("synthesize.ps1", ["-Request", requestPath], input.signal);
      if (res.code !== 0) {
        throw new AppError("PROVIDER_ERROR", "System voice synthesis failed.", { details: res.stderr.trim().slice(0, 800), hint: "Check that the selected Windows voice is installed and enabled." });
      }
      const result = JSON.parse(await fs.readFile(resultPath, "utf8")) as { voice: string; marks: SpeechMark[] };
      const audio = await fs.readFile(outputPath);
      const probe = await probeMedia(outputPath);
      const duration = probe.durationSec ?? 0;
      let marks = result.marks;
      const lastMark = marks.reduce((max, m) => Math.max(max, m.audioMs / 1000), 0);
      let rescaled: number | null = null;
      if (duration > 0 && lastMark > duration) {
        // Safety net: engine positions don't match the rendered audio rate — scale them back.
        rescaled = (duration * 0.97) / (lastMark + 0.3);
        marks = marks.map((m) => ({ ...m, audioMs: m.audioMs * rescaled! }));
      }
      const envelope = await audioEnvelope(outputPath, 0.01);
      const words = refineWordEnds(wordsFromSpeechMarks(marks, input.text, duration), envelope, duration);
      return {
        audio,
        extension: "wav",
        mimeType: "audio/wav",
        words,
        characters: null,
        transcriptSource: "system_tts",
        raw: { marks: result.marks },
        meta: { voiceName: result.voice, rate: input.rate ?? settings.systemRate, engine: "Windows SAPI", ...(rescaled ? { markRescale: rescaled } : {}) },
      };
    } finally {
      await Promise.all([requestPath, outputPath, resultPath].map((p) => fs.rm(p, { force: true })));
    }
  }
}
