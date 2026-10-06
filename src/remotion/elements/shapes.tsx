import { useCurrentFrame } from "remotion";
import type { ElementOf } from "../../core/spec/scene";
import { alpha, resolveColor } from "../engine/color";
import { useScene } from "../engine/context";
import { clamp01, ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { ElementBox, surfaceStyle } from "../engine/layout";
import { useSvgId } from "./shared";

/** Graphics: Line (draw, curve, arrow), Circle, Rect, Grid, Progress (bar/ring). */

export function LineElementView({ element }: { element: ElementOf<"line"> }) {
  const ctx = useScene();
  const uid = useSvgId("line");
  const { width: W, height: H, u, design } = ctx;
  const color = resolveColor(element.color, design, "primary");
  const sw = u(element.strokeWidth ?? 4);
  const x1 = (element.from[0] / 100) * W;
  const y1 = (element.from[1] / 100) * H;
  const x2 = (element.to[0] / 100) * W;
  const y2 = (element.to[1] / 100) * H;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const curve = element.curve ?? 0;
  const cx = (x1 + x2) / 2 + (len ? (-(y2 - y1) / len) * curve * len * 0.5 : 0);
  const cy = (y1 + y2) / 2 + (len ? ((x2 - x1) / len) * curve * len * 0.5 : 0);
  const d = curve ? `M${x1},${y1} Q${cx},${cy} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
  const angle = curve ? Math.atan2(y2 - cy, x2 - cx) : Math.atan2(y2 - y1, x2 - x1);
  const head = sw * 3.4;
  const arrow = [
    [x2 + Math.cos(angle) * sw * 0.6, y2 + Math.sin(angle) * sw * 0.6],
    [x2 - head * Math.cos(angle) + head * 0.62 * Math.sin(angle), y2 - head * Math.sin(angle) - head * 0.62 * Math.cos(angle)],
    [x2 - head * Math.cos(angle) - head * 0.62 * Math.sin(angle), y2 - head * Math.sin(angle) + head * 0.62 * Math.cos(angle)],
  ]
    .map((p) => p.map((n) => n.toFixed(1)).join(","))
    .join(" ");
  return (
    <ElementBox element={{ ...element, x: 50, y: 50, anchor: "center" }} width={W} height={H}>
      {(motion) => {
        const drawP = element.enter?.type === "draw" ? clamp01(motion.enterProgress) : 1;
        return (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible", display: "block" }}>
            <defs>
              <mask id={`${uid}-m`} maskUnits="userSpaceOnUse" x={-W} y={-H} width={W * 3} height={H * 3}>
                <path d={d} fill="none" stroke="#FFFFFF" strokeWidth={sw * 2} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawP} />
              </mask>
            </defs>
            <path d={d} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={element.dashed ? `${sw * 2.5} ${sw * 2}` : undefined} mask={drawP < 1 ? `url(#${uid}-m)` : undefined} />
            {element.arrow && drawP > 0.9 ? <polygon points={arrow} fill={color} opacity={clamp01((drawP - 0.9) / 0.1)} /> : null}
          </svg>
        );
      }}
    </ElementBox>
  );
}

export function CircleElementView({ element }: { element: ElementOf<"circle"> }) {
  const ctx = useScene();
  const { u, design } = ctx;
  const size = u(element.size ?? 160);
  const color = resolveColor(element.color, design, "primary");
  const sw = u(element.strokeWidth ?? 4);
  const c = size / 2;
  return (
    <ElementBox element={element} width={size} height={size}>
      {(motion) => {
        const drawP = element.enter?.type === "draw" ? clamp01(motion.enterProgress) : 1;
        return (
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: "visible", display: "block" }}>
            {element.fill ? (
              <circle cx={c} cy={c} r={c * (0.6 + 0.4 * drawP)} fill={color} opacity={drawP} />
            ) : (
              <circle cx={c} cy={c} r={Math.max(0, c - sw / 2)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawP} transform={`rotate(-90 ${c} ${c})`} />
            )}
          </svg>
        );
      }}
    </ElementBox>
  );
}

export function RectElementView({ element }: { element: ElementOf<"rect"> }) {
  const ctx = useScene();
  const { u, design } = ctx;
  const w = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * 0.3;
  const h = element.height !== undefined ? (element.height / 100) * ctx.height : ctx.height * 0.2;
  const fill = element.fill ?? true;
  const color = resolveColor(element.color, design, fill ? "surface" : "primary");
  const sw = u(element.strokeWidth ?? 3);
  const radius = u(element.radius ?? design.shape.radius);
  const draw = element.enter?.type === "draw";
  return (
    <ElementBox element={element} width={w} height={h}>
      {(motion) => {
        const drawP = draw ? clamp01(motion.enterProgress) : 1;
        if (fill && !draw) {
          return (
            <div
              style={{
                width: "100%",
                height: "100%",
                ...(element.style ? surfaceStyle(element, ctx) : {}),
                borderRadius: radius,
                background: element.style?.glass && !element.color ? alpha(design.colors.surface, 0.5) : color,
              }}
            />
          );
        }
        return (
          <svg width={w} height={h} style={{ overflow: "visible", display: "block" }}>
            <rect
              x={sw / 2}
              y={sw / 2}
              width={Math.max(0, w - sw)}
              height={Math.max(0, h - sw)}
              rx={radius}
              fill={fill ? color : "none"}
              fillOpacity={fill ? drawP : undefined}
              stroke={fill ? undefined : color}
              strokeWidth={fill ? undefined : sw}
              pathLength={1}
              strokeDasharray={fill ? undefined : "1 1"}
              strokeDashoffset={fill ? undefined : 1 - drawP}
            />
          </svg>
        );
      }}
    </ElementBox>
  );
}

