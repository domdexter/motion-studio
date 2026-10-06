import { Img, random, useCurrentFrame } from "remotion";
import { CARDS_COLLAPSE_SECONDS, type CardItem, type ElementOf } from "../../core/spec/scene";
import { alpha, readableOn, resolveColor } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { StudioIcon } from "../engine/icon";
import { ElementBox, surfaceStyle } from "../engine/layout";
import { itemMotion, MissingAsset, withoutEnter } from "./shared";

/** UI components: Card (default/glass/solid/outline/app/stat/feature/testimonial) and Cards layouts. */

type CardVariant = NonNullable<ElementOf<"card">["variant"]>;

/** Default card sizes in u. */
const DEFAULT_WIDTH: Record<CardVariant, number> = { default: 460, glass: 460, solid: 460, outline: 460, app: 180, stat: 380, feature: 440, testimonial: 580 };
const DEFAULT_HEIGHT: Record<CardVariant, number> = { default: 260, glass: 260, solid: 260, outline: 260, app: 236, stat: 240, feature: 320, testimonial: 340 };

function CardBody({
  item,
  variant,
  accent,
  width,
  height,
  surfaceElement,
  ctx,
}: {
  item: CardItem;
  variant: CardVariant;
  accent?: string;
  width: number;
  height?: number;
  surfaceElement: ElementOf<"card"> | ElementOf<"cards">;
  ctx: SceneContextValue;
}) {
  const { design, u } = ctx;
  const accentColor = resolveColor(item.color ?? accent, design, "primary");
  const heading = fontStack(design.typography.headingFont);
  const body = fontStack(design.typography.bodyFont);
  const image = item.image ? ctx.assets[item.image] : undefined;

  if (variant === "app") {
    const tile = width;
    return (
      <div style={{ width, display: "flex", flexDirection: "column", alignItems: "center", gap: u(14) }}>
        <div
          style={{
            width: tile,
            height: tile,
            borderRadius: tile * 0.24,
            background: `linear-gradient(145deg, ${accentColor}, ${alpha(accentColor, 0.7)})`,
            boxShadow: `0 ${u(18)}px ${u(44)}px ${alpha(accentColor, 0.32)}, inset 0 ${Math.max(1, u(2))}px 0 rgba(255,255,255,0.25)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {image ? <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <StudioIcon name={item.icon ?? "sparkles"} size={tile * 0.46} color={readableOn(accentColor, design)} strokeWidth={2} />}
        </div>
        {item.title || item.label ? (
          <div style={{ fontFamily: body, fontSize: u(26), fontWeight: 600, color: design.colors.text, textAlign: "center", whiteSpace: "nowrap" }}>{item.title ?? item.label}</div>
        ) : null}
      </div>
    );
  }

  const surfaceVariant = variant === "glass" || variant === "solid" || variant === "outline" ? variant : "default";
  const surface = surfaceStyle(surfaceElement, ctx, { variant: surfaceVariant, accent: accentColor });
  const onSolid = variant === "solid";
  const textColor = onSolid ? readableOn(accentColor, design) : design.colors.text;
  const mutedColor = onSolid ? alpha(textColor, 0.78) : design.colors.muted;
  const pad = surfaceElement.style?.padding !== undefined ? u(surfaceElement.style.padding) : u(variant === "stat" ? 34 : 38);
  const iconTile = (size: number) =>
    item.icon ? (
      <div
        style={{
          width: u(size),
          height: u(size),
          borderRadius: u(size * 0.28),
          background: onSolid ? alpha(textColor, 0.16) : alpha(accentColor, 0.15),
          border: `1px solid ${onSolid ? alpha(textColor, 0.2) : alpha(accentColor, 0.3)}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <StudioIcon name={item.icon} size={u(size * 0.52)} color={onSolid ? textColor : accentColor} />
      </div>
    ) : null;
  const clamp = (lines: number) => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical" as const, overflow: "hidden" });

  if (variant === "stat") {
    const big = item.value ?? item.title ?? "";
    const sub = item.value ? (item.body ?? item.title) : item.body;
    return (
      <div style={{ ...surface, width, height, padding: pad, display: "flex", flexDirection: "column", justifyContent: "center", gap: u(10) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: u(16) }}>
          {item.label ? <div style={{ fontFamily: body, fontSize: u(23), fontWeight: 600, color: mutedColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>{item.label}</div> : <span />}
          {iconTile(56)}
        </div>
        <div style={{ fontFamily: heading, fontSize: u(92), fontWeight: 800, color: onSolid ? textColor : accentColor, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{big}</div>
        {sub ? <div style={{ fontFamily: body, fontSize: u(26), color: mutedColor, lineHeight: 1.4, ...clamp(2) }}>{sub}</div> : null}
      </div>
    );
  }

  if (variant === "testimonial") {
    const initials = (item.title ?? "?")
      .split(/\s+/)
      .map((p) => p[0] ?? "")
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return (
      <div style={{ ...surface, width, height, padding: pad * 1.1, display: "flex", flexDirection: "column", gap: u(22) }}>
        <StudioIcon name="quote" size={u(44)} color={accentColor} />
        <div style={{ fontFamily: heading, fontSize: u(36), fontWeight: 500, color: textColor, lineHeight: 1.35, letterSpacing: "-0.01em", ...clamp(4) }}>{item.body}</div>
        <div style={{ display: "flex", alignItems: "center", gap: u(16), marginTop: "auto" }}>
          <div style={{ width: u(60), height: u(60), borderRadius: 999, overflow: "hidden", background: alpha(accentColor, 0.2), display: "flex", alignItems: "center", justifyContent: "center", color: accentColor, fontFamily: body, fontWeight: 700, fontSize: u(22), flexShrink: 0 }}>
            {image ? <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
          </div>
          <div>
            {item.title ? <div style={{ fontFamily: body, fontSize: u(26), fontWeight: 600, color: textColor }}>{item.title}</div> : null}
            {item.label ? <div style={{ fontFamily: body, fontSize: u(22), color: mutedColor }}>{item.label}</div> : null}
          </div>
        </div>
      </div>
    );
  }

  const feature = variant === "feature";
  const showImage = !!item.image && !feature;
  return (
    <div style={{ ...surface, width, height, padding: showImage ? 0 : pad, display: "flex", flexDirection: "column", gap: u(18) }}>
      {showImage ? (
        <div style={{ width: "100%", aspectRatio: "16 / 9", overflow: "hidden", flexShrink: 0 }}>
          {image ? <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <MissingAsset id={item.image!} />}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: u(14), padding: showImage ? `0 ${pad}px ${pad}px` : 0, minHeight: 0 }}>
        {iconTile(feature ? 76 : 64)}
        {item.value ? <div style={{ fontFamily: heading, fontSize: u(64), fontWeight: 800, color: onSolid ? textColor : accentColor, lineHeight: 1, letterSpacing: "-0.02em" }}>{item.value}</div> : null}
        {item.title ? <div style={{ fontFamily: heading, fontSize: u(feature ? 40 : 38), fontWeight: 700, color: textColor, lineHeight: 1.15, letterSpacing: "-0.01em", ...clamp(2) }}>{item.title}</div> : null}
        {item.body ? <div style={{ fontFamily: body, fontSize: u(27), color: mutedColor, lineHeight: 1.45, ...clamp(3) }}>{item.body}</div> : null}
        {item.label ? <div style={{ fontFamily: body, fontSize: u(22), fontWeight: 600, color: onSolid ? textColor : accentColor, textTransform: "uppercase", letterSpacing: "0.1em" }}>{item.label}</div> : null}
      </div>
    </div>
  );
}

export function CardElementView({ element }: { element: ElementOf<"card"> }) {
  const ctx = useScene();
  const variant = element.variant ?? "default";
  const width = element.width !== undefined ? (element.width / 100) * ctx.width : ctx.u(DEFAULT_WIDTH[variant]);
  const height = element.height !== undefined ? (element.height / 100) * ctx.height : undefined;
  return (
    <ElementBox element={element} width={width} height={height}>
      {() => <CardBody item={element} variant={variant} accent={element.accent} width={width} height={height} surfaceElement={element} ctx={ctx} />}
    </ElementBox>
  );
}

interface Slot {
  x: number;
  y: number;
  rotate?: number;
  scale?: number;
  z?: number;
}

export function CardsElementView({ element }: { element: ElementOf<"cards"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { u } = ctx;
  const variant = element.variant ?? "default";
  const layout = element.layout ?? "row";
  const n = element.items.length;
  const gap = u(element.gap ?? (variant === "app" ? 40 : 28));
  let itemW = u(element.itemWidth ?? DEFAULT_WIDTH[variant] * (ctx.portrait && variant !== "app" ? 0.92 : 1));
  const itemH = u(element.itemHeight ?? DEFAULT_HEIGHT[variant]);
  const boxWidth = element.width !== undefined ? (element.width / 100) * ctx.width : undefined;
  const boxHeight = element.height !== undefined ? (element.height / 100) * ctx.height : undefined;

  const slots: Slot[] = [];
  let W = 0;
  let H = 0;
  switch (layout) {
    case "row": {
      if (boxWidth && element.itemWidth === undefined) itemW = (boxWidth - gap * (n - 1)) / n;
      W = n * itemW + (n - 1) * gap;
      H = itemH;
      for (let i = 0; i < n; i++) slots.push({ x: (i - (n - 1) / 2) * (itemW + gap), y: 0 });
      break;
    }
    case "column": {
      W = itemW;
      H = n * itemH + (n - 1) * gap;
      for (let i = 0; i < n; i++) slots.push({ x: 0, y: (i - (n - 1) / 2) * (itemH + gap) });
      break;
    }
    case "grid": {
      const cols = ctx.portrait ? Math.min(2, n) : n <= 4 ? n : Math.min(4, Math.ceil(n / 2));
      const rows = Math.ceil(n / cols);
      if (boxWidth && element.itemWidth === undefined) itemW = (boxWidth - gap * (cols - 1)) / cols;
      W = cols * itemW + (cols - 1) * gap;
      H = rows * itemH + (rows - 1) * gap;
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols);
        const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
        slots.push({ x: ((i % cols) - (inRow - 1) / 2) * (itemW + gap), y: (r - (rows - 1) / 2) * (itemH + gap) });
      }
      break;
    }
    case "scatter": {
      W = boxWidth ?? ctx.width * 0.84;
      H = boxHeight ?? ctx.height * 0.66;
      const cols = Math.max(1, Math.round(Math.sqrt((n * W) / H)));
      const rows = Math.ceil(n / cols);
      const cellW = W / cols;
      const cellH = H / rows;
      for (let i = 0; i < n; i++) {
        const seed = `scatter-${ctx.scene.id}-${i}`;
        slots.push({
          x: -W / 2 + cellW * ((i % cols) + 0.5) + (random(`${seed}-x`) - 0.5) * cellW * 0.3,
          y: -H / 2 + cellH * (Math.floor(i / cols) + 0.5) + (random(`${seed}-y`) - 0.5) * cellH * 0.3,
          rotate: (random(`${seed}-r`) - 0.5) * 14,
        });
      }
      break;
    }
    case "stack": {
      const step = u(34);
      W = itemW + u(40);
      H = itemH + (n - 1) * step;
      for (let i = 0; i < n; i++) slots.push({ x: 0, y: (i - (n - 1) / 2) * step, scale: 1 - (n - 1 - i) * 0.035, z: i });
      break;
    }
    case "orbit": {
      W = boxWidth ?? Math.min(ctx.width * 0.82, ctx.height * 1.2);
      H = boxHeight ?? ctx.height * 0.72;
      const rx = Math.max(0, W / 2 - itemW / 2);
      const ry = Math.max(0, H / 2 - itemH / 2);
      const spin = (frame / ctx.fps) * 0.12 * ctx.intensity;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + spin;
        slots.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry, z: Math.round(Math.sin(a) * 10) });
      }
      break;
    }
    case "cascade": {
      const dx = u(70);
      const dy = u(56);
      W = itemW + (n - 1) * dx;
      H = itemH + (n - 1) * dy;
      for (let i = 0; i < n; i++) slots.push({ x: (i - (n - 1) / 2) * dx, y: (i - (n - 1) / 2) * dy, z: i });
      break;
    }
  }

  const collapseFrame = element.collapseAt ? ctx.frameAt(element.collapseAt) : null;
  const c = collapseFrame === null ? 0 : ease("expoInOut", (frame - collapseFrame) / Math.max(1, ctx.frames(CARDS_COLLAPSE_SECONDS)));
  const fade = 1 - Math.max(0, (c - 0.55) / 0.45);

  return (
    <ElementBox element={withoutEnter(element)} width={W} height={H}>
      {() => (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          {element.items.map((item, i) => {
            const m = item.at ? itemMotion(element.enter ?? { type: "pop" }, 0, frame, ctx, { baseFrame: ctx.frameAt(item.at) }) : itemMotion(element.enter, i, frame, ctx);
            const slot = slots[i];
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: W / 2 + slot.x * (1 - c),
                  top: H / 2 + slot.y * (1 - c),
                  transform: `translate(-50%, -50%) rotate(${(slot.rotate ?? 0) * (1 - c)}deg) scale(${(slot.scale ?? 1) * (1 - 0.65 * c)})`,
                  zIndex: slot.z ?? 0,
                  opacity: fade,
                }}
              >
                <div style={m.style}>
                  <CardBody item={item} variant={variant} accent={element.accent} width={itemW} height={variant === "app" ? undefined : itemH} surfaceElement={element} ctx={ctx} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ElementBox>
  );
}
