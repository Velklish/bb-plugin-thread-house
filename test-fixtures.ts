import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Repository } from "./model";

export const NOW = Date.UTC(2026, 9, 12, 12);
export const DAY = 86_400_000;
export const repository: Repository = {
  id: "host:sample-app/.git", hostId: "host", label: "sample-app", path: "/work/sample-app",
};
export function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, projectId: "workspace", title: id, titleFallback: null, displayTitle: id,
    parentThreadId: null, lifecycleOwnerThreadId: null, sourceThreadId: null,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
    status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    pinnedAt: null, pinSortKey: null, isArchived: false, archivedAt: null,
    href: `/projects/workspace/threads/${id}`, isHidden: false,
    environment: { id: "env", name: null, branchName: "main", path: "/work/sample-app", isWorktree: false, providerId: null, workspaceDisplayKind: null },
    host: { id: "host", name: "Mac" }, createdAt: NOW - DAY, updatedAt: NOW,
    lastReadAt: null, latestAttentionAt: NOW, ...overrides,
  };
}
