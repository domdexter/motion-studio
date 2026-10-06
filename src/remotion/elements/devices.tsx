import type { CSSProperties, ReactNode } from "react";
import { Img, OffthreadVideo, random, useCurrentFrame } from "remotion";
import type { ElementOf, Screen } from "../../core/spec/scene";
import { slugify } from "../../core/util/text";
import { alpha, isDark, resolveColor } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { StudioIcon } from "../engine/icon";
import { ElementBox } from "../engine/layout";
import { animateNumericText, MissingAsset, Scaled, smoothPath, useSvgId } from "./shared";

/**
 * Device mockups (Browser, Phone, Desktop) with animated screen content, and the Dashboard
 * element. Mockups render at a fixed base resolution and scale, so they look identical at any
 * output size.
 */

type Theme = "light" | "dark";

interface Palette {
  bg: string;
  panel: string;
  panel2: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  onAccent: string;
}

function screenPalette(theme: Theme, accent: string): Palette {
  const onAccent = isDark(accent) ? "#FFFFFF" : "#0B0B0F";
  return theme === "light"
    ? { bg: "#FFFFFF", panel: "#F6F7F9", panel2: "#ECEFF3", line: "rgba(15,23,42,0.09)", text: "#0F172A", muted: "#64748B", faint: "#E3E7EE", accent, onAccent }
    : { bg: "#0B0D12", panel: "#131720", panel2: "#1B2030", line: "rgba(255,255,255,0.075)", text: "#E8EBF1", muted: "#8B94A7", faint: "#242A3A", accent, onAccent };
}

function themeFor(theme: Theme | undefined, ctx: SceneContextValue): Theme {
  return theme ?? (isDark(ctx.design.colors.background) ? "dark" : "light");
}

interface ScreenKit {
  pal: Palette;
  compact: boolean;
  title?: string;
  items: string[];
  seed: string;
  uid: string;
  brandName: string;
  headingFont: string;
  seconds: number;
  /** Staggered appear progress for part i. */
  appear: (i: number, delaySec?: number, stepSec?: number) => number;
  progressAt: (startSec: number, durationSec: number) => number;
}

// ---------------------------------------------------------------------------------------
// Screen content
// ---------------------------------------------------------------------------------------

function DashboardScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact, appear } = kit;
  const nav = kit.items.length ? kit.items : ["Overview", "Pipeline", "Customers", "Reports", "Settings"];
  const kpis: [string, string, string][] = [
    ["Revenue", "$48.2k", "+12.4%"],
    ["Active users", "12,847", "+8.1%"],
    ["Conversion", "3.9%", "+0.6%"],
    ["Churn", "1.2%", "−0.3%"],
  ];
  const shown = kpis.slice(0, compact ? 2 : 4);
  const bars = Array.from({ length: compact ? 8 : 14 }, (_, i) => 0.3 + 0.65 * random(`dash-${kit.seed}-${i}`));
  return (
    <div style={{ display: "flex", width: "100%", height: "100%" }}>
      {!compact && (
        <div style={{ width: 220, borderRight: `1px solid ${pal.line}`, background: pal.panel, padding: "26px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, padding: "0 10px", fontWeight: 700, fontSize: 17 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: pal.accent }} />
            {kit.brandName}
          </div>
          {nav.slice(0, 7).map((label, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                background: i === 0 ? alpha(pal.accent, 0.14) : "transparent",
                color: i === 0 ? pal.accent : pal.muted,
                fontSize: 15,
                fontWeight: i === 0 ? 600 : 500,
                opacity: appear(i, 0.1, 0.05),
              }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 5, background: i === 0 ? pal.accent : pal.faint }} />
              {label}
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, padding: compact ? 16 : 30, display: "flex", flexDirection: "column", gap: compact ? 12 : 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: kit.headingFont, fontSize: compact ? 22 : 26, fontWeight: 700, letterSpacing: "-0.01em" }}>{kit.title ?? "Overview"}</div>
          <div style={{ display: "flex", gap: 10 }}>
            {!compact && <div style={{ width: 200, height: 36, borderRadius: 10, background: pal.panel, border: `1px solid ${pal.line}` }} />}
            <div style={{ width: 36, height: 36, borderRadius: 999, background: alpha(pal.accent, 0.35) }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, 1fr)`, gap: compact ? 10 : 16 }}>
          {shown.map(([label, value, delta], i) => {
            const p = appear(i);
            return (
              <div key={i} style={{ background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 14, padding: compact ? 12 : 18, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
                <div style={{ fontSize: compact ? 12 : 13, color: pal.muted, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: compact ? 21 : 28, fontWeight: 700, marginTop: 6, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{animateNumericText(value, appear(i, 0.3, 0.1))}</div>
                <div style={{ fontSize: 12, marginTop: 4, color: delta.startsWith("−") ? "#F87171" : "#34D399", fontWeight: 600 }}>{delta}</div>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, display: "flex", gap: 16, minHeight: 0 }}>
          <div style={{ flex: 2, background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 14, padding: compact ? 12 : 18, display: "flex", flexDirection: "column" }}>
            <div style={{ width: 140, height: 12, borderRadius: 6, background: pal.faint, marginBottom: 16 }} />
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: compact ? 6 : 10 }}>
              {bars.map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h * 100 * appear(i, 0.45, 0.04)}%`, borderRadius: 6, background: i === bars.length - 3 ? pal.accent : alpha(pal.accent, 0.32) }} />
              ))}
            </div>
          </div>
          {!compact && (
            <div style={{ flex: 1, background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, opacity: appear(i, 0.6, 0.07) }}>
                  <div style={{ width: 30, height: 30, borderRadius: 999, background: alpha(pal.accent, 0.14 + i * 0.08) }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ width: `${55 + random(`dl-${kit.seed}-${i}`) * 40}%`, height: 10, borderRadius: 5, background: pal.faint }} />
                    <div style={{ width: "38%", height: 8, borderRadius: 4, background: pal.faint, marginTop: 7, opacity: 0.6 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnalyticsScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact, appear, uid } = kit;
  const n = 14;
  const VW = 1000;
  const VH = 360;
  const pts = Array.from({ length: n }, (_, i) => {
    const v = Math.max(0.06, Math.min(0.94, 0.18 + 0.62 * (i / (n - 1)) + (random(`an-${kit.seed}-${i}`) - 0.5) * 0.24));
    return [(i / (n - 1)) * VW, VH - v * VH] as [number, number];
  });
  const line = smoothPath(pts);
  const draw = kit.progressAt(0.35, 1.5);
  const stats: [string, string][] = [
    ["Visitors", "184,209"],
    ["Signups", "9,432"],
    ["Revenue", "$92.4k"],
  ];
  const shown = stats.slice(0, compact ? 2 : 3);
  return (
    <div style={{ height: "100%", padding: compact ? 16 : 32, display: "flex", flexDirection: "column", gap: compact ? 12 : 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: kit.headingFont, fontSize: compact ? 20 : 26, fontWeight: 700 }}>{kit.title ?? "Analytics"}</div>
        {!compact && (
          <div style={{ display: "flex", gap: 6, padding: 4, borderRadius: 10, background: pal.panel, border: `1px solid ${pal.line}` }}>
            {["7d", "30d", "90d"].map((r, i) => (
              <div key={r} style={{ padding: "6px 12px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: i === 1 ? pal.bg : "transparent", color: i === 1 ? pal.text : pal.muted }}>
                {r}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${shown.length}, 1fr)`, gap: 12 }}>
        {shown.map(([label, value], i) => (
          <div key={label} style={{ opacity: appear(i), background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 14, padding: compact ? 12 : 18 }}>
            <div style={{ fontSize: 13, color: pal.muted }}>{label}</div>
            <div style={{ fontSize: compact ? 20 : 26, fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{animateNumericText(value, appear(i, 0.3, 0.1))}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 16, padding: compact ? 12 : 22 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <defs>
            <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pal.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={pal.accent} stopOpacity={0} />
            </linearGradient>
            <clipPath id={`${uid}-c`}>
              <rect x={-10} y={-20} width={VW * draw + 10} height={VH + 40} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={0} x2={VW} y1={VH * g} y2={VH * g} stroke={pal.line} strokeWidth={2} />
          ))}
          <g clipPath={`url(#${uid}-c)`}>
            <path d={`${line} L${VW},${VH} L0,${VH} Z`} fill={`url(#${uid}-g)`} />
            <path d={line} fill="none" stroke={pal.accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      </div>
    </div>
  );
}

function ListScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact, appear } = kit;
  const rows = kit.items.length ? kit.items : ["Acme Corp — Renewal", "Northwind — Onboarding", "Globex — Proposal sent", "Initech — Invoice paid", "Umbrella — Demo booked"];
  const statuses = ["Active", "Pending", "Done"];
  return (
    <div style={{ padding: compact ? 16 : 30, display: "flex", flexDirection: "column", gap: compact ? 10 : 12 }}>
      <div style={{ fontFamily: kit.headingFont, fontSize: compact ? 22 : 26, fontWeight: 700, marginBottom: 8 }}>{kit.title ?? "Inbox"}</div>
      {rows.slice(0, 8).map((row, i) => {
        const p = appear(i);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: compact ? "12px 14px" : "16px 18px",
              borderRadius: 14,
              background: pal.panel,
              border: `1px solid ${pal.line}`,
              opacity: p,
              transform: `translateY(${(1 - p) * 18}px)`,
            }}
          >
            <div
              style={{
                width: compact ? 34 : 40,
                height: compact ? 34 : 40,
                borderRadius: 999,
                flexShrink: 0,
                background: `linear-gradient(135deg, ${alpha(pal.accent, 0.95)}, ${alpha(pal.accent, 0.45)})`,
                color: pal.onAccent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {row.trim().charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: compact ? 15 : 17, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row}</div>
              <div style={{ width: `${45 + random(`ls-${kit.seed}-${i}`) * 35}%`, height: 8, borderRadius: 4, background: pal.faint, marginTop: 8 }} />
            </div>
            {!compact && <div style={{ fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 999, background: alpha(pal.accent, 0.14), color: pal.accent }}>{statuses[i % 3]}</div>}
          </div>
        );
      })}
    </div>
  );
}

function ChatScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact } = kit;
  const msgs = kit.items.length ? kit.items : ["Can we automate the weekly report?", "Yes — it now runs every Monday at 9:00.", "Perfect. Share it with the whole team.", "Done. Everyone has access ✓"];
  const avatar = compact ? 34 : 40;
  const input = compact ? 40 : 46;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: compact ? "12px 16px" : "18px 28px", borderBottom: `1px solid ${pal.line}`, background: pal.panel }}>
        <div style={{ width: avatar, height: avatar, borderRadius: 999, background: `linear-gradient(135deg, ${pal.accent}, ${alpha(pal.accent, 0.5)})` }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: compact ? 15 : 17 }}>{kit.title ?? kit.brandName}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: pal.muted }}>
            <span style={{ width: 7, height: 7, borderRadius: 9, background: "#34D399" }} />
            Online
          </div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, padding: compact ? 14 : 28 }}>
        {msgs.slice(0, 8).map((m, i) => {
          const p = kit.progressAt(0.3 + i * 0.7, 0.4);
          const mine = i % 2 === 1;
          return (
            <div
              key={i}
              style={{
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "78%",
                padding: compact ? "10px 14px" : "13px 18px",
                borderRadius: 18,
                borderBottomRightRadius: mine ? 6 : 18,
                borderBottomLeftRadius: mine ? 18 : 6,
                background: mine ? pal.accent : pal.panel2,
                color: mine ? pal.onAccent : pal.text,
                fontSize: compact ? 15 : 17,
                lineHeight: 1.4,
                opacity: p,
                transform: `translateY(${(1 - p) * 16}px) scale(${0.96 + 0.04 * p})`,
                transformOrigin: mine ? "100% 100%" : "0% 100%",
              }}
            >
              {m}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, padding: compact ? "10px 14px 16px" : "14px 28px 22px" }}>
        <div style={{ flex: 1, height: input, borderRadius: 999, background: pal.panel, border: `1px solid ${pal.line}` }} />
        <div style={{ width: input, height: input, borderRadius: 999, background: pal.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <StudioIcon name="send" size={compact ? 18 : 20} color={pal.onAccent} />
        </div>
      </div>
    </div>
  );
}

function LandingScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact, appear } = kit;
  const title = kit.title ?? `${kit.brandName} — work, simplified`;
  const btn = compact ? "10px 16px" : "14px 26px";
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: `radial-gradient(120% 80% at 50% 0%, ${alpha(pal.accent, 0.18)}, transparent 60%), ${pal.bg}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: compact ? "14px 18px" : "22px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: compact ? 16 : 19 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: pal.accent }} />
          {kit.brandName}
        </div>
        {!compact && (
          <div style={{ display: "flex", gap: 28 }}>
            {[70, 64, 80].map((w, i) => (
              <div key={i} style={{ width: w, height: 10, borderRadius: 5, background: pal.faint }} />
            ))}
          </div>
        )}
        <div style={{ padding: compact ? "8px 12px" : "10px 18px", borderRadius: 999, background: pal.text, color: pal.bg, fontSize: compact ? 12 : 14, fontWeight: 600 }}>Get started</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: compact ? "22px 20px 0" : "52px 120px 0", gap: compact ? 14 : 20, minHeight: 0 }}>
        <div style={{ opacity: appear(0), padding: "6px 14px", borderRadius: 999, border: `1px solid ${alpha(pal.accent, 0.4)}`, color: pal.accent, fontSize: compact ? 12 : 14, fontWeight: 600 }}>New · Now available</div>
        <div style={{ opacity: appear(1), transform: `translateY(${(1 - appear(1)) * 20}px)`, fontFamily: kit.headingFont, fontSize: compact ? 30 : 58, fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em", maxWidth: 900 }}>{title}</div>
        <div style={{ opacity: appear(2), display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>
          <div style={{ width: compact ? "90%" : 560, height: 12, borderRadius: 6, background: pal.faint }} />
          <div style={{ width: compact ? "70%" : 440, height: 12, borderRadius: 6, background: pal.faint }} />
        </div>
        <div style={{ opacity: appear(3), display: "flex", gap: 12, marginTop: 6 }}>
          <div style={{ padding: btn, borderRadius: 12, background: pal.accent, color: pal.onAccent, fontWeight: 600, fontSize: compact ? 14 : 17, boxShadow: `0 10px 30px ${alpha(pal.accent, 0.35)}` }}>Start free</div>
          <div style={{ padding: btn, borderRadius: 12, border: `1px solid ${pal.line}`, background: pal.panel, fontWeight: 600, fontSize: compact ? 14 : 17 }}>Book a demo</div>
        </div>
        <div
          style={{
            opacity: appear(4),
            transform: `translateY(${(1 - appear(4)) * 40}px)`,
            marginTop: compact ? 10 : 26,
            width: "100%",
            maxWidth: 980,
            flex: 1,
            borderRadius: "18px 18px 0 0",
            border: `1px solid ${pal.line}`,
            borderBottom: "none",
            background: `linear-gradient(180deg, ${pal.panel}, ${pal.bg})`,
            padding: 18,
            display: "flex",
            gap: 12,
            alignItems: "flex-end",
          }}
        >
          {Array.from({ length: compact ? 6 : 12 }, (_, i) => (
            <div key={i} style={{ flex: 1, height: `${(30 + random(`land-${kit.seed}-${i}`) * 60) * appear(5, 0.25 + i * 0.03, 0.08)}%`, borderRadius: 8, background: alpha(pal.accent, 0.25 + (i % 3) * 0.15) }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FormScreen({ kit }: { kit: ScreenKit }) {
  const { pal, compact, appear } = kit;
  const fields = kit.items.length ? kit.items.slice(0, 6) : ["Full name", "Work email", "Company", "Team size"];
  const active = Math.min(fields.length - 1, Math.max(0, Math.floor(kit.seconds / 0.9) - 1));
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: pal.panel, padding: compact ? 16 : 40 }}>
      <div style={{ width: compact ? "100%" : 520, background: pal.bg, borderRadius: 20, border: `1px solid ${pal.line}`, padding: compact ? 20 : 34, display: "flex", flexDirection: "column", gap: compact ? 12 : 16, boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}>
        <div style={{ fontFamily: kit.headingFont, fontSize: compact ? 22 : 28, fontWeight: 700 }}>{kit.title ?? "Create your account"}</div>
        {fields.map((label, i) => {
          const p = appear(i + 1);
          const focused = i === active;
          return (
            <div key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 12}px)` }}>
              <div style={{ fontSize: compact ? 12 : 14, color: pal.muted, marginBottom: 6, fontWeight: 500 }}>{label}</div>
              <div
                style={{
                  height: compact ? 38 : 46,
                  borderRadius: 10,
                  border: `${focused ? 2 : 1}px solid ${focused ? pal.accent : pal.line}`,
                  boxShadow: focused ? `0 0 0 4px ${alpha(pal.accent, 0.15)}` : undefined,
                  background: pal.panel,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 14px",
                }}
              >
                <div style={{ width: `${30 + random(`form-${kit.seed}-${i}`) * 40}%`, height: 9, borderRadius: 5, background: i <= active ? alpha(pal.text, 0.5) : pal.faint }} />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop: 6, height: compact ? 42 : 50, borderRadius: 12, background: pal.accent, color: pal.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: compact ? 15 : 17, opacity: appear(fields.length + 1) }}>Continue</div>
      </div>
    </div>
  );
}

