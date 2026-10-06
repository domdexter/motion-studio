"use client";

import {
  Group,
  Ungroup,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  BringToFront,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Ellipsis,
  SendToBack,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { ALIGN_LABELS, ALIGN_MODES, ARRANGE_ACTIONS, ARRANGE_LABELS, type AlignMode, type ArrangeAction, type DistributeAxis } from "@/core/timeline/element-ops";
import { Button } from "@/components/ui/button";
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROPERTY_GROUPS, usePropertyClips, type PropertyGroup } from "./property-clipboard";

/** What can be done to the selected elements of a scene, from menus, the inspector and shortcuts. */
export interface ElementActions {
  /** Selected elements of the current scene. */
  count: number;
  /** Why they can't be edited right now (locked scene, unsaved spec), or null. */
  blockedReason: string | null;
  duplicate: () => void;
  remove: () => void;
  arrange: (action: ArrangeAction) => void;
  /** One element aligns to the frame, several to their bounds. */
  align: (mode: AlignMode) => void;
  distribute: (axis: DistributeAxis) => void;
  /** Copies the transform, appearance or animation of the one selected element. */
  copy?: (group: PropertyGroup) => void;
  /** Pastes copied properties onto every selected element (one undo step). */
  paste?: (group: PropertyGroup) => void;
  /** Puts the selected elements into one group, or takes the selected group apart. */
  group?: () => void;
  ungroup?: () => void;
  canGroup?: boolean;
  canUngroup?: boolean;
}

export const ALIGN_ICONS: Record<AlignMode, LucideIcon> = {
  left: AlignStartVertical,
  hcenter: AlignCenterVertical,
  right: AlignEndVertical,
  top: AlignStartHorizontal,
  vcenter: AlignCenterHorizontal,
  bottom: AlignEndHorizontal,
};
export const ARRANGE_ICONS: Record<ArrangeAction, LucideIcon> = { front: BringToFront, forward: ArrowUp, backward: ArrowDown, back: SendToBack };
export const ARRANGE_SHORTCUTS: Record<ArrangeAction, string> = { front: "Ctrl+Shift+]", forward: "Ctrl+]", backward: "Ctrl+[", back: "Ctrl+Shift+[" };
export const DISTRIBUTE_ICONS: Record<DistributeAxis, LucideIcon> = { horizontal: AlignHorizontalDistributeCenter, vertical: AlignVerticalDistributeCenter };

interface MenuKit {
  Item: ComponentType<{ disabled?: boolean; onSelect?: () => void; className?: string; children?: ReactNode }>;
  Label: ComponentType<{ className?: string; children?: ReactNode }>;
  Separator: ComponentType<object>;
  Shortcut: ComponentType<{ children?: ReactNode }>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ disabled?: boolean; children?: ReactNode }>;
  SubContent: ComponentType<{ className?: string; children?: ReactNode }>;
}

const KITS = {
  context: { Item: ContextMenuItem, Label: ContextMenuLabel, Separator: ContextMenuSeparator, Shortcut: ContextMenuShortcut, Sub: ContextMenuSub, SubTrigger: ContextMenuSubTrigger, SubContent: ContextMenuSubContent } as unknown as MenuKit,
  dropdown: { Item: DropdownMenuItem, Label: DropdownMenuLabel, Separator: DropdownMenuSeparator, Shortcut: DropdownMenuShortcut, Sub: DropdownMenuSub, SubTrigger: DropdownMenuSubTrigger, SubContent: DropdownMenuSubContent } as unknown as MenuKit,
};

