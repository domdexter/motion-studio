/**
 * Production status and dependency staleness, derived from real project state.
 * Nothing here is manually assigned — callers pass a summary of what exists.
 */

export const PRODUCTION_STATUSES = [
  "DRAFT",
  "VOICE_READY",
  "TIMELINE_READY",
  "STORYBOARD_READY",
  "ASSETS_READY",
  "ANIMATION_READY",
  "READY_TO_RENDER",
  "RENDERING",
  "COMPLETE",
] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const STATUS_LABELS: Record<ProductionStatus, string> = {
  DRAFT: "Draft",
  VOICE_READY: "Voice ready",
  TIMELINE_READY: "Timeline ready",
  STORYBOARD_READY: "Storyboard ready",
  ASSETS_READY: "Assets ready",
  ANIMATION_READY: "Animation ready",
  READY_TO_RENDER: "Ready to render",
  RENDERING: "Rendering",
  COMPLETE: "Complete",
};

export const STAGE_KEYS = ["script", "voice", "alignment", "timeline", "storyboard", "assets", "scenes", "render"] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export type StageStateKind = "missing" | "ready" | "stale" | "attention" | "running" | "optional";

export interface StageState {
  state: StageStateKind;
  label: string;
  reason?: string;
}

export interface PipelineInput {
  script: { hash: string; wordCount: number } | null;
  voice: { id: string; source: string; scriptHash: string | null } | null;
  voiceJobRunning: boolean;
  alignmentJobRunning: boolean;
  transcript: { id: string; voiceTakeId: string } | null;
  timeline: { id: string; transcriptId: string | null } | null;
  timelineDecision: { voiceTakeId: string; decision: "keep" | "recalculate" } | null;
  scenes: {
    total: number;
    approved: number;
    /** Audio-locked scenes built on a timeline that is no longer active. */
    staleTiming: number;
    /** Approved scenes whose spec/timing/assets changed after approval. */
    needsReview: number;
    /** Scenes whose spec fails validation. */
    invalid: number;
  };
  assets: { missing: number; openRequests: number; awaitingApproval: number };
  render: { running: boolean; latestComplete: { compositionHash: string } | null; latestFailed: boolean };
  compositionHash: string | null;
}

export interface PipelineResult {
  status: ProductionStatus;
  stages: Record<StageKey, StageState>;
  next: { stage: StageKey; label: string } | null;
  staleCount: number;
}

const GENERATED_VOICE_SOURCES = new Set(["elevenlabs", "system_tts"]);