function ScreenView({ screen, theme, width, startFrame, ctx }: { screen: Screen | undefined; theme: Theme; width: number; startFrame: number; ctx: SceneContextValue }) {
  const frame = useCurrentFrame();
  const uid = useSvgId("scr");
  const pal = screenPalette(theme, resolveColor(screen?.accent, ctx.design, "primary"));
  const f = frame - startFrame;
  const kind = screen?.kind ?? "dashboard";
  const kit: ScreenKit = {
    pal,
    compact: width < 600,
    title: screen?.title,
    items: screen?.items ?? [],
    seed: `${ctx.scene.id}-${kind}`,
    uid,
    brandName: screen?.brand || ctx.brand.brandName || "Studio",
    headingFont: fontStack(ctx.design.typography.headingFont),
    seconds: Math.max(0, f / ctx.fps),
    appear: (i, delaySec = 0.25, stepSec = 0.08) => ease("expoOut", (f - ctx.frames(delaySec + i * stepSec)) / Math.max(1, ctx.frames(0.5))),
    progressAt: (startSec, durationSec) => ease("easeInOut", (f - ctx.frames(startSec)) / Math.max(1, ctx.frames(durationSec))),
  };
  let content: ReactNode = null;
  switch (kind) {
    case "image":
    case "video": {
      const asset = screen?.assetId ? ctx.assets[screen.assetId] : undefined;
      const media: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
      content = asset ? kind === "image" ? <Img src={asset.src} style={media} /> : <OffthreadVideo src={asset.src} muted style={media} /> : <MissingAsset id={screen?.assetId ?? "(no assetId)"} />;
      break;
    }
    case "dashboard":
      content = <DashboardScreen kit={kit} />;
      break;
    case "analytics":
      content = <AnalyticsScreen kit={kit} />;
      break;
    case "list":
      content = <ListScreen kit={kit} />;
      break;
    case "chat":
      content = <ChatScreen kit={kit} />;
      break;
    case "landing":
      content = <LandingScreen kit={kit} />;
      break;
    case "form":
      content = <FormScreen kit={kit} />;
      break;
    case "blank":
      break;
  }
  return <div style={{ position: "absolute", inset: 0, background: pal.bg, color: pal.text, fontFamily: fontStack(ctx.design.typography.bodyFont), overflow: "hidden" }}>{content}</div>;
}

