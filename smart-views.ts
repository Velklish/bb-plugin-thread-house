import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { buildGroups, type Period, type Repository, type ThreadNode } from "./model";

export interface ActivitySummary { needsInput: number; running: number }
export function buildSmartViews(threads: readonly PluginSidebarThread[], environments: ReadonlyMap<string, Repository | null>, assignments: ReadonlyMap<string, Repository>, period: Period, now: number) {
  const visible = threads.filter(thread => !thread.isHidden && !thread.isArchived);
  const repositories = new Map<string, Repository | null>();
  function remember(node: ThreadNode) { repositories.set(node.thread.id, node.repository); node.children.forEach(remember); }
  buildGroups(visible, environments, assignments, "all", now).forEach(group => group.roots.forEach(remember));
  const nodes = new Map(visible.map(thread => [thread.id, { thread, repository: repositories.get(thread.id) ?? null,
    children: [], contextOnly: false, updatedAt: thread.updatedAt } as ThreadNode]));
  const roots: ThreadNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.thread.parentThreadId ? nodes.get(node.thread.parentThreadId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const summaries = new Map<string, ActivitySummary>();
  const compare = (a: ThreadNode, b: ThreadNode) => b.updatedAt - a.updatedAt || a.thread.id.localeCompare(b.thread.id);
  function summarize(node: ThreadNode): ActivitySummary {
    const summary = { needsInput: Number(node.thread.hasPendingInteraction), running: Number(["starting", "active", "stopping"].includes(node.thread.status)) };
    for (const child of node.children) {
      const activity = summarize(child); summary.needsInput += activity.needsInput; summary.running += activity.running;
      node.updatedAt = Math.max(node.updatedAt, child.updatedAt);
    }
    node.children.sort(compare); summaries.set(node.thread.id, summary); return summary;
  }
  roots.forEach(summarize); roots.sort(compare);
  function pending(node: ThreadNode): ThreadNode | null {
    const children = node.children.flatMap(child => { const result = pending(child); return result ? [result] : []; });
    if (!node.thread.hasPendingInteraction && !children.length) return null;
    return { ...node, children, contextOnly: !node.thread.hasPendingInteraction };
  }
  const cutoff = period === "all" ? -Infinity : now - Number(period) * 86_400_000;
  return {
    input: roots.flatMap(root => { const node = pending(root); return node ? [node] : []; }),
    inputCount: visible.filter(thread => thread.hasPendingInteraction).length,
    recent: roots.filter(root => !root.thread.parentThreadId && root.updatedAt >= cutoff).slice(0, 10).map(root => ({ ...root, children: [] })),
    summaries,
  };
}
