import { Component, Fragment, useMemo, type ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CompositionScene, StudioVideoProps } from "../../core/spec/composition";
import type { SceneElement, ShotSpec } from "../../core/spec/scene";
import { resolveShotWindows, type ShotWindow } from "../../core/spec/triggers";
import { secondsToFrames } from "../../core/timing/frames";
import { buildSceneContext, SceneContext, shotContext, type SceneContextValue } from "../engine/context";
import { ElementRenderer } from "../elements";
import { SceneBackground } from "./background";
import { cameraStyle, effectiveTransition, shotTransition, transitionStyle } from "./transition";

/**
 * One scene: transition-in → camera → background → elements (z-ordered). Rendered inside a
 * Sequence that starts on the scene's audio-locked frame. A scene with shots renders its shots in
 * order inside the same timing; scene-level elements persist across shots (z < 0 below, z ≥ 0 above).
 */

class ElementErrorBoundary extends Component<{ children: ReactNode; label: string; preview: boolean; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[motion-studio] ${this.props.label} failed to render:`, error);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // Final renders must not silently drop an element: fail with a precise message instead.
    if (!this.props.preview) throw new Error(`${this.props.label} failed to render: ${error.message}`);
    return (
      <div style={{ position: "absolute", left: 16, bottom: 16, maxWidth: "60%", padding: "8px 12px", background: "rgba(220,38,38,0.92)", color: "#fff", fontFamily: "system-ui, sans-serif", fontSize: 14, borderRadius: 8, zIndex: 1000 }}>
        {this.props.label}: {error.message}
      </div>
    );
  }
}

function SafeArea({ margin }: { margin: number }) {
  const { width, height } = useVideoConfig();
  const inset = (Math.min(width, height) * margin) / 100;
  return <div style={{ position: "absolute", left: inset, top: inset, right: inset, bottom: inset, border: "2px dashed rgba(34,211,238,0.55)", borderRadius: 6, pointerEvents: "none", zIndex: 999 }} />;
}

type Ordered = { element: SceneElement; i: number }[];

const byZ = (elements: SceneElement[]): Ordered => elements.map((element, i) => ({ element, i })).sort((a, b) => (a.element.z ?? 0) - (b.element.z ?? 0) || a.i - b.i);

/**
 * An element layer. `isolation: isolate` gives the layer its own stacking context, so an element's
 * z-index orders it within the layer instead of pushing negative-z elements behind the background.
 * In the editor preview each element is tagged with `data-studio-el="<sceneId>:<shotId>:<index>"`
 * (a `display: contents` wrapper, so layout is unchanged) — the editor canvas selects and measures
 * elements through it. Renders get no wrapper.
 */
function Elements({ ordered, label, preview, sceneId, shotId }: { ordered: Ordered; label: string; preview: boolean; sceneId: string; shotId: string | null }) {
  if (!ordered.length) return null;
  return (
    <AbsoluteFill style={{ isolation: "isolate" }}>
      {ordered.map(({ element, i }) => {
        const key = `${sceneId}:${shotId ?? ""}:${i}`;
        const node = (
          <ElementErrorBoundary label={`${label} element #${i + 1} (${element.type}${element.id ? ` “${element.id}”` : ""})`} preview={preview} resetKey={JSON.stringify(element)}>
            <ElementRenderer element={element} tag={preview ? key : undefined} />
          </ElementErrorBoundary>
        );
        return preview ? (
          <div key={`${i}-${element.type}`} data-studio-el={key} style={{ display: "contents" }}>
            {node}
          </div>
        ) : (
          <Fragment key={`${i}-${element.type}`}>{node}</Fragment>
        );
      })}
    </AbsoluteFill>
  );
}

