import { z } from "zod";

/**
 * Normalized timing format. Every provider (ElevenLabs TTS alignment, forced alignment,
 * speech-to-text, whisper.cpp, system voice, imported SRT/VTT/JSON, manual edits) is
 * converted into these shapes, so the rest of the app never sees provider structures.
 */

export const TimedWordSchema = z.object({
  /** Index within the transcript (0-based, contiguous). */
  i: z.number().int().nonnegative(),
  /** Display text, punctuation attached ("business,"). */
  text: z.string().min(1),
  /** Seconds from the start of the voice-over. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
  /** True when the timing was interpolated (e.g. distributed across a subtitle cue). */
  interpolated: z.boolean().optional(),
});
export type TimedWord = z.infer<typeof TimedWordSchema>;

export const TimedCharSchema = z.object({
  char: z.string(),
  start: z.number(),
  end: z.number(),
});
export type TimedChar = z.infer<typeof TimedCharSchema>;

export const TRANSCRIPT_SOURCES = [
  "elevenlabs_tts",
  "elevenlabs_forced_alignment",
  "elevenlabs_stt",
  "whisper_cpp",
  "system_tts",
  "import_json",
  "import_srt",
  "import_vtt",
  "manual",
] as const;
export const TranscriptSourceSchema = z.enum(TRANSCRIPT_SOURCES);
export type TranscriptSource = z.infer<typeof TranscriptSourceSchema>;

export const TRANSCRIPT_SOURCE_LABELS: Record<TranscriptSource, string> = {
  elevenlabs_tts: "ElevenLabs voice alignment",
  elevenlabs_forced_alignment: "ElevenLabs forced alignment",
  elevenlabs_stt: "ElevenLabs speech-to-text",
  whisper_cpp: "Local whisper.cpp",
  system_tts: "System voice word timing",
  import_json: "Imported JSON timing",
  import_srt: "Imported SRT subtitles",
  import_vtt: "Imported WebVTT subtitles",
  manual: "Manual edit",
};

export const SegmentKindSchema = z.enum(["sentence", "phrase", "paragraph", "cue"]);

export const SegmentSchema = z.object({
  id: z.string(),
  kind: SegmentKindSchema,
  text: z.string(),
  start: z.number(),
  end: z.number(),
  /** Word range [wordStart, wordEnd) into the transcript words. */
  wordStart: z.number().int().nonnegative(),
  wordEnd: z.number().int().nonnegative(),
  paragraph: z.number().int().nonnegative().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const PauseSchema = z.object({
  start: z.number(),
  end: z.number(),
  afterWord: z.number().int(),
});
export type Pause = z.infer<typeof PauseSchema>;

export const TimelineDataSchema = z.object({
  timebase: z.literal("seconds"),
  duration: z.number().nonnegative(),
  /** Sentence segments — exported as `segments` in timeline.json. */
  sentences: z.array(SegmentSchema),
  phrases: z.array(SegmentSchema),
  paragraphs: z.array(SegmentSchema),
  pauses: z.array(PauseSchema),
  /** Exact imported cues (SRT/VTT/JSON) when the timeline was imported. */
  cues: z.array(SegmentSchema).optional(),
});
export type TimelineData = z.infer<typeof TimelineDataSchema>;
