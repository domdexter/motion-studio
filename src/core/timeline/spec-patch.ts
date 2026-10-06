import { z } from "zod";
import { grammarEnter } from "../creative/grammar";
import { DEFAULT_DEPTH } from "../spec/animatable";
import { elementPropertyKeys, SHADOW_KINDS } from "../spec/element-properties";
import { AnchorSchema, BlendSchema, CameraSchema, CLIP_REVEALS, CLIP_SHAPES, ClipSchema, ColorSchema, EasingSchema, EmphasisSchema, ENTER_ANIMATIONS, EXIT_ANIMATIONS, IdleSchema, KeyframeSchema, MAX_KEYFRAMES, MOTION_DENSITIES, MOTION_INTENTS, MOTION_ROLES, MotionPathSchema, PointSchema, TRANSITIONS, type Camera, type EnterAnimation, type ExitAnimation, type SceneElement, type SceneSpec, type Transition } from "../spec/scene";
import { sortKeyframes } from "../motion/keyframes";
import type { CueId, TriggerContext } from "../spec/triggers";
import { croppedAspect } from "./clip-edits";
import { CueError, CuePatchSchema, isCutExit, setElementCue } from "./element-cues";
import { MOTION_CUT_SEC, SCENE_MEDIA_PLACEMENTS, scenePlacementLayout, type FrameSize } from "./element-layout";
import { DEFAULT_EXIT_SEC } from "./media-clip";
import { keyframesAfterRetime } from "./scene-restructure";

/**
 * Patches of a scene spec made by the editor: the properties of one element, and the scene's look
 * (transition, camera, motion density). The server applies them and validates the result; the editor
 * applies the same function to show the change in the preview while it saves, so what you see while
 * editing is exactly what is saved. A patch only touches the fields it names: `null` removes a field
 * (the renderer's default applies again), anything left out stays as it was.
 */

export class SpecPatchError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const StylePatchSchema = z
  .object({
    color: ColorSchema.nullable(),
    background: ColorSchema.nullable(),
    borderColor: ColorSchema.nullable(),
    borderWidth: z.number().min(0).max(40).nullable(),
    radius: z.number().min(0).max(2000).nullable(),
    shadow: z.enum(SHADOW_KINDS).nullable(),
    blur: z.number().min(0).max(200).nullable(),
    padding: z.number().min(0).max(400).nullable(),
    glass: z.boolean().nullable(),
  })
  .partial()
  .strict();

/** Effects, key by key: null removes one (the renderer's neutral value applies again). */
export const EffectsPatchSchema = z
  .object({
    blur: z.number().min(0).max(100).nullable(),
    glow: z.number().min(0).max(100).nullable(),
    glowColor: ColorSchema.nullable(),
    shadowBlur: z.number().min(0).max(100).nullable(),
    shadowX: z.number().min(-100).max(100).nullable(),
    shadowY: z.number().min(-100).max(100).nullable(),
    shadowColor: ColorSchema.nullable(),
    brightness: z.number().min(0).max(4).nullable(),
    contrast: z.number().min(0).max(4).nullable(),
    saturate: z.number().min(0).max(4).nullable(),
  })
  .partial()
  .strict();

/** The clip shape, key by key (merged into the element's clip; a new clip without a type is a rect). */
export const ClipPatchSchema = z
  .object({
    type: z.enum(CLIP_SHAPES),
    inset: ClipSchema.shape.inset.unwrap().nullable(),
    radius: z.number().min(0).max(50).nullable(),
    progress: z.number().min(0).max(1).nullable(),
    reveal: z.enum(CLIP_REVEALS).nullable(),
  })
  .partial()
  .strict();

