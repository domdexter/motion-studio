import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import type { ElementOf } from "../../core/spec/scene";
import { alpha, mix, readableOn, resolveColor, SHADOWS } from "../engine/color";
import { useScene } from "../engine/context";
import { bell, ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { getIcon, StudioIcon } from "../engine/icon";
import { ElementBox } from "../engine/layout";

/** Interactive UI: Button (with press), Notification (toast/ios/banner), Cursor (path + clicks). */

export function ButtonElementView({ element }: { element: ElementOf<"button"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { design, u } = ctx;
  const variant = element.variant ?? "primary";
  const k = element.size === "sm" ? 0.72 : element.size === "md" ? 0.86 : 1;
  const fontSize = u(34 * k);
  const base = resolveColor(element.style?.background, design, "primary");
  const pressFrame = element.pressAt ? ctx.frameAt(element.pressAt) : null;
  const pt = pressFrame === null ? -1 : (frame - pressFrame) / Math.max(1, ctx.frames(0.55));
  const pressing = pt >= 0 && pt <= 1;
  const pressScale = pressing ? 1 - 0.08 * bell(Math.min(1, pt * 1.8)) : 1;
  const textColor =
    variant === "primary" ? resolveColor(element.style?.color, design, "white") === "#FFFFFF" && !element.style?.color ? readableOn(base, design) : resolveColor(element.style?.color, design) : variant === "secondary" ? resolveColor(element.style?.color, design, "text") : resolveColor(element.style?.color, design, "primary");
  const style: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: u(14 * k),
    padding: `${u(24 * k)}px ${u(46 * k)}px`,
    borderRadius: u(element.style?.radius ?? Math.max(12, design.shape.radius * 1.2)),
    fontFamily: fontStack(design.typography.bodyFont),
    fontWeight: 600,
    fontSize,
    color: textColor,
    whiteSpace: "nowrap",
    overflow: "hidden",
    background: variant === "primary" ? `linear-gradient(180deg, ${mix(base, "#FFFFFF", 0.14)}, ${base})` : variant === "secondary" ? design.colors.surface : "transparent",
    border: variant === "outline" ? `${Math.max(1, u(2))}px solid ${alpha(textColor, 0.7)}` : variant === "secondary" ? `1px solid ${alpha(design.colors.text, 0.12)}` : "none",
    boxShadow: variant === "primary" ? `0 ${u(14)}px ${u(36)}px ${alpha(base, 0.4)}, inset 0 1px 0 rgba(255,255,255,0.25)` : variant === "secondary" ? SHADOWS.soft(u) : undefined,
    transform: `scale(${pressScale})`,
  };
  return (
    <ElementBox element={element}>
      {() => (
        <div style={style}>
          {pressing ? (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: u(120),
                height: u(120),
                borderRadius: 999,
                background: alpha(variant === "primary" ? "#FFFFFF" : base, 0.35),
                transform: `translate(-50%, -50%) scale(${0.2 + pt * 4})`,
                opacity: 1 - pt,
              }}
            />
          ) : null}
          {element.icon ? <StudioIcon name={element.icon} size={fontSize * 1.05} color={textColor} strokeWidth={2.2} /> : null}
          <span style={{ position: "relative" }}>{element.label}</span>
        </div>
      )}
    </ElementBox>
  );
}

