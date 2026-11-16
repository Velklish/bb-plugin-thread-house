import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  definePluginApp, experimental_Icon as Icon, experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsMenu as ThreadMenu, experimental_ThreadActionsContextMenu as ContextMenu,
  experimental_ThreadStatusGlyph as StatusGlyph, experimental_useProviders,
  experimental_useSidebarThreads, experimental_useSidebarThreadSplit,
  ThreadTitle, useBbNavigate,
  useSidebarThreadDraft, useSidebarThreadRowStatus, useSidebarThreadShortcut, useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps, PluginThreadActionTarget, PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { buildGroups, groupedRepository, repositoryLinks, type Period, type Repository, type ThreadNode } from "./model";
import { FolderRow, type RowDrag } from "./folder-row";
import { STORAGE_KEY, comparePins, effectiveFolderId, folderKey, folderScope, moveOrder, orderedTree, placeThread, siblingKey, threadFolderTarget } from "./preferences";
import { buildFolderTree, flattenFolders, moveFolder, removeFolder, type FolderNode, type DropPosition } from "./folders";
import { buildSmartViews, type ActivitySummary } from "./smart-views";
import { useLayoutPreferences } from "./use-layout-preferences";
import { useRepositoryData } from "./use-repository-data";
import "./styles.css";

const ROW_HEIGHT = 40;
const COMPACT_ROW_HEIGHT = 28;
const DRAG_TYPE = "application/x-thread-house";
const periods: { value: Period; label: string }[] = [
  { value: "1", label: "Last 24 hours" }, { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" }, { value: "all", label: "All" },
];
type ListRow =
  | { kind: "heading"; key: string; label: string; subtitle?: string; depth: number; count: number; smart?: "input" | "recent" }
  | { kind: "folder"; key: string; node: FolderNode; depth: number }
  | { kind: "thread"; key: string; node: ThreadNode; depth: number; groupRepositoryId: string | null; groupRepositoryLabel: string | null; folder: string; scope: string; parentId?: string | null; compact?: boolean; smart?: boolean; pinned?: boolean; summary?: ActivitySummary };

function ThreadRow({ node, depth, groupRepositoryId, groupRepositoryLabel, shortcutTarget, drag, restore, summary, expanded, branchCollapsed, toggle, active, onNavigate, repositories, onAssign, onPath, onMove, tabIndex, compact = false, enhanced = true }: {
  node: ThreadNode; depth: number; groupRepositoryId: string | null; expanded: boolean; branchCollapsed: boolean;
  shortcutTarget: boolean; tabIndex: number; onMove(node: ThreadNode): void;
  groupRepositoryLabel: string | null;
  drag: RowDrag; restore?: () => void;
  summary?: ActivitySummary;
  toggle(): void; active: boolean; onNavigate(): void; repositories: Repository[];
  onAssign(threadId: string, path: string | null): Promise<void>; onPath(node: ThreadNode): void;
  enhanced?: boolean;
  compact?: boolean;
}) {
  const t = node.thread;
  const navigate = useBbNavigate();
  const { providers } = experimental_useProviders();
  const { splitProps } = experimental_useSidebarThreadSplit(t.id);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(t.id);
  const rowStatus = useSidebarThreadRowStatus(t.id);
  const assignedShortcut = useSidebarThreadShortcut(t.id);
  const shortcut = shortcutTarget ? assignedShortcut : null;
  const target: PluginThreadActionTarget = { ...t, environment: t.environment?.id ? { id: t.environment.id, path: t.environment.path } : null };
  const inline: PluginThreadActionsInlineItem[] = enhanced ? [{
    key: "thread-house/repository", group: "thread-house", action: {
      label: "Repository", icon: "Folder", detail: node.repository?.label ?? "Unassigned",
      choices: { hint: "Children in the same environment inherit this assignment.", items: [
        { id: "__auto__", label: "Automatic (environment / parent)" },
        ...repositories.filter(r => r.hostId === t.host?.id).map(r => ({ id: r.id, label: r.label, selected: r.id === node.repository?.id })),
        { id: "__path__", label: "Choose path…", icon: "Folder" },
      ] },
      run: async ({ value }) => {
        if (value === "__path__") onPath(node);
        else if (value === "__auto__") await onAssign(t.id, null);
        else { const repo = repositories.find(r => r.id === value); if (repo) await onAssign(t.id, repo.path); }
      },
    },
  }] : [];
  if (enhanced) inline.push({ key: "thread-house/move", group: "thread-house", action: { label: "Move to…", icon: "Folder", run: () => onMove(node) } });
  if (restore) inline.push({ key: "thread-house/automatic-folder", group: "thread-house", action: { label: "Automatic folder", icon: "Folder", run: restore } });
  const provider = providers.find(p => p.id === t.providerId);
  const location = [summary?.needsInput ? `${summary.needsInput} need input` : null, summary?.running ? `${summary.running} running` : null,
    enhanced && ((node.repository?.id ?? null) !== groupRepositoryId || (node.repository?.label ?? null) !== groupRepositoryLabel) ? node.repository?.label ?? "Unassigned" : null, t.environment?.branchName].filter(Boolean).join(" · ");
  const indicator = hasUnsubmittedDraft && (t.indicator === "none" || t.indicator === "runtime")
    ? (t.indicator === "runtime" ? "working-draft" : "draft") : t.indicator;
  return <ContextMenu thread={target} inline={inline}>
    <div className={`wt-row ${active ? "wt-selected" : ""} ${node.contextOnly ? "wt-context" : ""} ${compact ? "wt-compact" : ""}`}
      role="treeitem" aria-level={depth + 1} aria-expanded={node.children.length ? expanded : undefined}
      data-wt-thread-id={t.id} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop}
      style={{ paddingLeft: 8 + depth * 12 }}>
      {node.children.length ? <button tabIndex={tabIndex} className="wt-icon-button" aria-label={`${branchCollapsed ? "Expand" : "Collapse"} ${t.displayTitle}`} onClick={toggle}>
        <Icon name={branchCollapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5" />
      </button> : <span className="wt-indent" />}
      <a {...splitProps} href={t.href} className="wt-thread-link" data-wt-primary tabIndex={tabIndex}
        data-sidebar-thread-shortcut-target={shortcutTarget ? "" : undefined} data-sidebar-thread-id={shortcutTarget ? t.id : undefined}
        aria-current={active ? "page" : undefined} aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        title={`${t.displayTitle}\n${t.environment?.path ?? "No environment"}${node.contextOnly ? "\nParent retained for a child in this view" : ""}`}
        onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate.toThread(t.id); onNavigate(); } }}>
        {!compact && provider ? <ProviderIcon providerKind="agent" provider={provider} className="size-4 shrink-0" /> : null}
        {t.environment?.isWorktree === true ? <span className="wt-worktree" role="img" aria-label="Git worktree" title="Git worktree"><Icon name="Fork" className="size-3 shrink-0" aria-hidden /></span> : null}
        <span className="wt-thread-text"><span className="wt-title"><ThreadTitle threadId={t.id} /></span>
          {!compact && location ? <span className="wt-location">{location}{node.contextOnly ? " · Parent" : ""}</span> : null}</span>
        {compact ? <Icon name="ArrowUpRight" className="size-3 shrink-0" aria-hidden /> : null}
        {!compact && t.isPinned ? <Icon name="Pin" className="size-3 shrink-0" /> : null}
        {!compact ? <StatusGlyph indicator={indicator} rowStatus={rowStatus} /> : null}
        {shortcut ? <kbd>{shortcut.label}</kbd> : null}
      </a>
      {enhanced && drag.onDragStart ? <button tabIndex={-1} className="wt-icon-button wt-menu wt-order-handle" aria-label={`Drag to organize ${t.displayTitle}`} title="Drag to organize" draggable
        onPointerDown={event => event.stopPropagation()} onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd}><span aria-hidden="true">⠿</span></button> : null}
      <ThreadMenu thread={target} inline={inline} trigger={props => <button {...props} tabIndex={tabIndex} className={[props.className, "wt-icon-button wt-menu"].filter(Boolean).join(" ")} aria-label={`Actions for ${t.displayTitle}`}><Icon name="MoreHorizontal" className="size-4" /></button>} />
    </div>
  </ContextMenu>;
}

