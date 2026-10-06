import { z } from "zod";

export const WORKFLOWS = ["script_only", "audio_only", "script_audio", "script_audio_timeline", "imported", "blank"] as const;
export const WorkflowSchema = z.enum(WORKFLOWS);
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WORKFLOW_INFO: Record<Workflow, { label: string; description: string; steps: string[] }> = {
  script_only: {
    label: "Script only",
    description: "Write or paste a script. Generate the voice-over, then build everything on its real timing.",
    steps: ["Script", "Analyze", "Generate voice", "Alignment", "Timeline", "Storyboard", "Assets", "Animation", "Preview", "Render"],
  },
  audio_only: {
    label: "Audio only",
    description: "Start from an existing voice-over. Transcribe and align it, then storyboard to the audio.",
    steps: ["Audio", "Transcribe", "Align", "Timeline", "Storyboard", "Assets", "Animation", "Preview", "Render"],
  },
  script_audio: {
    label: "Script + Audio",
    description: "Use your script and an existing voice-over. Align them and review any differences.",
    steps: ["Script + Audio", "Compare / Align", "Timeline", "Storyboard", "Assets", "Animation", "Preview", "Render"],
  },
  script_audio_timeline: {
    label: "Script + Audio + Timeline",
    description: "Fastest route: bring timestamps (SRT, VTT or JSON). Validate, then go straight to storyboard.",
    steps: ["Script + Audio + Timeline", "Validate", "Storyboard", "Assets", "Animation", "Preview", "Render"],
  },
  imported: {
    label: "Existing project",
    description: "Open a project from your library or import a project package.",
    steps: ["Open", "Continue from any stage"],
  },
  blank: {
    label: "Blank project",
    description: "An empty project. Add materials in any order.",
    steps: ["Any stage"],
  },
};

export const VISUAL_TYPES = ["motion_graphic", "kinetic_type", "ui_demo", "data_viz", "image", "video", "logo", "mixed"] as const;
export const VisualTypeSchema = z.enum(VISUAL_TYPES);
export type VisualType = z.infer<typeof VisualTypeSchema>;

export const VISUAL_TYPE_LABELS: Record<VisualType, string> = {
  motion_graphic: "Motion graphic",
  kinetic_type: "Kinetic type",
  ui_demo: "UI demo",
  data_viz: "Data viz",
  image: "AI image",
  video: "AI video",
  logo: "Logo / CTA",
  mixed: "Mixed",
};

export const ASSET_KINDS = [
  "image",
  "video",
  "audio",
  "music",
  "sfx",
  "logo",
  "font",
  "screenshot",
  "icon",
  "brand_guide",
  "reference",
] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const AssetRequirementSchema = z.object({
  kind: z.enum(["image", "video", "logo", "screenshot", "icon", "audio"]),
  description: z.string().min(1),
  assetId: z.string().nullable().optional(),
  requestId: z.string().nullable().optional(),
});
export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;

export const SCENE_STATUSES = ["draft", "approved"] as const;
export const TIMING_MODES = ["audio_locked", "user_adjusted"] as const;
export type TimingMode = (typeof TIMING_MODES)[number];

export const ASSET_REQUEST_STATUSES = ["requested", "generating", "generated", "approved", "rejected", "cancelled"] as const;
export type AssetRequestStatus = (typeof ASSET_REQUEST_STATUSES)[number];

export const AI_TASK_TYPES = [
  "analyze_script",
  "generate_storyboard",
  "regenerate_scenes",
  "edit_scene",
  "scene_alternatives",
  "generate_assets",
  "plan_creative",
  "creative_review",
  "refine_creative",
  "command",
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];
