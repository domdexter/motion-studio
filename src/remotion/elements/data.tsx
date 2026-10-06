import type { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import type { ElementOf } from "../../core/spec/scene";
import { alpha, readableOn, resolveColor } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { bell, clamp01, ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { StudioIcon } from "../engine/icon";
import { ElementBox } from "../engine/layout";
import { decimalsOf, formatNumber, itemMotion, seriesColor, smoothPath, useSvgId, withoutEnter } from "./shared";

/** Data + structure: Chart (bar/line/area/donut), Counter, Diagram (hub/flow/cycle/grid), Icon, List. */

const CURRENCY = new Set(["$", "€", "£", "¥", "₹"]);

function withUnit(value: number, decimals: number, unit?: string): string {
  const n = formatNumber(value, decimals);
  if (!unit) return n;
  if (CURRENCY.has(unit)) return `${unit}${n}`;
  return unit.length > 2 ? `${n} ${unit}` : `${n}${unit}`;
}

// ---------------------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------------------

interface ChartKit {
  element: ElementOf<"chart">;
  w: number;
  h: number;
  start: number;
  frame: number;
  ctx: SceneContextValue;
  decimals: number;
  colorFor: (i: number) => string;
  uid: string;
}

function BarChart({ k }: { k: ChartKit }) {
  const { element, h, start, frame, ctx, decimals, colorFor } = k;
  const { u, design } = ctx;
  const data = element.data;
  const n = data.length;
  const hl = element.highlight;
  const max = Math.max(0, ...data.map((d) => d.value)) || 1;
  const showValues = element.showValues ?? true;
  const showLabels = element.showLabels ?? true;
  const gap = u(n > 10 ? 10 : n > 6 ? 18 : 28);
  const labelH = showLabels ? u(54) : 0;
  const valueSpace = showValues ? u(60) : 0;
  const plotH = Math.max(u(40), h - labelH - valueSpace);
  const stagger = ctx.frames(element.enter?.stagger ?? 0.07);
  const heading = fontStack(design.typography.headingFont);
  const body = fontStack(design.typography.bodyFont);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ height: valueSpace + plotH, display: "flex", alignItems: "flex-end", gap, borderBottom: `${Math.max(1, u(2))}px solid ${alpha(design.colors.text, 0.14)}` }}>
        {data.map((d, i) => {
          const p = ease("expoOut", (frame - start - i * stagger) / Math.max(1, ctx.frames(0.9)));
          const barH = (Math.max(0, d.value) / max) * plotH * p;
          const color = colorFor(i);
          const dim = hl !== undefined && i !== hl;
          return (
            <div key={i} style={{ flex: 1, height: "100%", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: barH,
                  borderRadius: `${u(12)}px ${u(12)}px ${u(3)}px ${u(3)}px`,
                  background: dim ? color : `linear-gradient(180deg, ${color}, ${alpha(color, 0.6)})`,
                  boxShadow: i === hl ? `0 0 ${u(32)}px ${alpha(color, 0.45)}` : undefined,
                }}
              />
              {showValues ? (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: barH + u(12),
                    transform: "translateX(-50%)",
                    fontFamily: heading,
                    fontWeight: 700,
                    fontSize: u(n > 8 ? 24 : 32),
                    color: dim ? design.colors.muted : design.colors.text,
                    opacity: clamp01(p * 2),
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {withUnit(d.value * clamp01(p), decimals, element.unit)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {showLabels ? (
        <div style={{ height: labelH, display: "flex", gap, alignItems: "center" }}>
          {data.map((d, i) => (
            <div
              key={i}
              style={{ flex: 1, minWidth: 0, textAlign: "center", fontFamily: body, fontSize: u(n > 8 ? 20 : 25), color: hl === i ? design.colors.text : design.colors.muted, fontWeight: hl === i ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {d.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LineChart({ k }: { k: ChartKit }) {
  const { element, w, h, start, frame, ctx, decimals, uid } = k;
  const { u, design } = ctx;
  const data = element.data;
  const n = data.length;
  const color = resolveColor(element.color ?? data[0]?.color, design, "primary");
  const showValues = element.showValues ?? n <= 8;
  const showLabels = element.showLabels ?? true;
  const labelH = showLabels ? u(54) : 0;
  const top = showValues ? u(66) : u(20);
  const plotH = h - labelH;
  const padX = Math.min(u(50), w / (n * 2));
  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const bottom = plotH - u(8);
  const pts = data.map((d, i) => [n === 1 ? w / 2 : padX + (i / (n - 1)) * (w - padX * 2), top + (1 - (d.value - min) / range) * (bottom - top)] as [number, number]);
  const line = smoothPath(pts);
  const draw = ease("easeInOut", (frame - start) / Math.max(1, ctx.frames(1.4)));
  const drawX = n > 1 ? pts[0][0] + (pts[n - 1][0] - pts[0][0]) * draw : w;
  const sw = u(6);
  const body = fontStack(design.typography.bodyFont);
  const heading = fontStack(design.typography.headingFont);
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      <svg width={w} height={plotH} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.38} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <clipPath id={`${uid}-clip`}>
            <rect x={-sw * 2} y={-u(120)} width={Math.max(0, drawX + sw * 2)} height={plotH + u(240)} />
          </clipPath>
        </defs>
        {[0, 0.5, 1].map((g) => {
          const y = top + g * (bottom - top);
          return <line key={g} x1={0} x2={w} y1={y} y2={y} stroke={alpha(design.colors.text, g === 1 ? 0.14 : 0.06)} strokeWidth={Math.max(1, u(2))} strokeDasharray={g === 1 ? undefined : `${u(8)} ${u(10)}`} />;
        })}
        <g clipPath={`url(#${uid}-clip)`}>
          {element.kind === "area" && n > 1 ? <path d={`${line} L${pts[n - 1][0]},${bottom} L${pts[0][0]},${bottom} Z`} fill={`url(#${uid}-fill)`} /> : null}
          <path d={line} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 ${u(6)}px ${u(14)}px ${alpha(color, 0.45)})` }} />
        </g>
        {pts.map(([x, y], i) => {
          const reached = clamp01((drawX - x) / Math.max(1, u(40)));
          if (reached <= 0 && !(i === 0 && draw > 0)) return null;
          const isHl = element.highlight === i;
          return <circle key={i} cx={x} cy={y} r={u(isHl ? 13 : 9) * ease("backOut", Math.max(reached, i === 0 ? draw * 4 : 0))} fill={design.colors.background} stroke={color} strokeWidth={u(isHl ? 6 : 4)} />;
        })}
      </svg>
      {showValues
        ? pts.map(([x, y], i) => (
            <div
              key={i}
              style={{ position: "absolute", left: x, top: y - u(22), transform: "translate(-50%, -100%)", fontFamily: heading, fontWeight: 700, fontSize: u(26), color: element.highlight === i ? color : design.colors.text, opacity: clamp01((drawX - x) / Math.max(1, u(40))), whiteSpace: "nowrap" }}
            >
              {withUnit(data[i].value, decimals, element.unit)}
            </div>
          ))
        : null}
      {showLabels
        ? pts.map(([x], i) => (
            <div key={i} style={{ position: "absolute", left: x, top: plotH + u(14), transform: "translateX(-50%)", fontFamily: body, fontSize: u(22), color: design.colors.muted, whiteSpace: "nowrap" }}>
              {data[i].label}
            </div>
          ))
        : null}
    </div>
  );
}

function DonutChart({ k }: { k: ChartKit }) {
  const { element, w, h, start, frame, ctx, decimals, colorFor } = k;
  const { u, design } = ctx;
  const data = element.data;
  const showLabels = element.showLabels ?? true;
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const horizontal = showLabels && w > h * 1.3;
  const size = showLabels ? (horizontal ? Math.min(h, w * 0.5) : Math.min(w, h * 0.62)) : Math.min(w, h);
  const sw = size * 0.14;
  const c = size / 2;
  const r = c - sw / 2 - u(6);
  const sweep = ease("easeInOut", (frame - start) / Math.max(1, ctx.frames(1.3)));
  const hl = element.highlight;
  let acc = 0;
  const segments = data.map((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const seg = { i, from: acc, frac };
    acc += frac;
    return seg;
  });
  const centerValue = hl !== undefined && data[hl] ? data[hl].value : total;
  const centerLabel = hl !== undefined && data[hl] ? data[hl].label : "Total";
  const heading = fontStack(design.typography.headingFont);
  const body = fontStack(design.typography.bodyFont);
  return (
    <div style={{ width: w, height: h, display: "flex", flexDirection: horizontal ? "row" : "column", alignItems: "center", justifyContent: "center", gap: u(40) }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ overflow: "visible", display: "block" }}>
          <circle cx={c} cy={c} r={r} fill="none" stroke={alpha(design.colors.text, 0.07)} strokeWidth={sw} />
          {segments.map((s) => {
            const visible = Math.max(0, Math.min(s.frac, sweep - s.from));
            const gapF = segments.length > 1 ? Math.min(0.006, visible / 2) : 0;
            const len = Math.max(0, visible - gapF);
            if (len <= 0) return null;
            return (
              <circle
                key={s.i}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={colorFor(s.i)}
                strokeWidth={hl === s.i ? sw * 1.18 : sw}
                pathLength={1}
                strokeDasharray={`${len} ${1 - len}`}
                strokeDashoffset={-s.from}
                transform={`rotate(-90 ${c} ${c})`}
                opacity={hl !== undefined && hl !== s.i ? 0.45 : 1}
              />
            );
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: heading, fontWeight: 800, fontSize: size * 0.17, color: design.colors.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{withUnit(centerValue * clamp01(sweep), decimals, element.unit)}</div>
          <div style={{ fontFamily: body, fontSize: size * 0.062, color: design.colors.muted, marginTop: size * 0.02 }}>{centerLabel}</div>
        </div>
      </div>
      {showLabels ? (
        <div style={{ display: "flex", flexDirection: "column", gap: u(16) }}>
          {data.map((d, i) => {
            const m = clamp01((sweep - segments[i].from) / Math.max(0.001, segments[i].frac));
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: u(14), opacity: 0.25 + 0.75 * m, fontFamily: body, fontSize: u(28), color: design.colors.text }}>
                <span style={{ width: u(18), height: u(18), borderRadius: u(5), background: colorFor(i), flexShrink: 0 }} />
                <span style={{ flex: 1, whiteSpace: "nowrap" }}>{d.label}</span>
                <span style={{ color: design.colors.muted, fontVariantNumeric: "tabular-nums", marginLeft: u(18) }}>{Math.round((Math.max(0, d.value) / total) * 100)}%</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ChartElementView({ element }: { element: ElementOf<"chart"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const uid = useSvgId("chart");
  const { design } = ctx;
  const w = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.86 : 0.58);
  const h = element.height !== undefined ? (element.height / 100) * ctx.height : ctx.height * (ctx.portrait ? 0.34 : 0.52);
  const hl = element.highlight;
  const decimals = Math.max(0, ...element.data.map((d) => decimalsOf(d.value)));
  const colorFor = (i: number) => {
    const d = element.data[i];
    if (d?.color) return resolveColor(d.color, design);
    if (element.kind === "donut") return seriesColor(ctx, i);
    if (hl !== undefined) return i === hl ? resolveColor(element.color, design, "primary") : alpha(design.colors.text, 0.22);
    return resolveColor(element.color, design, "primary");
  };
  return (
    <ElementBox element={element} width={w} height={h}>
      {(motion) => {
        const start = element.animateAt ? ctx.frameAt(element.animateAt) : motion.enterFrame + ctx.frames(0.1);
        const k: ChartKit = { element, w, h, start, frame, ctx, decimals, colorFor, uid };
        if (element.kind === "bar") return <BarChart k={k} />;
        if (element.kind === "donut") return <DonutChart k={k} />;
        return <LineChart k={k} />;
      }}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------------------

export function CounterElementView({ element }: { element: ElementOf<"counter"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u, design } = ctx;
  const size = u(element.size ?? 180);
  const color = resolveColor(element.color, design, "text");
  const decimals = element.decimals ?? 0;
  const from = element.from ?? 0;
  const prefix = element.prefix ?? "";
  const suffix = element.suffix ?? "";
  const widest = [from, element.to].map((v) => formatNumber(v, decimals)).sort((a, b) => b.length - a.length)[0];
  return (
    <ElementBox element={element}>
      {(motion) => {
        const start = element.animateAt ? ctx.frameAt(element.animateAt) : motion.enterFrame;
        const p = ease("expoOut", (frame - start) / Math.max(1, ctx.frames(element.countDuration ?? 1.6)));
        const value = from + (element.to - from) * p;
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size * 0.06 }}>
            <div style={{ position: "relative", fontFamily: fontStack(design.typography.headingFont), fontWeight: 800, fontSize: size, lineHeight: 1, letterSpacing: "-0.04em", color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <span style={{ visibility: "hidden" }}>
                {prefix}
                {widest}
                {suffix}
              </span>
              <span style={{ position: "absolute", inset: 0, textAlign: "center" }}>
                {prefix}
                {formatNumber(value, decimals)}
                {suffix}
              </span>
            </div>
            {element.label ? <div style={{ fontFamily: fontStack(design.typography.bodyFont), fontSize: Math.max(u(24), size * 0.2), color: design.colors.muted, fontWeight: 500 }}>{element.label}</div> : null}
          </div>
        );
      }}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Diagram
// ---------------------------------------------------------------------------------------

type NodeRef = number | "c";

function DiagramNode({ x, y, label, icon, color, big, style, ctx }: { x: number; y: number; label: string; icon?: string; color: string; big?: boolean; style: CSSProperties; ctx: SceneContextValue }) {
  const { u, design } = ctx;
  const fg = big ? readableOn(color, design) : design.colors.text;
  return (
    <div style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", zIndex: big ? 2 : 1 }}>
      <div style={style}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: u(14),
            height: big ? u(110) : u(88),
            padding: `0 ${u(big ? 36 : 28)}px 0 ${u(icon ? (big ? 16 : 12) : big ? 36 : 28)}px`,
            borderRadius: 999,
            whiteSpace: "nowrap",
            background: big ? `linear-gradient(135deg, ${color}, ${alpha(color, 0.72)})` : alpha(design.colors.surface, 0.94),
            border: `${Math.max(1, u(2))}px solid ${big ? "rgba(255,255,255,0.2)" : alpha(color, 0.35)}`,
            boxShadow: big ? `0 0 ${u(60)}px ${alpha(color, 0.45)}, 0 ${u(20)}px ${u(50)}px rgba(0,0,0,0.35)` : `0 ${u(14)}px ${u(34)}px rgba(0,0,0,0.25)`,
            fontFamily: fontStack(design.typography.bodyFont),
            fontSize: u(big ? 34 : 28),
            fontWeight: 600,
            color: fg,
          }}
        >
          {icon ? (
            <div style={{ width: u(big ? 78 : 64), height: u(big ? 78 : 64), borderRadius: 999, background: big ? "rgba(255,255,255,0.18)" : alpha(color, 0.16), display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StudioIcon name={icon} size={u(big ? 40 : 32)} color={big ? fg : color} />
            </div>
          ) : null}
          {label}
        </div>
      </div>
    </div>
  );
}

export function DiagramElementView({ element }: { element: ElementOf<"diagram"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u, design } = ctx;
  const layout = element.layout ?? (element.center ? "hub" : "flow");
  const W = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.9 : 0.8);
  const H = element.height !== undefined ? (element.height / 100) * ctx.height : ctx.height * (ctx.portrait ? 0.56 : 0.7);
  const color = resolveColor(element.color, design, "primary");
  const nodes = element.nodes;
  const n = nodes.length;
  const nodeH = u(88);
  const centerH = u(110);
  const center = layout === "hub" ? (element.center ?? { label: ctx.brand.brandName || "Hub", icon: "sparkles" }) : element.center;
  const halfWidth = (label: string, icon: string | undefined, big = false) => (label.length * u(big ? 34 : 28) * 0.56 + (icon ? u(big ? 124 : 104) : u(big ? 72 : 56))) / 2;

  const pos: { x: number; y: number }[] = [];
  const centerPos = center && (layout === "hub" || layout === "cycle") ? { x: W / 2, y: H / 2 } : null;
  const custom = (element.edges ?? []).filter(([a, b]) => a < n && b < n && a !== b).map(([a, b]) => ({ from: a as NodeRef, to: b as NodeRef, arrow: true }));
  let edges: { from: NodeRef; to: NodeRef; arrow: boolean }[] = [];

  if (layout === "hub" || layout === "cycle") {
    const maxHalf = Math.max(...nodes.map((nd) => halfWidth(nd.label, nd.icon)));
    const rx = Math.max(u(140), W / 2 - maxHalf - u(8));
    const ry = Math.max(u(110), H / 2 - nodeH / 2 - u(8));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      pos.push({ x: W / 2 + Math.cos(a) * rx, y: H / 2 + Math.sin(a) * ry });
    }
    if (layout === "hub") edges = [...nodes.map((_, i) => ({ from: "c" as NodeRef, to: i as NodeRef, arrow: false })), ...custom];
    else edges = custom.length ? custom : n > 1 ? nodes.map((_, i) => ({ from: i as NodeRef, to: ((i + 1) % n) as NodeRef, arrow: true })) : [];
  } else if (layout === "flow") {
    const first = halfWidth(nodes[0].label, nodes[0].icon);
    const last = halfWidth(nodes[n - 1].label, nodes[n - 1].icon);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      pos.push(ctx.portrait ? { x: W / 2, y: nodeH / 2 + t * (H - nodeH) } : { x: first + t * (W - first - last), y: H / 2 });
    }
    edges = custom.length ? custom : nodes.slice(1).map((_, i) => ({ from: i as NodeRef, to: (i + 1) as NodeRef, arrow: true }));
  } else {
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * W) / H))));
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) pos.push({ x: ((i % cols) + 0.5) * (W / cols), y: (Math.floor(i / cols) + 0.5) * (H / rows) });
    edges = custom;
  }

  const at = (r: NodeRef) => (r === "c" ? centerPos : pos[r]);
  const half = (r: NodeRef) => (r === "c" && center ? { hw: halfWidth(center.label, center.icon, true), hh: centerH / 2 } : { hw: halfWidth(nodes[r as number].label, nodes[r as number].icon), hh: nodeH / 2 });
  const enter = element.enter ?? { type: "pop" as const };
  const offset = centerPos ? 1 : 0;
  const lastNode = itemMotion(enter, n - 1 + offset, frame, ctx);
  const connectBase = element.connectAt ? ctx.frameAt(element.connectAt) : lastNode.start + ctx.frames(0.3);
  const edgeDur = Math.max(1, ctx.frames(0.6));
  const edgeStep = ctx.frames(0.12);
  const head = u(16);

  return (
    <ElementBox element={withoutEnter(element)} width={W} height={H}>
      {() => (
        <div style={{ position: "relative", width: W, height: H }}>
          <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {edges.map((edge, e) => {
              const a = at(edge.from);
              const b = at(edge.to);
              if (!a || !b) return null;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              const trim = (r: NodeRef) => {
                const { hw, hh } = half(r);
                return Math.min(Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity) + u(10);
              };
              const t0 = Math.min(len / 2, trim(edge.from));
              const t1 = Math.min(len / 2, trim(edge.to));
              const sx = a.x + ux * t0;
              const sy = a.y + uy * t0;
              const ex = b.x - ux * t1;
              const ey = b.y - uy * t1;
              const start = connectBase + e * edgeStep;
              const p = ease("easeInOut", (frame - start) / edgeDur);
              if (p <= 0) return null;
              const since = frame - start - edgeDur;
              const tt = since > 0 ? (since / Math.max(1, ctx.frames(1.8)) + e * 0.37) % 1 : -1;
              const ang = Math.atan2(ey - sy, ex - sx);
              const arrow = `${ex},${ey} ${ex - head * Math.cos(ang) + head * 0.6 * Math.sin(ang)},${ey - head * Math.sin(ang) - head * 0.6 * Math.cos(ang)} ${ex - head * Math.cos(ang) - head * 0.6 * Math.sin(ang)},${ey - head * Math.sin(ang) + head * 0.6 * Math.cos(ang)}`;
              return (
                <g key={e}>
                  <line x1={sx} y1={sy} x2={sx + (ex - sx) * p} y2={sy + (ey - sy) * p} stroke={alpha(color, 0.55)} strokeWidth={u(3.5)} strokeLinecap="round" />
                  {edge.arrow && p > 0.95 ? <polygon points={arrow} fill={alpha(color, 0.85)} /> : null}
                  {tt >= 0 ? <circle cx={sx + (ex - sx) * tt} cy={sy + (ey - sy) * tt} r={u(7)} fill={color} opacity={bell(tt) * 0.95} style={{ filter: `drop-shadow(0 0 ${u(8)}px ${color})` }} /> : null}
                </g>
              );
            })}
          </svg>
          {center && centerPos ? <DiagramNode x={centerPos.x} y={centerPos.y} label={center.label} icon={center.icon} color={color} big style={itemMotion(enter, 0, frame, ctx).style} ctx={ctx} /> : null}
          {nodes.map((nd, i) => (
            <DiagramNode key={i} x={pos[i].x} y={pos[i].y} label={nd.label} icon={nd.icon} color={resolveColor(nd.color ?? element.color, design, "primary")} style={itemMotion(enter, i + offset, frame, ctx).style} ctx={ctx} />
          ))}
        </div>
      )}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Icon & List
// ---------------------------------------------------------------------------------------

export function IconElementView({ element }: { element: ElementOf<"icon"> }) {
  const ctx = useScene();
  const { u, design } = ctx;
  const size = u(element.size ?? 96);
  const color = resolveColor(element.color, design, "primary");
  const container = element.container ?? "none";
  const box = container === "none" ? size : size * 1.9;
  return (
    <ElementBox element={element} width={box} height={box}>
      {() => (
        <div
          style={{
            width: box,
            height: box,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: container === "circle" ? 999 : container === "none" ? 0 : box * 0.26,
            background: container === "none" ? undefined : container === "glass" ? alpha(design.colors.surface, 0.5) : alpha(color, 0.14),
            border: container === "none" ? undefined : `1px solid ${container === "glass" ? alpha(design.colors.text, 0.14) : alpha(color, 0.3)}`,
            backdropFilter: container === "glass" ? `blur(${u(20)}px)` : undefined,
            boxShadow: container === "none" ? undefined : `0 ${u(16)}px ${u(40)}px ${alpha(color, 0.18)}`,
          }}
        >
          <StudioIcon name={element.name} size={size} color={color} strokeWidth={element.strokeWidth ?? 1.8} />
        </div>
      )}
    </ElementBox>
  );
}

export function ListElementView({ element }: { element: ElementOf<"list"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u, design } = ctx;
  const size = u(element.size ?? 44);
  const gap = u(element.gap ?? 26);
  const variant = element.variant ?? "checks";
  const color = resolveColor(element.color, design, "text");
  const accent = design.colors.primary;
  const body = fontStack(design.typography.bodyFont);
  const heading = fontStack(design.typography.headingFont);
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.84 : 0.56);
  const markerSize = size * 1.15;
  return (
    <ElementBox element={withoutEnter(element)} width={width}>
      {() => (
        <div style={{ display: "flex", flexDirection: "column", gap }}>
          {element.items.map((item, i) => {
            const m = item.at ? itemMotion(element.enter ?? { type: "rise" }, 0, frame, ctx, { baseFrame: ctx.frameAt(item.at) }) : itemMotion(element.enter, i, frame, ctx);
            const mp = ease("backOut", (frame - m.start - ctx.frames(0.12)) / Math.max(1, ctx.frames(0.45)));
            let marker: ReactNode;
            switch (variant) {
              case "bullets":
                marker = <div style={{ width: size * 0.32, height: size * 0.32, borderRadius: 999, background: accent, margin: `0 ${size * 0.2}px`, transform: `scale(${mp})`, flexShrink: 0 }} />;
                break;
              case "numbers":
                marker = (
                  <div style={{ width: markerSize, height: markerSize, borderRadius: markerSize * 0.3, background: alpha(accent, 0.16), border: `1px solid ${alpha(accent, 0.4)}`, color: accent, fontFamily: heading, fontWeight: 700, fontSize: size * 0.55, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {i + 1}
                  </div>
                );
                break;
              case "icons":
                marker = (
                  <div style={{ width: markerSize, height: markerSize, borderRadius: markerSize * 0.3, background: alpha(accent, 0.14), border: `1px solid ${alpha(accent, 0.35)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ transform: `scale(${mp})` }}>
                      <StudioIcon name={item.icon ?? "sparkles"} size={size * 0.62} color={accent} />
                    </div>
                  </div>
                );
                break;
              default:
                marker = (
                  <div style={{ width: markerSize, height: markerSize, borderRadius: 999, background: alpha(accent, 0.16), border: `1px solid ${alpha(accent, 0.45)}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <div style={{ transform: `scale(${mp})` }}>
                      <StudioIcon name={item.icon ?? "check"} size={size * 0.62} color={accent} strokeWidth={2.6} />
                    </div>
                  </div>
                );
            }
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: size * 0.55, ...m.style }}>
                {marker}
                <div style={{ fontFamily: body, fontSize: size, color, fontWeight: 500, lineHeight: 1.25 }}>{item.text}</div>
              </div>
            );
          })}
        </div>
      )}
    </ElementBox>
  );
}