export function ThreadHouseList(props: PluginThreadListProps) {
  const { values } = useSettings();
  const enabledProject = typeof values?.project === "string" ? values.project : null;
  return <ProjectThreadList key={enabledProject ?? "disabled"} {...props} enabledProject={enabledProject} />;
}
function ProjectThreadList(props: PluginThreadListProps & { enabledProject: string | null }) {
  const { enabledProject } = props;
  const { status, threads: allThreads, projects } = experimental_useSidebarThreads();
  const threads = allThreads.filter(thread => thread.projectId === enabledProject);
  const storageKey = `${STORAGE_KEY}:${enabledProject ?? "disabled"}`;
  const { preferences, setPreferences, undo, canUndo } = useLayoutPreferences(storageKey);
  const { period } = preferences;
  const collapsed = useMemo(() => new Set(preferences.collapsed), [preferences.collapsed]);
  const [now, setNow] = useState(Date.now);
  const [pathNode, setPathNode] = useState<ThreadNode | null>(null);
  const [path, setPath] = useState("");
  const [folderDialog, setFolderDialog] = useState<{ projectId: string; parentId: string | null; id?: string } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [moveDialog, setMoveDialog] = useState<{ kind: "thread"; node: ThreadNode } | { kind: "folder"; node: FolderNode } | null>(null);
  const [destination, setDestination] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<{ message: string; threadId: string; path: string | null } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dragged = useRef<(({ kind: "folder"; node: FolderNode } | { kind: "thread"; row: Extract<ListRow, { kind: "thread" }> }) & { token: string }) | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const visibleThreads = threads.filter(t => !t.isHidden || t.id === props.activeThreadId);
  const ids = [...new Set(visibleThreads.map(t => t.id))].sort();
  const envs = [...new Set(visibleThreads.flatMap(t => t.environment?.id ? [t.environment.id] : []))].sort();
  const paths = JSON.stringify([...new Map(threads.flatMap(t => t.environment?.id ? [[t.environment.id, t.environment.path] as const] : [])).entries()].sort(([a], [b]) => a.localeCompare(b)));
  const { rpc, state, error, loading, connected, refresh } = useRepositoryData(ids, envs, paths);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(v => ({ ...v, height: element.clientHeight || 600 })));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const toggle = (key: string) => setPreferences(old => {
    const next = new Set(old.collapsed); if (next.has(key)) next.delete(key); else next.add(key);
    return { ...old, collapsed: [...next] };
  });
  const repositories = [...new Map([
    ...Object.values(preferences.groupWith),
    ...Object.values(preferences.folderRepositories),
    ...(state?.environments.flatMap(e => e.repository ? [e.repository] : []) ?? []),
    ...(state?.assignments.map(a => a.repository) ?? []),
  ].map(r => [r.id, r])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const links = repositoryLinks(repositories, new Map(Object.entries(preferences.groupWith)));
  const placements = new Map<string, { folderId: string; repository: Repository | null }>();
  const threadsById = new Map(threads.map(thread => [thread.id, thread]));
  for (const thread of threads) {
    const target = threadFolderTarget(thread, threadsById, preferences);
    if (!target) continue;
    if (preferences.customFolders[target]?.projectId === thread.projectId) {
      placements.set(thread.id, { folderId: target, repository: null });
      continue;
    }
    const repository = repositories.find(r => JSON.stringify([thread.projectId, r.id]) === target);
    if (repository && repository.hostId === thread.host?.id) {
      const grouped = groupedRepository(repository, links)!;
      placements.set(thread.id, { folderId: JSON.stringify([thread.projectId, grouped.id]), repository: grouped });
    } else if (target === JSON.stringify([thread.projectId, null])) placements.set(thread.id, { folderId: target, repository: null });
  }
  const environments = new Map(state?.environments.map(e => [e.environmentId, e.repository]) ?? []);
  const assignments = new Map(state?.assignments.map(a => [a.threadId, a.repository]) ?? []);
  const groups = buildGroups(threads, environments, assignments, period, now, links, placements, props.activeThreadId);
  const allGroups = buildGroups(threads, environments, assignments, "all", now, links, placements, props.activeThreadId);
  const available = [...buildGroups(threads, environments, assignments, "all", now, links, undefined, props.activeThreadId), ...allGroups];
  const groupCatalog = [...new Map(repositories.map(r => { const grouped = groupedRepository(r, links)!; return [grouped.id, grouped]; })).values()];
  const rows: ListRow[] = [];
  const pinned = allThreads.filter(thread => thread.isPinned && !thread.isHidden && !thread.isArchived)
    .sort((a, b) => comparePins(a, b) || a.id.localeCompare(b.id));
  if (pinned.length) {
    rows.push({ kind: "heading", key: "pinned", label: "Pinned", depth: 0, count: pinned.length });
    if (!collapsed.has("pinned")) {
      const nodes = new Map<string, ThreadNode>();
      function collect(node: ThreadNode) { nodes.set(node.thread.id, node); node.children.forEach(collect); }
      available.forEach(group => group.roots.forEach(collect));
      for (const thread of pinned) {
        const node = nodes.get(thread.id);
        rows.push({ kind: "thread", key: `pinned:${thread.id}`, node: { thread, repository: node?.repository ?? null, children: [], contextOnly: false, updatedAt: thread.updatedAt },
          depth: 1, groupRepositoryId: null, groupRepositoryLabel: null, folder: "pinned", scope: "pinned", pinned: true });
      }
    }
  }
  const projectIds = [...new Set([...groups.map(g => g.projectId), ...Object.values(preferences.customFolders).filter(f => f.projectId === enabledProject).map(f => f.projectId)])];
  const trees = new Map(projectIds.map(id => [id, buildFolderTree(groups, available, preferences, id, links)]));
  const retainedThreads = new Map<string, Set<string>>();
  const retainedFolders = new Set<string>();
  const openedThreads = new Map<string, Set<string>>();
  const openedFolders = new Set<string>();
  function retainThread(node: ThreadNode, included: Set<string>, opened: Set<string>): boolean {
    const t = node.thread;
    let keepOpened = !node.contextOnly && t.id === props.activeThreadId;
    let retain = !node.contextOnly && (["starting", "active", "stopping"].includes(t.status) || t.isUnread || t.indicator !== "none" || keepOpened);
    for (const child of node.children) {
      if (retainThread(child, included, opened)) retain = true;
      if (opened.has(child.thread.id)) keepOpened = true;
    }
    if (retain) included.add(t.id);
    if (keepOpened) opened.add(t.id);
    return retain;
  }
  function retainFolder(node: FolderNode): boolean {
    let retain = false;
    for (const child of node.children) if (retainFolder(child)) retain = true;
    const included = new Set<string>();
    const opened = new Set<string>();
    for (const root of node.group?.roots ?? []) if (retainThread(root, included, opened)) retain = true;
    retainedThreads.set(node.id, included);
    openedThreads.set(node.id, opened);
    if (retain) retainedFolders.add(node.id);
    if (opened.size || node.children.some(child => openedFolders.has(child.id))) openedFolders.add(node.id);
    return retain;
  }
  for (const tree of trees.values()) for (const node of tree) retainFolder(node);
  const smart = buildSmartViews(threads, environments, assignments, period, now);
  function appendSmart(nodes: ThreadNode[], view: "input" | "recent", depth: number) {
    for (const node of nodes) {
      const key = `smart:${view}:${node.thread.id}`;
      rows.push({ kind: "thread", key, node, depth, groupRepositoryId: null, groupRepositoryLabel: null, folder: `smart:${view}`,
        scope: `smart:${view}`, smart: true, summary: smart.summaries.get(node.thread.id) });
      if (!collapsed.has(key)) appendSmart(node.children, view, depth + 1);
    }
  }
  for (const view of enabledProject ? ["input", "recent"] as const : []) {
    rows.push({ kind: "heading", key: `smart:${view}`, label: view === "input" ? "Needs input" : "Recent", depth: 0,
      count: view === "input" ? smart.inputCount : smart.recent.length, smart: view });
    if (preferences.smartExpanded.includes(view)) appendSmart(smart[view], view, 1);
  }
  for (const projectId of projectIds) {
    const key = `project:${projectId}`;
    rows.push({ kind: "heading", key, label: projects.find(p => p.id === projectId)?.name ?? projectId, depth: 0,
      count: groups.filter(g => g.projectId === projectId).reduce((n, g) => n + g.count, 0) });
    function appendThreads(nodes: ThreadNode[], folder: FolderNode, headingKey: string, parentId: string | null, depth: number, retainedOnly = false, openedOnly = false) {
      for (const node of nodes) {
        if (openedOnly && !openedThreads.get(folder.id)?.has(node.thread.id)) continue;
        if (retainedOnly && !retainedThreads.get(folder.id)?.has(node.thread.id)) continue;
        const key = `thread:${headingKey}:${node.thread.id}`;
        const ownFolder = placements.get(node.thread.id)?.folderId ?? JSON.stringify([node.thread.projectId, groupedRepository(node.repository, links)?.id ?? null]);
        rows.push({ kind: "thread", key, node, depth, groupRepositoryId: folder.repository?.id ?? null, groupRepositoryLabel: folder.repository?.label ?? null,
          folder: folder.id, scope: siblingKey(folder.id, parentId), parentId, compact: node.contextOnly && ownFolder !== folder.id });
        appendThreads(node.children, folder, headingKey, node.thread.id, depth + 1, retainedOnly, openedOnly || collapsed.has(key));
      }
    }
    function appendFolder(node: FolderNode, depth: number, retainedOnly = false, openedOnly = false) {
      if (openedOnly && !openedFolders.has(node.id)) return;
      if (retainedOnly && !retainedFolders.has(node.id)) return;
      const key = node.custom ? `folder:${node.id}` : `repository:${projectId}:${node.repository?.id ?? "unassigned"}`;
      rows.push({ kind: "folder", key, node, depth });
      const retainOnly = retainedOnly || collapsed.has(key);
      for (const child of node.children) appendFolder(child, depth + 1, retainOnly, openedOnly);
      if (node.group) appendThreads(orderedTree(node.group.roots, node.id, preferences), node, key, null, depth + 1, retainOnly, openedOnly);
    }
    for (const node of trees.get(projectId)!) appendFolder(node, 1, false, collapsed.has(key));
  }
  for (const project of projects.filter(project => project.id !== enabledProject)) {
    const plain = allThreads.filter(thread => thread.projectId === project.id && (!thread.isHidden || thread.id === props.activeThreadId)).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!plain.length) continue;
    const key = `project:${project.id}`;
    rows.push({ kind: "heading", key, label: project.name, depth: 0, count: plain.length });
    for (const thread of plain) {
      if (collapsed.has(key) && thread.id !== props.activeThreadId) continue;
      rows.push({ kind: "thread", key: `plain:${thread.id}`, node: { thread, repository: null, children: [], contextOnly: false, updatedAt: thread.updatedAt }, depth: 1, groupRepositoryId: null, groupRepositoryLabel: null, folder: "", scope: "" });
    }
  }
  let totalHeight = 0;
  const positionedRows = rows.map((row, index) => {
    const height = row.kind === "thread" && row.compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    const top = totalHeight; totalHeight += height;
    const showsChildren = (rows[index + 1]?.depth ?? -1) > row.depth;
    return { row, top, height, showsChildren };
  });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const focusInTree = useRef(false);
  const focusIndex = useRef(0);
  const focusKey = rows.some(row => row.key === focusedKey) ? focusedKey
    : rows[Math.min(focusIndex.current, rows.length - 1)]?.key;
  function rowExpanded(row: ListRow) {
    return row.kind === "heading" && row.smart ? preferences.smartExpanded.includes(row.smart) : !collapsed.has(row.key);
  }
  function toggleRow(row: ListRow) {
    if (row.kind === "heading" && row.smart) {
      const view = row.smart;
      setPreferences(old => ({ ...old, smartExpanded: old.smartExpanded.includes(view) ? old.smartExpanded.filter(v => v !== view) : [...old.smartExpanded, view] }));
    } else toggle(row.key);
  }
  function focusRow(index: number) {
    const position = positionedRows[index];
    if (!position) return;
    pendingFocus.current = position.row.key; focusIndex.current = index; setFocusedKey(position.row.key);
    const element = scroll.current;
    if (!element) return;
    const top = position.top < viewport.top ? position.top
      : position.top + position.height > viewport.top + viewport.height ? position.top + position.height - viewport.height : viewport.top;
    element.scrollTop = top; setViewport(old => ({ ...old, top }));
  }
  useLayoutEffect(() => {
    const key = pendingFocus.current ?? (focusInTree.current && focusedKey !== focusKey ? focusKey : null);
    if (!key) return;
    const active = document.activeElement;
    if (active && active !== document.body && !scroll.current?.contains(active)) { pendingFocus.current = null; focusInTree.current = false; return; }
    const element = rowElements.current.get(key)?.querySelector<HTMLElement>("[data-wt-primary]");
    if (element) { pendingFocus.current = null; element.focus({ preventScroll: true }); }
  });
  function treeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-wt-primary") || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.target.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
    const index = rows.findIndex(row => row.key === key); const row = rows[index];
    if (!row) return;
    const expandable = row.kind !== "thread" || row.node.children.length > 0;
    switch (event.key) {
      case "ArrowDown": focusRow(Math.min(rows.length - 1, index + 1)); break;
      case "ArrowUp": focusRow(Math.max(0, index - 1)); break;
      case "Home": focusRow(0); break;
      case "End": focusRow(rows.length - 1); break;
      case "ArrowRight":
        if (expandable && !rowExpanded(row)) toggleRow(row);
        else if (rows[index + 1]?.depth > row.depth) focusRow(index + 1);
        break;
      case "ArrowLeft":
        if (expandable && rowExpanded(row)) toggleRow(row);
        else { for (let parent = index - 1; parent >= 0; parent--) if (rows[parent].depth < row.depth) { focusRow(parent); break; } }
        break;
      case " ": if (event.target.tagName === "A") event.target.click(); else return; break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation();
  }
  const visibleRows = positionedRows.filter(({ row, top, height }) => top + height > viewport.top - 6 * ROW_HEIGHT && top < viewport.top + viewport.height + 6 * ROW_HEIGHT || focusInTree.current && row.key === focusKey);
  const fullTargets = new Set(visibleRows.flatMap(({ row }) => row.kind === "thread" && !row.compact ? [row.node.thread.id] : []));
  const shortcutTargets = new Set<string>();
  const renderedRows = visibleRows.map(positioned => {
    const { row } = positioned;
    const shortcutTarget = row.kind === "thread" && !shortcutTargets.has(row.node.thread.id) && (!row.compact || !fullTargets.has(row.node.thread.id));
    if (shortcutTarget) shortcutTargets.add(row.node.thread.id);
    return { ...positioned, shortcutTarget };
  });
  function finishDrag() {
    dragged.current = null;
    scroll.current?.querySelectorAll("[data-drop]").forEach(element => element.removeAttribute("data-drop"));
  }
  useEffect(() => {
    window.addEventListener("dragstart", finishDrag, true);
    window.addEventListener("dragend", finishDrag);
    window.addEventListener("drop", finishDrag);
    return () => {
      window.removeEventListener("dragstart", finishDrag, true);
      window.removeEventListener("dragend", finishDrag);
      window.removeEventListener("drop", finishDrag);
    };
  }, []);
  function locateThread(id: string, folder?: string, repository?: Repository | null) {
    setPreferences(old => placeThread(old, threadsById, id, folder, repository));
  }
  // Every sibling in the folder's order, including those hidden by Updated, so only threads that appear later count as new.
  function siblingIds(folder: string, parentId: string | null) {
    let nodes = orderedTree(allGroups.find(group => folderKey(group) === folder)?.roots ?? [], folder, preferences);
    if (parentId) {
      const pending = [...nodes]; nodes = [];
      for (const node of pending) { if (node.thread.id === parentId) { nodes = node.children; break; } pending.push(...node.children); }
    }
    return nodes.map(node => node.thread.id);
  }
  function threadDrag(row: Extract<ListRow, { kind: "thread" }>): RowDrag {
    return {
      onDragStart: event => { event.stopPropagation(); const token = crypto.randomUUID(); dragged.current = { kind: "thread", row, token }; event.dataTransfer.setData(DRAG_TYPE, token); event.dataTransfer.effectAllowed = "move"; },
      onDragEnd: finishDrag,
      onDragLeave: event => { delete event.currentTarget.dataset.drop; },
      onDragOver: event => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE) || row.smart || dragged.current?.kind !== "thread" || dragged.current.row.scope !== row.scope) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dataset.drop = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
      },
      onDrop: event => {
        if (!dragged.current || event.dataTransfer.getData(DRAG_TYPE) !== dragged.current.token) { finishDrag(); return; }
        if (!event.dataTransfer.types.includes(DRAG_TYPE) || row.smart || dragged.current?.kind !== "thread" || dragged.current.row.scope !== row.scope) return;
        event.preventDefault(); event.stopPropagation();
        const source = dragged.current.row.node.thread.id;
        const rect = event.currentTarget.getBoundingClientRect(); const after = event.clientY > rect.top + rect.height / 2;
        const peers = siblingIds(row.folder, row.parentId ?? null);
        setPreferences(old => ({ ...old, folderSort: { ...old.folderSort, [row.folder]: "manual" },
          threadOrder: { ...old.threadOrder, [row.scope]: moveOrder(old.threadOrder[row.scope] ?? [], peers, source, row.node.thread.id, after) } }));
        finishDrag();
      },
    };
  }
  function folderDrag(node: FolderNode): RowDrag {
    function position(clientY: number, element: HTMLElement): DropPosition {
      const rect = element.getBoundingClientRect(); const offset = (clientY - rect.top) / Math.max(1, rect.height);
      return offset < 0.25 ? "before" : offset > 0.75 ? "after" : "inside";
    }
    function threadAllowed() {
      const item = dragged.current;
      return item?.kind === "thread" && item.row.node.thread.projectId === node.projectId
        && (!node.repository || node.repository.hostId === item.row.node.thread.host?.id);
    }
    return {
      onDragStart: event => { event.stopPropagation(); const token = crypto.randomUUID(); dragged.current = { kind: "folder", node, token }; event.dataTransfer.setData(DRAG_TYPE, token); event.dataTransfer.effectAllowed = "move"; },
      onDragEnd: finishDrag,
      onDragLeave: event => { delete event.currentTarget.dataset.drop; },
      onDragOver: event => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE) || !dragged.current) return;
        event.preventDefault(); event.stopPropagation();
        const where = position(event.clientY, event.currentTarget);
        const allowed = dragged.current.kind === "folder"
          ? !!moveFolder(preferences, trees.get(node.projectId)!, dragged.current.node.id, node.id, where) : threadAllowed();
        event.dataTransfer.dropEffect = allowed ? "move" : "none";
        if (allowed) event.currentTarget.dataset.drop = dragged.current.kind === "thread" ? "inside" : where;
        else delete event.currentTarget.dataset.drop;
      },
      onDrop: event => {
        if (!dragged.current || event.dataTransfer.getData(DRAG_TYPE) !== dragged.current.token) { finishDrag(); return; }
        const item = dragged.current; if (!event.dataTransfer.types.includes(DRAG_TYPE) || !item) return;
        event.preventDefault(); event.stopPropagation();
        if (item.kind === "folder") {
          const where = position(event.clientY, event.currentTarget);
          // The unfiltered tree also saves folders hidden by Updated, so only folders that appear later count as new.
          const tree = buildFolderTree(allGroups, available, preferences, node.projectId, links);
          setPreferences(old => moveFolder(old, tree, item.node.id, node.id, where) ?? old);
        } else if (threadAllowed()) locateThread(item.row.node.thread.id, node.id, node.repository);
        finishDrag();
      },
    };
  }
  function openFolderDialog(projectId: string, parentId: string | null, id?: string) {
    setFolderName(id ? preferences.customFolders[id].label : ""); setFolderDialog({ projectId, parentId, id });
  }
  function treeForMove(dialog: NonNullable<typeof moveDialog>) {
    const projectId = dialog.kind === "thread" ? dialog.node.thread.projectId : dialog.node.projectId;
    return buildFolderTree(allGroups, available, preferences, projectId, links);
  }
  const moveTree = moveDialog ? treeForMove(moveDialog) : [];
  const moveFolders = flattenFolders(moveTree);
  const moveCandidates = moveFolders.filter(folder => moveDialog?.kind === "thread"
    ? !folder.repository || folder.repository.hostId === moveDialog.node.thread.host?.id
    : moveDialog && moveFolder(preferences, moveTree, moveDialog.node.id, folder.id, "inside") !== null);
  function folderLabel(folder: FolderNode) {
    const names = [folder.label];
    for (let parent = folder.parentId; parent;) {
      const node = moveFolders.find(candidate => candidate.id === parent);
      if (!node) break;
      names.unshift(node.label); parent = node.parentId;
    }
    return names.join(" / ");
  }
  function currentMoveDestination(dialog: NonNullable<typeof moveDialog>) {
    const saved = dialog.kind === "thread" ? preferences.threadFolders[dialog.node.thread.id] : dialog.node.parentId;
    return saved ? effectiveFolderId(saved, preferences, links) : "";
  }
  function openMove(dialog: NonNullable<typeof moveDialog>) {
    const current = currentMoveDestination(dialog);
    const exists = flattenFolders(treeForMove(dialog)).some(folder => folder.id === current
      && (dialog.kind === "folder" || !folder.repository || folder.repository.hostId === dialog.node.thread.host?.id));
    setDestination(exists ? current : "");
    setMoveDialog(dialog);
  }
  function renderFolder(row: Extract<ListRow, { kind: "folder" }>, expanded: boolean) {
    const node = row.node;
    return <FolderRow id={node.id} label={node.label} path={node.repository?.path} count={node.count} depth={row.depth} custom={node.custom} nested={node.parentId !== null}
      expanded={expanded} collapsed={collapsed.has(row.key)} tabIndex={row.key === focusKey ? 0 : -1} move={() => openMove({ kind: "folder", node })} toggle={() => toggle(row.key)} pinned={preferences.folderPins.includes(node.id)} drag={folderDrag(node)}
      togglePin={() => setPreferences(old => ({ ...old, folderPins: old.folderPins.includes(node.id) ? old.folderPins.filter(key => key !== node.id) : [...old.folderPins, node.id] }))}
      sort={preferences.folderSort[node.id] ?? "updated"} setSort={mode => setPreferences(old => ({ ...old, folderSort: { ...old.folderSort, [node.id]: mode } }))}
      resetOrder={() => setPreferences(old => ({ ...old, folderOrder: { ...old.folderOrder, [folderScope(node.projectId, node.parentId)]: [] } }))}
      candidates={node.repository ? groupCatalog.filter(repository => repository.hostId === node.repository!.hostId && repository.id !== node.repository!.id) : []}
      grouped={!!node.repository && [...links].some(([id, target]) => id !== node.repository!.id && groupedRepository(target, links)?.id === node.repository!.id)}
      groupWith={target => setPreferences(old => ({ ...old, groupWith: { ...old.groupWith, [node.repository!.id]: groupedRepository(target, links)! } }))}
      separate={() => setPreferences(old => {
        const groupWith = Object.fromEntries(Object.entries(old.groupWith).filter(([, target]) => groupedRepository(target, links)?.id !== node.repository?.id));
        for (const repository of repositories) if (repository.origin && groupedRepository(repository, links)?.id === node.repository?.id) groupWith[repository.id] = repository;
        return { ...old, groupWith };
      })}
      create={() => openFolderDialog(node.projectId, node.id)} rename={() => openFolderDialog(node.projectId, node.parentId, node.id)}
      remove={() => setPreferences(old => removeFolder(old, node.id))}
      toRoot={() => setPreferences(old => ({ ...old, folderParents: Object.fromEntries(Object.entries(old.folderParents).filter(([id]) => id !== node.id)) }))}
      hasThreadLocations={Object.values(preferences.threadFolders).some(folder => effectiveFolderId(folder, preferences, links) === node.id)}
      restoreThreadLocations={() => setPreferences(old => ({ ...old, threadFolders: Object.fromEntries(Object.entries(old.threadFolders).filter(([, folder]) => effectiveFolderId(folder, old, links) !== node.id)) }))}
    />;
  }
  const failures = state?.environments.filter(e => e.error) ?? [];
  const assign = async (threadId: string, path: string | null) => {
    try { await rpc.call("assign", { threadId, path }); setAssignmentError(null); }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setAssignmentError({ message, threadId, path }); throw cause; }
  };
  const selectedCount = groups.reduce((count, group) => count + group.count, 0);
  const noMatches = enabledProject && status === "ready" && state && !selectedCount;
  const projectLabel = projects.find(project => project.id === enabledProject)?.name ?? "this Project";
  return <div className="wt-sidebar">
    {enabledProject ? <div className="wt-toolbar"><label className="wt-filter-label" title={`Filter threads in ${projectLabel}; Pinned stays visible`}>Updated
      <select aria-label="Activity period" value={period} onChange={event => { const period = event.target.value as Period; setPreferences(old => ({ ...old, period })); if (scroll.current) scroll.current.scrollTop = 0; setViewport(v => ({ ...v, top: 0 })); }}>
        {periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select></label>
      <button className="wt-icon-button" aria-label="New folder" title="New folder"
        onClick={() => openFolderDialog(enabledProject, null)}><Icon name="Folder" className="size-4" /></button>
      <button className="wt-icon-button" onClick={() => refresh(true)} disabled={loading || !connected} aria-label="Refresh repositories" title="Refresh repositories"><span className={loading ? "wt-refreshing" : undefined} aria-hidden>↻</span></button>
    </div> : null}
    {canUndo ? <div className="wt-layout-notice" role="status">Layout changed<button onClick={undo} aria-label="Undo layout change">Undo</button></div> : null}
    {loading ? <div className="wt-load-status" role="status">Refreshing repositories…</div> : null}
    {!connected ? <div className="wt-load-status" role="status">Reconnecting… Repository updates will resume automatically.</div> : null}
    {error || failures.length ? <div className="wt-error" role="alert">{error ?? `${failures.length} environment(s) could not be resolved: ${failures[0]?.error}`}<button disabled={loading || !connected} onClick={() => refresh(true)}>Retry</button></div> : null}
    {assignmentError && !pathNode ? <div className="wt-error" role="alert">{assignmentError.message}
      {assignmentError.path !== null ? <button onClick={() => {
        const node = available.flatMap(group => group.roots).find(node => node.thread.id === assignmentError.threadId);
        const thread = threadsById.get(assignmentError.threadId);
        if (thread) { setPathNode(node ?? { thread, repository: null, children: [], contextOnly: false, updatedAt: thread.updatedAt }); setPath(assignmentError.path ?? ""); }
      }}>Edit path…</button> : null}
      <button onClick={() => setAssignmentError(null)}>Dismiss</button>
    </div> : null}
    {noMatches ? <div className="wt-empty" role="status">{period === "all" ? `No threads in ${projectLabel} yet.` : "No threads updated in this period."}
      {period !== "all" ? <button onClick={() => { setPreferences(old => ({ ...old, period: "all" })); if (scroll.current) scroll.current.scrollTop = 0; setViewport(old => ({ ...old, top: 0 })); }}>Show all</button> : null}
    </div> : null}
    <div ref={scroll} className="wt-scroll" onScroll={event => { const top = event.currentTarget.scrollTop; setViewport(v => ({ ...v, top })); }}>
      {status === "loading" ? <p className="wt-empty" role="status">Loading threads…</p>
        : status === "error" ? <p className="wt-empty" role="alert">Could not load threads.</p>
        : !rows.length ? <p className="wt-empty" role="status">No threads updated in this period.</p>
        : <div role="tree" aria-label="Threads by repository" onKeyDown={treeKeyDown}
          onFocus={event => { const key = (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey; if (key) { focusInTree.current = true; focusIndex.current = rows.findIndex(row => row.key === key); setFocusedKey(key); } }}
          onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focusInTree.current = false; }} style={{ height: totalHeight, position: "relative" }}>
          {renderedRows.map(({ row, top, height, shortcutTarget, showsChildren }) => {
            const revealed = row.kind === "heading" && row.smart ? preferences.smartExpanded.includes(row.smart) : !collapsed.has(row.key) || showsChildren;
            return <div key={row.key} data-row-key={row.key} ref={element => { if (element) rowElements.current.set(row.key, element); else rowElements.current.delete(row.key); }} className="wt-positioned" data-wt-pinned={row.kind === "thread" && row.pinned ? "" : undefined} data-wt-smart-view={row.kind === "thread" && row.smart ? row.folder.slice(6) : undefined} style={{ top, height }}>
            {row.kind === "heading" ? <button data-wt-primary tabIndex={row.key === focusKey ? 0 : -1} aria-label={`${rowExpanded(row) ? "Collapse" : "Expand"} ${row.label}`} className={`wt-heading wt-depth-${row.depth}`} style={{ paddingLeft: 8 + row.depth * 12 }} role="treeitem" aria-level={row.depth + 1}
              aria-expanded={revealed} title={!rowExpanded(row) && showsChildren ? "Expand all threads. Active or opened threads remain visible while collapsed." : row.subtitle}
              onClick={() => toggleRow(row)}>
              <Icon name={rowExpanded(row) ? "ChevronDown" : "ChevronRight"} className="size-3.5 shrink-0" />
              {row.depth === 1 ? <Icon name="Folder" className="size-4 shrink-0" /> : null}
              <span className="wt-heading-label">{row.label}</span><span className="wt-count">{row.count}</span>
            </button> : row.kind === "folder" ? renderFolder(row, revealed)
              : <ThreadRow tabIndex={row.key === focusKey ? 0 : -1} onMove={node => openMove({ kind: "thread", node })} node={row.node} depth={row.depth} groupRepositoryId={row.groupRepositoryId} groupRepositoryLabel={row.groupRepositoryLabel} shortcutTarget={shortcutTarget}
                enhanced={row.node.thread.projectId === enabledProject} drag={row.node.thread.projectId === enabledProject && !row.pinned ? threadDrag(row) : {}} restore={row.node.thread.projectId === enabledProject && preferences.threadFolders[row.node.thread.id] ? () => locateThread(row.node.thread.id) : undefined} summary={row.summary}
                compact={row.compact} expanded={revealed} branchCollapsed={collapsed.has(row.key)} toggle={() => toggle(row.key)} active={!row.compact && props.activeThreadId === row.node.thread.id}
                onNavigate={props.onNavigate} repositories={repositories} onAssign={assign}
                onPath={node => { setPathNode(node); setPath(node.repository?.path ?? node.thread.environment?.path ?? ""); setAssignmentError(null); }} />}
            </div>;
          })}
        </div>}
    </div>
    <Dialog open={moveDialog !== null} onOpenChange={open => { if (!open) setMoveDialog(null); }}>
      <DialogContent><DialogTitle>Move {moveDialog?.kind === "thread" ? moveDialog.node.thread.displayTitle : moveDialog?.node.label}</DialogTitle>
        <DialogDescription>{moveDialog?.kind === "thread" ? "Children follow their parent unless placed separately." : "Move this folder and its contents."}</DialogDescription>
        <form className="wt-assign-form" onSubmit={event => {
          event.preventDefault(); if (!moveDialog || destination && !moveCandidates.some(folder => folder.id === destination)) return;
          const current = currentMoveDestination(moveDialog);
          if (destination === current) { setMoveDialog(null); return; }
          if (moveDialog.kind === "thread") locateThread(moveDialog.node.thread.id, destination || undefined, moveCandidates.find(folder => folder.id === destination)?.repository);
          else if (destination) setPreferences(old => moveFolder(old, moveTree, moveDialog.node.id, destination, "inside") ?? old);
          else setPreferences(old => ({ ...old, folderParents: Object.fromEntries(Object.entries(old.folderParents).filter(([id]) => id !== moveDialog.node.id)) }));
          setMoveDialog(null);
        }}>
          <label>Destination folder<select autoFocus aria-label="Destination folder" value={destination} onChange={event => setDestination(event.target.value)}>
            <option value="">{moveDialog?.kind === "thread" ? "Automatic folder" : "Project root"}</option>
            {moveCandidates.map(folder => <option key={folder.id} value={folder.id}>{folderLabel(folder)}</option>)}
          </select></label>
          <div className="wt-dialog-buttons"><Button type="button" variant="ghost" onClick={() => setMoveDialog(null)}>Cancel</Button><Button type="submit" disabled={!!destination && !moveCandidates.some(folder => folder.id === destination)}>Move</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={folderDialog !== null} onOpenChange={open => { if (!open) setFolderDialog(null); }}>
      <DialogContent><DialogTitle>{folderDialog?.id ? "Rename folder" : "New folder"}</DialogTitle>
        <DialogDescription>Organize this sidebar with a virtual folder.</DialogDescription>
        <form className="wt-assign-form" onSubmit={event => {
          event.preventDefault(); if (!folderDialog || !folderName.trim()) return;
          const { projectId, parentId, id } = folderDialog; const key = id ?? `custom:${crypto.randomUUID()}`;
          setPreferences(old => ({ ...old, customFolders: { ...old.customFolders, [key]: { projectId, label: folderName.trim() } },
            folderParents: parentId ? { ...old.folderParents, [key]: parentId } : old.folderParents }));
          setFolderDialog(null);
        }}>
          <Input autoFocus aria-label="Folder name" value={folderName} onChange={event => setFolderName(event.target.value)} />
          <div className="wt-dialog-buttons"><Button type="button" variant="ghost" onClick={() => setFolderDialog(null)}>Cancel</Button>
            <Button type="submit" disabled={!folderName.trim()}>{folderDialog?.id ? "Rename" : "Create"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
    <Dialog open={pathNode !== null} onOpenChange={open => { if (!open && !saving) setPathNode(null); }}>
      <DialogContent><DialogTitle>Assign repository</DialogTitle><DialogDescription>Enter an absolute Git repository or worktree path on {pathNode?.thread.host?.name ?? "the thread's machine"}.</DialogDescription>
        <form className="wt-assign-form" onSubmit={async event => {
          event.preventDefault(); if (!pathNode || saving) return;
          setSaving(true);
          try { await assign(pathNode.thread.id, path.trim()); setPathNode(null); } catch { /* The server error stays visible. */ } finally { setSaving(false); }
        }}>
          <Input autoFocus aria-label="Repository path" value={path} onChange={event => setPath(event.target.value)} />
          {assignmentError ? <p role="alert" className="text-sm text-destructive">{assignmentError.message}</p> : null}
          <div className="wt-dialog-buttons"><Button type="button" variant="ghost" disabled={saving} onClick={() => setPathNode(null)}>Cancel</Button><Button type="submit" disabled={saving || !path.trim()}>{saving ? "Assigning…" : "Assign"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadList({ id: "repositories", title: "Thread House", description: "Repositories, nested agents, and a last-update filter.", component: ThreadHouseList });
});
