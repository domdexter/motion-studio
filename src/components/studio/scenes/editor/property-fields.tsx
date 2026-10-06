"use client";

import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { DesignSystem } from "@/core/spec/design";
import { COLOR_TOKENS, ColorSchema, type Anchor } from "@/core/spec/scene";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Compact property controls for the inspector: labelled rows with a reset, colours (design tokens or
 * any colour), selects, segmented choices, switches, text, the anchor grid and editable lists. A
 * control only keeps what is being typed; finished values go to its section, which saves them through
 * the element service — the saved scene spec stays the only state.
 */

/** A property row: label, control and — while the value is set — a reset back to the default. */
export function FieldRow({ label, hint, onReset, disabled, children, className }: { label: string; hint?: string; onReset?: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-h-7 grid-cols-[4.75rem_minmax(0,1fr)_1.25rem] items-center gap-1.5", className)}>
      <span className="truncate text-[11px] text-muted-foreground" title={hint ?? label}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
      {onReset ? <ResetButton label={`Reset ${label.toLowerCase()} to its default`} onClick={onReset} disabled={disabled} /> : <span aria-hidden />}
    </div>
  );
}

export function ResetButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" size="icon-xs" variant="ghost" className="size-5 text-muted-foreground hover:text-foreground [&_svg]:size-3" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <RotateCcw />
    </Button>
  );
}

/** A small hint under a group of controls. */
export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

const DEFAULT_OPTION = "__default";

