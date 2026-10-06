import { useMemo } from "react";
import { AbsoluteFill, Img, OffthreadVideo, random, useCurrentFrame } from "remotion";
import type { Background } from "../../core/spec/scene";
import { alpha, resolveColor } from "../engine/color";
import { useScene } from "../engine/context";
import { ease } from "../engine/easing";

let noiseUrl: string | null = null;

/** Deterministic grayscale noise tile (generated once, reused for grain). */
function noiseTexture(): string | null {
  if (noiseUrl) return noiseUrl;
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(random(`grain-${i}`) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseUrl = canvas.toDataURL("image/png");
  return noiseUrl;
}

/** Recolors the media beneath toward a hue while keeping its light and shadow (the parent isolates the blend). */
function Tint({ tint }: { tint?: { color: string; amount?: number } }) {
  const { design } = useScene();
  const amount = tint?.amount ?? 1;
  if (!tint || amount <= 0) return null;
  return <AbsoluteFill style={{ backgroundColor: resolveColor(tint.color, design), mixBlendMode: "color", opacity: amount }} />;
}

function Grain({ amount }: { amount: number }) {
  const frame = useCurrentFrame();
  const url = useMemo(() => noiseTexture(), []);
  if (!url || amount <= 0) return null;
  const jitterX = Math.floor(random(`gx-${frame}`) * 256);
  const jitterY = Math.floor(random(`gy-${frame}`) * 256);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url(${url})`,
        backgroundSize: "256px 256px",
        backgroundPosition: `${jitterX}px ${jitterY}px`,
        opacity: Math.min(0.5, amount),
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
}

function Vignette({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${Math.min(0.9, amount)}) 100%)`, pointerEvents: "none" }} />;
}

function MissingMedia({ id }: { id: string }) {
  const { design, u, preview } = useScene();
  return (
    <AbsoluteFill style={{ background: design.colors.surface, alignItems: "center", justifyContent: "center" }}>
      {preview ? <span style={{ color: design.colors.muted, fontSize: u(28), fontFamily: "system-ui" }}>Missing asset {id}</span> : null}
    </AbsoluteFill>
  );
}

