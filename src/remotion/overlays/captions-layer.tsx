import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionCue } from "../../core/publish/captions";
import type { TimedWord } from "../../core/spec/timing";

/**
 * Burned-in subtitles above everything else, from the voice-over's caption cues. Styles: minimal
 * (white with a shadow), boxed (a dark box behind), bold (large outlined), karaoke (spoken words light up).
 */

export type CaptionStyle = "minimal" | "boxed" | "bold" | "karaoke";
export type CaptionPosition = "bottom" | "top" | "center";

export function CaptionsLayer({ cues, words, style, position, font, accent }: { cues: CaptionCue[]; words: TimedWord[]; style: CaptionStyle; position: CaptionPosition; font: string; accent: string }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.startSec && t <= c.endSec);
  if (!cue) return null;
  const unit = Math.min(width, height) / 1080;
  const size = (style === "bold" ? 62 : 48) * unit;
  const place = position === "top" ? { top: height * 0.07 } : position === "center" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: height * 0.08 };
  const textStyle: React.CSSProperties = {
    fontFamily: font,
    fontSize: size,
    fontWeight: style === "bold" ? 900 : 700,
    lineHeight: 1.22,
    color: "#FFFFFF",
    textAlign: "center",
    textTransform: style === "bold" ? "uppercase" : undefined,
    textShadow: style === "boxed" ? undefined : `0 ${3 * unit}px ${14 * unit}px rgba(0,0,0,0.85), 0 0 ${3 * unit}px rgba(0,0,0,0.9)`,
    WebkitTextStroke: style === "bold" ? `${3 * unit}px #000000` : undefined,
    paintOrder: "stroke fill",
  };
  const content =
    style === "karaoke"
      ? words
          .filter((w) => w.start >= cue.startSec - 0.01 && w.start < cue.endSec)
          .map((w, i) => (
            <span key={`${w.start}-${i}`} style={{ color: t >= w.start ? accent : "#FFFFFF", transition: "none" }}>
              {i ? " " : ""}
              {w.text}
            </span>
          ))
      : cue.text;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "10%", right: "10%", display: "flex", justifyContent: "center", ...place }}>
        <div style={{ ...textStyle, ...(style === "boxed" ? { background: "rgba(0,0,0,0.72)", padding: `${10 * unit}px ${24 * unit}px`, borderRadius: 14 * unit } : {}) }}>{content}</div>
      </div>
    </AbsoluteFill>
  );
}
