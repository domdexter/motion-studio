import type { CSSProperties, ReactNode } from "react";
import { Freeze, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { annotationVisibility, clipSecForSource, CLICK_RIPPLE_SEC, cropBox, sourceSecAt, type Annotation, type Crop, type RemapClip } from "../../core/timeline/clip-edits";

/**
 * Layers shared by overlay clips and media inside scenes: the crop (the visible part fills the clip's
 * frame), speed-remapped video (speed ramps and freeze frames), and annotations drawn on the picture.
 */

/** Positions media so only its cropped part shows in the frame. */
export function CropFrame({ crop, children }: { crop: Crop | null | undefined; children: ReactNode }) {
  const box = cropBox(crop);
  if (!box) return <>{children}</>;
  return <div style={{ position: "absolute", ...box }}>{children}</div>;
}

/**
 * A video whose speed changes over time. Every frame shows the exact source frame for that moment
 * (so the clip's own audio is muted). After the trimmed part it holds its last frame or loops.
 */
export function RemappedVideo({
  src,
  clip,
  trimEndSec,
  sourceDurationSec,
  loop,
  style,
}: {
  src: string;
  clip: RemapClip;
  /** Source out-point (null = the end of the source). */
  trimEndSec: number | null;
  sourceDurationSec: number | null;
  loop: boolean;
  style: CSSProperties;
}) {
  const frame = useCurrentFrame();
  const fps = useFpsFromFrame();
  const end = trimEndSec ?? sourceDurationSec;
  const playSec = end !== null ? clipSecForSource(clip, end) : null;
  let t = frame / fps;
  if (playSec !== null && playSec > 0 && t >= playSec) t = loop ? t % playSec : Math.max(0, playSec - 1 / fps);
  const last = sourceDurationSec ? Math.max(0, sourceDurationSec - 1 / fps) : Infinity;
  const sourceFrame = Math.max(0, Math.round(Math.min(sourceSecAt(clip, t), last) * fps));
  return (
    <Freeze frame={sourceFrame}>
      <OffthreadVideo src={src} muted style={style} />
    </Freeze>
  );
}

/** Frames per second of the composition (RemappedVideo is always rendered inside it). */
function useFpsFromFrame(): number {
  return useVideoConfig().fps;
}

const DEFAULT_COLOR = "#FFD23F";

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `${x2},${y2} ${x2 + size * Math.cos(a1)},${y2 + size * Math.sin(a1)} ${x2 + size * Math.cos(a2)},${y2 + size * Math.sin(a2)}`;
}

/** Annotations at clip second `timeSec`, drawn over a frame of `width` × `height` pixels. */
export function AnnotationLayer({ annotations, timeSec, width, height }: { annotations: Annotation[] | undefined; timeSec: number; width: number; height: number }) {
  if (!annotations?.length) return null;
  const unit = Math.min(width, height) / 1080;
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {annotations.map((a) => {
        const color = a.color ?? DEFAULT_COLOR;
        const left = a.x * width;
        const top = a.y * height;
        const w = a.w * width;
        const h = a.h * height;
        if (a.type === "click") {
          const p = (timeSec - a.startSec) / CLICK_RIPPLE_SEC;
          if (p < 0 || p > 1) return null;
          const ring = (14 + p * 70) * unit;
          const dot = 9 * unit;
          return (
            <div key={a.id}>
              <div style={{ position: "absolute", left: left - ring, top: top - ring, width: ring * 2, height: ring * 2, borderRadius: "50%", border: `${Math.max(2, 5 * unit)}px solid ${color}`, opacity: 1 - p }} />
              <div style={{ position: "absolute", left: left - dot, top: top - dot, width: dot * 2, height: dot * 2, borderRadius: "50%", background: color, opacity: Math.min(1, (1 - p) * 2), boxShadow: `0 0 ${12 * unit}px ${color}` }} />
            </div>
          );
        }
        const visible = annotationVisibility(a, timeSec);
        if (visible <= 0) return null;
        switch (a.type) {
          case "blur":
            return (
              <div
                key={a.id}
                style={{ position: "absolute", left, top, width: w, height: h, borderRadius: 8 * unit, opacity: visible, backdropFilter: `blur(${(6 + (a.strength ?? 0.6) * 30) * unit}px)`, WebkitBackdropFilter: `blur(${(6 + (a.strength ?? 0.6) * 30) * unit}px)`, background: "rgba(128,128,128,0.18)" }}
              />
            );
          case "box":
            return <div key={a.id} style={{ position: "absolute", left, top, width: w, height: h, borderRadius: 10 * unit, border: `${Math.max(2, 5 * unit)}px solid ${color}`, boxShadow: `0 0 ${18 * unit}px ${color}66`, opacity: visible }} />;
          case "spotlight": {
            const dark = 0.35 + (a.strength ?? 0.6) * 0.5;
            return (
              <div
                key={a.id}
                style={{ position: "absolute", inset: 0, opacity: visible, background: `radial-gradient(${Math.max(1, w / 2)}px ${Math.max(1, h / 2)}px at ${left + w / 2}px ${top + h / 2}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 96%, rgba(0,0,0,${dark}) 100%)` }}
              />
            );
          }
          case "label":
            return (
              <div
                key={a.id}
                style={{ position: "absolute", left, top, maxWidth: width - left, padding: `${10 * unit}px ${18 * unit}px`, borderRadius: 12 * unit, background: color, color: "#111111", fontWeight: 700, fontSize: 34 * unit, lineHeight: 1.2, opacity: visible, boxShadow: `0 ${10 * unit}px ${28 * unit}px rgba(0,0,0,0.35)` }}
              >
                {a.text || "Label"}
              </div>
            );
          case "arrow": {
            const x2 = left + w;
            const y2 = top + h;
            const stroke = Math.max(3, 7 * unit);
            return (
              <svg key={a.id} width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0, opacity: visible, overflow: "visible" }}>
                <line x1={left} y1={top} x2={x2} y2={y2} stroke={color} strokeWidth={stroke} strokeLinecap="round" />
                <polygon points={arrowHead(left, top, x2, y2, stroke * 4)} fill={color} />
              </svg>
            );
          }
        }
        return null;
      })}
    </div>
  );
}
