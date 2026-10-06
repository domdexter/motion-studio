"use client";

import { AudioLines, Clock3, Crosshair, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EmphasisSchema, type Emphasis, type SceneElement, type Trigger } from "@/core/spec/scene";
import type { TimedWord } from "@/core/spec/timing";
import { elementCues, isVoiceTrigger, wordsInSegment, type CueId, type CueKind, type ElementCue, type TriggerContext } from "@/core/spec/triggers";
import { actionCuesFor, cueLabel, cueRemovable, describeTrigger, isCutExit, spokenTrigger, wordAtTime, type ActionCueId } from "@/core/timeline/element-cues";
import { triggerAtTime } from "@/core/timeline/scene-restructure";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ElementFieldContext } from "./element-fields";
import { ClipboardMenu } from "./element-sections";
import { useInspectorEnv } from "./inspector-env";
import { IconAction, InspectorSection, ScrubField } from "./inspector-section";
import { ColorField, FieldHint, FieldRow, SegmentedField, SelectField } from "./property-fields";
import { humanize } from "./property-inputs";

/**
 * The voice-aware cue editor: every moment an element's motion is timed to — its entrance and exit,
 * emphasis moments, its type's actions, item entrances, cursor clicks and path points — each shown as
 * WORD or TIME → the moment it fires → what happens. A cue on a spoken word follows the voice-over; a
 * time is seconds into the scene (or shot). Every change is an element patch (`cues`, `emphasis`) saved
 * through the element service, so the timeline, canvas and undo follow.
 */

export const EMPHASIS_TYPES = EmphasisSchema.shape.type.options;
/** The renderer draws these four as a coloured glow (the others move the element). */
const GLOWING = new Set<string>(["glow", "highlight", "underline", "colorShift"]);
const EMPHASIS_HINTS: Record<Emphasis["type"], string> = {
  pulse: "A gentle scale pulse",
  pop: "A quick scale pop",
  shake: "A shake",
  bounce: "A bounce",
  glow: "A coloured glow",
  highlight: "A coloured glow (drawn like glow)",
  underline: "A coloured glow (drawn like glow)",
  colorShift: "A coloured glow (drawn like glow)",
};
const ACTION_DEFAULTS: Record<ActionCueId, string> = {
  pressAt: "never pressed",
  animateAt: "right after its entrance",
  collapseAt: "never collapses",
  connectAt: "after its last node appears",
};
export const CUE_DOT: Record<CueKind, string> = { enter: "bg-primary", exit: "bg-primary", emphasis: "bg-warning", action: "bg-foreground/75", path: "bg-muted-foreground" };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface CueSlot {
  id: CueId;
  kind: CueKind;
  label: string;
  /** The animation, or the item's text. */
  detail?: string;
  /** The cue, resolved — null when it has no moment of its own. */
  cue: ElementCue | null;
  /** How its default moment reads. */
  defaultText: string;
  /** Why it can't be cued here (a voice-synced reveal times itself). */
  locked?: string;
  /** It always needs a moment (emphasis, clicks, path points): no "default". */
  required: boolean;
}

