"use client";

import {
  AppWindow,
  BarChart3,
  Bell,
  Captions,
  Circle,
  Hash,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Loader,
  Monitor,
  MousePointer2,
  Move,
  Network,
  Smartphone,
  Sparkles,
  Square,
  Tag,
  Type,
  Video,
  Wand2,
} from "lucide-react";
import { PageHeader, Panel } from "../common";
import { AssetLibrary } from "./asset-library";
import { AssetRequestsPanel } from "./asset-requests";

export function ImagesPage({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <PageHeader title="Images" description="AI images Claude Code generates for your scenes, plus uploaded images, screenshots and references. Reference an approved image in a scene spec by its asset id." />
      <AssetRequestsPanel projectId={projectId} kind="image" />
      <AssetLibrary
        projectId={projectId}
        title="Image library"
        kinds={["image", "screenshot", "reference"]}
        uploadKinds={["image", "screenshot", "reference"]}
        emptyHint="Upload photos, product screenshots or reference images (PNG, JPG, WebP, GIF, AVIF, SVG)."
      />
    </div>
  );
}

export function VideosPage({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <PageHeader title="Videos" description="AI video clips and uploaded footage. Clips play muted by default under the voice-over; trim, speed and loop are set per scene." />
      <AssetRequestsPanel projectId={projectId} kind="video" />
      <AssetLibrary projectId={projectId} title="Video library" kinds={["video"]} uploadKinds={["video"]} emptyHint="Upload clips or screen recordings (MP4, MOV, WebM)." />
    </div>
  );
}

const COMPONENT_GROUPS: { title: string; items: { name: string; icon: typeof Type; description: string }[] }[] = [
  {
    title: "Typography",
    items: [
      { name: "text", icon: Type, description: "Headlines and body copy with word/character reveals, masks, typewriter and voice-synced highlights." },
      { name: "kinetic", icon: Sparkles, description: "The narration becomes typography — phrase, word, stack or karaoke, locked to the voice." },
      { name: "captions", icon: Captions, description: "Voice-synced captions: minimal, boxed, bold or karaoke." },
      { name: "badge", icon: Tag, description: "Pills, eyebrows and labels." },
    ],
  },
  {
    title: "UI",
    items: [
      { name: "card / cards", icon: LayoutGrid, description: "Cards in rows, grids, scatter, orbit, stack or cascade — with collapse-into-one and word-synced entrances." },
      { name: "browser / phone / desktop", icon: Monitor, description: "Device mockups with animated dashboard, analytics, list, chat, landing, form or media screens." },
      { name: "dashboard", icon: LayoutDashboard, description: "KPIs that count up, charts and status rows." },
      { name: "button", icon: AppWindow, description: "Buttons with a press and ripple on any trigger." },
      { name: "notification", icon: Bell, description: "Toasts, iOS notifications and banners." },
      { name: "cursor", icon: MousePointer2, description: "Cursor paths and clicks that land on spoken words." },
    ],
  },
  {
    title: "Data & diagrams",
    items: [
      { name: "chart", icon: BarChart3, description: "Bar, line, area and donut charts animated on a word." },
      { name: "counter", icon: Hash, description: "Numbers that count up with prefix/suffix." },
      { name: "progress", icon: Loader, description: "Progress bars and rings." },
      { name: "diagram", icon: Network, description: "Hub, flow, cycle and grid diagrams with drawn, pulsing connections." },
      { name: "list", icon: ListChecks, description: "Checklists and feature lists that land item by item." },
    ],
  },
  {
    title: "Graphics, media & scene",
    items: [
      { name: "icon / line / circle / rect / grid", icon: Square, description: "Lucide icons and shapes that draw on." },
      { name: "image / video", icon: ImageIcon, description: "Ken Burns, masks, overlays; clip trim, rate and loop." },
      { name: "logo", icon: Circle, description: "Brand logo or a wordmark of the brand name." },
      { name: "backgrounds", icon: Wand2, description: "Mesh, gradient, grid, particles, noise, image or video — with grain and vignette." },
      { name: "transitions & camera", icon: Move, description: "Fade, slide, wipe, zoom, blur, scale, morph; push-in, pull-out, pans, drift." },
      { name: "smartphone-first layouts", icon: Smartphone, description: "Every element adapts to 16:9, 9:16, 1:1 and 4:5 through relative units." },
      { name: "video clips", icon: Video, description: "AI or uploaded footage composed with motion graphics on top." },
    ],
  },
];

export function GraphicsPage({ projectId }: { projectId: string }) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <PageHeader title="Graphics" description="Logos, icons and the Remotion motion component library scenes are built from. Graphics are rendered as code — crisp at any resolution and restyled by the design system." />
      <AssetLibrary projectId={projectId} title="Logos & icons" kinds={["logo", "icon"]} uploadKinds={["logo", "icon"]} emptyHint="Upload logo variations and custom icons (SVG or transparent PNG work best)." />
      <Panel title="Motion component library" description="What scene specs can use. Claude Code composes these (see REMOTION.md); the design system styles them all.">
        <div className="grid gap-6 lg:grid-cols-2">
          {COMPONENT_GROUPS.map((group) => (
            <div key={group.title}>
              <h4 className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{group.title}</h4>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={item.name} className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <item.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <div className="font-mono text-xs">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{item.description}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