// ---------------------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------------------

export function BrowserElementView({ element }: { element: ElementOf<"browser"> }) {
  const ctx = useScene();
  const theme = themeFor(element.theme, ctx);
  const pal = screenPalette(theme, resolveColor(element.screen?.accent, ctx.design, "primary"));
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.9 : 0.64);
  const BW = ctx.portrait ? 900 : 1280;
  const chrome = 52;
  const s = width / BW;
  const contentH = element.height !== undefined ? ((element.height / 100) * ctx.height) / s - chrome : BW * (ctx.portrait ? 1.1 : 0.6);
  const BH = chrome + contentH;
  const url = element.url ?? `app.${slugify(ctx.brand.brandName || "studio", 24) || "studio"}.com`;
  return (
    <ElementBox element={element} width={width} height={BH * s}>
      {(motion) => (
        <Scaled baseWidth={BW} baseHeight={BH} width={width}>
          <div style={{ width: BW, height: BH, borderRadius: 18, overflow: "hidden", background: pal.bg, border: `1px solid ${theme === "dark" ? "rgba(255,255,255,0.10)" : "rgba(15,23,42,0.10)"}`, boxShadow: "0 40px 120px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.25)" }}>
            <div style={{ height: chrome, display: "flex", alignItems: "center", gap: 16, padding: "0 20px", background: pal.panel, borderBottom: `1px solid ${pal.line}` }}>
              <div style={{ display: "flex", gap: 8 }}>
                {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                  <div key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
                <div style={{ minWidth: 380, maxWidth: "70%", height: 32, borderRadius: 9, background: pal.bg, border: `1px solid ${pal.line}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 16px", color: pal.muted, fontSize: 15, fontFamily: fontStack(ctx.design.typography.bodyFont) }}>
                  <StudioIcon name="lock" size={13} color={pal.muted} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{element.title ? `${element.title} — ${url}` : url}</span>
                </div>
              </div>
              <div style={{ width: 58 }} />
            </div>
            <div style={{ position: "relative", height: contentH }}>
              <ScreenView screen={element.screen} theme={theme} width={BW} startFrame={motion.enterFrame} ctx={ctx} />
            </div>
          </div>
        </Scaled>
      )}
    </ElementBox>
  );
}

export function PhoneElementView({ element }: { element: ElementOf<"phone"> }) {
  const ctx = useScene();
  const theme = themeFor(element.theme, ctx);
  const pal = screenPalette(theme, resolveColor(element.screen?.accent, ctx.design, "primary"));
  const BW = 414;
  const BH = 868;
  const height =
    element.height !== undefined ? (element.height / 100) * ctx.height : element.width !== undefined ? ((element.width / 100) * ctx.width * BH) / BW : ctx.height * (ctx.portrait ? 0.6 : 0.78);
  const width = (height * BW) / BH;
  const screenW = BW - 24;
  const screenH = BH - 24;
  const statusH = 54;
  return (
    <ElementBox element={element} width={width} height={height}>
      {(motion) => (
        <Scaled baseWidth={BW} baseHeight={BH} width={width}>
          <div style={{ width: BW, height: BH, borderRadius: 68, padding: 12, background: "linear-gradient(145deg, #2B2D33, #0C0D10)", boxShadow: "0 50px 120px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.08)" }}>
            <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 56, overflow: "hidden", background: pal.bg }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: statusH, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 34px", color: pal.text, fontFamily: fontStack(ctx.design.typography.bodyFont), fontSize: 16, fontWeight: 600, zIndex: 2 }}>
                <span>9:41</span>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StudioIcon name="signal" size={16} color={pal.text} />
                  <StudioIcon name="wifi" size={16} color={pal.text} />
                  <StudioIcon name="battery-full" size={22} color={pal.text} />
                </div>
              </div>
              <div style={{ position: "absolute", top: 11, left: "50%", transform: "translateX(-50%)", width: 122, height: 35, borderRadius: 20, background: "#000", zIndex: 3 }} />
              <div style={{ position: "absolute", top: statusH, left: 0, width: screenW, height: screenH - statusH }}>
                <ScreenView screen={element.screen} theme={theme} width={screenW} startFrame={motion.enterFrame} ctx={ctx} />
              </div>
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 134, height: 5, borderRadius: 3, background: alpha(pal.text, 0.5), zIndex: 2 }} />
            </div>
          </div>
        </Scaled>
      )}
    </ElementBox>
  );
}

export function DesktopElementView({ element }: { element: ElementOf<"desktop"> }) {
  const ctx = useScene();
  const theme = themeFor(element.theme, ctx);
  const device = element.device ?? "laptop";
  const screenW = 1280;
  const screenH = 800;
  const bezel = device === "laptop" ? 18 : 16;
  const frameW = screenW + bezel * 2;
  const BW = device === "laptop" ? 1500 : frameW;
  const BH = device === "laptop" ? screenH + bezel * 2 + 34 : screenH + bezel * 2 + 150;
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.92 : 0.66);
  const s = width / BW;
  return (
    <ElementBox element={element} width={width} height={BH * s}>
      {(motion) => (
        <Scaled baseWidth={BW} baseHeight={BH} width={width}>
          <div style={{ position: "relative", width: BW, height: BH }}>
            <div
              style={{
                position: "absolute",
                left: (BW - frameW) / 2,
                top: 0,
                width: frameW,
                height: screenH + bezel * 2,
                borderRadius: device === "laptop" ? "26px 26px 8px 8px" : 22,
                background: "#0A0B0E",
                padding: bezel,
                boxShadow: "0 50px 120px rgba(0,0,0,0.45), inset 0 0 0 2px rgba(255,255,255,0.07)",
              }}
            >
              <div style={{ position: "relative", width: screenW, height: screenH, borderRadius: 6, overflow: "hidden" }}>
                <ScreenView screen={element.screen} theme={theme} width={screenW} startFrame={motion.enterFrame} ctx={ctx} />
              </div>
            </div>
            {device === "laptop" ? (
              <div style={{ position: "absolute", left: 0, top: screenH + bezel * 2, width: BW, height: 34, borderRadius: "4px 4px 22px 22px", background: "linear-gradient(180deg, #D5D8DE 0%, #A9ADB5 55%, #6E727A 100%)", boxShadow: "0 30px 60px rgba(0,0,0,0.35)" }}>
                <div style={{ margin: "0 auto", width: 220, height: 12, borderRadius: "0 0 12px 12px", background: "rgba(0,0,0,0.18)" }} />
              </div>
            ) : (
              <>
                <div style={{ position: "absolute", left: BW / 2 - 70, top: screenH + bezel * 2, width: 140, height: 118, background: "linear-gradient(90deg, #8E929A, #C9CCD2, #8E929A)" }} />
                <div style={{ position: "absolute", left: BW / 2 - 210, top: BH - 32, width: 420, height: 32, borderRadius: "12px 12px 6px 6px", background: "linear-gradient(180deg, #C9CCD2, #8E929A)", boxShadow: "0 20px 40px rgba(0,0,0,0.35)" }} />
              </>
            )}
          </div>
        </Scaled>
      )}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Dashboard element
// ---------------------------------------------------------------------------------------

const STATUS_COLORS = { ok: "#34D399", warn: "#FBBF24", error: "#F87171" } as const;

export function DashboardElementView({ element }: { element: ElementOf<"dashboard"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const theme = themeFor(element.theme, ctx);
  const pal = screenPalette(theme, resolveColor(element.style?.color, ctx.design, "primary"));
  const BW = ctx.portrait ? 760 : 1280;
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.width * (ctx.portrait ? 0.9 : 0.72);
  const s = width / BW;
  const BH = element.height !== undefined ? ((element.height / 100) * ctx.height) / s : ctx.portrait ? 1180 : 760;
  const font = fontStack(ctx.design.typography.bodyFont);
  const heading = fontStack(ctx.design.typography.headingFont);
  const sidebar = !ctx.portrait ? (element.sidebar ?? []) : [];
  const kpis = element.kpis ?? [];
  const chart = element.chart ?? [];
  const rows = element.rows ?? [];
  const maxV = Math.max(1, ...chart.map((d) => d.value));

  return (
    <ElementBox element={element} width={width} height={BH * s}>
      {(motion) => {
        const f = frame - motion.enterFrame;
        const appear = (i: number, delay = 0.2, step = 0.07) => ease("expoOut", (f - ctx.frames(delay + i * step)) / Math.max(1, ctx.frames(0.55)));
        return (
          <Scaled baseWidth={BW} baseHeight={BH} width={width}>
            <div style={{ width: BW, height: BH, display: "flex", borderRadius: 22, overflow: "hidden", background: pal.bg, color: pal.text, fontFamily: font, border: `1px solid ${pal.line}`, boxShadow: "0 40px 120px rgba(0,0,0,0.45)" }}>
              {sidebar.length > 0 && (
                <div style={{ width: 230, background: pal.panel, borderRight: `1px solid ${pal.line}`, padding: "28px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", marginBottom: 22, fontWeight: 700, fontSize: 17 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 8, background: pal.accent }} />
                    {ctx.brand.brandName || "Studio"}
                  </div>
                  {sidebar.map((label, i) => (
                    <div key={i} style={{ padding: "11px 12px", borderRadius: 10, fontSize: 15, fontWeight: i === 0 ? 600 : 500, color: i === 0 ? pal.accent : pal.muted, background: i === 0 ? alpha(pal.accent, 0.14) : "transparent", opacity: appear(i, 0.1, 0.05) }}>
                      {label}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0, padding: 30, display: "flex", flexDirection: "column", gap: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontFamily: heading, fontSize: 28, fontWeight: 700, letterSpacing: "-0.01em" }}>{element.title ?? "Overview"}</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ padding: "8px 14px", borderRadius: 10, background: pal.panel, border: `1px solid ${pal.line}`, fontSize: 13, color: pal.muted }}>Last 30 days</div>
                    <div style={{ width: 36, height: 36, borderRadius: 999, background: alpha(pal.accent, 0.35) }} />
                  </div>
                </div>
                {kpis.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${ctx.portrait ? Math.min(2, kpis.length) : kpis.length}, 1fr)`, gap: 16 }}>
                    {kpis.map((k, i) => {
                      const p = appear(i);
                      const negative = /^[-−]/.test(k.delta ?? "");
                      return (
                        <div key={i} style={{ background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 16, padding: 20, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                          <div style={{ fontSize: 14, color: pal.muted, fontWeight: 500 }}>{k.label}</div>
                          <div style={{ fontFamily: heading, fontSize: 34, fontWeight: 700, marginTop: 8, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{animateNumericText(k.value, appear(i, 0.3, 0.1))}</div>
                          {k.delta ? <div style={{ fontSize: 14, marginTop: 6, fontWeight: 600, color: negative ? "#F87171" : "#34D399" }}>{k.delta}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
                {chart.length > 0 && (
                  <div style={{ flex: rows.length ? 1.3 : 1, minHeight: 0, background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", opacity: appear(kpis.length) }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: chart.length > 12 ? 8 : 16, minHeight: 0 }}>
                      {chart.map((d, i) => (
                        <div key={i} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                          <div style={{ height: `${(Math.max(0, d.value) / maxV) * 100 * appear(i, 0.45, 0.05)}%`, borderRadius: "8px 8px 3px 3px", background: d.color ? resolveColor(d.color, ctx.design) : i === chart.length - 1 ? pal.accent : alpha(pal.accent, 0.4) }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: chart.length > 12 ? 8 : 16, marginTop: 10 }}>
                      {chart.map((d, i) => (
                        <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, color: pal.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {d.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {rows.length > 0 && (
                  <div style={{ flex: 1, minHeight: 0, background: pal.panel, border: `1px solid ${pal.line}`, borderRadius: 16, padding: "10px 22px", display: "flex", flexDirection: "column" }}>
                    {rows.map((r, i) => {
                      const p = appear(i, 0.55, 0.08);
                      const dot = r.status ? (r.status === "info" ? pal.accent : STATUS_COLORS[r.status]) : pal.faint;
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0", borderBottom: i < rows.length - 1 ? `1px solid ${pal.line}` : "none", opacity: p, transform: `translateX(${(1 - p) * -12}px)` }}>
                          <span style={{ width: 10, height: 10, borderRadius: 99, background: dot, boxShadow: r.status ? `0 0 12px ${alpha(dot, 0.6)}` : undefined }} />
                          <span style={{ flex: 1, fontSize: 16, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
                          {r.value ? <span style={{ fontSize: 16, color: pal.muted, fontVariantNumeric: "tabular-nums" }}>{r.value}</span> : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Scaled>
        );
      }}
    </ElementBox>
  );
}
