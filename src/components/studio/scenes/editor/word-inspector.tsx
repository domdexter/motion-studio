"use client";

import { AudioLines, Highlighter, X } from "lucide-react";
import { useState } from "react";
import { allSpecElements, type Emphasis, type SceneElement, type SceneSpec } from "@/core/spec/scene";
import type { Segment, TimedWord } from "@/core/spec/timing";
import { elementCues, resolveShotWindows, type CueId, type TriggerContext } from "@/core/spec/triggers";
import { actionCuesFor, cueLabel, spokenTrigger } from "@/core/timeline/element-cues";
import { findElementAt, type ElementRef } from "@/core/timeline/element-layout";
import { refKey } from "@/core/timeline/element-ops";
import { normalizeWord } from "@/core/util/text";
import { cn } from "@/lib/utils";
import type { SceneElementPatch } from "@/server/services/scene-elements";
import type { SceneDto } from "@/server/services/scenes";
import { Button } from "@/components/ui/button";
import { CUE_DOT, EMPHASIS_TYPES } from "./cue-editor";
import { BlockedNote, InspectorHeader } from "./element-sections";
import { elementIcon, elementName } from "./element-summary";
import { IconAction, InspectorSection } from "./inspector-section";
import { FieldHint, FieldRow, SegmentedField, SelectField } from "./property-fields";
import { humanize } from "./property-inputs";

/**
 * Inspector for a spoken word (or phrase) picked on the timeline: its exact time and sentence, what
 * is already cued to it, and a way to cue any element of the scene to it — its entrance, exit, a new
 * emphasis moment, an action, an item or a click (WORD → TIMESTAMP → VISUAL EVENT). Text that contains
 * the word can highlight it as it's spoken. Every change is an ordinary element edit.
 */

type EventChoice = CueId | `emphasis+${Emphasis["type"]}` | "click+";

function eventChoices(el: SceneElement): { value: EventChoice; label: string }[] {
  const out: { value: EventChoice; label: string }[] = [
    { value: "enter", label: "Appear (its entrance)" },
    { value: "exit", label: "Leave (its exit)" },
    ...EMPHASIS_TYPES.map((type) => ({ value: `emphasis+${type}` as const, label: `New emphasis · ${humanize(type).toLowerCase()}` })),
    ...(el.emphasis ?? []).map((e, k) => ({ value: `emphasis:${k}` as const, label: `Move emphasis ${k + 1} (${humanize(e.type).toLowerCase()})` })),
    ...actionCuesFor(el.type).map((id) => ({ value: id, label: cueLabel(id, el.type) })),
  ];
  if (el.type === "list") el.items.forEach((it, k) => out.push({ value: `item:${k}`, label: `Item ${k + 1} · ${it.text}` }));
  if (el.type === "cards") el.items.forEach((it, k) => out.push({ value: `item:${k}`, label: `Card ${k + 1}${it.title ? ` · ${it.title}` : ""}` }));
  if (el.type === "cursor") {
    out.push({ value: "click+", label: "New click" });
    (el.clicks ?? []).forEach((_, k) => out.push({ value: `click:${k}`, label: `Move click ${k + 1}` }));
    el.path.forEach((p, k) => out.push({ value: `path:${k}`, label: `Path point ${k + 1} (${p.x}%, ${p.y}%)` }));
  }
  return out;
}