export function derivePipeline(input: PipelineInput): PipelineResult {
  const stages = {} as Record<StageKey, StageState>;

  // SCRIPT
  if (input.script && input.script.wordCount > 0) stages.script = { state: "ready", label: `${input.script.wordCount} words` };
  else if (input.voice) stages.script = { state: "optional", label: "Using the voice-over transcript" };
  else stages.script = { state: "missing", label: "No script yet" };

  // VOICE
  if (input.voiceJobRunning) stages.voice = { state: "running", label: "Generating voice-over…" };
  else if (!input.voice) stages.voice = { state: "missing", label: "No voice-over" };
  else if (
    GENERATED_VOICE_SOURCES.has(input.voice.source) &&
    input.voice.scriptHash &&
    input.script &&
    input.voice.scriptHash !== input.script.hash
  )
    stages.voice = { state: "stale", label: "Script changed", reason: "The script changed after this voice-over was generated." };
  else stages.voice = { state: "ready", label: input.voice.source === "import" ? "Imported voice-over" : "Generated voice-over" };

  // ALIGNMENT
  if (input.alignmentJobRunning) stages.alignment = { state: "running", label: "Aligning…" };
  else if (!input.voice) stages.alignment = { state: "missing", label: "Needs a voice-over" };
  else if (!input.transcript) stages.alignment = { state: "missing", label: "Not aligned" };
  else if (input.transcript.voiceTakeId !== input.voice.id)
    stages.alignment = { state: "stale", label: "Voice changed", reason: "The active voice-over changed; word timing belongs to a previous take." };
  else stages.alignment = { state: "ready", label: "Word timing ready" };

  // TIMELINE
  const keptTimeline = !!(input.timelineDecision && input.voice && input.timelineDecision.voiceTakeId === input.voice.id && input.timelineDecision.decision === "keep");
  if (!input.transcript && !input.timeline) stages.timeline = { state: "missing", label: "Needs alignment" };
  else if (!input.timeline) stages.timeline = { state: "missing", label: "No timeline" };
  else if (input.transcript && input.timeline.transcriptId !== input.transcript.id) {
    stages.timeline = keptTimeline
      ? { state: "attention", label: "Kept previous timeline", reason: "You chose to keep the existing timeline after the voice-over changed." }
      : { state: "stale", label: "Timeline may be invalidated", reason: "Voice-over changed. Existing scene timing may no longer match." };
  } else stages.timeline = { state: "ready", label: "Audio-locked timeline" };

  // STORYBOARD
  if (!input.timeline) stages.storyboard = { state: "missing", label: "Needs a timeline" };
  else if (input.scenes.total === 0) stages.storyboard = { state: "missing", label: "No storyboard" };
  else if (input.scenes.staleTiming > 0)
    stages.storyboard = {
      state: "stale",
      label: `${input.scenes.staleTiming} scene${input.scenes.staleTiming === 1 ? "" : "s"} on old timing`,
      reason: "These audio-locked scenes were built on a previous timeline.",
    };
  else stages.storyboard = { state: "ready", label: `${input.scenes.total} scene${input.scenes.total === 1 ? "" : "s"}` };

  // ASSETS
  const pendingAssets = input.assets.openRequests + input.assets.awaitingApproval;
  if (input.assets.missing > 0)
    stages.assets = { state: "attention", label: `${input.assets.missing} missing asset${input.assets.missing === 1 ? "" : "s"}`, reason: "Scenes reference assets that do not exist." };
  else if (pendingAssets > 0) stages.assets = { state: "attention", label: `${pendingAssets} asset request${pendingAssets === 1 ? "" : "s"} open` };
  else stages.assets = { state: "ready", label: "No blocking assets" };

  // SCENES
  if (input.scenes.total === 0) stages.scenes = { state: "missing", label: "No scenes" };
  else if (input.scenes.invalid > 0) stages.scenes = { state: "attention", label: `${input.scenes.invalid} invalid spec${input.scenes.invalid === 1 ? "" : "s"}` };
  else if (input.scenes.needsReview > 0)
    stages.scenes = { state: "stale", label: `${input.scenes.needsReview} need${input.scenes.needsReview === 1 ? "s" : ""} review`, reason: "Changed after approval." };
  else if (input.scenes.approved < input.scenes.total)
    stages.scenes = { state: "attention", label: `${input.scenes.approved}/${input.scenes.total} approved` };
  else stages.scenes = { state: "ready", label: "All scenes approved" };

  // RENDER
  if (input.render.running) stages.render = { state: "running", label: "Rendering…" };
  else if (input.render.latestComplete && input.compositionHash && input.render.latestComplete.compositionHash === input.compositionHash)
    stages.render = { state: "ready", label: "Final render up to date" };
  else if (input.render.latestComplete) stages.render = { state: "stale", label: "Project changed since last render" };
  else if (input.render.latestFailed) stages.render = { state: "attention", label: "Last render failed" };
  else stages.render = { state: "missing", label: "Not rendered" };

  // STATUS — highest stage reached in order.
  const ok = (k: StageKey) => stages[k].state === "ready" || stages[k].state === "optional";
  let status: ProductionStatus = "DRAFT";
  if (ok("voice")) {
    status = "VOICE_READY";
    if (ok("alignment") && (ok("timeline") || stages.timeline.state === "attention")) {
      status = "TIMELINE_READY";
      if (ok("storyboard")) {
        status = "STORYBOARD_READY";
        if (ok("assets")) {
          status = "ASSETS_READY";
          if (input.scenes.invalid === 0 && input.scenes.needsReview === 0) {
            status = "ANIMATION_READY";
            if (input.scenes.approved === input.scenes.total) status = "READY_TO_RENDER";
          }
        }
      }
    }
  }
  if (input.render.running) status = "RENDERING";
  else if (stages.render.state === "ready" && status === "READY_TO_RENDER") status = "COMPLETE";

  const next = nextAction(stages, input);
  const staleCount = STAGE_KEYS.filter((k) => stages[k].state === "stale").length;
  return { status, stages, next, staleCount };
}

function nextAction(stages: Record<StageKey, StageState>, input: PipelineInput): PipelineResult["next"] {
  if (stages.voice.state === "running" || stages.alignment.state === "running") return null;
  if (stages.script.state === "missing" && stages.voice.state === "missing") return { stage: "script", label: "Add a script or import a voice-over" };
  if (stages.voice.state === "missing") return { stage: "voice", label: "Generate or import the voice-over" };
  if (stages.voice.state === "stale") return { stage: "voice", label: "Regenerate the voice-over (script changed)" };
  if (stages.alignment.state === "missing") return { stage: "alignment", label: "Align the voice-over" };
  if (stages.alignment.state === "stale") return { stage: "alignment", label: "Align the new voice-over" };
  if (stages.timeline.state === "missing") return { stage: "timeline", label: "Build the timeline" };
  if (stages.timeline.state === "stale") return { stage: "timeline", label: "Review timeline after voice-over change" };
  if (stages.storyboard.state === "missing") return { stage: "storyboard", label: "Generate the storyboard" };
  if (stages.storyboard.state === "stale") return { stage: "storyboard", label: "Update scene timing" };
  if (stages.assets.state === "attention") return { stage: "assets", label: stages.assets.label };
  if (stages.scenes.state !== "ready") return { stage: "scenes", label: input.scenes.invalid ? "Fix invalid scene specs" : "Review and approve scenes" };
  if (stages.render.state === "missing" || stages.render.state === "stale" || stages.render.state === "attention")
    return { stage: "render", label: "Render the final video" };
  return null;
}
