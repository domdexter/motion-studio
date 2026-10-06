import { useEffect, useMemo, useRef, useState } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, getRemotionEnvironment, Sequence, useVideoConfig } from "remotion";
import { duckGain, speechIntervals } from "../core/audio/ducking";
import type { CompositionTrack, StudioVideoProps } from "../core/spec/composition";
import { allSpecElements } from "../core/spec/scene";
import { voiceGainAtFrame } from "../core/timeline/audio-clips";
import { secondsToFrames } from "../core/timing/frames";
import { fontStack, loadBrandFont, loadGoogleFont } from "./engine/fonts";
import { CaptionsLayer } from "./overlays/captions-layer";
import { OverlayClips } from "./overlays/overlay-clips";
import { SceneView } from "./scene/scene-view";
import { transitionOverlapSec } from "./scene/transition";

/**
 * The master composition. Scenes are Sequences placed on their exact audio-locked frames; overlay
 * clips (images/videos in absolute video time) draw above them, burned-in captions above those; the
 * voice-over plays from frame 0; music/SFX tracks are placed, trimmed, faded and ducked.
 */

function TrackAudio({ track, fps, totalFrames, intervals }: { track: CompositionTrack; fps: number; totalFrames: number; intervals: [number, number][] }) {
  const from = secondsToFrames(track.startSec, fps);
  const available = totalFrames - from;
  if (available <= 0) return null;
  const clipSec = track.durationSec ?? (!track.loop && track.sourceDurationSec !== null ? Math.max(0, track.sourceDurationSec - track.trimStartSec) : null);
  const duration = clipSec !== null ? Math.min(available, Math.max(1, Math.round(clipSec * fps))) : available;
  const fadeIn = track.fadeInSec * fps;
  const fadeOut = track.fadeOutSec * fps;
  return (
    <Sequence from={from} durationInFrames={duration} name={`${track.kind === "music" ? "Music" : track.kind === "voice" ? "Voice line" : "SFX"} · ${track.name}`} layout="none">
      <Audio
        src={track.src}
        // Only pass the trim when there is one: an undefined trimBefore still reaches the DOM audio tag.
        {...(track.trimStartSec > 0 ? { trimBefore: Math.round(track.trimStartSec * fps) } : {})}
        loop={track.loop}
        muted={track.muted}
        volume={(f) => {
          let v = track.volume;
          if (fadeIn > 0) v *= Math.min(1, f / fadeIn);
          if (fadeOut > 0) v *= Math.max(0, Math.min(1, (duration - f) / fadeOut));
          if (track.duckUnderVoice && intervals.length) v *= duckGain((from + f) / fps, intervals);
          return Math.max(0, Math.min(1, v));
        }}
      />
    </Sequence>
  );
}

function fontFamilies(props: StudioVideoProps): string[] {
  const set = new Set([props.design.typography.headingFont, props.design.typography.bodyFont, props.design.typography.monoFont]);
  for (const scene of props.scenes) {
    for (const { element: el } of allSpecElements(scene.spec)) {
      if ((el.type === "text" || el.type === "kinetic") && el.font && !["heading", "body", "mono"].includes(el.font)) set.add(el.font);
    }
  }
  return [...set];
}

/** Blocks rendering until curated + brand fonts are loaded (never longer than 12 s). */
function useStudioFonts(props: StudioVideoProps) {
  const families = fontFamilies(props);
  const key = JSON.stringify([families, props.fonts]);
  const [handle] = useState(() => delayRender("Loading fonts", { timeoutInMilliseconds: 60000 }));
  const released = useRef(false);
  useEffect(() => {
    const custom = new Set(props.fonts.map((f) => f.family));
    const jobs = [...props.fonts.map((f) => loadBrandFont(f.family, f.src)), ...families.filter((f) => !custom.has(f)).map((f) => loadGoogleFont(f))];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 12000);
    });
    Promise.race([Promise.all(jobs), timeout]).finally(() => {
      if (timer) clearTimeout(timer);
      if (!released.current) {
        released.current = true;
        continueRender(handle);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function StudioVideo(props: StudioVideoProps) {
  const { fps, durationInFrames } = useVideoConfig();
  useStudioFonts(props);
  const preview = !getRemotionEnvironment().isRendering;
  const cuts = props.voice?.cuts;
  const intervals = useMemo(() => speechIntervals(props.words, cuts ?? []), [props.words, cuts]);
  const body = fontStack(props.design.typography.bodyFont);

  return (
    <AbsoluteFill className="ms-root" style={{ backgroundColor: props.design.colors.background, fontFamily: body, color: props.design.colors.text, WebkitFontSmoothing: "antialiased" }}>
      <style>{".ms-root, .ms-root * { box-sizing: border-box; } .ms-root { text-rendering: geometricPrecision; }"}</style>
      {props.scenes.length === 0 && preview ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", color: props.design.colors.muted, fontSize: Math.round(Math.min(props.width, props.height) / 30) }}>No scenes yet — generate a storyboard to see your video here.</AbsoluteFill>
      ) : null}
      {props.scenes.map((scene, i) => {
        const from = secondsToFrames(scene.start, fps);
        const end = secondsToFrames(scene.end, fps);
        const next = props.scenes[i + 1];
        const overlap = next ? Math.round(transitionOverlapSec(next.spec, props.design, i + 1) * fps) : 0;
        const length = Math.max(1, Math.min(durationInFrames - from, end - from + overlap));
        if (from >= durationInFrames) return null;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={length} name={`${scene.key} · ${scene.name}`}>
            <SceneView props={props} scene={scene} index={i} preview={preview} />
          </Sequence>
        );
      })}
      {props.overlayClips?.length && !props.preview?.hideOverlays ? <OverlayClips clips={props.preview?.muteAudio ? props.overlayClips.map((c) => ({ ...c, volume: 0 })) : props.overlayClips} intervals={intervals} /> : null}
      {props.captions?.cues.length ? (
        <CaptionsLayer cues={props.captions.cues} words={props.words} style={props.captions.style} position={props.captions.position} font={body} accent={props.design.colors.accent} />
      ) : null}
      {props.voice ? (
        <Audio
          src={props.voice.src}
          volume={cuts?.length ? (f) => props.voice!.volume * voiceGainAtFrame(f, fps, cuts) : props.voice.volume}
          muted={props.voice.muted || !!props.preview?.muteVoice}
        />
      ) : null}
      {props.tracks.map((track) => (
        <TrackAudio key={track.id} track={props.preview?.muteAudio ? { ...track, muted: true } : track} fps={fps} totalFrames={durationInFrames} intervals={intervals} />
      ))}
    </AbsoluteFill>
  );
}