export const ElementPatchSchema = z
  .object({
    /** Percent of the frame width / height at the element's anchor (null: the centre). */
    x: z.number().min(-100).max(200).nullable(),
    y: z.number().min(-100).max(200).nullable(),
    /** Percent of the frame width, or null to size from the content (media: from the height and its aspect ratio). */
    width: z.number().positive().max(400).nullable(),
    /** Percent of the frame height, or null to size from the content. */
    height: z.number().positive().max(400).nullable(),
    /** The point of the element that x/y place (null: its centre). */
    anchor: AnchorSchema.nullable(),
    rotation: z.number().min(-3600).max(3600).nullable(),
    scale: z.number().positive().max(20).nullable(),
    opacity: z.number().min(0).max(1).nullable(),
    /** Layer: higher draws on top; negative sits behind scene-level shots. */
    z: z.number().int().min(-100).max(100).nullable(),
    /** Merged into the entrance (its cue is kept); null removes a setting so the design default applies. */
    enter: z
      .object({
        type: z.enum(ENTER_ANIMATIONS),
        duration: z.number().positive().max(10).nullable(),
        delay: z.number().min(-5).max(30).nullable(),
        easing: EasingSchema.nullable(),
        stagger: z.number().min(0).max(2).nullable(),
        distance: z.number().min(0).max(2000).nullable(),
      })
      .partial()
      .strict(),
    /** Merged into the exit (the moment it's gone is kept), or null / type "none" for no exit animation. */
    exit: z
      .object({ type: z.enum(EXIT_ANIMATIONS), duration: z.number().positive().max(10), easing: EasingSchema.nullable(), distance: z.number().min(0).max(2000).nullable() })
      .partial()
      .strict()
      .nullable(),
    idle: IdleSchema.nullable(),
    motionRole: z.enum(MOTION_ROLES).nullable(),
    motionIntent: z.enum(MOTION_INTENTS).nullable(),
    /** Extra one-axis scale (1 = none), or null for none. */
    scaleX: z.number().min(0).max(20).nullable(),
    scaleY: z.number().min(0).max(20).nullable(),
    /** What rotation and scale turn around, in % of the element's own box, or null for its centre. */
    pivot: PointSchema.nullable(),
    /** Tilt in 3D, in degrees (X leans the top back, Y swings the right edge back), or null for flat. */
    rotateX: z.number().min(-3600).max(3600).nullable(),
    rotateY: z.number().min(-3600).max(3600).nullable(),
    /** The viewer's distance from a tilted element, in u, or null for the default. */
    depth: z.number().min(100).max(20000).nullable(),
    /** The curve it travels along, or null to leave it where it is. */
    motionPath: MotionPathSchema.nullable(),
    /** How far along that curve it has travelled (0–1). */
    pathProgress: z.number().min(0).max(1).nullable(),
    /** Merged into the element's style; null removes a key. */
    style: StylePatchSchema,
    /** How it mixes with what is underneath, or null / "normal" for no blending. */
    blend: BlendSchema.nullable(),
    /** Merged into the element's effects; null removes them all, a null key removes that one. */
    effects: EffectsPatchSchema.nullable(),
    /** Merged into the element's clip shape; null removes the clip. */
    clip: ClipPatchSchema.nullable(),
    /** Type-specific fields (text, size, data, items, variant…); null removes one. */
    props: z.record(z.string().min(1).max(40), z.unknown()),
    /** When it appears, in seconds into the scene (a time cue replaces its entrance cue), or null to appear when its scene or shot starts. */
    appearAt: z.number().min(0).max(3600).nullable(),
    /** When it's gone, in seconds into the scene, or null to stay until its scene or shot ends. */
    disappearAt: z.number().min(0).max(3600).nullable(),
    /** Images and videos: re-place with a preset (sets position, size and layer). */
    placement: z.enum(SCENE_MEDIA_PLACEMENTS),
    /**
     * Cues by id — "enter", "exit", "emphasis:0", "pressAt", "item:2", "click:0", "path:1"… (see
     * element-cues.ts): the trigger each fires on, or null to clear it (an emphasis moment or click is
     * removed, an entrance or exit follows its scene or shot again).
     */
    cues: CuePatchSchema,
    /** The element's emphasis moments (replaces the list), or null for none. */
    emphasis: z.array(EmphasisSchema).max(24).nullable(),
    /** The element's property keyframes (replaces the list; times are seconds after it appears), or null for none. */
    keyframes: z.array(KeyframeSchema).max(MAX_KEYFRAMES).nullable(),
  })
  .partial()
  .strict();
