"use client";

import { Plus, Trash2 } from "lucide-react";
import { setKeyframe, valueAt } from "@/core/motion/keyframes";
import { midpoint, pathAsType, pathLength } from "@/core/motion/path";
import { animatableProperty, formatPropertyValue } from "@/core/spec/animatable";
import { MOTION_PATH_TYPES, type MotionPath, type MotionPathType, type Point } from "@/core/spec/scene";
import { Button } from "@/components/ui/button";
import { hasPosition } from "./element-fields";
import type { ElementFieldContext } from "./element-fields";
import { FieldHint, FieldRow, SegmentedField, SwitchField } from "./property-fields";
import { InspectorSection } from "./inspector-section";
import { AnimatedPropertyField } from "./keyframe-fields";

/**
 * The inspector's Motion path section: the curve an element travels instead of sitting at one place.
 * Adding a path turns its current position into the start and a point across the frame into the end,
 * and keyframes its progress from 0 to 1 over the time it is on screen — so a path is a normal animation
 * from the moment it exists. The curve's shape is dragged on the canvas; this section holds what can't
 * be dragged: the kind of curve, whether the element turns along it, and its progress at the playhead.
 */

const TYPE_LABELS: Record<MotionPathType, string> = { linear: "Straight", quadratic: "Curved", cubic: "S-curve" };

export function MotionPathSection({ ctx, id }: { ctx: ElementFieldContext; id: string }) {
  const el = ctx.element;
  const clock = ctx.clock;
  if (!hasPosition(el.type) || el.type === "grid") return null;
  const path = el.motionPath;
  const progress = animatableProperty("pathProgress");

  const addPath = () => {
    const from: Point = [el.x ?? 50, el.y ?? 50];
    const to: Point = [Math.min(95, (el.x ?? 50) + 25), el.y ?? 50];
    const motionPath: MotionPath = { type: "quadratic", from, to, c1: [midpoint(from, to)[0], Math.max(2, (el.y ?? 50) - 18)] };
    // Progress runs over the element's whole time on screen, so the path plays as soon as it exists.
    const duration = clock ? Math.max(0.1, clock.gone - clock.appear) : 1;
    const start = setKeyframe(el.keyframes, { property: "pathProgress", time: 0, value: 0 }, 0.001);
    const end = setKeyframe(start.keyframes, { property: "pathProgress", time: duration, value: 1, easing: "easeInOut" }, 0.001);
    ctx.commit({ motionPath, keyframes: end.keyframes });
  };

  const removePath = () => {
    const at = clock?.local ?? 0;
    const point = { x: Number(valueAt(el, "x", at)), y: Number(valueAt(el, "y", at)) };
    // It stays where the path had put it, and loses only the path's own keyframes.
    ctx.commit({ motionPath: null, x: point.x, y: point.y, keyframes: (el.keyframes ?? []).filter((k) => k.property !== "pathProgress") });
  };

  if (!path) {
    return (
      <InspectorSection id={id} title="Motion path" summary="none" actions={<Button size="xs" variant="ghost" className="h-6" disabled={ctx.disabled} onClick={addPath}><Plus /> Path</Button>}>
        <FieldHint>A motion path moves it along a curve instead of between X and Y keyframes. Add one, then drag its ends and its handle on the canvas.</FieldHint>
      </InspectorSection>
    );
  }

  const set = (next: Partial<MotionPath>) => ctx.commit({ motionPath: { ...path, ...next } as MotionPath });
  const at = clock ? Number(valueAt(el, "pathProgress", clock.local)) : 0;

  return (
    <InspectorSection
      id={id}
      title="Motion path"
      summary={`${TYPE_LABELS[path.type].toLowerCase()} · ${formatPropertyValue("pathProgress", at)}`}
      actions={
        <Button size="xs" variant="ghost" className="h-6" disabled={ctx.disabled} onClick={removePath} title="Remove the path (it stays where it is now)">
          <Trash2 /> Remove
        </Button>
      }
    >
      <FieldRow label="Curve" hint="Drag the path's points on the canvas">
        <SegmentedField
          value={path.type}
          options={MOTION_PATH_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
          ariaLabel="Path shape"
          disabled={ctx.disabled}
          onChange={(v) => v && ctx.commit({ motionPath: pathAsType(path, v as MotionPathType) })}
        />
      </FieldRow>
      <AnimatedPropertyField ctx={ctx} property="pathProgress" label={progress.label} />
      <FieldRow label="Turn with it" hint="It faces along the curve; its own rotation is added on top, so rotation keyframes still work">
        <SwitchField label="Turn along the path" checked={!!path.orient} disabled={ctx.disabled} onChange={(v) => set({ orient: v || undefined })} />
      </FieldRow>
      <FieldHint>
        {`From ${path.from[0].toFixed(1)}, ${path.from[1].toFixed(1)} to ${path.to[0].toFixed(1)}, ${path.to[1].toFixed(1)} · ${pathLength(path).toFixed(1)}% of the frame long. Progress 0 is the start and 1 the end, measured along the curve, so an even progress moves at an even speed. While it travels a path, its X and Y follow the curve.`}
      </FieldHint>
    </InspectorSection>
  );
}
