"use client";

import type { CardItem, ElementOf, Screen } from "@/core/spec/scene";
import type { ElementFieldContext } from "./element-fields";
import { summarizeElement } from "./element-summary";
import { useInspectorEnv } from "./inspector-env";
import { InspectorSection, ScrubField } from "./inspector-section";
import { ColorField, FieldHint, FieldRow, ListEditor, SegmentedField, SelectField, TextField, compact } from "./property-fields";
import { NumberInput, SegmentInput, SelectInput, SwitchInput, TextInput, bindPatch, options, propBinding } from "./property-inputs";

/**
 * The Content section: what an element shows, by type — its words, data, items, screen or points.
 * Lists (chart values, list items, cards, nodes, KPIs) are edited item by item and saved whole; cues
 * that items carry (a card that enters on a spoken word) are kept.
 */

const SCREEN_KINDS = ["dashboard", "analytics", "list", "chat", "landing", "form", "image", "video", "blank"] as const;
type ChartDatum = ElementOf<"chart">["data"][number];
type DiagramNode = ElementOf<"diagram">["nodes"][number];
type ListItem = ElementOf<"list">["items"][number];
type Kpi = NonNullable<ElementOf<"dashboard">["kpis"]>[number];
type DashboardRow = NonNullable<ElementOf<"dashboard">["rows"]>[number];

/** Lines or comma-separated words as a list (at most `max`). */
const listOf = (text: string, separator: RegExp, max: number) =>
  text
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

function ItemText({ value, label, onCommit, required, multiline, placeholder, disabled }: { value: string | undefined; label: string; onCommit: (value: string) => void; required?: boolean; multiline?: boolean; placeholder?: string; disabled?: boolean }) {
  return <TextField value={value ?? ""} ariaLabel={label} placeholder={placeholder ?? label} required={required} multiline={multiline} rows={2} disabled={disabled} onCommit={onCommit} />;
}

function ItemColor({ value, fallback, label, onCommit, disabled }: { value: string | undefined; fallback?: string; label: string; onCommit: (value: string | undefined) => void; disabled?: boolean }) {
  const env = useInspectorEnv();
  return <ColorField value={value} fallback={fallback} design={env?.design ?? null} ariaLabel={label} disabled={disabled} onCommit={(c) => onCommit(c ?? undefined)} />;
}

/** An image or video of the project (all project assets are available to the renderer). */
function AssetSelect({ value, kind, label, onChange, disabled, noneLabel = "None" }: { value: string | undefined; kind: "image" | "video"; label: string; onChange: (id: string | undefined) => void; disabled?: boolean; noneLabel?: string }) {
  const env = useInspectorEnv();
  const assets = Object.values(env?.assets ?? {})
    .filter((a) => a.kind === kind || a.mimeType.startsWith(`${kind}/`))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <FieldRow label={label}>
      <SelectField value={value} options={assets.map((a) => ({ value: a.id, label: a.name }))} defaultLabel={noneLabel} ariaLabel={label} disabled={disabled} onChange={onChange} />
    </FieldRow>
  );
}

function CardItemFields({ item, onChange, disabled }: { item: CardItem; onChange: (item: CardItem) => void; disabled: boolean }) {
  const set = (patch: Partial<CardItem>) => onChange(compact({ ...item, ...patch }));
  return (
    <div className="space-y-1">
      <ItemText value={item.title} label="Title" disabled={disabled} onCommit={(v) => set({ title: v })} />
      <ItemText value={item.body} label="Body" multiline disabled={disabled} onCommit={(v) => set({ body: v })} />
      <div className="grid grid-cols-2 gap-1">
        <ItemText value={item.value} label="Value" disabled={disabled} onCommit={(v) => set({ value: v })} />
        <ItemText value={item.label} label="Label" disabled={disabled} onCommit={(v) => set({ label: v })} />
        <ItemText value={item.icon} label="Icon" placeholder="Icon name" disabled={disabled} onCommit={(v) => set({ icon: v })} />
        <ItemColor value={item.color} fallback="primary" label="Card color" disabled={disabled} onCommit={(c) => set({ color: c })} />
      </div>
      <AssetSelect value={item.image} kind="image" label="Image" disabled={disabled} onChange={(id) => set({ image: id })} />
    </div>
  );
}

