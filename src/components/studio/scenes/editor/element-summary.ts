import { Group, Activity, Film, Hexagon, ImageIcon, LayoutGrid, Monitor, MousePointer2, Shapes, Square, Star, Type, type LucideIcon } from "lucide-react";
import type { ElementType, SceneElement } from "@/core/spec/scene";
import type { ElementRef } from "@/core/timeline/element-layout";

/** How the editor names and describes scene elements (layers list, inspector headers). */

export function summarizeElement(el: SceneElement): string {
  switch (el.type) {
    case "group":
      return el.name ?? `${el.children.length} elements`;
    case "text":
    case "badge":
      return el.text;
    case "kinetic":
      return el.text ?? "Narration, word by word";
    case "card":
      return [el.title, el.value, el.body].filter(Boolean).join(" · ");
    case "cards":
      return el.items.map((i) => i.title ?? i.label ?? i.value).filter(Boolean).join(", ");
    case "list":
      return el.items.map((i) => i.text).join(", ");
    case "button":
      return el.label;
    case "notification":
      return el.title;
    case "counter":
      return `${el.prefix ?? ""}${el.to}${el.suffix ?? ""}${el.label ? ` · ${el.label}` : ""}`;
    case "chart":
      return `${el.kind} · ${el.data.map((d) => d.label).join(", ")}`;
    case "diagram":
      return `${el.center ? `${el.center.label} · ` : ""}${el.nodes.map((n) => n.label).join(", ")}`;
    case "image":
    case "video":
      return el.assetId;
    case "logo":
      return el.text ?? "Brand logo";
    case "browser":
    case "phone":
    case "desktop":
      return `${el.screen?.kind ?? "dashboard"} screen`;
    case "dashboard":
      return el.title ?? "Dashboard";
    case "icon":
      return el.name;
    case "progress":
      return `${el.value}%${el.label ? ` · ${el.label}` : ""}`;
    default:
      return "";
  }
}

export function elementIcon(type: ElementType): LucideIcon {
  switch (type) {
    case "image":
      return ImageIcon;
    case "video":
      return Film;
    case "text":
    case "kinetic":
    case "captions":
    case "badge":
      return Type;
    case "logo":
      return Hexagon;
    case "card":
    case "cards":
      return LayoutGrid;
    case "browser":
    case "phone":
    case "desktop":
    case "dashboard":
      return Monitor;
    case "button":
    case "notification":
    case "cursor":
      return MousePointer2;
    case "line":
    case "circle":
    case "rect":
    case "grid":
      return Shapes;
    case "chart":
    case "counter":
    case "diagram":
    case "progress":
    case "list":
      return Activity;
    case "icon":
      return Star;
    case "group":
      return Group;
    default:
      return Square;
  }
}

/** “video_1”, or “shot_b/#2” for an element without an id. */
export function elementName(el: SceneElement, ref: ElementRef): string {
  return el.id ?? `${ref.shotId ? `${ref.shotId}/` : ""}#${ref.index + 1}${ref.child === undefined ? "" : `.${ref.child + 1}`}`;
}
