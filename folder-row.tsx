import type { HTMLAttributes } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import * as Dropdown from "./components/ui/dropdown-menu";
import * as Context from "./components/ui/context-menu";
import { useResponsiveOverlayBehavior } from "./components/ui/responsive-overlay";
import type { Repository } from "./model";
import { sortModes, type SortMode } from "./preferences";

export type RowDrag = Pick<HTMLAttributes<HTMLElement>, "onDragStart" | "onDragOver" | "onDragLeave" | "onDrop" | "onDragEnd">;
interface FolderProps {
  id: string; label: string; path?: string; depth: number; count: number; expanded: boolean; pinned: boolean;
  custom: boolean; nested: boolean; sort: SortMode; candidates: Repository[]; grouped: boolean; drag: RowDrag;
  toggle(): void; togglePin(): void; setSort(mode: SortMode): void;
  groupWith(repository: Repository): void; separate(): void; resetOrder(): void;
  create(): void; rename(): void; remove(): void; toRoot(): void;
  hasThreadLocations: boolean; restoreThreadLocations(): void;
}
function FolderActions({ context = false, ...props }: FolderProps & { context?: boolean }) {
  const { presentation } = useResponsiveOverlayBehavior();
  const compact = !context && presentation === "drawer";
  const Item = context ? Context.ContextMenuItem : Dropdown.DropdownMenuItem;
  const Separator = context ? Context.ContextMenuSeparator : Dropdown.DropdownMenuSeparator;
  const Sub = context ? Context.ContextMenuSub : Dropdown.DropdownMenuSub;
  const SubTrigger = context ? Context.ContextMenuSubTrigger : Dropdown.DropdownMenuSubTrigger;
  const SubContent = context ? Context.ContextMenuSubContent : Dropdown.DropdownMenuSubContent;
  const RadioGroup = context ? Context.ContextMenuRadioGroup : Dropdown.DropdownMenuRadioGroup;
  const RadioItem = context ? Context.ContextMenuRadioItem : Dropdown.DropdownMenuRadioItem;
  return <>
    <Item onSelect={props.create}>New folder…</Item>
    {props.custom ? <><Item onSelect={props.rename}>Rename folder…</Item><Item onSelect={props.remove}>Remove folder</Item></> : null}
    <Item onSelect={props.togglePin}>{props.pinned ? "Unpin folder" : "Pin folder"}</Item>
    {props.nested ? <Item onSelect={props.toRoot}>Move to root</Item> : null}
    <Item onSelect={props.resetOrder}>Reset folder order</Item>
    {props.hasThreadLocations ? <Item onSelect={props.restoreThreadLocations}>Restore thread locations</Item> : null}
    <Separator />
    {compact ? <label className="flex flex-col gap-1 px-2 py-1 text-xs">Sort by
      <select aria-label="Folder sort" value={props.sort} onChange={event => props.setSort(event.target.value as SortMode)}>
        {sortModes.map(mode => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
      </select>
    </label> : <Sub><SubTrigger>Sort by</SubTrigger><SubContent>
      <RadioGroup value={props.sort} onValueChange={value => props.setSort(value as SortMode)}>
        {sortModes.map(mode => <RadioItem key={mode.value} value={mode.value}>{mode.label}</RadioItem>)}
      </RadioGroup>
    </SubContent></Sub>}
    {props.candidates.length || props.grouped ? compact ? <label className="flex flex-col gap-1 px-2 py-1 text-xs">Group with…
      <select aria-label="Group with" value="" onChange={event => {
        if (event.target.value === "separate") props.separate();
        else { const repository = props.candidates.find(repository => repository.id === event.target.value); if (repository) props.groupWith(repository); }
      }}>
        <option value="" disabled>Choose repository…</option>
        {props.candidates.map(repository => <option key={repository.id} value={repository.id}>{repository.label}</option>)}
        {props.grouped ? <option value="separate">Keep checkouts separate</option> : null}
      </select>
    </label> : <Sub><SubTrigger>Group with…</SubTrigger><SubContent>
      {props.candidates.map(repository => <Item key={repository.id} title={repository.path} onSelect={() => props.groupWith(repository)}>{repository.label}</Item>)}
      {props.grouped ? <><Separator /><Item onSelect={props.separate}>Keep checkouts separate</Item></> : null}
    </SubContent></Sub> : null}
  </>;
}
export function FolderRow(props: FolderProps) {
  return <Context.ContextMenu><Context.ContextMenuTrigger asChild>
    <div className="wt-row wt-folder" data-wt-folder-id={props.id} role="treeitem" aria-level={props.depth + 1} aria-expanded={props.expanded}
      onDragOver={props.drag.onDragOver} onDragLeave={props.drag.onDragLeave} onDrop={props.drag.onDrop}
      style={{ paddingLeft: 8 + props.depth * 12 }}>
      <button className="wt-heading" title={props.path} onClick={props.toggle} draggable
        onDragStart={props.drag.onDragStart} onDragEnd={props.drag.onDragEnd}>
        <Icon name={props.expanded ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0" />
        <Icon name="Folder" className="size-4 shrink-0" />
        <span className="wt-heading-label">{props.label}</span>
        {props.pinned ? <span aria-label="Pinned folder"><Icon name="Pin" className="size-3 shrink-0" /></span> : null}
        <span className="wt-count">{props.count}</span>
      </button>
      <Dropdown.DropdownMenu><Dropdown.DropdownMenuTrigger asChild>
        <button className="wt-icon-button wt-menu" aria-label={`Folder actions for ${props.label}`}><Icon name="MoreHorizontal" className="size-4" /></button>
      </Dropdown.DropdownMenuTrigger><Dropdown.DropdownMenuContent align="start">
        <FolderActions {...props} />
      </Dropdown.DropdownMenuContent></Dropdown.DropdownMenu>
    </div>
  </Context.ContextMenuTrigger><Context.ContextMenuContent><FolderActions {...props} context /></Context.ContextMenuContent></Context.ContextMenu>;
}