export function NotificationElementView({ element }: { element: ElementOf<"notification"> }) {
  const ctx = useScene();
  const { design, u } = ctx;
  const variant = element.variant ?? "toast";
  const accent = resolveColor(element.style?.color, design, "primary");
  const body = fontStack(design.typography.bodyFont);
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : u(variant === "banner" ? 960 : variant === "ios" ? 680 : 640);
  const icon = element.icon ?? "bell";
  const text = design.colors.text;
  const muted = design.colors.muted;
  const clamp2: CSSProperties = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

  if (variant === "ios") {
    return (
      <ElementBox element={element} width={width}>
        {() => (
          <div style={{ width, padding: u(26), borderRadius: u(40), background: alpha(design.colors.surface, 0.72), backdropFilter: `blur(${u(30)}px) saturate(1.4)`, border: `1px solid ${alpha(text, 0.1)}`, boxShadow: SHADOWS.deep(u), display: "flex", gap: u(20), alignItems: "flex-start", fontFamily: body }}>
            <div style={{ width: u(64), height: u(64), borderRadius: u(16), background: `linear-gradient(145deg, ${accent}, ${alpha(accent, 0.7)})`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <StudioIcon name={icon} size={u(36)} color={readableOn(accent, design)} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: u(21), color: muted, fontWeight: 500, letterSpacing: "0.03em" }}>
                <span style={{ textTransform: "uppercase" }}>{element.app ?? (ctx.brand.brandName || "App")}</span>
                <span>{element.time ?? "now"}</span>
              </div>
              <div style={{ fontSize: u(29), fontWeight: 600, color: text, marginTop: u(6) }}>{element.title}</div>
              {element.body ? <div style={{ fontSize: u(26), color: muted, lineHeight: 1.35, marginTop: u(4), ...clamp2 }}>{element.body}</div> : null}
            </div>
          </div>
        )}
      </ElementBox>
    );
  }

  if (variant === "banner") {
    return (
      <ElementBox element={element} width={width}>
        {() => (
          <div style={{ width, display: "flex", alignItems: "center", gap: u(22), padding: `${u(22)}px ${u(30)}px`, borderRadius: u(22), background: design.colors.surface, borderLeft: `${u(8)}px solid ${accent}`, boxShadow: SHADOWS.medium(u), fontFamily: body }}>
            <StudioIcon name={icon} size={u(40)} color={accent} strokeWidth={2} />
            <div style={{ flex: 1, minWidth: 0, fontSize: u(28), color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span style={{ fontWeight: 700 }}>{element.title}</span>
              {element.body ? <span style={{ color: muted }}> — {element.body}</span> : null}
            </div>
            {element.time ? <span style={{ fontSize: u(22), color: muted }}>{element.time}</span> : null}
          </div>
        )}
      </ElementBox>
    );
  }

  return (
    <ElementBox element={element} width={width}>
      {() => (
        <div style={{ width, display: "flex", gap: u(22), alignItems: "flex-start", padding: u(28), borderRadius: u(26), background: design.colors.surface, border: `1px solid ${alpha(text, 0.1)}`, boxShadow: SHADOWS.deep(u), fontFamily: body }}>
          <div style={{ width: u(66), height: u(66), borderRadius: 999, background: alpha(accent, 0.16), border: `1px solid ${alpha(accent, 0.35)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <StudioIcon name={icon} size={u(34)} color={accent} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: u(16), alignItems: "baseline" }}>
              <div style={{ fontSize: u(30), fontWeight: 650, color: text }}>{element.title}</div>
              {element.time ? <div style={{ fontSize: u(22), color: muted, whiteSpace: "nowrap" }}>{element.time}</div> : null}
            </div>
            {element.body ? <div style={{ fontSize: u(26), color: muted, lineHeight: 1.4, marginTop: u(6), ...clamp2 }}>{element.body}</div> : null}
          </div>
        </div>
      )}
    </ElementBox>
  );
}

const ARROW_HOTSPOT = { x: 4 / 24, y: 2 / 24 };
const HAND_HOTSPOT = { x: 0.42, y: 0.08 };

export function CursorElementView({ element }: { element: ElementOf<"cursor"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u } = ctx;
  const points = element.path.map((p) => ({ x: p.x, y: p.y, f: ctx.frameAt(p.at) })).sort((a, b) => a.f - b.f);
  let x = points[0].x;
  let y = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (frame >= cur.f) {
      x = cur.x;
      y = cur.y;
      continue;
    }
    const travel = Math.max(1, Math.min(ctx.frames(0.85), cur.f - prev.f));
    const t = ease("easeInOut", (frame - (cur.f - travel)) / travel);
    // A gentle arc reads as a human hand rather than a robot.
    const dx = ((cur.x - prev.x) * ctx.width) / 100;
    const dy = ((cur.y - prev.y) * ctx.height) / 100;
    const len = Math.hypot(dx, dy);
    const arc = Math.sin(Math.PI * t) * Math.min(len * 0.08, u(60));
    x = prev.x + (cur.x - prev.x) * t + (len ? ((-dy / len) * arc * 100) / ctx.width : 0);
    y = prev.y + (cur.y - prev.y) * t + (len ? ((dx / len) * arc * 100) / ctx.height : 0);
    break;
  }

  let press = 0;
  let ripple: number | null = null;
  for (const click of element.clicks ?? []) {
    const cf = ctx.frameAt(click);
    const ct = (frame - cf) / Math.max(1, ctx.frames(0.55));
    if (ct >= 0 && ct <= 1) {
      press = Math.max(press, bell(Math.min(1, ct * 2.2)));
      ripple = ct;
    }
  }

  const size = u(58);
  const hand = element.variant === "hand";
  const hot = hand ? HAND_HOTSPOT : ARROW_HOTSPOT;
  const Pointer = getIcon("pointer");
  return (
    <ElementBox element={{ ...element, x, y, anchor: "top-left" }} width={size} height={size}>
      {() => (
        <div style={{ position: "relative", width: size, height: size, transform: `translate(${-hot.x * size}px, ${-hot.y * size}px)` }}>
          {ripple !== null ? (
            <div
              style={{
                position: "absolute",
                left: hot.x * size - u(45),
                top: hot.y * size - u(45),
                width: u(90),
                height: u(90),
                borderRadius: 999,
                border: `${u(4)}px solid ${alpha(ctx.design.colors.primary, 0.9)}`,
                transform: `scale(${0.2 + ripple * 1.1})`,
                opacity: 1 - ripple,
              }}
            />
          ) : null}
          <div style={{ transform: `scale(${1 - 0.16 * press})`, transformOrigin: `${hot.x * 100}% ${hot.y * 100}%`, filter: `drop-shadow(0 ${u(6)}px ${u(10)}px rgba(0,0,0,0.35))` }}>
            {hand ? (
              <Pointer size={size} color="#111111" fill="#FFFFFF" strokeWidth={1.6} />
            ) : (
              <svg width={size} height={size} viewBox="0 0 24 24">
                <path d="M4 2 L4 20.5 L8.6 16.4 L11.6 23 L14.6 21.6 L11.7 15.2 L18 15.2 Z" fill="#FFFFFF" stroke="#111111" strokeWidth={1.3} strokeLinejoin="round" />
              </svg>
            )}
          </div>
        </div>
      )}
    </ElementBox>
  );
}
