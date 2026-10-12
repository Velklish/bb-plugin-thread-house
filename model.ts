import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type Period = "1" | "3" | "7" | "all";
export interface Repository {
  id: string;
  hostId: string;
  label: string;
  path: string;
  origin?: string;
}
export interface ThreadNode {
  thread: PluginSidebarThread;
  repository: Repository | null;
  children: ThreadNode[];
  contextOnly: boolean;
  updatedAt: number;
}
export interface RepositoryGroup {
  folderId?: string;
  projectId: string;
  repository: Repository | null;
  repositories: Repository[];
  roots: ThreadNode[];
  count: number;
  updatedAt: number;
}

export function groupedRepository(repository: Repository | null, links: ReadonlyMap<string, Repository>): Repository | null {
  let current = repository;
  const visited = new Set<string>();
  while (current && links.has(current.id)) {
    if (visited.has(current.id)) return repository;
    visited.add(current.id);
    const next = links.get(current.id)!;
    if (next.hostId !== current.hostId) break;
    if (next.id === current.id) return next;
    current = next;
  }
  return current;
}

export function repositoryLinks(repositories: readonly Repository[], overrides: ReadonlyMap<string, Repository> = new Map()): Map<string, Repository> {
  const origins = new Map<string, Repository[]>();
  for (const repository of repositories) {
    if (!repository.origin) continue;
    const key = JSON.stringify([repository.hostId, repository.origin]);
    const clones = origins.get(key) ?? []; clones.push(repository); origins.set(key, clones);
  }
  const links = new Map(overrides);
  for (const clones of origins.values()) {
    const label = clones[0].origin!.split("/").at(-1)!;
    clones.sort((a, b) => Number(b.label === label) - Number(a.label === label) || a.path.length - b.path.length || a.id.localeCompare(b.id));
    const selected = clones.flatMap(clone => {
      const override = overrides.get(clone.id);
      if (!override || override.id === clone.id) return [];
      const destination = groupedRepository(override, overrides)!;
      return clones.filter(candidate => candidate.id === destination.id);
    })[0] ?? clones[0];
    const target = { ...selected, label };
    for (const clone of clones) {
      if (overrides.has(clone.id)) continue;
      const destination = groupedRepository(target, links)!;
      links.set(clone.id, destination.id === clone.id ? { ...clone, label } : target);
    }
  }
  return links;
}

export function buildGroups(
  threads: readonly PluginSidebarThread[],
  environments: ReadonlyMap<string, Repository | null>,
  assignments: ReadonlyMap<string, Repository>,
  period: Period,
  now: number,
  groupWith: ReadonlyMap<string, Repository> = new Map(),
  placements: ReadonlyMap<string, { folderId: string; repository: Repository | null }> = new Map(),
): RepositoryGroup[] {
  const visible = new Map(threads.filter(t => !t.isHidden).map(t => [t.id, t]));
  const cutoff = period === "all" ? -Infinity : now - Number(period) * 86_400_000;
  const matching = new Set([...visible.values()].filter(t => t.updatedAt >= cutoff).map(t => t.id));
  const included = new Set(matching);
  for (const id of matching) {
    let parent = visible.get(id)?.parentThreadId;
    while (parent && visible.has(parent) && !included.has(parent)) {
      included.add(parent);
      parent = visible.get(parent)!.parentThreadId;
    }
  }
  const nodes = new Map<string, ThreadNode>();
  for (const id of included) {
    const t = visible.get(id)!;
    nodes.set(id, { thread: t, repository: null, children: [], contextOnly: !matching.has(id), updatedAt: t.updatedAt });
  }
  const roots: ThreadNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.thread.parentThreadId ? nodes.get(node.thread.parentThreadId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const compare = (a: ThreadNode, b: ThreadNode) => b.updatedAt - a.updatedAt || a.thread.id.localeCompare(b.thread.id);
  const groupKey = (node: ThreadNode) => placements.get(node.thread.id)?.folderId ?? JSON.stringify([node.thread.projectId, groupedRepository(node.repository, groupWith)?.id ?? null]);
  const groups = new Map<string, RepositoryGroup>();
  function resolve(node: ThreadNode, parent?: ThreadNode): void {
    const envId = node.thread.environment?.id;
    const discovered = parent && envId === parent.thread.environment?.id
      ? parent.repository : (envId ? environments.get(envId) ?? null : null);
    node.repository = assignments.get(node.thread.id) ?? discovered;
    const key = groupKey(node);
    let group = groups.get(key);
    if (!group) {
      const placement = placements.get(node.thread.id);
      group = { folderId: placement?.folderId, projectId: node.thread.projectId, repository: placement ? placement.repository : groupedRepository(node.repository, groupWith), repositories: [], roots: [], count: 0, updatedAt: -Infinity };
      groups.set(key, group);
    }
    if (node.repository && !group.repositories.some(r => r.id === node.repository!.id)) group.repositories.push(node.repository);
    group.count++;
    group.updatedAt = Math.max(group.updatedAt, node.thread.updatedAt);
    for (const child of node.children) resolve(child, node);
  }
  for (const root of roots) resolve(root);
  function project(node: ThreadNode, key: string): ThreadNode | null {
    const children = node.children.flatMap(child => {
      const projected = project(child, key);
      return projected ? [projected] : [];
    }).sort(compare);
    const belongs = groupKey(node) === key;
    if (!belongs && !children.length) return null;
    return {
      ...node, children, contextOnly: node.contextOnly || !belongs,
      updatedAt: Math.max(belongs ? node.thread.updatedAt : -Infinity, ...children.map(child => child.updatedAt)),
    };
  }
  for (const [key, group] of groups) {
    group.roots = roots.flatMap(root => {
      const projected = project(root, key);
      return projected ? [projected] : [];
    }).sort(compare);
  }
  return [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}
