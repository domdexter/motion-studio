import type { CSSProperties } from "react";
import { useCurrentFrame } from "remotion";
import { TEXT_ROLE_SIZES, TYPE_SCALE_MULTIPLIER } from "../../core/spec/design";
import type { ElementOf } from "../../core/spec/scene";
import type { TimedWord } from "../../core/spec/timing";
import { normalizeWord, endsClause, endsSentence } from "../../core/util/text";
import { alpha, mix, resolveColor } from "../engine/color";
import { useScene, type SceneContextValue } from "../engine/context";
import { clamp01, ease } from "../engine/easing";
import { fontStack } from "../engine/fonts";
import { StudioIcon } from "../engine/icon";
import { ElementBox } from "../engine/layout";

/**
 * Typography: TextElement (WordReveal, CharacterReveal, TextFade/Slide/Scale via motion,
 * TextMask, typewriter, HighlightWord), KineticText, Captions and Badge.
 */

const HEADING_ROLES = new Set(["display", "headline", "title", "quote"]);

function typographyFor(el: ElementOf<"text">, ctx: SceneContextValue) {
  const { design, u } = ctx;
  const role = el.role ?? "title";
  const heading = HEADING_ROLES.has(role);
  const size = u(el.size ?? TEXT_ROLE_SIZES[role] * TYPE_SCALE_MULTIPLIER[design.typography.scale]);
  const family =
    el.font === "heading" || (!el.font && heading)
      ? design.typography.headingFont
      : el.font === "mono"
        ? design.typography.monoFont
        : el.font && el.font !== "body"
          ? el.font
          : design.typography.bodyFont;
  return {
    role,
    heading,
    fontSize: size,
    fontFamily: fontStack(family),
    fontWeight: el.weight ?? (role === "eyebrow" || role === "label" ? 600 : heading ? design.typography.headingWeight : design.typography.bodyWeight),
    color: resolveColor(el.color, design, role === "caption" || role === "label" || role === "eyebrow" ? "muted" : "text"),
    lineHeight: el.lineHeight ?? (heading ? design.typography.lineHeight : 1.4),
    letterSpacing: `${el.letterSpacing ?? (role === "eyebrow" ? 0.16 : heading ? design.typography.headingLetterSpacing : 0)}em`,
    textTransform: (el.transform ?? (role === "eyebrow" ? "uppercase" : heading ? design.typography.headingTransform : "none")) as CSSProperties["textTransform"],
    fontStyle: role === "quote" ? "italic" : undefined,
  };
}

/** Maps each visible word token (in order) to the frame it is spoken inside the scene. */
function spokenFrames(tokens: string[], sceneWords: TimedWord[], ctx: SceneContextValue): (number | null)[] {
  const result: (number | null)[] = new Array(tokens.length).fill(null);
  let cursor = 0;
  tokens.forEach((token, i) => {
    const norm = normalizeWord(token);
    if (!norm) return;
    for (let j = cursor; j < sceneWords.length; j++) {
      if (normalizeWord(sceneWords[j].text) === norm) {
        result[i] = ctx.frameOfWord(sceneWords[j].i);
        cursor = j + 1;
        return;
      }
    }
  });
  return result;
}