/** Every cue an element has or can have, in the order the inspector lists them. */
function cueSlots(el: SceneElement, cues: ElementCue[], inShot: boolean): CueSlot[] {
  const seg = inShot ? "its shot" : "the scene";
  const byId = new Map(cues.map((c) => [c.id, c]));
  const slots: CueSlot[] = [];
  const enter = byId.get("enter") ?? null;
  slots.push({
    id: "enter",
    kind: "enter",
    label: "Entrance",
    detail: enter?.animation ? `${humanize(enter.animation).toLowerCase()}${enter.grammar ? " (from its intent)" : ""}` : "no animation",
    cue: enter?.trigger || enter?.delay ? enter : null,
    defaultText: `appears when ${seg} starts`,
    locked: enter?.spoken ? "Each word appears as the narrator says it (voice sync). Turn off Voice sync under Animation to cue the entrance." : undefined,
    required: false,
  });
  const exitAnimation = el.exit && el.exit.type !== "none" ? el.exit : null;
  slots.push({
    id: "exit",
    kind: "exit",
    label: "Exit",
    detail: exitAnimation ? (isCutExit(exitAnimation) ? "cut" : humanize(exitAnimation.type).toLowerCase()) : "stays",
    cue: byId.get("exit") ?? null,
    defaultText: exitAnimation ? `plays as ${seg} ends` : `stays until ${seg} ends`,
    required: false,
  });
  (el.emphasis ?? []).forEach((e, k) => slots.push({ id: `emphasis:${k}`, kind: "emphasis", label: `Emphasis ${k + 1}`, detail: humanize(e.type).toLowerCase(), cue: byId.get(`emphasis:${k}`) ?? null, defaultText: "", required: true }));
  for (const id of actionCuesFor(el.type)) slots.push({ id, kind: "action", label: cueLabel(id, el.type), cue: byId.get(id) ?? null, defaultText: ACTION_DEFAULTS[id], required: false });
  if (el.type === "list") el.items.forEach((it, k) => slots.push({ id: `item:${k}`, kind: "action", label: `Item ${k + 1}`, detail: it.text, cue: byId.get(`item:${k}`) ?? null, defaultText: "with the list's entrance", required: false }));
  if (el.type === "cards") el.items.forEach((it, k) => slots.push({ id: `item:${k}`, kind: "action", label: `Card ${k + 1}`, detail: it.title ?? it.label ?? it.value, cue: byId.get(`item:${k}`) ?? null, defaultText: "with the cards' entrance", required: false }));
  if (el.type === "cursor") {
    (el.clicks ?? []).forEach((_, k) => slots.push({ id: `click:${k}`, kind: "action", label: `Click ${k + 1}`, cue: byId.get(`click:${k}`) ?? null, defaultText: "", required: true }));
    el.path.forEach((p, k) => slots.push({ id: `path:${k}`, kind: "path", label: `Point ${k + 1}`, detail: `${p.x}%, ${p.y}%`, cue: byId.get(`path:${k}`) ?? null, defaultText: "", required: true }));
  }
  return slots;
}

/** Transcript indexes of the words spoken in a segment (a scene, or a shot of it). */
function segmentWordIndexes(words: TimedWord[], segment: TriggerContext): number[] {
  const spoken = new Set(wordsInSegment(words, segment));
  return words.flatMap((w, k) => (spoken.has(w) ? [k] : []));
}

type SourceMode = "word" | "time" | "default";

function modeOf(trigger: Trigger | undefined): SourceMode {
  if (!trigger) return "default";
  if (isVoiceTrigger(trigger)) return "word";
  return (trigger.type === "sceneStart" || trigger.type === "shotStart") && !trigger.offset ? "default" : "time";
}

/**
 * Where a cue's moment comes from: a spoken word or phrase (pick it from the scene's words, at the
 * playhead or on the timeline; fire as it starts or ends, with an offset), a time into the scene or
 * shot, or its default moment.
 */