/** Duplicate, delete, layer order, align and distribute, for a context menu or a dropdown. */
export function ElementMenuItems({ actions, kind }: { actions: ElementActions; kind: keyof typeof KITS }) {
  const { Item, Label, Separator, Shortcut, Sub, SubTrigger, SubContent } = KITS[kind];
  const clips = usePropertyClips();
  const blocked = !!actions.blockedReason || actions.count === 0;
  const several = actions.count > 1;
  const canCopy = !several && actions.count === 1 && !!actions.copy;
  return (
    <>
      <Label className="text-xs font-normal text-muted-foreground">{actions.blockedReason ?? (several ? `${actions.count} elements` : "Element")}</Label>
      <Item disabled={blocked} onSelect={actions.duplicate}>
        <Copy /> Duplicate <Shortcut>Ctrl+D</Shortcut>
      </Item>
      <Item disabled={blocked} onSelect={actions.remove}>
        <Trash2 /> Delete <Shortcut>Del</Shortcut>
      </Item>
      {actions.group && actions.canGroup ? (
        <Item disabled={blocked} onSelect={actions.group}>
          <Group /> Group <Shortcut>Ctrl+G</Shortcut>
        </Item>
      ) : null}
      {actions.ungroup && actions.canUngroup ? (
        <Item disabled={blocked} onSelect={actions.ungroup}>
          <Ungroup /> Ungroup <Shortcut>Ctrl+Shift+G</Shortcut>
        </Item>
      ) : null}
      {canCopy || actions.paste ? (
        <Sub>
          <SubTrigger disabled={actions.count === 0}>
            <Clipboard /> Properties
          </SubTrigger>
          <SubContent className="w-60">
            {canCopy
              ? PROPERTY_GROUPS.map((group) => (
                  <Item key={`copy-${group}`} onSelect={() => actions.copy?.(group)}>
                    <ClipboardCopy /> Copy {group}
                  </Item>
                ))
              : null}
            {canCopy && actions.paste ? <Separator /> : null}
            {actions.paste
              ? PROPERTY_GROUPS.map((group) => (
                  <Item key={`paste-${group}`} disabled={blocked || !clips[group]} onSelect={() => actions.paste?.(group)}>
                    <ClipboardPaste /> Paste {group}
                    {clips[group] ? <Shortcut>{clips[group]!.name}</Shortcut> : null}
                  </Item>
                ))
              : null}
          </SubContent>
        </Sub>
      ) : null}
      <Separator />
      {ARRANGE_ACTIONS.map((action) => {
        const Icon = ARRANGE_ICONS[action];
        return (
          <Item key={action} disabled={blocked} onSelect={() => actions.arrange(action)}>
            <Icon /> {ARRANGE_LABELS[action]} <Shortcut>{ARRANGE_SHORTCUTS[action]}</Shortcut>
          </Item>
        );
      })}
      <Separator />
      <Sub>
        <SubTrigger disabled={blocked}>
          <AlignCenterVertical /> {several ? "Align" : "Align to frame"}
        </SubTrigger>
        <SubContent className="w-40">
          {ALIGN_MODES.map((mode) => {
            const Icon = ALIGN_ICONS[mode];
            return (
              <Item key={mode} onSelect={() => actions.align(mode)}>
                <Icon /> {ALIGN_LABELS[mode]}
              </Item>
            );
          })}
        </SubContent>
      </Sub>
      {several ? (
        <Sub>
          <SubTrigger disabled={blocked || actions.count < 3}>
            <AlignHorizontalDistributeCenter /> Distribute
          </SubTrigger>
          <SubContent className="w-44">
            <Item onSelect={() => actions.distribute("horizontal")}>
              <AlignHorizontalDistributeCenter /> Horizontally
            </Item>
            <Item onSelect={() => actions.distribute("vertical")}>
              <AlignVerticalDistributeCenter /> Vertically
            </Item>
          </SubContent>
        </Sub>
      ) : null}
    </>
  );
}

/** The inspector header's "more" menu for the selected element(s). */
export function ElementActionsMenu({ actions }: { actions: ElementActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label="More actions" title="Duplicate, layer order and alignment">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <ElementMenuItems actions={actions} kind="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Right-click on the picture with no element selected. */
export function SceneContextMenuItems({ sceneKey, onDuplicate, disabled }: { sceneKey: string; onDuplicate: () => void; disabled: boolean }) {
  return (
    <>
      <ContextMenuLabel className="text-xs font-normal text-muted-foreground">{sceneKey}</ContextMenuLabel>
      <ContextMenuItem disabled={disabled} onSelect={onDuplicate}>
        <CopyPlus /> Duplicate scene
      </ContextMenuItem>
    </>
  );
}

/** Right-click on an overlay clip in the picture. */
export function OverlayContextMenuItems({ onRemove }: { onRemove: () => void }) {
  return (
    <>
      <ContextMenuLabel className="text-xs font-normal text-muted-foreground">Overlay clip</ContextMenuLabel>
      <ContextMenuItem onSelect={onRemove}>
        <Trash2 /> Delete overlay <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}