export type ElementPatch = z.input<typeof ElementPatchSchema>;

export interface ElementPatchContext {
  /** Video frame size (placement presets). */
  frame?: FrameSize;
  /** Width ÷ height of an image or video asset (placement presets), when known. */
  assetAspect?: number | null;
  /** Seconds the scene lasts (appearAt / disappearAt). */
  sceneDurationSec?: number;
  /**
   * The element's scene timing, narrowed to its shot. With it, an edit that changes when an element with
   * keyframes appears or leaves keeps them in place (see `keyframesAfterRetime`); without it they stay
   * relative to its appearance.
   */
  segment?: TriggerContext;
}

/** "x", "style.radius", "props.text", "cues.enter"… — the fields a patch changes (undo labels and merging repeated tweaks). */
export function elementPatchKeys(patch: ElementPatch): string[] {
  return Object.entries(patch).flatMap(([key, value]) => (key === "style" || key === "props" || key === "cues" || key === "effects" || key === "clip") && value && typeof value === "object" ? Object.keys(value).map((k) => `${key}.${k}`) : [key]);
}

/** Copies `source` onto `target` key by key: null removes a key, undefined leaves it. */
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null) delete target[key];
    else if (value !== undefined) target[key] = value;
  }
  return target;
}

/** The element with the patch applied (not validated — the scene spec schema checks the result). */
export function applyElementPatch(element: SceneElement, patch: ElementPatch, context: ElementPatchContext): SceneElement {
  const next: Record<string, unknown> = { ...element };
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null) delete next[key];
    else next[key] = value;
  };
  const media = element.type === "image" || element.type === "video";

  if (patch.x !== undefined) set("x", patch.x === null ? undefined : r2(patch.x));
  if (patch.y !== undefined) set("y", patch.y === null ? undefined : r2(patch.y));
  if (patch.width !== undefined) set("width", patch.width === null ? undefined : r2(patch.width));
  if (patch.height !== undefined) set("height", patch.height === null ? undefined : r2(patch.height));
  if (patch.anchor !== undefined) set("anchor", patch.anchor === "center" ? undefined : patch.anchor);
  if (patch.rotation !== undefined) set("rotation", patch.rotation === null || Math.abs(patch.rotation) < 0.005 ? undefined : r2(patch.rotation));
  if (patch.scale !== undefined) set("scale", patch.scale === null || Math.abs(patch.scale - 1) < 0.0005 ? undefined : r3(patch.scale));
  if (patch.scaleX !== undefined) set("scaleX", patch.scaleX === null || Math.abs(patch.scaleX - 1) < 0.0005 ? undefined : r3(patch.scaleX));
  if (patch.scaleY !== undefined) set("scaleY", patch.scaleY === null || Math.abs(patch.scaleY - 1) < 0.0005 ? undefined : r3(patch.scaleY));
  // A pivot of 50/50 is the centre, which is the default.
  if (patch.pivot !== undefined) set("pivot", patch.pivot === null || (Math.abs(patch.pivot[0] - 50) < 0.05 && Math.abs(patch.pivot[1] - 50) < 0.05) ? undefined : ([r2(patch.pivot[0]), r2(patch.pivot[1])] as [number, number]));
  if (patch.rotateX !== undefined) set("rotateX", patch.rotateX === null || Math.abs(patch.rotateX) < 0.005 ? undefined : r2(patch.rotateX));
  if (patch.rotateY !== undefined) set("rotateY", patch.rotateY === null || Math.abs(patch.rotateY) < 0.005 ? undefined : r2(patch.rotateY));
  // Depth only reads on a tilted element, and the default needs no field of its own.
  if (patch.depth !== undefined) set("depth", patch.depth === null || Math.abs(patch.depth - DEFAULT_DEPTH) < 0.5 ? undefined : Math.round(patch.depth));
  if (patch.motionPath !== undefined) set("motionPath", patch.motionPath ?? undefined);
  if (patch.pathProgress !== undefined) set("pathProgress", patch.pathProgress === null ? undefined : r3(patch.pathProgress));
  if (patch.opacity !== undefined) set("opacity", patch.opacity === null || patch.opacity >= 0.9995 ? undefined : r3(patch.opacity));
  if (patch.z !== undefined) set("z", patch.z === null || patch.z === 0 ? undefined : patch.z);
  if (patch.idle !== undefined) set("idle", patch.idle === "none" ? undefined : patch.idle);
  if (patch.motionRole !== undefined) set("motionRole", patch.motionRole);
  if (patch.motionIntent !== undefined) set("motionIntent", patch.motionIntent);

  if (patch.placement) {
    if (!media) throw new SpecPatchError("Placement presets only apply to images and videos.");
    if (!context.frame) throw new SpecPatchError("Placement presets need the video frame size.");
    const aspect = context.assetAspect ? croppedAspect(context.assetAspect, element.crop) : null;
    const layout = scenePlacementLayout(patch.placement, context.frame, aspect);
    set("x", layout.x);
    set("y", layout.y);
    set("width", layout.width);
    set("height", layout.height);
    set("z", layout.z);
    set("anchor", undefined);
    set("rotation", undefined);
    set("rotateX", undefined);
    set("rotateY", undefined);
    // Boxed placements get the card look media is inserted with; full-frame ones fill edge to edge.
    const style: Record<string, unknown> = { ...(element.style ?? {}) };
    if (patch.placement === "background" || patch.placement === "fullscreen") {
      set("radius", undefined);
      delete style.shadow;
    } else {
      if (element.radius === undefined) set("radius", 24);
      if (style.shadow === undefined) style.shadow = "deep";
    }
    set("style", Object.keys(style).length ? style : undefined);
  }

  if (patch.style) {
    const style = merge({ ...((next.style as Record<string, unknown> | undefined) ?? {}) }, Object.fromEntries(Object.entries(patch.style).map(([k, v]) => [k, typeof v === "number" ? r2(v) : v])));
    set("style", Object.keys(style).length ? style : undefined);
  }

  // Compositing: blend, effects and the clip shape (src/remotion/engine/compositing.ts).
  if (patch.blend !== undefined) set("blend", patch.blend === null || patch.blend === "normal" ? undefined : patch.blend);
  if (patch.effects !== undefined) {
    if (patch.effects === null) set("effects", undefined);
    else {
      const effects = merge({ ...((next.effects as Record<string, unknown> | undefined) ?? {}) }, Object.fromEntries(Object.entries(patch.effects).map(([k, v]) => [k, typeof v === "number" ? r3(v) : v])));
      set("effects", Object.keys(effects).length ? effects : undefined);
    }
  }
  if (patch.clip !== undefined) {
    if (patch.clip === null) set("clip", undefined);
    else {
      const clip = merge({ ...((next.clip as Record<string, unknown> | undefined) ?? {}) }, patch.clip as Record<string, unknown>);
      // A clip is a shape: one that was only given a reveal or a progress is a plain rectangle.
      if (!clip.type) clip.type = "rect";
      if (clip.reveal === "none") delete clip.reveal;
      set("clip", clip);
    }
  }

  if (patch.props) {
    const allowed = new Set(elementPropertyKeys(element.type));
    for (const [key, value] of Object.entries(patch.props)) {
      if (!allowed.has(key)) throw new SpecPatchError(`“${key}” isn't a property of ${element.type} elements that can be set here.`);
      set(key, value);
    }
  }

  if (patch.enter) {
    const base = (next.enter as EnterAnimation | undefined) ?? { type: "fade" as const };
    const enter = merge({ ...base }, patch.enter) as EnterAnimation;
    // "none" ignores the entrance cue, so an element timed to appear later would show from the start: it becomes a cut.
    set("enter", enter.type === "none" && (base.at || base.delay) ? { ...enter, type: "fade", duration: MOTION_CUT_SEC } : enter);
  }

  if (patch.exit !== undefined) {
    const old = element.exit && element.exit.type !== "none" ? element.exit : undefined;
    const oldAt = old?.at;
    const timed = oldAt && (oldAt.type === "sceneTime" || oldAt.type === "shotTime") ? oldAt : null;
    const goneSec = timed ? timed.seconds + (timed.offset ?? 0) + (old?.duration ?? DEFAULT_EXIT_SEC) : null;
    // Keep the moment it's gone: an exit timed in seconds starts earlier when it gets longer.
    const at = (duration: number) => (timed && goneSec !== null ? { at: { ...timed, seconds: r3(Math.max(0, goneSec - duration - (timed.offset ?? 0))) } } : {});
    if (patch.exit === null || patch.exit.type === "none") {
      // An element that leaves before its scene ends still needs an exit to leave on time: it becomes a cut.
      set("exit", old?.at ? { ...old, type: "fade", duration: MOTION_CUT_SEC, ...at(MOTION_CUT_SEC) } : undefined);
    } else {
      const duration = patch.exit.duration ?? old?.duration ?? DEFAULT_EXIT_SEC;
      const exit = merge({ ...(old ?? {}), type: patch.exit.type ?? old?.type ?? "fade", duration, ...at(duration) }, { easing: patch.exit.easing, distance: patch.exit.distance });
      set("exit", exit);
    }
  }

  if (patch.appearAt !== undefined || patch.disappearAt !== undefined) {
    const sceneDuration = context.sceneDurationSec;
    if (sceneDuration === undefined) throw new SpecPatchError("Retiming an element needs its scene's length.");
    if (patch.appearAt !== undefined) {
      const current = (next.enter as EnterAnimation | undefined) ?? (element.motionIntent ? grammarEnter(element.motionIntent, element.type) : undefined);
      if (patch.appearAt === null) {
        // Appears when its scene or shot starts: the entrance keeps its animation without a cue.
        if (current) {
          const { at: _at, delay: _delay, ...rest } = current;
          set("enter", rest);
        }
      } else {
        if (patch.appearAt >= sceneDuration - 0.05) throw new SpecPatchError(`It must appear before its scene ends (${sceneDuration.toFixed(2)}s).`);
        const { delay: _delay, ...enter } = current ?? { type: "fade" as const, duration: MOTION_CUT_SEC };
        // An exact time replaces the cue; "none" would ignore the cue, so it becomes a cut.
        set("enter", { ...enter, ...(enter.type === "none" ? { type: "fade", duration: MOTION_CUT_SEC } : {}), at: { type: "sceneTime", seconds: r3(patch.appearAt) } });
      }
    }
    if (patch.disappearAt !== undefined) {
      const old = next.exit && (next.exit as ExitAnimation).type !== "none" ? (next.exit as ExitAnimation) : undefined;
      if (patch.disappearAt === null || patch.disappearAt >= sceneDuration - 0.02) {
        // Stays until its scene or shot ends: a timed exit plays at the end instead, and a cut that only made it leave early goes.
        if (old?.at) {
          const { at: _at, ...rest } = old;
          set("exit", isCutExit(old) ? undefined : rest);
        }
      } else {
        if (patch.appearAt !== undefined && patch.appearAt !== null && patch.disappearAt <= patch.appearAt + 0.1) throw new SpecPatchError("It must disappear after it appears.");
        // Leaving earlier doesn't add an animation: without an exit it cuts.
        const exit = old ?? { type: "fade" as const, duration: MOTION_CUT_SEC };
        const onScreen = patch.appearAt !== undefined && patch.appearAt !== null ? patch.disappearAt - patch.appearAt : Infinity;
        const duration = r3(Math.min(exit.duration ?? DEFAULT_EXIT_SEC, onScreen / 2));
        set("exit", { ...exit, duration, at: { type: "sceneTime", seconds: r3(Math.max(0, patch.disappearAt - duration)) } });
      }
    }
  }

  if (patch.emphasis !== undefined) set("emphasis", patch.emphasis?.length ? patch.emphasis : undefined);

  let result = next as SceneElement;
  if (patch.cues) {
    if (patch.cues.enter !== undefined && patch.appearAt !== undefined) throw new SpecPatchError("Set when it appears with a time or with a cue, not both.");
    if (patch.cues.exit !== undefined && patch.disappearAt !== undefined) throw new SpecPatchError("Set when it's gone with a time or with a cue, not both.");
    for (const [id, trigger] of Object.entries(patch.cues)) {
      try {
        result = setElementCue(result, id as CueId, trigger);
      } catch (e) {
        if (e instanceof CueError) throw new SpecPatchError(e.message);
        throw e;
      }
    }
  }

  return withKeyframes(element, result, patch, context);
}

