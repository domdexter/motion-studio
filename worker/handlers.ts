import { runHeadlessTask } from "@/server/claude/headless";
import type { JobHandler } from "@/server/jobs/types";
import { runWhisperInstall } from "@/server/providers/whisper";
import { runRenderStill, runRenderThumbnail, runRenderVideo } from "@/server/render/run-render";
import { runAlignment } from "@/server/services/alignment";
import { runAudioGeneration } from "@/server/services/audio-generation";
import { runPackageExport } from "@/server/services/package-jobs";
import { runVoiceGeneration, runVoicePreview } from "@/server/services/voice";

export type { JobHandler, JobHandlerContext } from "@/server/jobs/types";

/** Registry of job handlers executed by the worker. */
export const HANDLERS: Record<string, JobHandler> = {
  "voice.generate": runVoiceGeneration,
  "voice.preview": runVoicePreview,
  "alignment.forced": runAlignment,
  "alignment.stt": runAlignment,
  "alignment.whisper": runAlignment,
  "audio.generate": runAudioGeneration,
  "tools.whisper-install": runWhisperInstall,
  "render.video": runRenderVideo,
  "render.still": runRenderStill,
  "render.thumbnail": runRenderThumbnail,
  "export.package": runPackageExport,
  "ai.headless": runHeadlessTask,
};