export function TextElementView({ element }: { element: ElementOf<"text"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const typo = typographyFor(element, ctx);
  const maxWidth = ((element.maxWidth ?? (ctx.portrait ? 86 : 76)) / 100) * ctx.width;
  const align = element.align ?? "center";
  const parts = element.text.split(/(\s+)/);
  const wordTokens = parts.filter((p) => p.trim().length > 0);
  const enterType = element.enter?.type;
  const highlight = element.highlight;
  const highlightSet = new Set((highlight?.words ?? []).flatMap((w) => w.split(/\s+/)).map(normalizeWord));
  const highlightColor = resolveColor(highlight?.color, ctx.design, "primary");
  const spoken = enterType === "wordReveal" && element.syncToVoice ? spokenFrames(wordTokens, ctx.segmentWords, ctx) : null;
  const spokenForHighlight = highlight?.at === "spoken" ? spokenFrames(wordTokens, ctx.segmentWords, ctx) : null;

  return (
    <ElementBox element={element} width={maxWidth}>
      {(motion) => {
        const stagger = ctx.frames(element.enter?.stagger ?? ctx.design.motion.stagger);
        const wordDuration = Math.max(1, ctx.frames(Math.min(0.6, ctx.design.motion.defaultDuration)));
        let wordIndex = -1;
        let charOffset = 0;
        const totalChars = element.text.length;
        const typedChars = enterType === "typewriter" ? Math.floor(clamp01((frame - motion.enterFrame) / Math.max(1, ctx.frames(element.enter?.duration ?? Math.max(0.6, totalChars * 0.035)))) * totalChars) : totalChars;
        const caret = (
          <span style={{ display: "inline-block", width: "0.06em", height: "0.9em", marginLeft: "0.04em", marginRight: "-0.1em", background: typo.color, opacity: Math.floor(frame / Math.max(1, ctx.fps / 3)) % 2 ? 0 : 1, verticalAlign: "-0.08em" }} />
        );

        const gradientStyle: CSSProperties = element.gradient
          ? {
              backgroundImage: `linear-gradient(90deg, ${ctx.design.colors.primary}, ${ctx.design.colors.secondary})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }
          : {};

        return (
          <div
            style={{
              width: "100%",
              textAlign: align,
              fontSize: typo.fontSize,
              fontFamily: typo.fontFamily,
              fontWeight: typo.fontWeight,
              color: typo.color,
              lineHeight: typo.lineHeight,
              letterSpacing: typo.letterSpacing,
              textTransform: typo.textTransform,
              fontStyle: typo.fontStyle,
              // pre-line keeps explicit line breaks but drops the space at a wrap point
              // (pre-wrap left it at the start of the next line, misaligning wrapped headlines).
              whiteSpace: "pre-line",
              textWrap: "balance",
              ...gradientStyle,
            }}
          >
            {parts.map((part, pi) => {
              if (!part.trim()) {
                charOffset += part.length;
                return <span key={pi}>{part}</span>;
              }
              wordIndex++;
              const wi = wordIndex;
              const startChar = charOffset;
              charOffset += part.length;
              const norm = normalizeWord(part);
              const isHighlighted = highlightSet.has(norm);

              // Highlight progress
              let hp = 0;
              if (isHighlighted) {
                const hlStart = spokenForHighlight?.[wi] ?? motion.enterFrame + stagger * wi + ctx.frames(0.25);
                hp = ease("expoOut", (frame - hlStart) / Math.max(1, ctx.frames(0.45)));
              }
              const style: CSSProperties = { display: "inline-block", position: "relative" };
              if (isHighlighted && highlight) {
                const hs = highlight.style ?? "color";
                if (hs === "color") style.color = mix(typo.color.startsWith("#") ? typo.color : "#FFFFFF", highlightColor, hp);
                if (hs === "marker") {
                  style.backgroundImage = `linear-gradient(${alpha(highlightColor, 0.4)}, ${alpha(highlightColor, 0.4)})`;
                  style.backgroundRepeat = "no-repeat";
                  style.backgroundPosition = "0 88%";
                  style.backgroundSize = `${hp * 100}% 38%`;
                }
                if (hs === "underline") {
                  style.backgroundImage = `linear-gradient(${highlightColor}, ${highlightColor})`;
                  style.backgroundRepeat = "no-repeat";
                  style.backgroundPosition = "0 96%";
                  style.backgroundSize = `${hp * 100}% 0.07em`;
                }
                if (hs === "box") {
                  style.background = alpha(highlightColor, 0.2 * hp);
                  style.borderRadius = "0.18em";
                  style.padding = "0 0.12em";
                  style.margin = "0 -0.12em";
                }
              }

              if (enterType === "wordReveal") {
                const start = spoken?.[wi] ?? motion.enterFrame + stagger * wi;
                const pw = ease("expoOut", (frame - start) / wordDuration);
                style.opacity = pw;
                style.transform = `translateY(${(1 - pw) * 0.42}em)`;
                if (pw < 0.98) style.filter = `blur(${(1 - pw) * ctx.u(10)}px)`;
                return (
                  <span key={pi} style={style}>
                    {part}
                  </span>
                );
              }
              if (enterType === "mask") {
                const start = motion.enterFrame + stagger * wi;
                const pw = ease("expoOut", (frame - start) / wordDuration);
                return (
                  <span key={pi} style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.08em", marginBottom: "-0.08em" }}>
                    <span style={{ ...style, transform: `translateY(${(1 - pw) * 110}%)` }}>{part}</span>
                  </span>
                );
              }
              if (enterType === "charReveal") {
                const charStagger = Math.max(0.5, ctx.frames(element.enter?.stagger ?? 0.022));
                return (
                  <span key={pi} style={style}>
                    {[...part].map((ch, ci) => {
                      const start = motion.enterFrame + (startChar + ci) * charStagger * 0.5;
                      const pc = ease("expoOut", (frame - start) / Math.max(1, ctx.frames(0.35)));
                      return (
                        <span key={ci} style={{ display: "inline-block", opacity: pc, transform: `translateY(${(1 - pc) * 0.3}em)` }}>
                          {ch}
                        </span>
                      );
                    })}
                  </span>
                );
              }
              if (enterType === "typewriter") {
                const visible = Math.max(0, Math.min(part.length, typedChars - startChar));
                // The caret follows the typed characters (the untyped rest keeps its layout space).
                const caretHere = frame >= motion.enterFrame && typedChars < totalChars && typedChars >= startChar && typedChars <= startChar + part.length;
                return (
                  <span key={pi} style={style}>
                    <span>{part.slice(0, visible)}</span>
                    {caretHere ? caret : null}
                    <span style={{ opacity: 0 }}>{part.slice(visible)}</span>
                  </span>
                );
              }
              return (
                <span key={pi} style={style}>
                  {part}
                </span>
              );
            })}
          </div>
        );
      }}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// KineticText — narration becomes typography, word by word, in sync with the voice
// ---------------------------------------------------------------------------------------

interface KWord {
  text: string;
  frame: number;
  endFrame: number;
}

function kineticWords(el: ElementOf<"kinetic">, ctx: SceneContextValue): KWord[] {
  if ((el.source ?? "voice") === "voice" && ctx.segmentWords.length) {
    return ctx.segmentWords.map((w) => ({ text: w.text, frame: ctx.frameOfWord(w.i), endFrame: ctx.frameOfWord(w.i, "end") }));
  }
  const tokens = (el.text ?? ctx.scene.spec.notes ?? "").split(/\s+/).filter(Boolean);
  const step = (ctx.segmentEndFrame - ctx.segmentStartFrame) / Math.max(1, tokens.length + 1);
  return tokens.map((text, i) => ({ text, frame: ctx.segmentStartFrame + Math.round(step * (i + 0.3)), endFrame: ctx.segmentStartFrame + Math.round(step * (i + 1)) }));
}

function groupPhrases(words: KWord[], maxWords: number, fps: number): KWord[][] {
  const phrases: KWord[][] = [];
  let current: KWord[] = [];
  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    const pause = next ? (next.frame - w.endFrame) / fps : 1;
    if (!next || endsSentence(w.text) || endsClause(w.text) || pause > 0.35 || current.length >= maxWords) {
      phrases.push(current);
      current = [];
    }
  });
  return phrases;
}

export function KineticElementView({ element }: { element: ElementOf<"kinetic"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { design, u } = ctx;
  const words = kineticWords(element, ctx);
  const mode = element.mode ?? "phrase";
  const maxWidth = ((element.maxWidth ?? (ctx.portrait ? 88 : 80)) / 100) * ctx.width;
  const fontSize = u(element.size ?? (mode === "word" ? 180 : ctx.portrait ? 100 : 112));
  const color = resolveColor(element.color, design, "text");
  const active = resolveColor(element.activeColor, design, "primary");
  const emphasis = new Set((element.emphasisWords ?? []).flatMap((w) => w.split(/\s+/)).map(normalizeWord));
  const pop = Math.max(1, ctx.frames(0.28));
  const baseStyle: CSSProperties = {
    fontFamily: fontStack(element.font === "body" ? design.typography.bodyFont : element.font && element.font !== "heading" ? element.font : design.typography.headingFont),
    fontWeight: element.weight ?? design.typography.headingWeight,
    fontSize,
    lineHeight: design.typography.lineHeight,
    letterSpacing: `${design.typography.headingLetterSpacing}em`,
    textTransform: element.transform ?? design.typography.headingTransform,
    textAlign: element.align ?? "center",
    color,
    width: "100%",
  };

  const wordSpan = (w: KWord, key: number, opts: { hideUnspoken: boolean; dimUnspoken?: boolean }) => {
    const p = ease("expoOut", (frame - w.frame) / pop);
    const isEmphasis = emphasis.has(normalizeWord(w.text));
    const speaking = frame >= w.frame && frame <= w.endFrame + ctx.frames(0.1);
    const style: CSSProperties = {
      display: "inline-block",
      marginRight: "0.24em",
      color: isEmphasis ? active : color,
      transformOrigin: "50% 80%",
    };
    if (opts.hideUnspoken) {
      style.opacity = p;
      style.transform = `translateY(${(1 - p) * 0.25}em) scale(${0.94 + 0.06 * p})`;
    } else if (opts.dimUnspoken) {
      style.opacity = 0.28 + 0.72 * p;
      if (speaking) style.color = isEmphasis ? active : mix(color.startsWith("#") ? color : "#FFFFFF", active, 0.35);
    }
    return (
      <span key={key} style={style}>
        {w.text}
      </span>
    );
  };

  return (
    <ElementBox element={element} width={maxWidth}>
      {() => {
        if (!words.length) return null;
        if (mode === "word") {
          let idx = 0;
          for (let i = 0; i < words.length; i++) if (words[i].frame <= frame) idx = i;
          const w = words[idx];
          const p = ease("backOut", (frame - w.frame) / pop);
          return (
            <div style={{ ...baseStyle, whiteSpace: "nowrap" }}>
              <span style={{ display: "inline-block", transform: `scale(${0.8 + 0.2 * p})`, opacity: clamp01((frame - w.frame + 2) / 3), color: emphasis.has(normalizeWord(w.text)) ? active : color }}>{w.text}</span>
            </div>
          );
        }
        if (mode === "karaoke") {
          return <div style={baseStyle}>{words.map((w, i) => wordSpan(w, i, { hideUnspoken: false, dimUnspoken: true }))}</div>;
        }
        const phrases = groupPhrases(words, ctx.portrait ? 3 : 4, ctx.fps);
        let current = 0;
        for (let i = 0; i < phrases.length; i++) if (phrases[i][0].frame - ctx.frames(0.05) <= frame) current = i;
        if (mode === "stack") {
          const visible = phrases.slice(0, current + 1).slice(-3);
          return (
            <div style={{ ...baseStyle, display: "flex", flexDirection: "column", gap: "0.1em" }}>
              {visible.map((ph, i) => {
                const age = visible.length - 1 - i;
                return (
                  <div key={`${current}-${i}`} style={{ opacity: age === 0 ? 1 : 0.32, transform: `scale(${age === 0 ? 1 : 0.9})`, transition: "none" }}>
                    {ph.map((w, k) => wordSpan(w, k, { hideUnspoken: true }))}
                  </div>
                );
              })}
            </div>
          );
        }
        const phrase = phrases[current];
        return <div style={baseStyle}>{phrase.map((w, k) => wordSpan(w, k, { hideUnspoken: true }))}</div>;
      }}
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------------------

export function CaptionsElementView({ element }: { element: ElementOf<"captions"> }) {
  const frame = useCurrentFrame();
  const ctx = useScene();
  const { design, u } = ctx;
  const maxWords = element.maxWords ?? (ctx.portrait ? 4 : 7);
  const words = ctx.segmentWords.map((w) => ({ text: w.text, frame: ctx.frameOfWord(w.i), endFrame: ctx.frameOfWord(w.i, "end") }));
  const chunks = groupPhrases(words, maxWords, ctx.fps);
  let current = -1;
  for (let i = 0; i < chunks.length; i++) if (chunks[i][0].frame <= frame) current = i;
  const chunk = chunks[current];
  const variant = element.variant ?? "boxed";
  const position = element.position ?? "bottom";
  const y = element.y ?? (position === "top" ? 12 : position === "center" ? 50 : ctx.portrait ? 78 : 86);
  const fontSize = u(element.size ?? (variant === "bold" ? 64 : 44));
  const lastFrame = chunk ? chunk[chunk.length - 1].endFrame + ctx.frames(0.5) : 0;
  return (
    <ElementBox element={{ ...element, y }} width={ctx.width * (ctx.portrait ? 0.88 : 0.72)}>
      {() =>
        chunk && frame <= lastFrame ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <div
              style={{
                fontFamily: fontStack(variant === "bold" ? design.typography.headingFont : design.typography.bodyFont),
                fontWeight: variant === "bold" ? 800 : 600,
                fontSize,
                lineHeight: 1.25,
                textAlign: "center",
                color: "#FFFFFF",
                textTransform: variant === "bold" ? "uppercase" : "none",
                padding: variant === "boxed" ? `${u(10)}px ${u(22)}px` : 0,
                borderRadius: u(14),
                background: variant === "boxed" ? "rgba(0,0,0,0.62)" : "transparent",
                textShadow: variant === "boxed" ? undefined : `0 ${u(3)}px ${u(12)}px rgba(0,0,0,0.75)`,
              }}
            >
              {chunk.map((w, i) => (
                <span key={i} style={{ color: variant === "karaoke" && frame >= w.frame ? design.colors.primary : undefined, opacity: variant === "karaoke" ? 1 : clamp01((frame - chunk[0].frame + 2) / 4) }}>
                  {w.text}
                  {i < chunk.length - 1 ? " " : ""}
                </span>
              ))}
            </div>
          </div>
        ) : null
      }
    </ElementBox>
  );
}

// ---------------------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------------------

export function BadgeElementView({ element }: { element: ElementOf<"badge"> }) {
  const ctx = useScene();
  const { design, u } = ctx;
  const color = resolveColor(element.color, design, "primary");
  const variant = element.variant ?? "soft";
  const fontSize = u(element.size ?? 24);
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: u(10),
    padding: `${u(10)}px ${u(20)}px`,
    borderRadius: 999,
    fontFamily: fontStack(design.typography.bodyFont),
    fontWeight: 600,
    fontSize,
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
    color: variant === "solid" ? "#FFFFFF" : variant === "glass" ? design.colors.text : color,
    background: variant === "solid" ? color : variant === "soft" ? alpha(color, 0.14) : variant === "glass" ? alpha(design.colors.surface, 0.5) : "transparent",
    border: `1px solid ${variant === "outline" ? alpha(color, 0.6) : variant === "glass" ? alpha(design.colors.text, 0.14) : "transparent"}`,
    backdropFilter: variant === "glass" ? `blur(${u(18)}px)` : undefined,
  };
  return (
    <ElementBox element={element}>
      {() => (
        <div style={style}>
          {element.icon ? <StudioIcon name={element.icon} size={fontSize * 1.1} color={style.color as string} /> : null}
          {element.text}
        </div>
      )}
    </ElementBox>
  );
}