function ScreenFields({ ctx }: { ctx: ElementFieldContext }) {
  const env = useInspectorEnv();
  const el = ctx.element as ElementOf<"browser"> | ElementOf<"phone"> | ElementOf<"desktop">;
  const screen = el.screen;
  const kind = screen?.kind ?? "dashboard";
  const save = (patch: Partial<Screen>) => ctx.commit({ props: { screen: compact({ ...(screen ?? {}), kind, ...patch }) } });
  const media = kind === "image" || kind === "video";
  return (
    <>
      <FieldRow label="Screen">
        <SelectField value={kind} options={options(SCREEN_KINDS)} ariaLabel="Screen" disabled={ctx.disabled} onChange={(v) => v && save({ kind: v })} />
      </FieldRow>
      {media ? <AssetSelect value={screen?.assetId} kind={kind} label={kind === "image" ? "Image" : "Video"} disabled={ctx.disabled} onChange={(id) => save({ assetId: id })} /> : null}
      {!media && kind !== "blank" ? (
        <>
          <FieldRow label="Title">
            <TextField value={screen?.title ?? ""} ariaLabel="Screen title" placeholder="Shown in the screen" disabled={ctx.disabled} onCommit={(v) => save({ title: v })} />
          </FieldRow>
          <div className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Items (one per line)</span>
            <TextField
              value={(screen?.items ?? []).join("\n")}
              multiline
              rows={3}
              ariaLabel="Screen items"
              placeholder="Rows, messages or menu entries"
              disabled={ctx.disabled}
              onCommit={(v) => {
                const items = listOf(v, /\n/, 12);
                save({ items: items.length ? items : undefined });
              }}
            />
          </div>
          <FieldRow label="Accent" onReset={screen?.accent ? () => save({ accent: undefined }) : undefined} disabled={ctx.disabled}>
            <ColorField value={screen?.accent} fallback="primary" design={env?.design ?? null} ariaLabel="Screen accent" disabled={ctx.disabled} onCommit={(c) => save({ accent: c ?? undefined })} />
          </FieldRow>
          <FieldRow label="Brand">
            <TextField value={screen?.brand ?? ""} ariaLabel="Brand in the screen" placeholder="The project brand" disabled={ctx.disabled} onCommit={(v) => save({ brand: v })} />
          </FieldRow>
        </>
      ) : null}
      <FieldHint>A mock screen drawn by the renderer; the title and items fill its placeholders.</FieldHint>
    </>
  );
}