export function SceneBackground({ background }: { background: Background }) {
  const ctx = useScene();
  const frame = useCurrentFrame();
  const { design, u, width, height, segmentStartFrame, segmentEndFrame } = ctx;
  const t = frame / ctx.fps;
  const sceneProgress = Math.min(1, Math.max(0, frame - segmentStartFrame) / Math.max(1, segmentEndFrame - segmentStartFrame));

  let layer: React.ReactNode = null;
  switch (background.type) {
    case "solid":
      layer = <AbsoluteFill style={{ backgroundColor: resolveColor(background.color, design, "background") }} />;
      break;
    case "gradient": {
      const colors = (background.colors ?? ["background", "surface"]).map((c) => resolveColor(c, design));
      const angle = (background.angle ?? 135) + (background.animate ? Math.sin(t / 6) * 12 : 0);
      layer = (
        <AbsoluteFill
          style={{ background: background.radial ? `radial-gradient(circle at 50% 40%, ${colors.join(", ")})` : `linear-gradient(${angle}deg, ${colors.join(", ")})` }}
        />
      );
      break;
    }
    case "mesh": {
      const base = resolveColor(background.base, design, "background");
      const colors = (background.colors ?? ["primary", "secondary", "accent"]).map((c) => resolveColor(c, design));
      const intensity = background.intensity ?? 0.35;
      const size = Math.max(width, height) * 0.95;
      const seed = ctx.index;
      layer = (
        <AbsoluteFill style={{ backgroundColor: base, overflow: "hidden" }}>
          {colors.map((color, i) => {
            const phase = random(`mesh-${seed}-${i}`) * Math.PI * 2;
            const cx = (i === 0 ? 0.18 : i === 1 ? 0.82 : 0.55) * width + Math.sin(t / 9 + phase) * width * 0.05;
            const cy = (i === 0 ? 0.2 : i === 1 ? 0.75 : 0.1) * height + Math.cos(t / 11 + phase) * height * 0.05;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: cx - size / 2,
                  top: cy - size / 2,
                  width: size,
                  height: size,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, ${alpha(color, intensity * (i === 2 ? 0.55 : 0.9))} 0%, transparent 62%)`,
                }}
              />
            );
          })}
        </AbsoluteFill>
      );
      break;
    }
    case "grid": {
      const base = resolveColor(background.base, design, "background");
      const color = alpha(resolveColor(background.color, design, "text"), background.variant === "dots" ? 0.18 : 0.07);
      const spacing = u(background.spacing ?? 64);
      const offset = background.drift ? (t * u(10)) % spacing : 0;
      const pattern =
        background.variant === "dots"
          ? `radial-gradient(${color} ${Math.max(1, u(2))}px, transparent ${Math.max(1, u(2)) + 0.5}px)`
          : `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`;
      layer = (
        <AbsoluteFill style={{ backgroundColor: base }}>
          <AbsoluteFill
            style={{
              backgroundImage: pattern,
              backgroundSize: `${spacing}px ${spacing}px`,
              backgroundPosition: `${offset}px ${offset}px`,
              WebkitMaskImage: background.fade !== false ? "radial-gradient(ellipse at center, black 30%, transparent 78%)" : undefined,
              maskImage: background.fade !== false ? "radial-gradient(ellipse at center, black 30%, transparent 78%)" : undefined,
            }}
          />
        </AbsoluteFill>
      );
      break;
    }
    case "noise": {
      const base = resolveColor(background.base, design, "background");
      layer = (
        <AbsoluteFill style={{ backgroundColor: base }}>
          <Grain amount={(background.intensity ?? 0.5) * 0.3} />
        </AbsoluteFill>
      );
      break;
    }
    case "particles": {
      const base = resolveColor(background.base, design, "background");
      const color = resolveColor(background.color, design, "text");
      const count = background.count ?? 36;
      const speed = background.speed ?? 1;
      layer = (
        <AbsoluteFill style={{ backgroundColor: base, overflow: "hidden" }}>
          {Array.from({ length: count }).map((_, i) => {
            const rx = random(`p-${i}-x`);
            const ry = random(`p-${i}-y`);
            const rs = random(`p-${i}-s`);
            const size = u(2 + rs * 4);
            const y = ((ry * height - t * u(18) * speed * (0.4 + rs)) % height + height) % height;
            const twinkle = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * (0.8 + rs) + i));
            return <div key={i} style={{ position: "absolute", left: rx * width, top: y, width: size, height: size, borderRadius: "50%", background: color, opacity: twinkle * 0.6 }} />;
          })}
        </AbsoluteFill>
      );
      break;
    }
    case "image": {
      const asset = ctx.assets[background.assetId];
      const scale = background.kenBurns ? 1.04 + 0.08 * ease("smooth", sceneProgress) : 1;
      layer = asset ? (
        <AbsoluteFill style={{ overflow: "hidden", backgroundColor: design.colors.background, isolation: "isolate" }}>
          <Img src={asset.src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, filter: background.blur ? `blur(${u(background.blur)}px)` : undefined }} />
          <Tint tint={background.tint} />
          {background.overlay ? <AbsoluteFill style={{ backgroundColor: resolveColor(background.overlay.color, design), opacity: background.overlay.opacity }} /> : null}
        </AbsoluteFill>
      ) : (
        <MissingMedia id={background.assetId} />
      );
      break;
    }
    case "video": {
      const asset = ctx.assets[background.assetId];
      layer = asset ? (
        <AbsoluteFill style={{ overflow: "hidden", backgroundColor: design.colors.background, isolation: "isolate" }}>
          <OffthreadVideo
            src={asset.src}
            muted
            trimBefore={background.startFrom ? Math.round(background.startFrom * ctx.fps) : undefined}
            style={{ width: "100%", height: "100%", objectFit: "cover", filter: background.blur ? `blur(${u(background.blur)}px)` : undefined }}
          />
          <Tint tint={background.tint} />
          {background.overlay ? <AbsoluteFill style={{ backgroundColor: resolveColor(background.overlay.color, design), opacity: background.overlay.opacity }} /> : null}
        </AbsoluteFill>
      ) : (
        <MissingMedia id={background.assetId} />
      );
      break;
    }
  }

  return (
    <AbsoluteFill>
      {layer}
      <Vignette amount={background.vignette ?? 0} />
      <Grain amount={background.grain ?? 0} />
    </AbsoluteFill>
  );
}