export function WordInspector({
  scene,
  spec,
  words,
  sentences,
  first,
  last,
  target,
  blockedReason,
  onCommit,
  onSelectCue,
  onTarget,
  onClose,
}: {
  scene: SceneDto;
  spec: SceneSpec;
  words: TimedWord[];
  sentences: Segment[];
  /** Transcript indexes of the selected words. */
  first: number;
  last: number;
  /** The element to cue (the one selected before the word was picked). */
  target: ElementRef | null;
  blockedReason: string | null;
  /** Saves an element edit; `focus` selects the cue it created or moved. */
  onCommit: (ref: ElementRef, saved: SceneElement, patch: SceneElementPatch, focus?: CueId) => void;
  onSelectCue: (ref: ElementRef, cue: CueId) => void;
  onTarget: (ref: ElementRef) => void;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<EventChoice>("enter");
  const [edge, setEdge] = useState<"start" | "end">("start");
  const base: TriggerContext = { words, sceneStart: scene.startSec, sceneEnd: scene.endSec };
  const windows = resolveShotWindows(spec, base);
  const segmentOf = (shotId: string | null): TriggerContext => {
    const i = shotId ? (spec.shots ?? []).findIndex((s) => s.id === shotId) : -1;
    return i >= 0 ? { ...base, shotStart: windows[i].start, shotEnd: windows[i].end } : base;
  };
  const elements = [
    ...spec.elements.map((element, index) => ({ element, ref: { shotId: null, index } as ElementRef })),
    ...(spec.shots ?? []).flatMap((shot) => shot.elements.map((element, index) => ({ element, ref: { shotId: shot.id, index } as ElementRef }))),
  ];
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  const text = words.slice(lo, hi + 1).map((w) => w.text).join(" ");
  const sentence = sentences.find((s) => lo >= s.wordStart && lo < s.wordEnd);
  const trigger = spokenTrigger(words, lo, hi, base, { edge });

  // What is already cued to these words.
  const onWords = elements.flatMap(({ element, ref }) =>
    elementCues(element, segmentOf(ref.shotId), ref.shotId)
      .filter((c) => c.voiceSynced && c.wordIndex !== undefined && c.wordIndex >= lo && c.wordIndex <= hi)
      .map((cue) => ({ element, ref, cue })),
  );

  const targetEntry = (target && elements.find((e) => refKey(e.ref) === refKey(target))) ?? null;
  const choices = targetEntry ? eventChoices(targetEntry.element) : [];
  const chosen = choices.some((c) => c.value === choice) ? choice : "enter";
  const cueIt = () => {
    if (!targetEntry || blockedReason) return;
    const { element, ref } = targetEntry;
    const at = spokenTrigger(words, lo, hi, segmentOf(ref.shotId), { edge });
    if (chosen.startsWith("emphasis+")) {
      const list = element.emphasis ?? [];
      onCommit(ref, element, { emphasis: [...list, { type: chosen.slice("emphasis+".length) as Emphasis["type"], at }] }, `emphasis:${list.length}`);
    } else if (chosen === "click+") {
      const n = element.type === "cursor" ? (element.clicks?.length ?? 0) : 0;
      onCommit(ref, element, { cues: { [`click:${n}`]: at } }, `click:${n}`);
    } else {
      onCommit(ref, element, { cues: { [chosen]: at } }, chosen as CueId);
    }
  };

  // Text that says the word can highlight it as it's spoken (the renderer's highlight words).
  const token = lo === hi ? normalizeWord(words[lo]?.text ?? "") : "";
  const highlightable = token
    ? elements.filter(({ element }) => (element.type === "text" && element.text.split(/\s+/).some((t) => normalizeWord(t) === token)) || (element.type === "kinetic" && (element.source === "voice" || (element.text ?? "").split(/\s+/).some((t) => normalizeWord(t) === token))))
    : [];
  const toggleHighlight = (element: SceneElement, ref: ElementRef) => {
    if (element.type === "text") {
      const current = element.highlight;
      const list = current?.words ?? [];
      const has = list.some((w) => normalizeWord(w) === token);
      const next = has ? list.filter((w) => normalizeWord(w) !== token) : [...list, token];
      onCommit(ref, element, { props: { highlight: next.length ? { ...(current ?? {}), words: next, at: current?.at ?? "spoken" } : null } });
    } else if (element.type === "kinetic") {
      const list = element.emphasisWords ?? [];
      const has = list.some((w) => normalizeWord(w) === token);
      const next = has ? list.filter((w) => normalizeWord(w) !== token) : [...list, token];
      onCommit(ref, element, { props: { emphasisWords: next.length ? next : null } });
    }
  };
  const highlighted = (element: SceneElement) =>
    element.type === "text" ? !!element.highlight?.words.some((w) => normalizeWord(w) === token) : element.type === "kinetic" ? !!element.emphasisWords?.some((w) => normalizeWord(w) === token) : false;

  return (
    <div className="@container min-w-0">
      <InspectorHeader icon={<AudioLines />} title={`“${text}”`} subtitle={`${words[lo]?.start.toFixed(2)}–${words[hi]?.end.toFixed(2)}s · ${lo === hi ? `word ${lo + 1}` : `words ${lo + 1}–${hi + 1}`} · ${scene.key}`}>
        <IconAction label="Deselect (Esc)" onClick={onClose}>
          <X />
        </IconAction>
      </InspectorHeader>
      <BlockedNote reason={blockedReason} />

      <InspectorSection id="word.spoken" title="Spoken" summary={`${words[lo]?.start.toFixed(2)}s`}>
        {sentence ? (
          <p className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs leading-relaxed">
            {words.slice(sentence.wordStart, sentence.wordEnd).map((w, k) => {
              const index = sentence.wordStart + k;
              return (
                <span key={index} className={cn(index >= lo && index <= hi && "rounded bg-primary/20 px-0.5 font-semibold text-foreground")}>
                  {w.text}{" "}
                </span>
              );
            })}
          </p>
        ) : null}
        <FieldHint>Shift+click another word on the timeline to make it a phrase. Its timing comes from the voice-over and never moves.</FieldHint>
      </InspectorSection>

      <InspectorSection id="word.cued" title="Cued to it" summary={String(onWords.length)}>
        {onWords.length ? (
          <ul className="-mx-1.5 space-y-px">
            {onWords.map(({ element, ref, cue }) => {
              const Icon = elementIcon(element.type);
              return (
                <li key={`${refKey(ref)}:${cue.id}`}>
                  <button type="button" className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted/60" onClick={() => onSelectCue(ref, cue.id)}>
                    <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", CUE_DOT[cue.kind], !cue.ok && "bg-destructive")} />
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-mono text-[11px]">{elementName(element, ref)}</span>
                    <span className="min-w-0 truncate text-muted-foreground">
                      {cueLabel(cue.id, element.type)}
                      {cue.animation && cue.kind !== "action" ? ` · ${humanize(cue.animation).toLowerCase()}` : ""}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{cue.time.toFixed(2)}s</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing is cued to {lo === hi ? "this word" : "these words"} yet.</p>
        )}
      </InspectorSection>

      <InspectorSection id="word.cue" title="Cue to it">
        <FieldRow label="Element">
          <SelectField
            value={targetEntry ? refKey(targetEntry.ref) : undefined}
            defaultLabel={targetEntry ? undefined : "Choose an element"}
            options={elements.map(({ element, ref }) => ({ value: refKey(ref), label: `${elementName(element, ref)} · ${element.type}` }))}
            ariaLabel="Element to cue"
            disabled={!!blockedReason}
            onChange={(key) => {
              const found = key ? elements.find((e) => refKey(e.ref) === key) : undefined;
              if (found) onTarget(found.ref);
            }}
          />
        </FieldRow>
        <FieldRow label="What">
          <SelectField value={chosen} options={choices} ariaLabel="What happens on the word" disabled={!targetEntry || !!blockedReason} onChange={(v) => v && setChoice(v)} />
        </FieldRow>
        <FieldRow label="When">
          <SegmentedField
            value={edge}
            options={[
              { value: "start", label: "As it starts" },
              { value: "end", label: "As it ends" },
            ]}
            ariaLabel="Fire as the word starts or ends"
            onChange={setEdge}
          />
        </FieldRow>
        <div className="flex items-center gap-2">
          <Button size="xs" disabled={!targetEntry || !!blockedReason} onClick={cueIt}>
            Cue it
          </Button>
          <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground" title="The cue that will be saved">
            {trigger.type === "word" || trigger.type === "phrase" ? `${trigger.type} “${trigger.value}”${trigger.occurrence ? ` #${trigger.occurrence}` : ""}` : `word #${trigger.type === "wordIndex" ? trigger.index : ""}`}
            {edge === "end" ? " · end" : ""}
          </span>
        </div>
        <FieldHint>The cue names the word and which time it's spoken in {scene.key}, so it stays on this word if the voice-over is re-recorded. Elements inside shots are flagged when the word falls outside their shot.</FieldHint>
      </InspectorSection>

      {highlightable.length ? (
        <InspectorSection id="word.highlight" title="Highlight in text">
          {highlightable.map(({ element, ref }) => {
            const on = highlighted(element);
            const saved = findElementAt(spec, ref);
            return (
              <Button key={refKey(ref)} size="xs" variant={on ? "secondary" : "outline"} className="w-full justify-start" disabled={!!blockedReason || !saved} onClick={() => saved && toggleHighlight(saved, ref)}>
                <Highlighter /> {on ? "Stop highlighting" : "Highlight"} “{words[lo]?.text}” in {elementName(element, ref)}
                {element.type === "text" && !on ? " as it's spoken" : ""}
              </Button>
            );
          })}
          <FieldHint>Text highlights the word as the narrator says it; kinetic text shows it in its active colour.</FieldHint>
        </InspectorSection>
      ) : null}
    </div>
  );
}
