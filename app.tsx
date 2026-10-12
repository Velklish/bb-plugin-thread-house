import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp, experimental_Icon as Icon, experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsMenu as ThreadMenu, experimental_ThreadActionsContextMenu as ContextMenu,
  experimental_ThreadStatusGlyph as StatusGlyph, experimental_useProviders,
  experimental_useSidebarThreads, experimental_useSidebarThreadSplit,
  ThreadTitle, useBbNavigate, useRealtime, useRealtimeConnectionState, useRpc,
  useSidebarThreadDraft, useSidebarThreadRowStatus, useSidebarThreadShortcut, useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps, PluginThreadActionTarget, PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk/app";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import type { rpcContract, RepositoryState } from "./contracts";
import { buildGroups, groupedRepository, repositoryLinks, type Period, type Repository, type ThreadNode } from "./model";
import { FolderRow, type RowDrag } from "./folder-row";
import { STORAGE_KEY, effectiveFolderId, folderScope, moveOrder, orderedTree, readPreferences, siblingKey } from "./preferences";
import { buildFolderTree, moveFolder, removeFolder, type FolderNode, type DropPosition } from "./folders";
import { buildSmartViews, type ActivitySummary } from "./smart-views";
import "./styles.css";

const ROW_HEIGHT = 40;
const DRAG_TYPE = "application/x-thread-house";
const periods: { value: Period; label: string }[] = [
  { value: "1", label: "Last 24 hours" }, { value: "3", label: "Last 3 days" },
  { value: "7", label: "Last 7 days" }, { value: "all", label: "All" },
];
function useRepositoryData(threadIds: string[], environmentIds: string[], environmentPaths: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<RepositoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState({ revision: 0, force: false });
  const idsKey = JSON.stringify([threadIds, environmentIds]);
  const refresh = useCallback((force = false) => setReload(v => ({ revision: v.revision + 1, force })), []);
  const metadataChanged = useCallback(() => refresh(), [refresh]);
  useRealtime("changed", metadataChanged);
  useEffect(() => {
    const [ids, envs] = JSON.parse(idsKey) as [string[], string[]];
    if (!ids.length && !envs.length) { setState({ environments: [], assignments: [] }); setError(null); return; }
    if (connection !== "connected") return;
    let cancelled = false;
    const count = Math.max(1, Math.ceil(Math.max(ids.length, envs.length) / 200));
    Promise.all(Array.from({ length: count }, (_, i) => rpc.call("state", {
      threadIds: ids.slice(i * 200, (i + 1) * 200),
      environmentIds: envs.slice(i * 200, (i + 1) * 200), refresh: reload.force,
    }))).then(parts => {
      if (cancelled) return;
      setState({ environments: parts.flatMap(p => p.environments), assignments: parts.flatMap(p => p.assignments) });
      setError(null);
    }, cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [rpc, idsKey, environmentPaths, reload, connection]);
  return { rpc, state, error, refresh };
}
type ListRow =
  | { kind: "heading"; key: string; label: string; subtitle?: string; depth: number; count: number; smart?: "input" | "recent" }
  | { kind: "folder"; key: string; node: FolderNode; depth: number }
  | { kind: "thread"; key: string; node: ThreadNode; depth: number; groupRepositoryId: string | null; groupRepositoryLabel: string | null; folder: string; scope: string; peers: string[]; smart?: boolean; summary?: ActivitySummary };

function ThreadRow({ node, depth, groupRepositoryId, groupRepositoryLabel, shortcutTarget, drag, restore, summary, expanded, toggle, active, onNavigate, repositories, onAssign, onPath, enhanced = true }: {
  node: ThreadNode; depth: number; groupRepositoryId: string | null; expanded: boolean;
  shortcutTarget: boolean;
  groupRepositoryLabel: string | null;
  drag: RowDrag; restore?: () => void;
  summary?: ActivitySummary;
  toggle(): void; active: boolean; onNavigate(): void; repositories: Repository[];
  onAssign(threadId: string, path: string | null): Promise<void>; onPath(node: ThreadNode): void;
  enhanced?: boolean;
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
  if (restore) inline.push({ key: "thread-house/automatic-folder", group: "thread-house", action: { label: "Automatic folder", icon: "Folder", run: restore } });
  const provider = providers.find(p => p.id === t.providerId);
  const location = [summary?.needsInput ? `${summary.needsInput} need input` : null, summary?.running ? `${summary.running} running` : null,
    enhanced && ((node.repository?.id ?? null) !== groupRepositoryId || (node.repository?.label ?? null) !== groupRepositoryLabel) ? node.repository?.label ?? "Unassigned" : null, t.environment?.branchName, t.host?.name].filter(Boolean).join(" · ");
  const indicator = hasUnsubmittedDraft && (t.indicator === "none" || t.indicator === "runtime")
    ? (t.indicator === "runtime" ? "working-draft" : "draft") : t.indicator;
  return <ContextMenu thread={target} inline={inline}>
    <div className={`wt-row ${active ? "wt-selected" : ""} ${node.contextOnly ? "wt-context" : ""}`}
      role="treeitem" aria-level={depth + 1} aria-expanded={node.children.length ? expanded : undefined}
      data-wt-thread-id={t.id} onDragOver={drag.onDragOver} onDragLeave={drag.onDragLeave} onDrop={drag.onDrop}
      style={{ paddingLeft: 8 + depth * 12 }}>
      {node.children.length ? <button className="wt-icon-button" aria-label={`${expanded ? "Collapse" : "Expand"} ${t.displayTitle}`} onClick={toggle}>
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
      </button> : <span className="wt-indent" />}
      <a {...splitProps} href={t.href} className="wt-thread-link"
        data-sidebar-thread-shortcut-target={shortcutTarget ? "" : undefined} data-sidebar-thread-id={shortcutTarget ? t.id : undefined}
        aria-current={active ? "page" : undefined} aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        title={`${t.displayTitle}\n${t.environment?.path ?? "No environment"}${node.contextOnly ? "\nParent retained for a child in this view" : ""}`}
        onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate.toThread(t.id); onNavigate(); } }}>
        {provider ? <ProviderIcon providerKind="agent" provider={provider} className="size-4 shrink-0" /> : null}
        <span className="wt-thread-text"><span className="wt-title"><ThreadTitle threadId={t.id} /></span>
          <span className="wt-location">{location || "No environment"}{node.contextOnly ? " · Parent" : ""}</span></span>
        {t.isPinned ? <Icon name="Pin" className="size-3 shrink-0" /> : null}
        {t.isUnread ? <span className="wt-unread" aria-label="Unread" /> : null}
        <StatusGlyph indicator={indicator} rowStatus={rowStatus} />
        {shortcut ? <kbd>{shortcut.label}</kbd> : null}
      </a>
      {enhanced ? <button className="wt-icon-button wt-menu wt-order-handle" aria-label={`Drag to organize ${t.displayTitle}`} title="Drag to organize" draggable
        onPointerDown={event => event.stopPropagation()} onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd}><span aria-hidden="true">⠿</span></button> : null}
      <ThreadMenu thread={target} inline={inline} trigger={props => <button {...props} className={[props.className, "wt-icon-button wt-menu"].filter(Boolean).join(" ")} aria-label={`Actions for ${t.displayTitle}`}><Icon name="MoreHorizontal" className="size-4" /></button>} />
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
  const [preferences, setPreferences] = useState(() => readPreferences(storageKey));
  const { period } = preferences;
  const collapsed = useMemo(() => new Set(preferences.collapsed), [preferences.collapsed]);
  const [now, setNow] = useState(Date.now);
  const [pathNode, setPathNode] = useState<ThreadNode | null>(null);
  const [path, setPath] = useState("");
  const [folderDialog, setFolderDialog] = useState<{ projectId: string; parentId: string | null; id?: string } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dragged = useRef<(({ kind: "folder"; node: FolderNode } | { kind: "thread"; row: Extract<ListRow, { kind: "thread" }> }) & { token: string }) | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const ids = [...new Set(threads.filter(t => !t.isHidden).map(t => t.id))].sort();
  const envs = [...new Set(threads.filter(t => !t.isHidden).flatMap(t => t.environment?.id ? [t.environment.id] : []))].sort();
  const paths = JSON.stringify([...new Map(threads.flatMap(t => t.environment?.id ? [[t.environment.id, t.environment.path] as const] : [])).entries()].sort(([a], [b]) => a.localeCompare(b)));
  const { rpc, state, error, refresh } = useRepositoryData(ids, envs, paths);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Storage is optional. */ }
  }, [preferences, storageKey]);
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
  for (const thread of threads) {
    const target = preferences.threadFolders[thread.id];
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
  const groups = buildGroups(threads, environments, assignments, period, now, links, placements);
  const available = [...buildGroups(threads, environments, assignments, "all", now, links),
    ...buildGroups(threads, environments, assignments, "all", now, links, placements)];
  const groupCatalog = [...new Map(repositories.map(r => { const grouped = groupedRepository(r, links)!; return [grouped.id, grouped]; })).values()];
  const rows: ListRow[] = [];
  const projectIds = [...new Set([...groups.map(g => g.projectId), ...Object.values(preferences.customFolders).filter(f => f.projectId === enabledProject).map(f => f.projectId)])];
  const trees = new Map(projectIds.map(id => [id, buildFolderTree(groups, available, preferences, id, links)]));
  const smart = buildSmartViews(threads, environments, assignments, period, now);
  function appendSmart(nodes: ThreadNode[], view: "input" | "recent", depth: number) {
    for (const node of nodes) {
      const key = `smart:${view}:${node.thread.id}`;
      rows.push({ kind: "thread", key, node, depth, groupRepositoryId: null, groupRepositoryLabel: null, folder: `smart:${view}`,
        scope: `smart:${view}`, peers: [], smart: true, summary: smart.summaries.get(node.thread.id) });
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
    if (collapsed.has(key)) continue;
    function appendThreads(nodes: ThreadNode[], folder: FolderNode, headingKey: string, parentId: string | null, depth: number) {
      const peers = nodes.map(node => node.thread.id);
      for (const node of nodes) {
        const key = `thread:${headingKey}:${node.thread.id}`;
        rows.push({ kind: "thread", key, node, depth, groupRepositoryId: folder.repository?.id ?? null, groupRepositoryLabel: folder.repository?.label ?? null,
          folder: folder.id, scope: siblingKey(folder.id, parentId), peers });
        if (!collapsed.has(key)) appendThreads(node.children, folder, headingKey, node.thread.id, depth + 1);
      }
    }
    function appendFolder(node: FolderNode, depth: number) {
      const key = node.custom ? `folder:${node.id}` : `repository:${projectId}:${node.repository?.id ?? "unassigned"}`;
      rows.push({ kind: "folder", key, node, depth });
      if (collapsed.has(key)) return;
      for (const child of node.children) appendFolder(child, depth + 1);
      if (node.group) appendThreads(orderedTree(node.group.roots, node.id, preferences), node, key, null, depth + 1);
    }
    for (const node of trees.get(projectId)!) appendFolder(node, 1);
  }
  for (const project of projects.filter(project => project.id !== enabledProject)) {
    const plain = allThreads.filter(thread => thread.projectId === project.id && !thread.isHidden).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!plain.length) continue;
    const key = `project:${project.id}`;
    rows.push({ kind: "heading", key, label: project.name, depth: 0, count: plain.length });
    if (collapsed.has(key)) continue;
    for (const thread of plain) rows.push({ kind: "thread", key: `plain:${thread.id}`, node: { thread, repository: null, children: [], contextOnly: false, updatedAt: thread.updatedAt }, depth: 1, groupRepositoryId: null, groupRepositoryLabel: null, folder: "", scope: "", peers: [] });
  }
  const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 6);
  const end = Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + 6;
  const shortcutTargets = new Set<string>();
  const renderedRows = rows.slice(start, end).map(row => {
    const shortcutTarget = row.kind === "thread" && !shortcutTargets.has(row.node.thread.id);
    if (row.kind === "thread") shortcutTargets.add(row.node.thread.id);
    return { row, shortcutTarget };
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
  function subtreeIds(id: string) {
    const included = new Set([id]);
    for (const parent of included) for (const thread of threads) if (thread.parentThreadId === parent && !thread.isHidden) included.add(thread.id);
    return included;
  }
  function locateThread(id: string, folder?: string, repository?: Repository | null) {
    const ids = subtreeIds(id);
    setPreferences(old => {
      const threadFolders = { ...old.threadFolders };
      for (const id of ids) { if (folder) threadFolders[id] = folder; else delete threadFolders[id]; }
      return { ...old, threadFolders, folderRepositories: folder && repository ? { ...old.folderRepositories, [folder]: repository } : old.folderRepositories };
    });
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
        setPreferences(old => ({ ...old, folderSort: { ...old.folderSort, [row.folder]: "manual" },
          threadOrder: { ...old.threadOrder, [row.scope]: moveOrder(old.threadOrder[row.scope] ?? [], row.peers, source, row.node.thread.id, after) } }));
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
          setPreferences(old => moveFolder(old, trees.get(node.projectId)!, item.node.id, node.id, where) ?? old);
        } else if (threadAllowed()) locateThread(item.row.node.thread.id, node.id, node.repository);
        finishDrag();
      },
    };
  }
  function openFolderDialog(projectId: string, parentId: string | null, id?: string) {
    setFolderName(id ? preferences.customFolders[id].label : ""); setFolderDialog({ projectId, parentId, id });
  }
  function renderFolder(row: Extract<ListRow, { kind: "folder" }>) {
    const node = row.node;
    return <FolderRow id={node.id} label={node.label} path={node.repository?.path} count={node.count} depth={row.depth} custom={node.custom} nested={node.parentId !== null}
      expanded={!collapsed.has(row.key)} toggle={() => toggle(row.key)} pinned={preferences.folderPins.includes(node.id)} drag={folderDrag(node)}
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
    try { await rpc.call("assign", { threadId, path }); setAssignmentError(null); refresh(); }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setAssignmentError(message); throw cause; }
  };
  return <div className="wt-sidebar">
    {enabledProject ? <div className="wt-toolbar"><label className="wt-filter-label">Updated
      <select aria-label="Activity period" value={period} onChange={event => { const period = event.target.value as Period; setPreferences(old => ({ ...old, period })); if (scroll.current) scroll.current.scrollTop = 0; setViewport(v => ({ ...v, top: 0 })); }}>
        {periods.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select></label>
      <button className="wt-icon-button" aria-label="New folder" title="New folder"
        onClick={() => openFolderDialog(enabledProject, null)}><Icon name="Folder" className="size-4" /></button>
      <button className="wt-icon-button" onClick={() => refresh(true)} aria-label="Refresh repositories" title="Refresh repositories"><span aria-hidden="true">↻</span></button>
    </div> : null}
    {error || failures.length || assignmentError ? <div className="wt-error" role="alert">{assignmentError ?? error ?? `${failures.length} environment(s) could not be resolved: ${failures[0]?.error}`}<button onClick={() => refresh(true)}>Retry</button></div> : null}
    <div ref={scroll} className="wt-scroll" onScroll={event => { const top = event.currentTarget.scrollTop; setViewport(v => ({ ...v, top })); }}>
      {status === "loading" || (!state && !error) ? <p className="wt-empty" role="status">Loading threads…</p>
        : status === "error" ? <p className="wt-empty" role="alert">Could not load threads.</p>
        : !rows.length ? <p className="wt-empty" role="status">No threads updated in this period.</p>
        : <div role="tree" aria-label="Threads by repository" style={{ height: rows.length * ROW_HEIGHT, position: "relative" }}>
          {renderedRows.map(({ row, shortcutTarget }, i) => <div key={row.key} className="wt-positioned" data-wt-smart-view={row.kind === "thread" && row.smart ? row.folder.slice(6) : undefined} style={{ top: (start + i) * ROW_HEIGHT }}>
            {row.kind === "heading" ? <button className={`wt-heading wt-depth-${row.depth}`} style={{ paddingLeft: 8 + row.depth * 12 }} role="treeitem" aria-level={row.depth + 1}
              aria-expanded={row.smart ? preferences.smartExpanded.includes(row.smart) : !collapsed.has(row.key)} title={row.subtitle}
              onClick={() => { const view = row.smart; if (!view) toggle(row.key); else setPreferences(old => ({ ...old, smartExpanded: old.smartExpanded.includes(view) ? old.smartExpanded.filter(v => v !== view) : [...old.smartExpanded, view] })); }}>
              <Icon name={(row.smart ? !preferences.smartExpanded.includes(row.smart) : collapsed.has(row.key)) ? "ChevronRight" : "ChevronDown"} className="size-3.5 shrink-0" />
              {row.depth === 1 ? <Icon name="Folder" className="size-4 shrink-0" /> : null}
              <span className="wt-heading-label">{row.label}</span><span className="wt-count">{row.count}</span>
            </button> : row.kind === "folder" ? renderFolder(row)
              : <ThreadRow node={row.node} depth={row.depth} groupRepositoryId={row.groupRepositoryId} groupRepositoryLabel={row.groupRepositoryLabel} shortcutTarget={shortcutTarget}
                enhanced={row.node.thread.projectId === enabledProject} drag={row.node.thread.projectId === enabledProject ? threadDrag(row) : {}} restore={row.node.thread.projectId === enabledProject && preferences.threadFolders[row.node.thread.id] ? () => locateThread(row.node.thread.id) : undefined} summary={row.summary}
                expanded={!collapsed.has(row.key)} toggle={() => toggle(row.key)} active={props.activeThreadId === row.node.thread.id}
                onNavigate={props.onNavigate} repositories={repositories} onAssign={assign}
                onPath={node => { setPathNode(node); setPath(node.repository?.path ?? node.thread.environment?.path ?? ""); setAssignmentError(null); }} />}

          </div>)}
        </div>}
    </div>
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
          {assignmentError ? <p role="alert" className="text-sm text-destructive">{assignmentError}</p> : null}
          <div className="wt-dialog-buttons"><Button type="button" variant="ghost" disabled={saving} onClick={() => setPathNode(null)}>Cancel</Button><Button type="submit" disabled={saving || !path.trim()}>{saving ? "Assigning…" : "Assign"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadList({ id: "repositories", title: "Thread House", description: "Repositories, nested agents, and a last-update filter.", component: ThreadHouseList });
});
