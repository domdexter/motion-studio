import {
  AudioLines,
  ClipboardCheck,
  Compass,
  Clapperboard,
  FileText,
  Film,
  History,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  ListTree,
  MonitorPlay,
  Music,
  Palette,
  Rows3,
  Shapes,
  Mic,
} from "lucide-react";
import type { StageKey, StageStateKind, PipelineResult } from "@/core/status/pipeline";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  stages?: StageKey[];
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Project", items: [{ key: "overview", label: "Overview", href: "", icon: LayoutGrid }] },
  {
    label: "Script",
    items: [
      { key: "script", label: "Script", href: "/script", icon: FileText, stages: ["script"] },
      { key: "voice", label: "Voice", href: "/voice", icon: Mic, stages: ["voice", "alignment"] },
    ],
  },
  {
    label: "Story",
    items: [
      { key: "beats", label: "Beats", href: "/beats", icon: ListTree },
      { key: "direction", label: "Direction", href: "/direction", icon: Compass },
      { key: "storyboard", label: "Storyboard", href: "/storyboard", icon: Clapperboard, stages: ["storyboard"] },
    ],
  },
  {
    label: "Assets",
    items: [
      { key: "images", label: "Images", href: "/assets/images", icon: ImageIcon, stages: ["assets"] },
      { key: "videos", label: "Videos", href: "/assets/videos", icon: Film },
      { key: "graphics", label: "Graphics", href: "/assets/graphics", icon: Shapes },
      { key: "audio", label: "Audio", href: "/assets/audio", icon: Music },
      { key: "brand", label: "Brand", href: "/assets/brand", icon: Palette },
    ],
  },
  {
    label: "Motion",
    items: [
      { key: "scenes", label: "Scenes", href: "/scenes", icon: Layers, stages: ["scenes"] },
      { key: "timeline", label: "Timeline", href: "/timeline", icon: Rows3, stages: ["timeline"] },
    ],
  },
  {
    label: "Output",
    items: [
      { key: "preview", label: "Preview", href: "/preview", icon: MonitorPlay },
      { key: "review", label: "Creative QA", href: "/review", icon: ClipboardCheck },
      { key: "render", label: "Render", href: "/render", icon: AudioLines, stages: ["render"] },
    ],
  },
];

export const SECONDARY_NAV: NavItem[] = [{ key: "versions", label: "Versions & activity", href: "/versions", icon: History }];

export const STAGE_ROUTES: Record<StageKey, string> = {
  script: "/script",
  voice: "/voice",
  alignment: "/voice#alignment",
  timeline: "/timeline",
  storyboard: "/storyboard",
  assets: "/assets/images",
  scenes: "/scenes",
  render: "/render",
};

export const STAGE_LABELS: Record<StageKey, string> = {
  script: "Script",
  voice: "Voice",
  alignment: "Align",
  timeline: "Timeline",
  storyboard: "Storyboard",
  assets: "Assets",
  scenes: "Scenes",
  render: "Render",
};

const SEVERITY: StageStateKind[] = ["running", "stale", "attention", "missing", "optional", "ready"];

/** Worst state across the stages a nav item represents. */
export function navItemState(item: NavItem, pipeline: PipelineResult | undefined): StageStateKind | null {
  if (!item.stages || !pipeline) return null;
  const states = item.stages.map((s) => pipeline.stages[s].state);
  return SEVERITY.find((s) => states.includes(s)) ?? null;
}