export function GridElementView({ element }: { element: ElementOf<"grid"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u, design } = ctx;
  const w = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width;
  const h = element.height !== undefined ? (element.height / 100) * ctx.height : ctx.height;
  const spacing = u(element.spacing ?? 72);
  const dots = element.variant === "dots";
  const color = alpha(resolveColor(element.color, design, "text"), dots ? 0.22 : 0.09);
  const pattern = dots
    ? `radial-gradient(${color} ${Math.max(1, u(2.5))}px, transparent ${Math.max(1, u(2.5)) + 0.5}px)`
    : `linear-gradient(${color} ${Math.max(1, u(1.5))}px, transparent ${Math.max(1, u(1.5))}px), linear-gradient(90deg, ${color} ${Math.max(1, u(1.5))}px, transparent ${Math.max(1, u(1.5))}px)`;
  const drift = element.perspective ? ((frame / ctx.fps) * u(26)) % spacing : 0;
  const mask = "radial-gradient(ellipse at center, black 35%, transparent 75%)";
  return (
    <ElementBox element={element} width={w} height={h}>
      {() => (
        <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", perspective: element.perspective ? u(900) : undefined, WebkitMaskImage: mask, maskImage: mask }}>
          <div
            style={{
              position: "absolute",
              inset: element.perspective ? "-40% -60% -10% -60%" : 0,
              backgroundImage: pattern,
              backgroundSize: `${spacing}px ${spacing}px`,
              backgroundPosition: `0px ${drift}px`,
              transform: element.perspective ? "rotateX(62deg)" : undefined,
              transformOrigin: "50% 100%",
            }}
          />
        </div>
      )}
    </ElementBox>
  );
}

export function ProgressElementView({ element }: { element: ElementOf<"progress"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u, design } = ctx;
  const variant = element.variant ?? "bar";
  const color = resolveColor(element.color, design, "primary");
  const from = element.from ?? 0;
  const showValue = element.showValue ?? true;
  const body = fontStack(design.typography.bodyFont);
  const heading = fontStack(design.typography.headingFont);
  const ringSize = u(element.size ?? 280);
  const barWidth = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.8 : 0.5);
  return (
    <ElementBox element={element} width={variant === "ring" ? ringSize : barWidth}>
      {(motion) => {
        const start = element.animateAt ? ctx.frameAt(element.animateAt) : motion.enterFrame + ctx.frames(0.15);
        const p = ease("expoOut", (frame - start) / Math.max(1, ctx.frames(1.4)));
        const value = from + (element.value - from) * p;
        if (variant === "ring") {
          const sw = ringSize * 0.085;
          const c = ringSize / 2;
          const r = c - sw / 2;
          return (
            <div style={{ position: "relative", width: ringSize, height: ringSize }}>
              <svg width={ringSize} height={ringSize} style={{ display: "block", overflow: "visible" }}>
                <circle cx={c} cy={c} r={r} fill="none" stroke={alpha(design.colors.text, 0.1)} strokeWidth={sw} />
                <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" pathLength={100} strokeDasharray="100 100" strokeDashoffset={100 - value} transform={`rotate(-90 ${c} ${c})`} style={{ filter: `drop-shadow(0 0 ${u(12)}px ${alpha(color, 0.5)})` }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                {showValue ? <div style={{ fontFamily: heading, fontWeight: 800, fontSize: ringSize * 0.24, color: design.colors.text, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{Math.round(value)}%</div> : null}
                {element.label ? <div style={{ fontFamily: body, fontSize: ringSize * 0.075, color: design.colors.muted, marginTop: ringSize * 0.03 }}>{element.label}</div> : null}
              </div>
            </div>
          );
        }
        return (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: u(14) }}>
            {element.label || showValue ? (
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: body, fontSize: u(30), color: design.colors.text, fontWeight: 600 }}>
                <span>{element.label}</span>
                {showValue ? <span style={{ fontVariantNumeric: "tabular-nums", color }}>{Math.round(value)}%</span> : null}
              </div>
            ) : null}
            <div style={{ height: u(element.size ?? 22), borderRadius: 999, background: alpha(design.colors.text, 0.1), overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", borderRadius: 999, background: `linear-gradient(90deg, ${alpha(color, 0.7)}, ${color})`, boxShadow: `0 0 ${u(18)}px ${alpha(color, 0.55)}` }} />
            </div>
          </div>
        );
      }}
    </ElementBox>
  );
}