function CueSourceEditor({
  slot,
  segment,
  words,
  disabled,
  pickLabel,
  onSet,
  children,
}: {
  slot: CueSlot;
  segment: TriggerContext;
  words: TimedWord[];
  disabled: boolean;
  /** Names the cue while a word is picked on the timeline. */
  pickLabel: string;
  onSet: (trigger: Trigger | null) => void;
  children: ReactNode;
}) {
  const env = useInspectorEnv();
  const [open, setOpen] = useState(false);
  const trigger = slot.cue?.trigger;
  const [mode, setMode] = useState<SourceMode>(modeOf(trigger));
  const inShot = segment.shotStart !== undefined;
  const seg = inShot ? "its shot" : "the scene";
  const start = segment.shotStart ?? segment.sceneStart;
  const end = segment.shotEnd ?? segment.sceneEnd;
  const spoken = useMemo(() => segmentWordIndexes(words, segment), [words, segment]);
  const edge: "start" | "end" = trigger && "edge" in trigger && trigger.edge === "end" ? "end" : "start";
  const offset = trigger && "offset" in trigger ? (trigger.offset ?? 0) : 0;
  const first = slot.cue?.voiceSynced ? slot.cue.wordIndex : undefined;
  const last = first !== undefined && trigger?.type === "phrase" ? first + trigger.value.split(/\s+/).length - 1 : first;
  const cueWords = (a: number, b: number, nextEdge: "start" | "end" = edge, nextOffset = offset) => onSet(spokenTrigger(words, a, b, segment, { edge: nextEdge, offset: nextOffset }));
  const playhead = () => Math.min(end, Math.max(start, env?.getTime() ?? start));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMode(modeOf(trigger));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-2.5">
        <p className="text-[11px] font-medium">
          {slot.label}
          {slot.detail ? <span className="font-normal text-muted-foreground"> · {slot.detail}</span> : null}
        </p>
        <SegmentedField
          value={mode}
          options={[
            { value: "word", label: "Spoken word" },
            { value: "time", label: "Time" },
            { value: "default", label: slot.required ? `${inShot ? "Shot" : "Scene"} start` : "Default" },
          ]}
          ariaLabel="Where the moment comes from"
          onChange={setMode}
        />
        {mode === "word" ? (
          <>
            <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-muted/20 p-1 leading-none">
              {spoken.length ? (
                spoken.map((k) => {
                  const on = first !== undefined && last !== undefined && k >= first && k <= last;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={disabled}
                      title={`${words[k].start.toFixed(2)}–${words[k].end.toFixed(2)}s${first !== undefined ? " · Shift+click for a phrase" : ""}`}
                      className={cn("m-0.5 inline-flex rounded border px-1 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50", on ? "border-primary bg-primary/20 text-foreground" : "border-transparent text-foreground/80")}
                      onClick={(e) => (e.shiftKey && first !== undefined ? cueWords(Math.min(first, k), Math.max(last ?? first, k)) : cueWords(k, k))}
                    >
                      {words[k].text}
                    </button>
                  );
                })
              ) : (
                <p className="p-1 text-[11px] text-muted-foreground">No words are spoken in {inShot ? "this shot" : "this scene"}.</p>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-1.5">
              <SegmentedField
                value={edge}
                options={[
                  { value: "start", label: "As it starts" },
                  { value: "end", label: "As it ends" },
                ]}
                ariaLabel="Fire as the word starts or ends"
                disabled={disabled || first === undefined}
                onChange={(v) => first !== undefined && cueWords(first, last ?? first, v)}
              />
              <ScrubField label="Offset" unit="s" value={offset} step={0.05} min={-5} max={5} disabled={disabled || first === undefined} title="Seconds before (−) or after the word" onCommit={(n) => first !== undefined && cueWords(first, last ?? first, edge, n)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  const k = wordAtTime(words, env?.getTime() ?? -1, 0.2);
                  if (k !== null && spoken.includes(k)) cueWords(k, k, "start", 0);
                  else toast(`The playhead isn't on a word spoken in ${inShot ? "this shot" : "this scene"}.`);
                }}
              >
                <AudioLines /> Word at playhead
              </Button>
              {env?.pickWord ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    env.pickWord?.(pickLabel, (k) => cueWords(k, k, "start", 0));
                  }}
                >
                  <Crosshair /> Pick on the timeline
                </Button>
              ) : null}
            </div>
          </>
        ) : mode === "time" ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5">
            <ScrubField
              label={inShot ? "Into shot" : "Into scene"}
              unit="s"
              value={slot.cue ? r3(slot.cue.time - start) : 0}
              step={0.01}
              min={0}
              max={r3(end - start)}
              disabled={disabled}
              title={`Seconds after ${seg} starts`}
              onCommit={(n) => onSet(triggerAtTime(start + n, segment))}
            />
            <Button size="xs" variant="outline" className="h-7" disabled={disabled} onClick={() => onSet(triggerAtTime(playhead(), segment))}>
              <Clock3 /> Playhead
            </Button>
          </div>
        ) : slot.required ? (
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => onSet({ type: inShot ? "shotStart" : "sceneStart" })}>
            When {seg} starts
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <FieldHint>Default: {slot.defaultText}.</FieldHint>
            <Button size="xs" variant="outline" disabled={disabled || !trigger} onClick={() => onSet(null)}>
              Use default
            </Button>
          </div>
        )}
        {slot.cue ? (
          <p className="border-t border-border pt-1.5 text-[11px] text-muted-foreground">
            Fires at <span className="font-mono text-foreground">{slot.cue.time.toFixed(2)}s</span> ({(slot.cue.time - start).toFixed(2)}s into {seg})
            {slot.cue.voiceSynced ? " · follows the voice-over, even with a new take" : " · stays put if the voice-over changes"}
          </p>
        ) : null}
        {slot.cue && !slot.cue.ok ? <p className="text-[11px] text-destructive">{slot.cue.reason}</p> : null}
        {slot.id === "enter" && slot.cue?.delay ? <FieldHint>A new cue replaces its {slot.cue.delay}s delay.</FieldHint> : null}
      </PopoverContent>
    </Popover>
  );
}