function ContentFields({ ctx }: { ctx: ElementFieldContext }) {
  const el = ctx.element;
  const p = <T,>(key: string) => propBinding<T>(ctx, key);
  const disabled = ctx.disabled;
  const saveList = (key: string, items: unknown[]) => ctx.commit({ props: { [key]: items.length ? items : null } });
  switch (el.type) {
    case "text":
      return (
        <>
          <TextInput b={p<string>("text")} label="Text" multiline rows={3} required />
          <FieldHint>Ctrl+Enter or click away to save. Voice-synced reveals follow the words you type.</FieldHint>
        </>
      );
    case "kinetic":
      return (
        <>
          <SegmentInput
            b={p<"voice" | "text">("source")}
            label="Words"
            options={[
              { value: "voice", label: "Narration" },
              { value: "text", label: "Text" },
            ]}
            fallback="voice"
          />
          <TextInput b={p<string>("text")} label={(el.source ?? "voice") === "voice" ? "Text (when the scene has no narration)" : "Text"} multiline rows={2} />
          <SelectInput b={p<"phrase" | "word" | "stack" | "karaoke">("mode")} label="Mode" options={options(["phrase", "word", "stack", "karaoke"] as const)} defaultLabel="Default (phrase)" />
          <TextInput
            b={bindPatch<string>(ctx, el.emphasisWords?.join(", "), (v) => ({ props: { emphasisWords: v ? listOf(v, /,/, 30) : null } }))}
            label="Emphasis"
            placeholder="words, in the emphasis color"
            hint="Words shown in the emphasis color, separated by commas"
          />
        </>
      );
    case "captions":
      return (
        <>
          <NumberInput b={p<number>("maxWords")} label="Max words" min={1} max={20} placeholder={ctx.frame.height > ctx.frame.width ? 4 : 7} title="Words per caption line" />
          <FieldHint>Shows the narration spoken in this scene, a few words at a time.</FieldHint>
        </>
      );
    case "badge":
      return (
        <>
          <TextInput b={p<string>("text")} label="Text" required />
          <TextInput b={p<string>("icon")} label="Icon" placeholder="Icon name, e.g. sparkles" />
        </>
      );
    case "card":
      return (
        <>
          <TextInput b={p<string>("title")} label="Title" />
          <TextInput b={p<string>("body")} label="Body" multiline rows={2} />
          <TextInput b={p<string>("value")} label="Value" placeholder="e.g. 98%" />
          <TextInput b={p<string>("label")} label="Label" />
          <TextInput b={p<string>("icon")} label="Icon" placeholder="Icon name" />
          <AssetSelect value={el.image} kind="image" label="Image" disabled={disabled} onChange={(id) => ctx.commit({ props: { image: id ?? null } })} />
        </>
      );
    case "cards":
      return (
        <>
          <SelectInput b={p<"row" | "column" | "grid" | "scatter" | "stack" | "orbit" | "cascade">("layout")} label="Layout" options={options(["row", "column", "grid", "scatter", "stack", "orbit", "cascade"] as const)} defaultLabel="Default (row)" />
          <div className="grid grid-cols-3 gap-1.5">
            <NumberInput b={p<number>("gap")} label="Gap" min={0} max={400} placeholder={el.variant === "app" ? 40 : 28} title="Space between cards in pixels" />
            <NumberInput b={p<number>("itemWidth")} label="W" min={1} max={2000} placeholder="auto" title="Card width in pixels" />
            <NumberInput b={p<number>("itemHeight")} label="H" min={1} max={2000} placeholder="auto" title="Card height in pixels" />
          </div>
          <ListEditor
            items={el.items}
            min={1}
            max={12}
            addLabel="Add card"
            disabled={disabled}
            itemTitle={(item, i) => item.title ?? item.label ?? item.value ?? `Card ${i + 1}`}
            create={() => ({ title: `Card ${el.items.length + 1}` })}
            onCommit={(items) => ctx.commit({ props: { items } })}
            renderItem={(item, update) => <CardItemFields item={item} disabled={disabled} onChange={(next) => update({ ...next, ...(item.at ? { at: item.at } : {}) })} />}
          />
          {el.collapseAt ? <FieldHint>The cards collapse on a cue — see the timed events.</FieldHint> : null}
        </>
      );
    case "button":
      return (
        <>
          <TextInput b={p<string>("label")} label="Label" required />
          <TextInput b={p<string>("icon")} label="Icon" placeholder="Icon name" />
          {el.pressAt ? <FieldHint>It is pressed on a cue — see the timed events.</FieldHint> : null}
        </>
      );
    case "notification":
      return (
        <>
          <TextInput b={p<string>("title")} label="Title" required />
          <TextInput b={p<string>("body")} label="Body" multiline rows={2} />
          <TextInput b={p<string>("app")} label="App" placeholder="The project brand" />
          <TextInput b={p<string>("time")} label="Time" placeholder="now" />
          <TextInput b={p<string>("icon")} label="Icon" placeholder="bell" />
        </>
      );
    case "cursor":
      return (
        <FieldHint>
          It moves through {el.path.length} point{el.path.length === 1 ? "" : "s"}
          {el.clicks?.length ? ` and clicks ${el.clicks.length} time${el.clicks.length === 1 ? "" : "s"}` : ""}, each on a cue. Edit the path in the scene spec.
        </FieldHint>
      );
    case "line":
      return (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <ScrubField label="From X" unit="%" value={el.from[0]} step={0.5} disabled={disabled} onPreview={(n) => ctx.preview({ props: { from: [n, el.from[1]] } })} onCancel={ctx.cancel} onCommit={(n) => ctx.commit({ props: { from: [n, el.from[1]] } })} />
            <ScrubField label="From Y" unit="%" value={el.from[1]} step={0.5} disabled={disabled} onPreview={(n) => ctx.preview({ props: { from: [el.from[0], n] } })} onCancel={ctx.cancel} onCommit={(n) => ctx.commit({ props: { from: [el.from[0], n] } })} />
            <ScrubField label="To X" unit="%" value={el.to[0]} step={0.5} disabled={disabled} onPreview={(n) => ctx.preview({ props: { to: [n, el.to[1]] } })} onCancel={ctx.cancel} onCommit={(n) => ctx.commit({ props: { to: [n, el.to[1]] } })} />
            <ScrubField label="To Y" unit="%" value={el.to[1]} step={0.5} disabled={disabled} onPreview={(n) => ctx.preview({ props: { to: [el.to[0], n] } })} onCancel={ctx.cancel} onCommit={(n) => ctx.commit({ props: { to: [el.to[0], n] } })} />
          </div>
          <NumberInput b={p<number>("curve")} label="Curve" step={0.05} min={-1} max={1} placeholder={0} title="Bends the line (−1 to 1)" />
          <FieldHint>Points are in % of the frame; a line isn&apos;t placed by X and Y.</FieldHint>
        </>
      );
    case "progress":
      return (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <ScrubField label="Value" unit="%" value={el.value} step={1} min={0} max={100} disabled={disabled} onPreview={(n) => ctx.preview({ props: { value: n } })} onCancel={ctx.cancel} onCommit={(n) => ctx.commit({ props: { value: n } })} />
            <NumberInput b={p<number>("from")} label="From" unit="%" min={0} max={100} placeholder={0} title="Where it starts filling from" />
          </div>
          <TextInput b={p<string>("label")} label="Label" />
          <SwitchInput b={p<boolean>("showValue")} label="Show value" fallback />
          {el.variant !== "ring" ? <NumberInput b={p<number>("size")} label="Thickness" unit="px" min={1} max={1200} placeholder={22} title="Bar thickness in pixels" /> : null}
        </>
      );
    case "chart": {
      const data = el.data;
      return (
        <>
          <FieldRow label="Kind">
            <SegmentedField value={el.kind} options={options(["bar", "line", "area", "donut"] as const)} ariaLabel="Chart kind" disabled={disabled} onChange={(kind) => ctx.commit({ props: { kind } })} />
          </FieldRow>
          <ListEditor<ChartDatum>
            items={data}
            min={1}
            max={24}
            addLabel="Add value"
            disabled={disabled}
            itemTitle={(d, i) => d.label || `#${i + 1}`}
            create={() => ({ label: `Item ${data.length + 1}`, value: data[data.length - 1]?.value ?? 0 })}
            onCommit={(next) => ctx.commit({ props: { data: next, ...(el.highlight !== undefined && el.highlight >= next.length ? { highlight: null } : {}) } })}
            renderItem={(d, update) => (
              <div className="grid grid-cols-[minmax(0,1fr)_5.25rem_4.75rem] items-center gap-1">
                <ItemText value={d.label} label="Label" required disabled={disabled} onCommit={(v) => update({ ...d, label: v })} />
                <ScrubField label="Val" value={d.value} step={1} disabled={disabled} onCommit={(n) => update({ ...d, value: n })} />
                <ItemColor value={d.color} fallback={el.kind === "donut" ? undefined : "primary"} label="Value color" disabled={disabled} onCommit={(c) => update(compact({ ...d, color: c }))} />
              </div>
            )}
          />
          <TextInput b={p<string>("unit")} label="Unit" placeholder="%, $, users" />
          {el.kind !== "donut" ? <SwitchInput b={p<boolean>("showValues")} label="Values" fallback={el.kind === "bar" || data.length <= 8} /> : null}
          <SwitchInput b={p<boolean>("showLabels")} label="Labels" fallback />
          <FieldRow label="Highlight" onReset={el.highlight !== undefined ? () => ctx.commit({ props: { highlight: null } }) : undefined} disabled={disabled}>
            <SelectField
              value={el.highlight === undefined ? undefined : String(el.highlight)}
              options={data.map((d, i) => ({ value: String(i), label: d.label || `#${i + 1}` }))}
              defaultLabel="None"
              ariaLabel="Highlighted value"
              disabled={disabled}
              onChange={(v) => ctx.commit({ props: { highlight: v === undefined ? null : Number(v) } })}
            />
          </FieldRow>
        </>
      );
    }
    case "counter":
      return (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <NumberInput b={p<number>("from")} label="From" placeholder={0} />
            <ScrubField label="To" value={el.to} step={1} disabled={disabled} onCommit={(n) => ctx.commit({ props: { to: n } })} />
            <NumberInput b={p<number>("decimals")} label="Decimals" min={0} max={4} placeholder={0} />
            <NumberInput b={p<number>("countDuration")} label="Count" unit="s" step={0.1} min={0.1} max={20} placeholder={1.6} title="How long it counts" />
          </div>
          <TextInput b={p<string>("prefix")} label="Prefix" placeholder="$" />
          <TextInput b={p<string>("suffix")} label="Suffix" placeholder="%" />
          <TextInput b={p<string>("label")} label="Label" />
        </>
      );
    case "diagram": {
      const layout = el.layout ?? (el.center ? "hub" : "flow");
      const center = el.center;
      return (
        <>
          <SelectInput b={p<"hub" | "flow" | "cycle" | "grid">("layout")} label="Layout" options={options(["hub", "flow", "cycle", "grid"] as const)} defaultLabel={`Default (${el.center ? "hub" : "flow"})`} />
          {layout === "hub" || layout === "cycle" ? (
            <div className="grid grid-cols-2 gap-1">
              <ItemText value={center?.label} label="Center" placeholder="Center label" disabled={disabled} onCommit={(v) => ctx.commit({ props: { center: v ? compact({ ...(center ?? {}), label: v }) : null } })} />
              <ItemText value={center?.icon} label="Center icon" placeholder="Icon name" disabled={disabled || !center} onCommit={(v) => center && ctx.commit({ props: { center: compact({ ...center, icon: v }) } })} />
            </div>
          ) : null}
          <ListEditor<DiagramNode>
            items={el.nodes}
            min={1}
            max={12}
            addLabel="Add node"
            disabled={disabled}
            itemTitle={(n, i) => n.label || `Node ${i + 1}`}
            create={() => ({ label: `Node ${el.nodes.length + 1}` })}
            onCommit={(nodes) => ctx.commit({ props: { nodes } })}
            renderItem={(node, update) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_4.75rem] items-center gap-1">
                <ItemText value={node.label} label="Label" required disabled={disabled} onCommit={(v) => update({ ...node, label: v })} />
                <ItemText value={node.icon} label="Icon" disabled={disabled} onCommit={(v) => update(compact({ ...node, icon: v }))} />
                <ItemColor value={node.color} fallback="primary" label="Node color" disabled={disabled} onCommit={(c) => update(compact({ ...node, color: c }))} />
              </div>
            )}
          />
          {el.edges?.length ? <FieldHint>{el.edges.length} custom connections refer to nodes by position — reordering or removing nodes changes them. Edit connections in the scene spec.</FieldHint> : null}
        </>
      );
    }
    case "icon":
      return (
        <>
          <TextInput b={p<string>("name")} label="Icon" required placeholder="calendar-check" />
          <FieldHint>Any Lucide icon name.</FieldHint>
        </>
      );
    case "list":
      return (
        <>
          <SegmentInput b={p<"bullets" | "checks" | "numbers" | "icons">("variant")} label="Markers" options={options(["checks", "bullets", "numbers", "icons"] as const)} fallback="checks" />
          <ListEditor<ListItem>
            items={el.items}
            min={1}
            max={8}
            addLabel="Add item"
            disabled={disabled}
            itemTitle={(item, i) => item.text || `Item ${i + 1}`}
            create={() => ({ text: `Item ${el.items.length + 1}` })}
            onCommit={(items) => ctx.commit({ props: { items } })}
            renderItem={(item, update) => (
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-1">
                <ItemText value={item.text} label="Text" required disabled={disabled} onCommit={(v) => update({ ...item, text: v })} />
                <ItemText value={item.icon} label="Icon" disabled={disabled} onCommit={(v) => update(compact({ ...item, icon: v }))} />
              </div>
            )}
          />
        </>
      );
    case "browser":
      return (
        <>
          <TextInput b={p<string>("url")} label="Address" placeholder="app.brand.com" />
          <TextInput b={p<string>("title")} label="Page title" />
          <ScreenFields ctx={ctx} />
        </>
      );
    case "phone":
    case "desktop":
      return <ScreenFields ctx={ctx} />;
    case "dashboard":
      return (
        <>
          <TextInput b={p<string>("title")} label="Title" placeholder="Overview" />
          <TextInput b={bindPatch<string>(ctx, el.sidebar?.join("\n"), (v) => ({ props: { sidebar: v ? listOf(v, /\n/, 10) : null } }))} label="Sidebar (one per line)" multiline rows={3} placeholder="Home, Reports…" />
          <p className="pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Metrics</p>
          <ListEditor<Kpi>
            items={el.kpis ?? []}
            max={6}
            addLabel="Add metric"
            disabled={disabled}
            itemTitle={(k) => k.label}
            create={() => ({ label: "Metric", value: "0" })}
            onCommit={(kpis) => saveList("kpis", kpis)}
            renderItem={(k, update) => (
              <div className="grid grid-cols-3 gap-1">
                <ItemText value={k.label} label="Label" required disabled={disabled} onCommit={(v) => update({ ...k, label: v })} />
                <ItemText value={k.value} label="Value" required disabled={disabled} onCommit={(v) => update({ ...k, value: v })} />
                <ItemText value={k.delta} label="Change" placeholder="+12%" disabled={disabled} onCommit={(v) => update(compact({ ...k, delta: v }))} />
              </div>
            )}
          />
          <p className="pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Chart</p>
          <ListEditor
            items={el.chart ?? []}
            max={24}
            addLabel="Add bar"
            disabled={disabled}
            itemTitle={(d) => d.label}
            create={() => ({ label: `${(el.chart?.length ?? 0) + 1}`, value: el.chart?.[el.chart.length - 1]?.value ?? 10 })}
            onCommit={(chart) => saveList("chart", chart)}
            renderItem={(d, update) => (
              <div className="grid grid-cols-[minmax(0,1fr)_5.25rem] gap-1">
                <ItemText value={d.label} label="Label" required disabled={disabled} onCommit={(v) => update({ ...d, label: v })} />
                <ScrubField label="Val" value={d.value} step={1} disabled={disabled} onCommit={(n) => update({ ...d, value: n })} />
              </div>
            )}
          />
          <p className="pt-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Rows</p>
          <ListEditor<DashboardRow>
            items={el.rows ?? []}
            max={8}
            addLabel="Add row"
            disabled={disabled}
            itemTitle={(r) => r.label}
            create={() => ({ label: "Row" })}
            onCommit={(rows) => saveList("rows", rows)}
            renderItem={(row, update) => (
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_5.5rem] gap-1">
                <ItemText value={row.label} label="Label" required disabled={disabled} onCommit={(v) => update({ ...row, label: v })} />
                <ItemText value={row.value} label="Value" disabled={disabled} onCommit={(v) => update(compact({ ...row, value: v }))} />
                <SelectField value={row.status} options={options(["ok", "warn", "error", "info"] as const)} defaultLabel="No status" ariaLabel="Status" disabled={disabled} onChange={(status) => update(compact({ ...row, status }))} />
              </div>
            )}
          />
        </>
      );
    case "logo":
      return (
        <>
          <TextInput b={p<string>("text")} label="Name" placeholder="The brand name" />
          <AssetSelect value={el.assetId} kind="image" label="Logo" noneLabel="Brand logo" disabled={disabled} onChange={(id) => ctx.commit({ props: { assetId: id ?? null } })} />
        </>
      );
    default:
      return null;
  }
}

const DATA_TYPES = new Set(["chart", "counter", "progress"]);
const NO_CONTENT = new Set(["rect", "grid", "circle", "image", "video"]);

export function ContentSection({ ctx, id }: { ctx: ElementFieldContext; id: string }) {
  const el = ctx.element;
  if (NO_CONTENT.has(el.type)) return null;
  const title = DATA_TYPES.has(el.type) ? "Data" : el.type === "line" ? "Points" : el.type === "cursor" ? "Path" : el.type === "phone" || el.type === "desktop" ? "Screen" : "Content";
  return (
    <InspectorSection id={id} title={title} summary={summarizeElement(el) || undefined}>
      <ContentFields ctx={ctx} />
    </InspectorSection>
  );
}
