import { groupedRepository, type Repository, type RepositoryGroup } from "./model";
import { folderKey, folderScope, moveOrder, type Preferences } from "./preferences";

export interface FolderNode {
  id: string; projectId: string; label: string; repository: Repository | null;
  custom: boolean; group?: RepositoryGroup; parentId: string | null;
  count: number; updatedAt: number; children: FolderNode[];
}
export type DropPosition = "before" | "inside" | "after";

export function buildFolderTree(groups: readonly RepositoryGroup[], available: readonly RepositoryGroup[], preferences: Preferences, projectId: string,
  links: ReadonlyMap<string, Repository> = new Map(Object.entries(preferences.groupWith))): FolderNode[] {
  const active = new Map(groups.filter(g => g.projectId === projectId).map(g => [folderKey(g), g]));
  const known = new Map<string, FolderNode>();
  for (const group of available.filter(g => g.projectId === projectId)) {
    const id = folderKey(group); const current = active.get(id);
    known.set(id, { id, projectId, label: group.repository?.label ?? "Unassigned", repository: group.repository,
      custom: false, group: current, parentId: null, count: current?.count ?? 0, updatedAt: current?.updatedAt ?? 0, children: [] });
  }
  for (const [id, folder] of Object.entries(preferences.customFolders)) {
    if (folder.projectId !== projectId) continue;
    const current = active.get(id);
    known.set(id, { id, projectId, label: folder.label, repository: null, custom: true, group: current,
      parentId: null, count: current?.count ?? 0, updatedAt: current?.updatedAt ?? 0, children: [] });
  }
  function linkedParent(id: string): string | undefined {
    const parent = preferences.folderParents[id];
    if (!parent || known.has(parent)) return parent;
    try {
      const [project, repositoryId] = JSON.parse(parent);
      const target = project === projectId ? links.get(repositoryId) : undefined;
      return target ? JSON.stringify([projectId, groupedRepository(target, links)!.id]) : parent;
    } catch { return parent; }
  }
  function parentOf(id: string): string | null {
    const parent = linkedParent(id);
    if (!parent || !known.has(parent)) return null;
    const visited = new Set([id]);
    let cursor: string | undefined = parent;
    while (cursor && known.has(cursor)) {
      if (visited.has(cursor)) return null;
      visited.add(cursor); cursor = linkedParent(cursor);
    }
    return parent;
  }
  const included = new Set([...active.keys(), ...[...known.values()].filter(n => n.custom).map(n => n.id)]);
  for (const id of included) {
    const parent = parentOf(id);
    if (parent) included.add(parent);
  }
  const roots: FolderNode[] = [];
  for (const id of included) {
    const node = known.get(id)!;
    node.parentId = parentOf(id);
    if (node.parentId) known.get(node.parentId)!.children.push(node);
    else roots.push(node);
  }
  function rollup(nodes: FolderNode[], parentId: string | null) {
    for (const node of nodes) {
      rollup(node.children, node.id);
      for (const child of node.children) { node.count += child.count; node.updatedAt = Math.max(node.updatedAt, child.updatedAt); }
    }
    const order = preferences.folderOrder[folderScope(projectId, parentId)] ?? [];
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? Infinity : index; };
    nodes.sort((a, b) => Number(preferences.folderPins.includes(b.id)) - Number(preferences.folderPins.includes(a.id))
      || rank(a.id) - rank(b.id) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  rollup(roots, null);
  return roots;
}

export function flattenFolders(roots: readonly FolderNode[]): FolderNode[] {
  return roots.flatMap(node => [node, ...flattenFolders(node.children)]);
}

export function moveFolder(preferences: Preferences, roots: readonly FolderNode[], id: string, targetId: string, position: DropPosition): Preferences | null {
  const nodes = new Map(flattenFolders(roots).map(node => [node.id, node]));
  const node = nodes.get(id), target = nodes.get(targetId);
  if (!node || !target || id === targetId || node.projectId !== target.projectId) return null;
  const parentId = position === "inside" ? targetId : target.parentId;
  let parent = parentId;
  while (parent) { if (parent === id) return null; parent = nodes.get(parent)?.parentId ?? null; }
  if (position !== "inside" && preferences.folderPins.includes(id) !== preferences.folderPins.includes(targetId)) return null;
  const folderParents = { ...preferences.folderParents };
  if (parentId) folderParents[id] = parentId; else delete folderParents[id];
  const scope = folderScope(node.projectId, parentId);
  const siblings = (parentId ? nodes.get(parentId)!.children : roots).filter(n => n.id !== id).map(n => n.id);
  const stored = preferences.folderOrder[scope] ?? [];
  const order = position === "inside" ? [...new Set([...stored.filter(key => key !== id), ...siblings, id])]
    : moveOrder(stored, [...siblings, id], id, targetId, position === "after");
  return { ...preferences, folderParents, folderOrder: { ...preferences.folderOrder, [scope]: order } };
}

export function removeFolder(preferences: Preferences, id: string): Preferences {
  const customFolders = { ...preferences.customFolders }; delete customFolders[id];
  const folderParents = { ...preferences.folderParents }; delete folderParents[id];
  for (const child of Object.keys(folderParents)) {
    if (folderParents[child] !== id) continue;
    if (preferences.folderParents[id]) folderParents[child] = preferences.folderParents[id]; else delete folderParents[child];
  }
  return { ...preferences, customFolders, folderParents, folderPins: preferences.folderPins.filter(key => key !== id),
    threadFolders: Object.fromEntries(Object.entries(preferences.threadFolders).filter(([, folder]) => folder !== id)) };
}
