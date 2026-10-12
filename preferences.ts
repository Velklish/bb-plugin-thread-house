import { z } from "zod";
import { groupedRepository, type Repository, type RepositoryGroup, type ThreadNode } from "./model";

export const sortModes = [
  { value: "updated", label: "Updated" }, { value: "created", label: "Created" },
  { value: "title", label: "Title" }, { value: "pinned", label: "Pinned first" },
  { value: "manual", label: "Manual" },
] as const;
export type SortMode = typeof sortModes[number]["value"];
const repository = z.object({ id: z.string(), hostId: z.string(), label: z.string(), path: z.string(), origin: z.string().optional() });
const schema = z.object({
  period: z.enum(["1", "3", "7", "all"]).default("all"),
  collapsed: z.array(z.string()).default([]),
  folderPins: z.array(z.string()).default([]),
  folderOrder: z.record(z.string(), z.array(z.string())).default({}),
  folderSort: z.record(z.string(), z.enum(["updated", "created", "title", "pinned", "manual"])).default({}),
  threadOrder: z.record(z.string(), z.array(z.string())).default({}),
  groupWith: z.record(z.string(), repository).default({}),
  customFolders: z.record(z.string(), z.object({ projectId: z.string(), label: z.string() })).default({}),
  folderParents: z.record(z.string(), z.string()).default({}),
  threadFolders: z.record(z.string(), z.string()).default({}),
  folderRepositories: z.record(z.string(), repository).default({}),
  smartExpanded: z.array(z.enum(["input", "recent"])).default(["input"]),
});
export type Preferences = z.infer<typeof schema>;
export const STORAGE_KEY = "thread-house:preferences";
export const folderKey = (group: RepositoryGroup) => group.folderId ?? JSON.stringify([group.projectId, group.repository?.id ?? null]);
export const folderScope = (projectId: string, parentId: string | null) => parentId ? JSON.stringify([projectId, parentId]) : projectId;
export const siblingKey = (folder: string, parentId: string | null) => JSON.stringify([folder, parentId]);

export function effectiveFolderId(id: string, preferences: Preferences, links: ReadonlyMap<string, Repository> = new Map(Object.entries(preferences.groupWith))): string {
  if (preferences.customFolders[id]) return id;
  try {
    const [projectId, repositoryId] = JSON.parse(id);
    const target = links.get(repositoryId);
    if (target) return JSON.stringify([projectId, groupedRepository(target, links)!.id]);
  } catch { /* Non-repository folder keys are returned as-is. */ }
  return id;
}

export function parsePreferences(value: unknown): Preferences {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}
export function readPreferences(storageKey = STORAGE_KEY): Preferences {
  try { return parsePreferences(JSON.parse(localStorage.getItem(storageKey) ?? "null")); }
  catch { return parsePreferences(null); }
}

function rank(order: readonly string[], id: string) {
  const index = order.indexOf(id);
  return index < 0 ? Infinity : index;
}
export function orderedTree(nodes: readonly ThreadNode[], folder: string, preferences: Preferences, parentId: string | null = null): ThreadNode[] {
  const mode = preferences.folderSort[folder] ?? "updated";
  const order = preferences.threadOrder[siblingKey(folder, parentId)] ?? [];
  return nodes.map(node => ({ ...node, children: orderedTree(node.children, folder, preferences, node.thread.id) })).sort((a, b) => {
    let result = 0;
    if (mode === "manual") result = rank(order, a.thread.id) - rank(order, b.thread.id);
    if (mode === "created") result = b.thread.createdAt - a.thread.createdAt;
    if (mode === "title") result = a.thread.displayTitle.localeCompare(b.thread.displayTitle);
    if (mode === "pinned") {
      result = Number(b.thread.isPinned) - Number(a.thread.isPinned);
      if (!result && a.thread.isPinned && b.thread.isPinned) result = Number(b.thread.pinSortKey !== null) - Number(a.thread.pinSortKey !== null)
        || (a.thread.pinSortKey && b.thread.pinSortKey ? a.thread.pinSortKey.localeCompare(b.thread.pinSortKey) : (b.thread.pinnedAt ?? 0) - (a.thread.pinnedAt ?? 0));
    }
    return result || b.updatedAt - a.updatedAt || a.thread.id.localeCompare(b.thread.id);
  });
}

// Keep entries hidden by the activity filter when moving a visible sibling.
export function moveOrder(stored: readonly string[], visible: readonly string[], id: string, target: string, after = false): string[] {
  if (id === target || !visible.includes(id) || !visible.includes(target)) return [...stored];
  const order = [...new Set([...stored, ...visible])].filter(value => value !== id);
  order.splice(order.indexOf(target) + Number(after), 0, id);
  return order;
}