export function SelectField<T extends string>({
  value,
  options,
  onChange,
  defaultLabel,
  disabled,
  ariaLabel,
  className,
}: {
  value: T | undefined;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
  /** Adds a first option that unsets the value (e.g. "Default (title)"). */
  defaultLabel?: string;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const unknown = value !== undefined && !options.some((o) => o.value === value);
  return (
    <Select value={value ?? DEFAULT_OPTION} onValueChange={(v) => onChange(v === DEFAULT_OPTION ? undefined : (v as T))} disabled={disabled}>
      <SelectTrigger size="sm" className={cn("h-7 w-full min-w-0 text-xs", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLabel !== undefined ? <SelectItem value={DEFAULT_OPTION}>{defaultLabel}</SelectItem> : null}
        {unknown ? <SelectItem value={value}>{value}</SelectItem> : null}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One of a few choices side by side (alignment, variants). */
export function SegmentedField<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: T | undefined;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" spacing={0} value={value ?? ""} onValueChange={(v) => v && onChange(v as T)} disabled={disabled} aria-label={ariaLabel} className="w-full">
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} aria-label={o.label} title={o.label} className="h-7 min-w-0 flex-1 px-1 text-[11px] [&_svg]:size-3.5">
          {o.icon ?? o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SwitchField({ checked, onChange, disabled, label }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label: string }) {
  return <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />;
}

/** Text that saves when you leave the field (Enter; multiline: Ctrl+Enter). Escape puts the saved text back. */
export function TextField({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
  multiline = false,
  rows = 3,
  required = false,
  maxLength,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  multiline?: boolean;
  rows?: number;
  /** An empty value isn't saved (the saved text comes back). */
  required?: boolean;
  maxLength?: number;
  className?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text === value) return;
    if (required && !text.trim()) return setText(value);
    onCommit(text);
  };
  const common = {
    value: text,
    placeholder,
    disabled,
    maxLength,
    "aria-label": ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: commit,
  };
  if (multiline) {
    return (
      <Textarea
        {...common}
        rows={rows}
        className={cn("min-h-14 resize-y px-2 py-1.5 text-xs leading-snug", className)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) e.currentTarget.blur();
          if (e.key === "Escape") setText(value);
        }}
      />
    );
  }
  return (
    <Input
      {...common}
      className={cn("h-7 px-2 text-xs", className)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}

const FIXED_COLORS: Record<string, string> = { white: "#FFFFFF", black: "#000000", transparent: "transparent" };
const isToken = (value: string) => (COLOR_TOKENS as readonly string[]).includes(value);

/** The CSS colour a design token or colour value renders as. */
export function resolveColorValue(value: string | undefined, design: DesignSystem | null): string | null {
  if (!value) return null;
  if (design && value in design.colors) return design.colors[value as keyof DesignSystem["colors"]];
  return FIXED_COLORS[value] ?? value;
}

const asHex = (css: string | null) => (css && /^#[0-9a-f]{6}$/i.test(css) ? css : css && /^#[0-9a-f]{3}$/i.test(css) ? `#${[...css.slice(1)].map((c) => c + c).join("")}` : "#000000");

function Swatch({ css }: { css: string | null }) {
  const clear = !css || css === "transparent";
  return (
    <span
      className="size-4 shrink-0 rounded-sm border border-border/80"
      style={
        clear
          ? { backgroundImage: "linear-gradient(45deg,#9994 25%,transparent 25%,transparent 75%,#9994 75%),linear-gradient(45deg,#9994 25%,transparent 25%,transparent 75%,#9994 75%)", backgroundSize: "6px 6px", backgroundPosition: "0 0,3px 3px" }
          : { background: css }
      }
    />
  );
}

/**
 * A colour: one of the project's design tokens (they follow brand changes) or any colour. Dragging in
 * the colour picker previews; the colour saves when the picker closes.
 */
export function ColorField({
  value,
  fallback,
  design,
  onCommit,
  onPreview,
  onCancel,
  disabled,
  ariaLabel,
}: {
  value: string | undefined;
  /** The token an unset colour renders as. */
  fallback?: string;
  design: DesignSystem | null;
  /** null: back to the default. */
  onCommit: (value: string | null) => void;
  onPreview?: (value: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const css = resolveColorValue(value ?? fallback, design);
  const label = value === undefined ? `Default${fallback ? ` · ${fallback}` : ""}` : isToken(value) ? value : value.toUpperCase();

  const change = (next: boolean) => {
    if (next) {
      setTyped(value && !isToken(value) ? value : asHex(css));
      setCustom(null);
    } else if (custom !== null) {
      if (custom !== value) onCommit(custom);
      else onCancel?.();
      setCustom(null);
    }
    setOpen(next);
  };
  const pick = (color: string | null) => {
    setCustom(null);
    setOpen(false);
    if (color !== (value ?? null)) onCommit(color);
    else onCancel?.();
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          title={ariaLabel}
          className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-input bg-background/60 px-1.5 text-left text-[11px] outline-none focus-visible:border-ring disabled:opacity-50 dark:bg-input/30"
        >
          <Swatch css={custom ?? css} />
          <span className={cn("min-w-0 truncate", value === undefined && "text-muted-foreground")}>{custom ? custom : label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-2">
        <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Design colors</p>
        <div className="grid grid-cols-6 gap-1">
          {COLOR_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              title={token}
              aria-label={token}
              aria-pressed={value === token}
              onClick={() => pick(token)}
              className={cn("flex size-8 items-center justify-center rounded-md border hover:bg-muted", value === token ? "border-primary ring-1 ring-primary" : "border-border")}
            >
              <Swatch css={resolveColorValue(token, design)} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={asHex(custom ?? (typed.startsWith("#") ? typed : css))}
            onChange={(e) => {
              const color = e.target.value.toUpperCase();
              setCustom(color);
              setTyped(color);
              onPreview?.(color);
            }}
            className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
            aria-label="Pick a custom color"
          />
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = typed.trim();
              if (ColorSchema.safeParse(v).success) pick(v);
            }}
            className="h-7 font-mono text-[11px]"
            placeholder="#RRGGBB, rgba(…) or a token"
            aria-label="Color value (Enter to apply)"
          />
        </div>
        <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => pick(null)}>
          Use the default{fallback ? ` (${fallback})` : ""}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

const ANCHORS: Anchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

/** The point of an element that its x/y place, as a 3×3 grid. */
export function AnchorField({ value, onChange, disabled }: { value: Anchor; onChange: (anchor: Anchor) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Anchor" className="grid size-[3.1rem] shrink-0 grid-cols-3 gap-px rounded-md border border-input bg-background/60 p-0.5 dark:bg-input/30">
      {ANCHORS.map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          aria-label={`Anchor ${a}`}
          title={`Anchor: ${a}`}
          disabled={disabled}
          onClick={() => onChange(a)}
          className={cn("flex items-center justify-center rounded-[3px] hover:bg-muted disabled:opacity-50", value === a && "bg-primary/15")}
        >
          <span className={cn("size-1.5 rounded-full", value === a ? "bg-primary" : "bg-muted-foreground/45")} />
        </button>
      ))}
    </div>
  );
}

function ItemButton({ label, ...props }: { label: string } & Omit<React.ComponentProps<typeof Button>, "size" | "variant">) {
  return <Button type="button" size="icon-xs" variant="ghost" className="size-5 text-muted-foreground [&_svg]:size-3" aria-label={label} title={label} {...props} />;
}

/** Items of a list property (chart data, list items, cards…): edit, reorder, add and remove; every change saves the whole list. */
export function ListEditor<T>({
  items,
  onCommit,
  create,
  renderItem,
  max,
  min = 0,
  addLabel,
  disabled,
  itemTitle,
}: {
  items: readonly T[];
  onCommit: (items: T[]) => void;
  create: () => T;
  renderItem: (item: T, update: (next: T) => void, index: number) => ReactNode;
  max: number;
  min?: number;
  addLabel: string;
  disabled?: boolean;
  itemTitle?: (item: T, index: number) => string;
}) {
  const move = (from: number, to: number) => {
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onCommit(next);
  };
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-1.5">
          <div className="flex items-center gap-0.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{itemTitle ? itemTitle(item, i) : `#${i + 1}`}</span>
            <ItemButton label="Move up" disabled={disabled || i === 0} onClick={() => move(i, i - 1)}>
              <ArrowUp />
            </ItemButton>
            <ItemButton label="Move down" disabled={disabled || i === items.length - 1} onClick={() => move(i, i + 1)}>
              <ArrowDown />
            </ItemButton>
            <ItemButton label={items.length <= min ? `Keep at least ${min}` : "Remove"} disabled={disabled || items.length <= min} onClick={() => onCommit(items.filter((_, k) => k !== i))}>
              <X />
            </ItemButton>
          </div>
          {renderItem(item, (next) => onCommit(items.map((it, k) => (k === i ? next : it))), i)}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button type="button" size="xs" variant="outline" disabled={disabled || items.length >= max} onClick={() => onCommit([...items, create()])}>
          <Plus /> {addLabel}
        </Button>
        {items.length >= max ? <span className="text-[10px] text-muted-foreground">At most {max}</span> : null}
      </div>
    </div>
  );
}

/** A copy without unset optional values (empty strings and undefined), so saved items stay clean. */
export function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")) as T;
}