function ShotLayer({ shot, index, window, next, ctx, sceneKey, preview }: { shot: ShotSpec; index: number; window: ShotWindow; next: ShotSpec | undefined; ctx: SceneContextValue; sceneKey: string; preview: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const narrowed = useMemo(() => shotContext(ctx, window), [ctx, window]);
  const ordered = useMemo(() => byZ(shot.elements), [shot.elements]);
  const start = narrowed.segmentStartFrame;
  const end = narrowed.segmentEndFrame;
  const nextTransition = next ? shotTransition(next, ctx.design) : null;
  const overlap = nextTransition ? Math.round((nextTransition.duration ?? 0) * fps) : 0;
  if (frame < start || frame >= end + overlap) return null;
  const local = frame - start;
  const enterStyle = index === 0 ? null : transitionStyle(shotTransition(shot, ctx.design), local, fps, ctx.u(1));
  const camera = cameraStyle(shot.camera, local, Math.max(1, end - start), width, height, fps);
  return (
    <SceneContext.Provider value={narrowed}>
      <AbsoluteFill style={{ overflow: "hidden", ...(enterStyle ?? {}) }}>
        <AbsoluteFill style={camera}>
          {shot.background ? <SceneBackground background={shot.background} /> : null}
          <Elements ordered={ordered} label={`Scene ${sceneKey} shot “${shot.id}”`} preview={preview} sceneId={ctx.scene.id} shotId={shot.id} />
        </AbsoluteFill>
      </AbsoluteFill>
    </SceneContext.Provider>
  );
}

export function SceneView({ props, scene, index, preview }: { props: StudioVideoProps; scene: CompositionScene; index: number; preview: boolean }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ctx = useMemo(() => buildSceneContext({ props, scene, index, fps, width, height, preview }), [props, scene, index, fps, width, height, preview]);
  const transition = effectiveTransition(scene.spec, props.design, index);
  const enterStyle = transitionStyle(transition, frame, fps, ctx.u(1));
  const camera = cameraStyle(scene.spec.camera, frame, ctx.durationInFrames, width, height, fps);
  const background = scene.spec.background ?? props.design.background;
  const ordered = useMemo(() => byZ(scene.spec.elements), [scene.spec.elements]);
  const shots = scene.spec.shots ?? [];
  const windows = useMemo(() => (shots.length ? resolveShotWindows(scene.spec, { words: props.words, sceneStart: scene.start, sceneEnd: scene.end }) : []), [shots.length, scene.spec, props.words, scene.start, scene.end]);
  const label = `Scene ${scene.key}`;

  return (
    <SceneContext.Provider value={ctx}>
      <AbsoluteFill style={{ overflow: "hidden", ...(enterStyle ?? {}) }}>
        <AbsoluteFill style={camera}>
          <SceneBackground background={background} />
          {scene.valid ? (
            shots.length ? (
              <>
                <Elements ordered={ordered.filter((o) => (o.element.z ?? 0) < 0)} label={label} preview={preview} sceneId={scene.id} shotId={null} />
                {shots.map((shot, i) => (
                  <ShotLayer key={shot.id} shot={shot} index={i} window={windows[i]} next={shots[i + 1]} ctx={ctx} sceneKey={scene.key} preview={preview} />
                ))}
                <Elements ordered={ordered.filter((o) => (o.element.z ?? 0) >= 0)} label={label} preview={preview} sceneId={scene.id} shotId={null} />
              </>
            ) : (
              <Elements ordered={ordered} label={label} preview={preview} sceneId={scene.id} shotId={null} />
            )
          ) : (
            preview && (
              <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <div style={{ padding: "14px 20px", borderRadius: 10, background: "rgba(220,38,38,0.9)", color: "#fff", fontFamily: "system-ui, sans-serif", fontSize: ctx.u(28) }}>
                  Scene {scene.key} has an invalid spec — fix it in the Scenes editor.
                </div>
              </AbsoluteFill>
            )
          )}
        </AbsoluteFill>
        {preview && props.overlays?.safeArea ? <SafeArea margin={props.design.layout.safeMargin} /> : null}
        {preview && props.overlays?.sceneLabels ? (
          <div style={{ position: "absolute", left: ctx.u(20), top: ctx.u(20), padding: `${ctx.u(6)}px ${ctx.u(12)}px`, borderRadius: ctx.u(8), background: "rgba(0,0,0,0.6)", color: "#fff", fontFamily: "system-ui, sans-serif", fontSize: ctx.u(22), zIndex: 999 }}>
            {scene.key} · {scene.name}
            {shots.length ? ` · ${windows.filter((w) => secondsToFrames(w.start, fps) - ctx.startFrame <= frame).pop()?.id ?? ""}` : ""}
          </div>
        ) : null}
      </AbsoluteFill>
    </SceneContext.Provider>
  );
}
