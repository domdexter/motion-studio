import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, Img } from "remotion";
import type { ThumbnailProps } from "../../core/spec/composition";
import { fontStack, loadGoogleFont } from "../engine/fonts";

/**
 * YouTube thumbnail card (1280×720 by default): a frame of the video, darkened toward the text, with a
 * big title and an optional tag in the accent colour.
 */
export function ThumbnailCard(props: ThumbnailProps) {
  const [handle] = useState(() => delayRender("Loading thumbnail fonts", { timeoutInMilliseconds: 30000 }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 10000);
    });
    Promise.race([Promise.all([loadGoogleFont(props.headingFont), loadGoogleFont(props.bodyFont)]), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
      continueRender(handle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unit = Math.min(props.width / 1280, props.height / 720);
  const dark = Math.max(0, Math.min(0.85, props.darken));
  const gradient =
    props.layout === "left"
      ? `linear-gradient(90deg, rgba(0,0,0,${dark}) 0%, rgba(0,0,0,${dark * 0.75}) 45%, rgba(0,0,0,0) 80%)`
      : props.layout === "bottom"
        ? `linear-gradient(0deg, rgba(0,0,0,${dark}) 0%, rgba(0,0,0,${dark * 0.6}) 40%, rgba(0,0,0,0) 75%)`
        : `radial-gradient(ellipse at center, rgba(0,0,0,${dark}) 0%, rgba(0,0,0,${dark * 0.5}) 70%, rgba(0,0,0,${dark * 0.3}) 100%)`;
  const titleSize = (props.title.length > 28 ? 78 : props.title.length > 16 ? 96 : 118) * unit;
  const box: React.CSSProperties =
    props.layout === "left"
      ? { left: 64 * unit, top: 0, bottom: 0, width: "58%", justifyContent: "center", alignItems: "flex-start", textAlign: "left" }
      : props.layout === "bottom"
        ? { left: 64 * unit, right: 64 * unit, bottom: 56 * unit, alignItems: "flex-start", textAlign: "left" }
        : { left: 80 * unit, right: 80 * unit, top: 0, bottom: 0, justifyContent: "center", alignItems: "center", textAlign: "center" };

  return (
    <AbsoluteFill style={{ background: props.background_color, overflow: "hidden" }}>
      {props.background ? <Img src={props.background} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
      <AbsoluteFill style={{ background: gradient }} />
      <div style={{ position: "absolute", display: "flex", flexDirection: "column", ...box }}>
        <div
          style={{
            fontFamily: fontStack(props.headingFont),
            fontWeight: 800,
            fontSize: titleSize,
            lineHeight: 0.95,
            letterSpacing: "-0.025em",
            textTransform: "uppercase",
            color: props.textColor,
            textShadow: `0 ${8 * unit}px ${32 * unit}px rgba(0,0,0,0.6)`,
          }}
        >
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            style={{
              marginTop: 22 * unit,
              background: props.accent,
              color: "#111111",
              fontFamily: fontStack(props.bodyFont),
              fontWeight: 800,
              fontSize: 36 * unit,
              lineHeight: 1,
              letterSpacing: "0.02em",
              padding: `${14 * unit}px ${22 * unit}px`,
              borderRadius: 14 * unit,
              transform: "rotate(-2deg)",
              boxShadow: `0 ${12 * unit}px ${28 * unit}px rgba(0,0,0,0.45)`,
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
