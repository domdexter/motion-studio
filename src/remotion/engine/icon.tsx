import { icons, type LucideIcon } from "lucide-react";

const toPascal = (name: string) =>
  name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");

const ALIASES: Record<string, string> = {
  "bar-chart": "chart-column",
  "bar-chart-3": "chart-column",
  "check-circle": "circle-check",
  "check-circle-2": "circle-check",
  dollar: "dollar-sign",
  money: "wallet",
  email: "mail",
  chat: "message-square",
  dashboard: "layout-dashboard",
  ai: "sparkles",
};

/** Looks up a lucide icon by kebab-case name (with a safe fallback). */
export function getIcon(name: string | undefined, fallback = "circle"): LucideIcon {
  const lookup = (n: string) => (icons as Record<string, LucideIcon>)[toPascal(ALIASES[n] ?? n)];
  return (name ? lookup(name) : undefined) ?? lookup(fallback) ?? (icons as Record<string, LucideIcon>).Circle;
}

export function StudioIcon({ name, size, color, strokeWidth = 1.8, style }: { name?: string; size: number; color: string; strokeWidth?: number; style?: React.CSSProperties }) {
  const Icon = getIcon(name);
  return <Icon size={size} color={color} strokeWidth={strokeWidth} style={{ display: "block", flexShrink: 0, ...style }} />;
}