/**
 * The patched element's keyframes: the list the patch sets (in stored order), else its own — kept at
 * their moments in the scene when the patch changed when it appears or leaves, given its segment.
 */
function withKeyframes(before: SceneElement, after: SceneElement, patch: ElementPatch, context: ElementPatchContext): SceneElement {
  if (patch.keyframes !== undefined) {
    const { keyframes: _old, ...rest } = after;
    return (patch.keyframes?.length ? { ...rest, keyframes: sortKeyframes(patch.keyframes) } : rest) as SceneElement;
  }
  if (!before.keyframes?.length || !context.segment) return after;
  const keyframes = keyframesAfterRetime(before, after, context.segment);
  if (keyframes === after.keyframes) return after;
  const { keyframes: _old, ...rest } = after;
  return (keyframes?.length ? { ...rest, keyframes } : rest) as SceneElement;
}

// ---------------------------------------------------------------------------------------
// Scene look
// ---------------------------------------------------------------------------------------

export const SceneLookPatchSchema = z
  .object({
    /** How the scene enters over the previous one (merged), or null to follow the design system's transition. */
    transitionIn: z
      .object({ type: z.enum(TRANSITIONS), duration: z.number().min(0).max(2).nullable(), direction: z.enum(["left", "right", "up", "down"]).nullable() })
      .partial()
      .strict()
      .nullable(),
    /** Camera move over the whole scene (merged), or null for none. */
    camera: z.object({ type: CameraSchema.shape.type, amount: z.number().min(0).max(0.5).nullable() }).partial().strict().nullable(),
    /** Motion density of the scene, or null for the default (medium). */
    density: z.enum(MOTION_DENSITIES).nullable(),
  })
  .partial()
  .strict();
export type SceneLookPatch = z.input<typeof SceneLookPatchSchema>;

/** The scene spec with its look patched (not validated). */
export function applySceneLookPatch(spec: SceneSpec, patch: SceneLookPatch): SceneSpec {
  const next: SceneSpec = { ...spec };
  if (patch.transitionIn !== undefined) {
    if (patch.transitionIn === null) delete next.transitionIn;
    else {
      const transition = merge({ ...(spec.transitionIn ?? {}) }, patch.transitionIn);
      if (!transition.type) throw new SpecPatchError("Choose a transition type.");
      next.transitionIn = transition as Transition;
    }
  }
  if (patch.camera !== undefined) {
    const camera = patch.camera === null ? null : (merge({ ...(spec.camera ?? {}) }, patch.camera) as Partial<Camera>);
    if (!camera || !camera.type || camera.type === "static") delete next.camera;
    else next.camera = camera as Camera;
  }
  if (patch.density !== undefined) {
    const motion = { ...(spec.motion ?? {}) };
    if (patch.density === null) delete motion.density;
    else motion.density = patch.density;
    if (Object.keys(motion).length) next.motion = motion;
    else delete next.motion;
  }
  return next;
}
