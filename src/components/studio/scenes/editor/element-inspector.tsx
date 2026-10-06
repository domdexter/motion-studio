"use client";

import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { ELEMENT_TYPE_LABELS } from "@/core/spec/element-properties";
import type { SceneElement } from "@/core/spec/scene";
import type { CueId, TriggerContext } from "@/core/spec/triggers";
import type { ElementRef, FrameSize } from "@/core/timeline/element-layout";
import type { SceneDto } from "@/server/services/scenes";
import { CompositingSection } from "./compositing-section";
import { CuesSection } from "./cue-editor";
import { ElementActionsMenu, type ElementActions } from "./element-actions";
import { ContentSection } from "./element-content";
import { useElementDraft } from "./element-drafts";
import { useElementFieldContext } from "./element-fields";
import { AdvancedSection, AnimationSection, AppearanceSection, ArrangeSection, BlockedNote, InspectorHeader, TimingSection, TransformSection, TypographySection } from "./element-sections";
import { elementIcon, elementName, summarizeElement } from "./element-summary";
import { useInspectorEnv } from "./inspector-env";
import { IconAction, InspectorSection } from "./inspector-section";
import { KeyframesSection } from "./keyframes-section";
import { MotionPathSection } from "./motion-path-section";

/**
 * Inspector for a scene element that isn't an image or video. It shows the sections its type uses —
 * content (words, data, items, screen), typography, transform, appearance, animation, timing, cues and
 * arrange — each with only the properties its renderer reads.
 */
export function ElementInspector({
  projectId,
  scene,
  elementRef,
  element: saved,
  frame,
  segment,
  blockedReason,
  onClose,
  onRemove,
  onOpenSpec,
  actions,
  layers,
  focusedCue = null,
  onFocusCue,
  focusedKeyframe = null,
  onFocusKeyframe,
}: {
  projectId: string;
  scene: SceneDto;
  elementRef: ElementRef;
  element: SceneElement;
  frame: FrameSize;
  /** The element's scene (and shot) timing, for the Timing and Cues sections; null when unknown. */
  segment: TriggerContext | null;
  blockedReason: string | null;
  onClose: () => void;
  onRemove: () => void;
  onOpenSpec: () => void;
  /** Duplicate, layer order and alignment (the header's menu and the Arrange section). */
  actions?: ElementActions;
  /** The scene's layers list, to add elements to the selection. */
  layers?: React.ReactNode;
  /** The cue selected on the timeline (its row is highlighted). */
  focusedCue?: CueId | null;
  onFocusCue?: (cue: CueId | null) => void;
  /** The keyframe selected on the timeline (shown in Keyframes). */
  focusedKeyframe?: string | null;
  onFocusKeyframe?: (id: string | null) => void;
}) {
  const env = useInspectorEnv();
  const draft = useElementDraft(scene.id, elementRef, saved);
  const el = draft ?? saved;
  const { ctx } = useElementFieldContext({ projectId, sceneId: scene.id, elementRef, saved, element: el, blockedReason, frame, assetAspect: null, sceneDurationSec: scene.durationSec, segment });
  const [keepAspect, setKeepAspect] = useState(false);
  const Icon = elementIcon(el.type);
  const name = elementName(el, elementRef);
  const summary = summarizeElement(el);
  // Scrubbing an unset ("auto") side starts from the size it's drawn at, when it's on screen.
  const box = env?.measure(scene.id, elementRef) ?? null;
  const auto = box ? { width: (box.width / frame.width) * 100, height: (box.height / frame.height) * 100 } : { width: el.width ?? 40, height: el.height ?? 20 };

  return (
    <div className="@container min-w-0">
      <InspectorHeader icon={<Icon />} title={summary || name} subtitle={`${ELEMENT_TYPE_LABELS[el.type]} · ${scene.key}${elementRef.shotId ? ` · shot ${elementRef.shotId}` : ""} · ${name}`}>
        {actions ? <ElementActionsMenu actions={actions} /> : null}
        <IconAction label="Delete (Del)" onClick={onRemove} disabled={!!blockedReason}>
          <Trash2 />
        </IconAction>
        <IconAction label="Deselect (Esc)" onClick={onClose}>
          <X />
        </IconAction>
      </InspectorHeader>
      <BlockedNote reason={blockedReason} />

      <ContentSection ctx={ctx} id="element.content" />
      <TypographySection ctx={ctx} id="element.typography" />
      <TransformSection ctx={ctx} id="element.transform" name={name} auto={auto} keepAspect={keepAspect} onKeepAspect={setKeepAspect} />
      <AppearanceSection ctx={ctx} id="element.appearance" name={name} />
      <CompositingSection ctx={ctx} id="element.compositing" />
      <AnimationSection ctx={ctx} id="element.animation" name={name} />
      <KeyframesSection ctx={ctx} id="element.keyframes" name={name} focusedKeyframe={focusedKeyframe} onFocusKeyframe={onFocusKeyframe} />
      <MotionPathSection ctx={ctx} id="element.motionPath" />
      <TimingSection ctx={ctx} id="element.timing" scene={scene} segment={segment} />
      <CuesSection ctx={ctx} id="element.cues" name={name} segment={segment} focusedCue={focusedCue} onFocusCue={onFocusCue} />
      <ArrangeSection ctx={ctx} id="element.arrange" actions={actions} />
      {layers ? (
        <InspectorSection id="element.layers" title="Layers" defaultOpen={false}>
          {layers}
        </InspectorSection>
      ) : null}
      <AdvancedSection ctx={ctx} id="element.advanced" onOpenSpec={onOpenSpec} />
    </div>
  );
}
