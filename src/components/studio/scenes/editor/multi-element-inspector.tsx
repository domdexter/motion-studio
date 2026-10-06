"use client";

import { ClipboardPaste, Copy, Layers, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { isAnimated } from "@/core/motion/keyframes";
import { entrancesFor } from "@/core/spec/element-properties";
import { EXIT_ANIMATIONS, IdleSchema, type EnterAnimation, type ExitAnimation, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import { findElementAt, type ElementRef, type FrameSize } from "@/core/timeline/element-layout";
import { ALIGN_LABELS, ALIGN_MODES, ARRANGE_ACTIONS, ARRANGE_LABELS } from "@/core/timeline/element-ops";
import { DEFAULT_EXIT_SEC } from "@/core/timeline/media-clip";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { ALIGN_ICONS, ARRANGE_ICONS, ARRANGE_SHORTCUTS, DISTRIBUTE_ICONS, type ElementActions } from "./element-actions";
import { elementDrafts, elementKey, useElementDrafts } from "./element-drafts";
import { hasPosition } from "./element-fields";
import { BlockedNote, InspectorHeader, enterChoice, exitChoice } from "./element-sections";
import { elementIcon, elementName } from "./element-summary";
import { IconAction, InspectorSection, ScrubField } from "./inspector-section";
import { PROPERTY_GROUPS, usePropertyClips } from "./property-clipboard";
import { FieldHint, FieldRow, SelectField } from "./property-fields";
import { humanize } from "./property-inputs";
import { layoutWithPatch } from "./use-element-edits";
import type { ElementPatchItem } from "./use-element-ops";

interface Item {
  ref: ElementRef;
  saved: SceneElement;
  /** With its in-flight draft, while an edit saves. */
  shown: SceneElement;
}

type ValueKey = "x" | "y" | "rotation" | "scale" | "opacity" | "z";

const VALUE_FIELDS: { key: ValueKey; label: string; unit?: string; step: number; min: number; max: number; fallback: number; factor?: number; title: string }[] = [
  { key: "x", label: "X", unit: "%", step: 0.1, min: -100, max: 200, fallback: 50, title: "Horizontal position of each element's anchor, % of the frame width" },
  { key: "y", label: "Y", unit: "%", step: 0.1, min: -100, max: 200, fallback: 50, title: "Vertical position of each element's anchor, % of the frame height" },
  { key: "rotation", label: "Rot", unit: "°", step: 1, min: -3600, max: 3600, fallback: 0, title: "Rotation in degrees" },
  { key: "scale", label: "Scale", unit: "×", step: 0.01, min: 0.05, max: 20, fallback: 1, title: "Scale (1 = its size)" },
  { key: "opacity", label: "Opacity", unit: "%", step: 1, min: 0, max: 100, fallback: 1, factor: 100, title: "Opacity" },
  { key: "z", label: "Layer", step: 1, min: -100, max: 100, fallback: 0, title: "Layer: higher draws on top" },
];

/** The value every item shares, or null when they differ. */
function common<T>(values: T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

/**
 * Inspector for several selected elements of one scene. A value they share shows as a value; values
 * that differ show as "Mixed" and are never overwritten until you set one — then it applies to every
 * selected element, as one undo step. Also: align, distribute, layer order, entrance and exit, idle
 * motion, pasting copied properties, duplicate and delete.
 */
export function MultiElementInspector({
  scene,
  spec,
  refs,
  frame,
  actions,
  layers,
  onPatch,
  onSelectOne,
  onClose,
}: {
  scene: SceneDto;
  spec: SceneSpec;
  refs: readonly ElementRef[];
  frame: FrameSize;
  actions: ElementActions;
  /** The scene's layers list (to add or remove elements). */
  layers: ReactNode;
  /** Saves property edits of several elements as one step. */
  onPatch: (items: ElementPatchItem[]) => void;
  onSelectOne: (ref: ElementRef) => void;
  onClose: () => void;
}) {
  const drafts = useElementDrafts();
  const clips = usePropertyClips();
  const items: Item[] = refs.flatMap((ref) => {
    const saved = findElementAt(spec, ref);
    if (!saved) return [];
    const draft = drafts.get(elementKey(scene.id, ref));
    return [{ ref, saved, shown: draft && draft.base === JSON.stringify(saved) ? draft.element : saved }];
  });
  const blocked = !!actions.blockedReason;
  const context = { frame, sceneDurationSec: scene.durationSec };

  const preview = (targets: Item[], patch: (item: Item) => SceneElementPatch) => {
    if (blocked) return;
    for (const item of targets) elementDrafts.set(scene.id, item.ref, layoutWithPatch(item.shown, patch(item), context), item.saved);
  };
  const cancel = (targets: Item[]) => targets.forEach((item) => elementDrafts.clear(scene.id, item.ref));
  const commit = (targets: Item[], patch: (item: Item) => SceneElementPatch) => {
    if (blocked || !targets.length) return;
    onPatch(targets.map((item) => ({ sceneId: scene.id, ref: item.ref, saved: item.saved, patch: patch(item), preview: layoutWithPatch(item.shown, patch(item), context) })));
  };

  const placed = items.filter((i) => hasPosition(i.saved.type));
  const animatedCount = (key: ValueKey) => (key === "z" ? 0 : items.filter((i) => isAnimated(i.shown, key)).length);
  const anyAnimated = VALUE_FIELDS.some((f) => animatedCount(f.key) > 0);
  const entrances = items.reduce<string[] | null>((acc, i) => {
    const list: string[] = entrancesFor(i.saved.type);
    return acc ? acc.filter((t) => list.includes(t)) : list;
  }, null);
  const enterCommon = common(items.map((i) => enterChoice(i.shown)));
  const exitCommon = common(items.map((i) => exitChoice(i.shown)));
  const idleCommon = common(items.map((i) => i.shown.idle ?? "none"));
  const exitTypes = EXIT_ANIMATIONS.filter((t) => t !== "none" && t !== "converge");

  return (
    <div className="@container min-w-0">
      <InspectorHeader icon={<Layers />} title={`${items.length} elements`} subtitle={`${scene.key} · Shift+click to add or remove`}>
        <IconAction label="Duplicate (Ctrl+D)" onClick={actions.duplicate} disabled={blocked}>
          <Copy />
        </IconAction>
        <IconAction label="Delete (Del)" onClick={actions.remove} disabled={blocked}>
          <Trash2 />
        </IconAction>
        <IconAction label="Deselect (Esc)" onClick={onClose}>
          <X />
        </IconAction>
      </InspectorHeader>
      <BlockedNote reason={actions.blockedReason} />

      <InspectorSection id="multi.values" title="Transform">
        <div className="grid grid-cols-2 gap-1.5">
          {VALUE_FIELDS.map((f) => {
            const targets = f.key === "x" || f.key === "y" ? placed : items;
            if (!targets.length) return null;
            const values = targets.map((i) => Math.round((i.shown[f.key] ?? f.fallback) * (f.factor ?? 1) * 1000) / 1000);
            const shared = common(values);
            const toPatch = (n: number): SceneElementPatch => ({ [f.key]: f.factor ? n / f.factor : f.key === "z" ? Math.round(n) : n });
            // A keyframed property shows its keyframes' value, not its saved one: keyframes are edited one element at a time.
            const keyed = animatedCount(f.key);
            return (
              <ScrubField
                key={f.key}
                label={f.label}
                unit={f.unit}
                value={keyed ? null : shared}
                placeholder={keyed ? "Animated" : "Mixed"}
                scrubStart={values[0]}
                step={f.step}
                min={f.min}
                max={f.max}
                disabled={blocked || keyed > 0}
                className={keyed ? "border-keyframe/50" : undefined}
                title={keyed ? `${f.title} — keyframed on ${keyed} of the selected elements: select one element to change its keyframes` : shared === null ? `${f.title} — the values differ; a value you set applies to all of them` : f.title}
                onPreview={(n) => preview(targets, () => toPatch(n))}
                onCancel={() => cancel(targets)}
                onCommit={(n) => commit(targets, () => toPatch(n))}
              />
            );
          })}
        </div>
        <FieldHint>
          Mixed values stay as they are until you set one; it then applies to every selected element{placed.length < items.length ? " (X and Y skip lines and cursors, which are placed by their points)" : ""}. Drag the selection in the preview to move it together.
        </FieldHint>
        {anyAnimated ? <FieldHint>◆ Animated values have keyframes and can&apos;t be set for several elements at once — select one element to edit its keyframes. Dragging the selection in the preview keys their positions at the playhead.</FieldHint> : null}
      </InspectorSection>

      <InspectorSection id="multi.arrange" title="Arrange">
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Align">
          {ALIGN_MODES.map((mode) => {
            const Icon = ALIGN_ICONS[mode];
            return (
              <IconAction key={mode} label={`Align ${ALIGN_LABELS[mode].toLowerCase()}`} disabled={blocked} onClick={() => actions.align(mode)}>
                <Icon />
              </IconAction>
            );
          })}
          <span className="mx-1 h-4 w-px bg-border" />
          {(["horizontal", "vertical"] as const).map((axis) => {
            const Icon = DISTRIBUTE_ICONS[axis];
            return (
              <IconAction key={axis} label={`Distribute ${axis}ly${items.length < 3 ? " (select 3 or more)" : ""}`} disabled={blocked || items.length < 3} onClick={() => actions.distribute(axis)}>
                <Icon />
              </IconAction>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Layer order">
          {ARRANGE_ACTIONS.map((action) => {
            const Icon = ARRANGE_ICONS[action];
            return (
              <IconAction key={action} label={`${ARRANGE_LABELS[action]} (${ARRANGE_SHORTCUTS[action]})`} disabled={blocked} onClick={() => actions.arrange(action)}>
                <Icon />
              </IconAction>
            );
          })}
        </div>
        <FieldHint>Aligns to the selection&apos;s bounds; distributing leaves equal gaps; layer order keeps their order among themselves. Arrow keys nudge (Shift: 10 px).</FieldHint>
      </InspectorSection>

      <InspectorSection id="multi.animation" title="Animation">
        <FieldRow label="Entrance">
          <SelectField
            value={enterCommon && enterCommon !== "default" ? enterCommon : undefined}
            defaultLabel={enterCommon === null ? "— Mixed —" : enterCommon === "default" ? "Default" : undefined}
            options={[{ value: "none", label: "Cut (no animation)" }, ...(entrances ?? []).map((t) => ({ value: t, label: humanize(t) }))]}
            ariaLabel="Entrance of the selected elements"
            disabled={blocked}
            onChange={(v) => {
              if (!v) return;
              commit(items, (i) => ({ enter: v === "none" ? { type: "none" } : { type: v as EnterAnimation["type"], ...(enterChoice(i.saved) === "none" ? { duration: null } : {}) } }));
            }}
          />
        </FieldRow>
        <FieldRow label="Exit">
          <SelectField
            value={exitCommon ?? undefined}
            defaultLabel={exitCommon === null ? "— Mixed —" : undefined}
            options={[{ value: "none", label: "None / cut" }, ...exitTypes.map((t) => ({ value: t, label: humanize(t) }))]}
            ariaLabel="Exit of the selected elements"
            disabled={blocked}
            onChange={(v) => {
              if (!v) return;
              commit(items, (i) => ({ exit: v === "none" ? null : { type: v as ExitAnimation["type"], ...(exitChoice(i.saved) === "none" ? { duration: DEFAULT_EXIT_SEC } : {}) } }));
            }}
          />
        </FieldRow>
        <FieldRow label="Idle">
          <SelectField
            value={idleCommon && idleCommon !== "none" ? idleCommon : undefined}
            defaultLabel={idleCommon === null ? "— Mixed —" : "None"}
            options={IdleSchema.options.filter((i) => i !== "none").map((i) => ({ value: i, label: humanize(i) }))}
            ariaLabel="Idle motion of the selected elements"
            disabled={blocked}
            onChange={(v) => {
              if (v === undefined && idleCommon === null) return;
              commit(items, () => ({ idle: v ?? null }));
            }}
          />
        </FieldRow>
        <FieldHint>Entrances and exits keep each element&apos;s cue and length. Only entrances every selected element can play are offered.</FieldHint>
      </InspectorSection>

      {actions.paste ? (
        <InspectorSection id="multi.paste" title="Paste properties" defaultOpen={PROPERTY_GROUPS.some((g) => clips[g])}>
          <div className="flex flex-wrap gap-1.5">
            {PROPERTY_GROUPS.map((group) => (
              <Button key={group} size="xs" variant="outline" disabled={blocked || !clips[group]} onClick={() => actions.paste?.(group)} title={clips[group] ? `Paste the ${group} of ${clips[group]!.name} onto all of them` : `Copy an element's ${group} first`}>
                <ClipboardPaste /> {humanize(group)}
              </Button>
            ))}
          </div>
          <FieldHint>Copy from one element (its section&apos;s clipboard or the right-click menu). Timing pastes the entrance and exit cues and emphasis moments; the other groups never change content, cues or timing.</FieldHint>
        </InspectorSection>
      ) : null}

      <InspectorSection id="multi.selected" title="Selected" summary={String(items.length)}>
        <ul className="-mx-1.5 space-y-px">
          {items.map(({ ref, saved }) => {
            const Icon = elementIcon(saved.type);
            return (
              <li key={`${ref.shotId ?? ""}:${ref.index}`}>
                <button type="button" onClick={() => onSelectOne(ref)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/60" title="Select only this element">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-mono text-[11px]">{elementName(saved, ref)}</span>
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                    {saved.type}
                    {ref.shotId ? ` · shot ${ref.shotId}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </InspectorSection>

      <InspectorSection id="multi.layers" title="Layers" defaultOpen={false}>
        {layers}
      </InspectorSection>
    </div>
  );
}