function EmphasisFields({ ctx, index, emphasis }: { ctx: ElementFieldContext; index: number; emphasis: Emphasis }) {
  const env = useInspectorEnv();
  const update = (change: { type?: Emphasis["type"]; duration?: number | null; intensity?: number | null; color?: string | null }) => {
    const next: Record<string, unknown> = { ...emphasis };
    for (const [key, value] of Object.entries(change)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    ctx.commit({ emphasis: (ctx.saved.emphasis ?? []).map((e, k) => (k === index ? (next as Emphasis) : e)) });
  };
  return (
    <div className="mt-1.5 space-y-1.5 border-t border-border/60 pt-1.5">
      <FieldRow label="Type">
        <SelectField value={emphasis.type} options={EMPHASIS_TYPES.map((t) => ({ value: t, label: humanize(t) }))} ariaLabel="Emphasis type" disabled={ctx.disabled} onChange={(t) => t && update({ type: t })} />
      </FieldRow>
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubField label="Length" unit="s" value={emphasis.duration ?? 0.6} step={0.05} min={0.05} max={5} disabled={ctx.disabled} title="How long the emphasis lasts" onCommit={(n) => update({ duration: n })} onReset={emphasis.duration !== undefined ? () => update({ duration: null }) : undefined} />
        <ScrubField label="Strength" unit="×" value={emphasis.intensity ?? 1} step={0.05} min={0} max={3} disabled={ctx.disabled} title="How strong it is (the scene's motion density scales it)" onCommit={(n) => update({ intensity: n })} onReset={emphasis.intensity !== undefined ? () => update({ intensity: null }) : undefined} />
      </div>
      {GLOWING.has(emphasis.type) ? (
        <FieldRow label="Color" onReset={emphasis.color ? () => update({ color: null }) : undefined} disabled={ctx.disabled}>
          <ColorField value={emphasis.color} fallback="primary" design={env?.design ?? null} ariaLabel="Emphasis color" disabled={ctx.disabled} onCommit={(color) => update({ color })} />
        </FieldRow>
      ) : null}
      <FieldHint>{EMPHASIS_HINTS[emphasis.type]}.</FieldHint>
    </div>
  );
}

function CueRow({
  slot,
  ctx,
  segment,
  words,
  name,
  focused,
  onFocus,
}: {
  slot: CueSlot;
  ctx: ElementFieldContext;
  segment: TriggerContext;
  words: TimedWord[];
  name: string;
  focused: boolean;
  onFocus?: (cue: CueId) => void;
}) {
  const env = useInspectorEnv();
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const inShot = segment.shotStart !== undefined;
  const start = segment.shotStart ?? segment.sceneStart;
  const end = segment.shotEnd ?? segment.sceneEnd;
  const time = slot.cue?.time ?? (slot.id === "enter" ? start : slot.id === "exit" ? end : null);
  const source = slot.locked ? "as its words are spoken" : slot.cue ? `${describeTrigger(slot.cue.trigger, slot.id === "exit" ? "end" : "start", inShot, words)}${slot.cue.delay ? ` + ${slot.cue.delay}s` : ""}` : slot.defaultText;
  const removable = cueRemovable(slot.id) && (slot.required || !!slot.cue?.trigger);
  const emphasisIndex = slot.kind === "emphasis" ? Number(slot.id.split(":")[1]) : -1;
  const emphasis = emphasisIndex >= 0 ? ctx.element.emphasis?.[emphasisIndex] : undefined;
  return (
    <div ref={rowRef} className={cn("rounded-md border px-2 py-1.5", focused ? "border-primary/60 bg-primary/[0.06]" : "border-transparent hover:bg-muted/40")}>
      <div className="flex items-center gap-1.5">
        <span className={cn("size-2 shrink-0 rotate-45 rounded-[1px]", CUE_DOT[slot.kind], slot.cue?.voiceSynced && "ring-1 ring-track-voice", slot.cue && !slot.cue.ok && "bg-destructive")} />
        <button type="button" className="min-w-0 flex-1 truncate text-left text-xs font-medium" onClick={() => onFocus?.(slot.id)} title="Select this cue (its diamond is highlighted on the timeline)">
          {slot.label}
          {slot.detail ? <span className="font-normal text-muted-foreground"> · {slot.detail}</span> : null}
        </button>
        {time !== null ? (
          <button
            type="button"
            className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums hover:text-foreground"
            title="Move the playhead here"
            onClick={() => {
              onFocus?.(slot.id);
              env?.seek(time);
            }}
          >
            {time.toFixed(2)}s
          </button>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-1">
        {slot.cue?.voiceSynced ? <AudioLines className="size-3 shrink-0 text-track-voice" aria-label="On the voice" /> : null}
        {slot.locked ? (
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={slot.locked}>
            {source}
          </span>
        ) : (
          <CueSourceEditor slot={slot} segment={segment} words={words} disabled={ctx.disabled} pickLabel={`${name} · ${slot.label.toLowerCase()}`} onSet={(trigger) => ctx.commit({ cues: { [slot.id]: trigger } })}>
            <button type="button" className="min-w-0 flex-1 truncate rounded border border-input bg-background/60 px-1.5 py-0.5 text-left text-[11px] hover:border-ring disabled:opacity-50 dark:bg-input/30" title="Change when it happens">
              {source}
            </button>
          </CueSourceEditor>
        )}
        {removable ? (
          <IconAction label={`Remove ${slot.label.toLowerCase()} (Del)`} disabled={ctx.disabled} onClick={() => ctx.commit({ cues: { [slot.id]: null } })}>
            <Trash2 />
          </IconAction>
        ) : null}
      </div>
      {slot.cue && !slot.cue.ok ? <p className="mt-1 text-[10px] leading-snug text-destructive">{slot.cue.reason}</p> : null}
      {focused && emphasis ? <EmphasisFields ctx={ctx} index={emphasisIndex} emphasis={emphasis} /> : null}
    </div>
  );
}

/** The inspector's Cues section for a scene element (images and videos too). */
export function CuesSection({
  ctx,
  id,
  name,
  segment,
  focusedCue = null,
  onFocusCue,
}: {
  ctx: ElementFieldContext;
  id: string;
  name: string;
  /** The element's scene timing, narrowed to its shot; null when unknown. */
  segment: TriggerContext | null;
  focusedCue?: CueId | null;
  onFocusCue?: (cue: CueId | null) => void;
}) {
  const env = useInspectorEnv();
  if (!segment) return null;
  const el = ctx.element;
  const words = env?.words.length ? env.words : segment.words;
  const inShot = segment.shotStart !== undefined;
  const start = segment.shotStart ?? segment.sceneStart;
  const end = segment.shotEnd ?? segment.sceneEnd;
  const cues = elementCues(el, segment, ctx.elementRef.shotId);
  const slots = cueSlots(el, cues, inShot);
  const onVoice = cues.filter((c) => c.voiceSynced).length;
  const emphasis = ctx.saved.emphasis ?? [];
  /** At the playhead: on the word being spoken, else the exact time. */
  const momentAtPlayhead = (): Trigger => {
    const t = Math.min(end, Math.max(start, env?.getTime() ?? start));
    const k = wordAtTime(words, t, 0.15);
    return k !== null && segmentWordIndexes(words, segment).includes(k) ? spokenTrigger(words, k, k, segment) : triggerAtTime(t, segment);
  };

  return (
    <InspectorSection
      id={id}
      title="Cues"
      summary={`${cues.length} · ${onVoice} on the voice`}
      focused={!!focusedCue}
      actions={
        <>
          <ClipboardMenu ctx={ctx} group="timing" name={name} segment={segment} />
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="xs" variant="ghost" className="h-6" disabled={ctx.disabled || emphasis.length >= 24} title="Add an emphasis moment at the playhead — on the word being spoken">
              <Plus /> Emphasis
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {EMPHASIS_TYPES.map((type) => (
              <DropdownMenuItem
                key={type}
                onSelect={() => {
                  ctx.commit({ emphasis: [...emphasis, { type, at: momentAtPlayhead() }] });
                  onFocusCue?.(`emphasis:${emphasis.length}`);
                }}
              >
                {humanize(type)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <div className="-mx-1 space-y-0.5">
        {slots.map((slot) => (
          <CueRow key={slot.id} slot={slot} ctx={ctx} segment={segment} words={words} name={name} focused={focusedCue === slot.id} onFocus={onFocusCue ?? undefined} />
        ))}
      </div>
      {el.type === "cursor" ? (
        <Button size="xs" variant="outline" disabled={ctx.disabled || (el.clicks?.length ?? 0) >= 20} onClick={() => ctx.commit({ cues: { [`click:${el.clicks?.length ?? 0}`]: momentAtPlayhead() } })}>
          <Plus /> Click at playhead
        </Button>
      ) : null}
      <FieldHint>A cue on a spoken word follows the voice-over. Drag its diamond on the timeline to retime it, or click a word on the timeline to cue anything to it.</FieldHint>
    </InspectorSection>
  );
}
