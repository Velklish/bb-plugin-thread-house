// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import app, { ThreadHouseList } from "./app";
import { DAY, repository, thread } from "./test-fixtures";
import type { RepositoryState } from "./contracts";
import { STORAGE_KEY } from "./preferences";

const cleanup: (() => void)[] = [];
const storageWindow = new JSDOM("", { url: "https://bb.test" }).window;
beforeEach(() => {
  vi.stubGlobal("localStorage", storageWindow.localStorage);
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(stateProvider?: () => RepositoryState, threads?: ReturnType<typeof thread>[], sidebarShortcuts = {}, activeThreadId = "child") {
  const pluginApp = await loadPluginApp(async () => app);
  const now = Date.now();
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId, activeProjectId: "workspace", isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
    settings: { project: "workspace" },
    sidebarThreads: { status: "ready", projects: [{ id: "workspace", name: "workspace", isPersonal: false, href: "/", settingsHref: "/" }], sections: [], threads: threads ?? [thread("parent", { updatedAt: now - 10 * DAY }), thread("child", { updatedAt: now, parentThreadId: "parent" }), thread("old", { updatedAt: now - 10 * DAY })] },
    rpc: { state: stateProvider ?? (() => ({ environments: [{ environmentId: "env", repository, error: null }], assignments: [] })) },
    sidebarShortcuts,
  });
  cleanup.push(() => slot.lifecycle.unmount());
  await slot.findByText("sample-app");
  return slot;
}
const preferences = () => JSON.parse(localStorage.getItem(`${STORAGE_KEY}:workspace`)!);
it("recovers a transient repository RPC failure without clicking Retry", async () => {
  let calls = 0;
  const slot = await mount(() => {
    if (++calls === 1) throw new Error("HTTP 500: fetch failed");
    return { environments: [{ environmentId: "env", repository, error: null }], assignments: [] };
  });
  expect(calls).toBe(2);
  expect(slot.queryByRole("alert")).toBeNull();
});
it("retains loaded groups, stops after three attempts, and allows manual Retry", async () => {
  let failing = false, calls = 0;
  const slot = await mount(() => {
    calls++;
    if (failing) throw new Error("fetch failed");
    return { environments: [{ environmentId: "env", repository, error: null }], assignments: [] };
  });
  vi.useFakeTimers(); failing = true;
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.getByText("sample-app")).toBeTruthy();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(calls).toBe(4);
  expect(slot.getByRole("alert").textContent).toContain("fetch failed");
  failing = false;
  await act(async () => { fireEvent.click(slot.getByText("Retry")); });
  expect(calls).toBe(5);
  expect(slot.queryByRole("alert")).toBeNull();
});
it("recovers environment network errors while retaining the repository folder", async () => {
  let calls = 0;
  const slot = await mount(() => ({
    environments: [{ environmentId: "env", repository: ++calls === 2 ? null : repository, error: calls === 2 ? "fetch failed" : null }], assignments: [],
  }));
  vi.useFakeTimers();
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.getByText("sample-app")).toBeTruthy();
  expect(slot.getByRole("alert").textContent).toContain("fetch failed");
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(calls).toBe(3);
  expect(slot.queryByRole("alert")).toBeNull();
});
it("retains an explicit repository assignment while retrying its failed read", async () => {
  const assigned = { ...repository, id: "assigned", label: "Assigned repository" };
  let failing = false;
  const slot = await mount(() => {
    if (failing) throw new Error("fetch failed");
    return { environments: [{ environmentId: "env", repository, error: null }], assignments: [{ threadId: "parent", repository: assigned }] };
  });
  vi.useFakeTimers(); failing = true;
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.getByText("Assigned repository")).toBeTruthy();
  failing = false;
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(slot.getByText("Assigned repository")).toBeTruthy();
  expect(slot.queryByRole("alert")).toBeNull();
});
it("does not retry permanent RPC errors or retry after unmount", async () => {
  let failure = "", calls = 0;
  const slot = await mount(() => {
    calls++;
    if (failure) throw new Error(failure);
    return { environments: [{ environmentId: "env", repository, error: null }], assignments: [] };
  });
  vi.useFakeTimers(); failure = "Permission denied";
  await slot.behavior.emitRealtime("changed", {});
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(calls).toBe(2);
  failure = "fetch failed";
  await slot.behavior.emitRealtime("changed", {});
  expect(calls).toBe(3);
  slot.lifecycle.unmount();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(calls).toBe(3);
});
it("shows old pinned threads above the project, in BB pin order, regardless of Updated", async () => {
  const slot = await mount(undefined, [thread("recent", { updatedAt: Date.now() }),
    thread("second-pin", { isPinned: true, pinnedAt: 2, pinSortKey: "b", updatedAt: 1 }),
    thread("first-pin", { isPinned: true, pinnedAt: 1, pinSortKey: "a", updatedAt: 1 }),
    thread("hidden-pin", { isPinned: true, isHidden: true })]);
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "1" } });
  const tree = slot.getByRole("tree");
  expect(tree.querySelector(".wt-heading-label")?.textContent).toBe("Pinned");
  const rows = tree.querySelectorAll("[data-wt-pinned]");
  expect([...rows].map(row => row.querySelector("[data-wt-thread-id]")?.getAttribute("data-wt-thread-id"))).toEqual(["first-pin", "second-pin"]);
  expect(slot.queryByText("hidden-pin")).toBeNull();
  expect(slot.queryByLabelText("Drag to organize first-pin")).toBeNull();
  expect(slot.getByText("first-pin").closest("a")?.getAttribute("data-sidebar-thread-id")).toBe("first-pin");
});
it.each(["unread-success", "runtime", "waiting-for-input", "unread-error"] as const)("shows one native %s indicator on an unread thread", async indicator => {
  const slot = await mount(undefined, [thread("unread", { isUnread: true, indicator })]);
  const row = slot.getByText("unread").closest(".wt-row")!;
  expect(row.querySelectorAll('[data-thread-status-glyph], [aria-label="Unread"]')).toHaveLength(1);
  expect(row.querySelector("[data-thread-status-glyph]")?.getAttribute("data-thread-status-glyph")).toBe(indicator);
});
it("keeps other projects in a plain list and excludes them from repository RPC", async () => {
  const calls: unknown[] = [];
  const pluginApp = await loadPluginApp(async () => app);
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId: "outside", activeProjectId: "outside", isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
    settings: { project: "workspace" },
    sidebarThreads: { status: "ready", projects: [{ id: "workspace", name: "Selected", isPersonal: false, href: "/", settingsHref: "/" }, { id: "outside", name: "Other", isPersonal: false, href: "/", settingsHref: "/" }], sections: [], threads: [thread("selected"), thread("outside", { projectId: "outside", updatedAt: Date.now() - 30 * DAY, environment: { ...thread("outside").environment!, id: "outside-env", path: "/other/repo", branchName: "main" } })] },
    rpc: { state: input => { calls.push(input); return { environments: [{ environmentId: "env", repository, error: null }], assignments: [] }; } },
  });
  cleanup.push(() => slot.lifecycle.unmount());
  await slot.findByText("sample-app");
  expect(slot.getByText("outside")).toBeTruthy();
  expect(slot.queryByLabelText("Drag to organize outside")).toBeNull();
  expect(calls).toEqual([{ threadIds: ["selected"], environmentIds: ["env"], refresh: false }]);
});
it("renders a plain list without repository RPC when no project is enabled", async () => {
  const pluginApp = await loadPluginApp(async () => app);
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId: "one", activeProjectId: "workspace", isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
    sidebarThreads: { status: "ready", projects: [{ id: "workspace", name: "Project", isPersonal: false, href: "/", settingsHref: "/" }], sections: [], threads: [thread("one")] },
    rpc: { state: () => { throw new Error("Repository RPC must not run"); } },
  });
  cleanup.push(() => slot.lifecycle.unmount());
  await slot.findByText("one");
  expect(slot.queryByLabelText("New folder")).toBeNull();
  expect(slot.inspection.rpcCalls).toEqual([]);
});
it("keeps repository grouping from another project's saved layout out of this project", async () => {
  const foreign = { ...repository, id: "foreign", label: "Other project's repository", path: "/other/repository" };
  localStorage.setItem(`${STORAGE_KEY}:outside`, JSON.stringify({ groupWith: { [repository.id]: foreign } }));
  const slot = await mount();
  expect(slot.queryByText(foreign.label)).toBeNull();
  expect(slot.getByText("sample-app")).toBeTruthy();
});
function drop(source: Element, target: Element, clientY = 20) {
  const data = new Map<string, string>();
  const dataTransfer = { setData: (key: string, value: string) => data.set(key, value), getData: (key: string) => data.get(key) ?? "", types: ["application/x-thread-house"], effectAllowed: "", dropEffect: "" };
  const rect = { x: 0, y: 0, left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40, toJSON() {} };
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect);
  for (const [element, type] of [[source, "dragstart"], [target, "dragover"], [target, "drop"], [source, "dragend"]] as const) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer }); fireEvent(element, event);
  }
}
async function createFolder(slot: Awaited<ReturnType<typeof mount>>, name: string) {
  fireEvent.click(slot.getByLabelText("New folder"));
  fireEvent.change(await slot.findByLabelText("Folder name"), { target: { value: name } });
  fireEvent.click(slot.getByRole("button", { name: "Create" }));
  return (await slot.findByText(name)).closest(".wt-folder")!;
}
it("filters old roots while preserving a recent child's parent, and persists the period", async () => {
  const slot = await mount();
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "1" } });
  await waitFor(() => expect(slot.queryByText("old")).toBeNull());
  expect(slot.getByText("parent")).toBeTruthy(); expect(slot.getByText("child")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}:workspace`)!).period).toBe("1");
});
it("collapses children and navigates through BB with shortcut attributes", async () => {
  const slot = await mount(undefined, undefined, {}, "parent");
  const link = slot.getByText("child").closest("a")!;
  expect(link.getAttribute("data-sidebar-thread-id")).toBe("child");
  fireEvent.click(link);
  expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread" }));
  fireEvent.click(slot.getByLabelText("Collapse parent"));
  expect(slot.queryByText("child")).toBeNull();
});
it.each(["folder", "parent", "project"])("keeps the opened old idle session visible despite Updated and a collapsed %s", async collapsedKind => {
  const key = `repository:workspace:${repository.id}`;
  const collapsed = collapsedKind === "parent" ? [`thread:${key}:parent`]
    : ["folder:custom:work", key, `thread:${key}:parent`, ...(collapsedKind === "project" ? ["project:workspace"] : [])];
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ period: "1", smartExpanded: [], collapsed,
    customFolders: { "custom:work": { projectId: "workspace", label: "Work" } },
    folderParents: { [JSON.stringify(["workspace", repository.id])]: "custom:work" },
  }));
  const slot = await mount(undefined, [thread("parent", { updatedAt: Date.now() - 10 * DAY }),
    thread("opened", { parentThreadId: "parent", updatedAt: Date.now() - 10 * DAY }),
    thread("quiet-child", { parentThreadId: "parent", updatedAt: Date.now() }), thread("other", { updatedAt: Date.now() })], {}, "opened");
  expect(slot.getByText("opened").closest("a")!.getAttribute("aria-current")).toBe("page");
  expect(slot.getByText("parent")).toBeTruthy();
  expect(slot.getByText("parent").closest(".wt-row")!.getAttribute("aria-expanded")).toBe("true");
  if (collapsedKind === "folder") expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("true");
  if (collapsedKind === "project") expect(slot.getByText("workspace").closest("button")!.getAttribute("aria-expanded")).toBe("true");
  expect(slot.queryByText("quiet-child")).toBeNull();
  expect(preferences().collapsed).toEqual(collapsed);
  expect(preferences().period).toBe("1");
});
it("updates the opened session in a collapsed folder when navigation changes", async () => {
  const collapsed = [`repository:workspace:${repository.id}`];
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], collapsed }));
  const slot = await mount(undefined, [thread("first"), thread("second"), thread("quiet")], {}, "first");
  expect(slot.getByText("first")).toBeTruthy(); expect(slot.queryByText("second")).toBeNull();
  slot.lifecycle.rerender(<ThreadHouseList activeThreadId="second" activeProjectId="workspace" isCompactViewport={false} searchQuery="" onNavigate={vi.fn()} />);
  expect(slot.getByText("second").closest("a")!.getAttribute("aria-current")).toBe("page");
  expect(slot.queryByText("first")).toBeNull(); expect(slot.queryByText("quiet")).toBeNull();
  expect(preferences().collapsed).toEqual(collapsed);
});
it.each([false, true])("keeps the opened session visible in another collapsed plain Project with isHidden=%s", async isHidden => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ collapsed: ["project:outside"] }));
  const pluginApp = await loadPluginApp(async () => app);
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId: "opened", activeProjectId: "outside", isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
    settings: { project: "workspace" },
    sidebarThreads: { status: "ready", projects: [{ id: "outside", name: "Other", isPersonal: false, href: "/", settingsHref: "/" }],
      threads: [thread("opened", { projectId: "outside", isHidden }), thread("quiet", { projectId: "outside" })] },
  });
  cleanup.push(() => slot.lifecycle.unmount());
  expect(slot.getByText("opened")).toBeTruthy(); expect(slot.queryByText("quiet")).toBeNull();
  expect(slot.getByText("Other").closest("button")!.getAttribute("aria-expanded")).toBe("true");
});
it("keeps an opened hidden helper session in the repository tree", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], collapsed: [`repository:workspace:${repository.id}`] }));
  const slot = await mount(undefined, [thread("opened-helper", { isHidden: true }), thread("quiet"), thread("other-helper", { isHidden: true })], {}, "opened-helper");
  expect(slot.getByText("opened-helper").closest("a")!.getAttribute("aria-current")).toBe("page");
  expect(slot.queryByText("quiet")).toBeNull(); expect(slot.queryByText("other-helper")).toBeNull();
  expect(slot.inspection.rpcCalls[0].input).toEqual(expect.objectContaining({ threadIds: ["opened-helper", "quiet"], environmentIds: ["env"] }));
});
it("keeps busy threads and BB attention indicators in a collapsed repository folder", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [] }));
  const retained = [
    thread("starting", { status: "starting" }), thread("working", { status: "active" }), thread("stopping", { status: "stopping" }),
    thread("success", { indicator: "unread-success", isUnread: true }), thread("error", { indicator: "unread-error", isUnread: true }),
    thread("waiting", { indicator: "waiting-for-input", hasPendingInteraction: true }),
    thread("failed-send", { indicator: "queued-failed" }), thread("queued", { indicator: "queued-waiting" }),
    thread("background", { indicator: "background-command" }), thread("unread", { isUnread: true }),
  ];
  const slot = await mount(undefined, [...retained, thread("idle"), thread("hidden", { status: "active", isHidden: true })]);
  const ordered = [...slot.container.querySelectorAll("[data-wt-thread-id]")].map(row => row.getAttribute("data-wt-thread-id")).filter(id => id !== "idle");
  fireEvent.click(slot.getByText("sample-app").closest("button")!);
  const folder = slot.getByText("sample-app").closest(".wt-folder")!;
  expect(folder.getAttribute("aria-expanded")).toBe("true");
  expect([...slot.container.querySelectorAll("[data-wt-thread-id]")].map(row => row.getAttribute("data-wt-thread-id"))).toEqual(ordered);
  for (const t of retained.filter(t => t.indicator !== "none")) {
    expect(slot.getByText(t.id).closest(".wt-row")!.querySelector("[data-thread-status-glyph]")?.getAttribute("data-thread-status-glyph")).toBe(t.indicator);
  }
  expect(slot.queryByText("idle")).toBeNull(); expect(slot.queryByText("hidden")).toBeNull();
  fireEvent.click(folder.querySelector(".wt-heading")!);
  expect(slot.getByText("idle")).toBeTruthy();
});
it("does not reopen a collapsed session when its folder peeks at busy work", async () => {
  const key = `repository:workspace:${repository.id}`;
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], collapsed: [`thread:${key}:parent`] }));
  const slot = await mount(undefined, [thread("parent"), thread("middle", { parentThreadId: "parent" }),
    thread("worker", { parentThreadId: "middle", status: "active" }), thread("quiet-child", { parentThreadId: "middle" }), thread("quiet-root")]);
  expect(slot.queryByText("worker")).toBeNull();
  fireEvent.click(slot.getByText("sample-app").closest("button")!);
  const rows = [...slot.container.querySelectorAll("[data-wt-thread-id]")];
  expect(rows.map(row => row.getAttribute("data-wt-thread-id"))).toEqual(["parent"]);
  expect(rows.map(row => row.getAttribute("aria-expanded"))).toEqual(["false"]);
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("true");
  expect(slot.queryByText("quiet-child")).toBeNull(); expect(slot.queryByText("quiet-root")).toBeNull();
  expect(preferences().collapsed).toEqual([`thread:${key}:parent`, key]);
});
it("retains nested folder paths with attention and hides quiet branches under a collapsed category", async () => {
  const repoFolder = JSON.stringify(["workspace", repository.id]);
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], collapsed: ["folder:custom:outer", "folder:custom:inner"],
    customFolders: { "custom:outer": { projectId: "workspace", label: "Work" }, "custom:inner": { projectId: "workspace", label: "Libraries" }, "custom:quiet": { projectId: "workspace", label: "Quiet" } },
    folderParents: { "custom:inner": "custom:outer", [repoFolder]: "custom:inner", "custom:quiet": "custom:outer" },
    threadFolders: { quiet: "custom:quiet" },
  }));
  const slot = await mount(undefined, [thread("notice", { indicator: "unread-success", isUnread: true }), thread("idle"), thread("quiet")]);
  expect(slot.getByText("Work").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("true");
  expect(slot.getByText("Libraries").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("true");
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-level")).toBe("4");
  expect(slot.getByText("notice").closest(".wt-row")!.getAttribute("aria-level")).toBe("5");
  expect(slot.queryByText("Quiet")).toBeNull(); expect(slot.queryByText("quiet")).toBeNull(); expect(slot.queryByText("idle")).toBeNull();
});
it("updates retained rows without reopening a collapsed folder and hides them after work and attention clear", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [] }));
  const threads = [thread("changing"), thread("idle")];
  const slot = await mount(undefined, threads);
  fireEvent.click(slot.getByText("sample-app").closest("button")!);
  expect(slot.queryByText("changing")).toBeNull();
  threads[0] = thread("changing", { status: "active", indicator: "runtime" });
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.getByText("changing")).toBeTruthy();
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("true");
  threads[0] = thread("changing", { indicator: "unread-success", isUnread: true });
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.getByText("changing")).toBeTruthy();
  threads[0] = thread("changing");
  await slot.behavior.emitRealtime("changed", {});
  expect(slot.queryByText("changing")).toBeNull();
  expect(slot.queryByText("idle")).toBeNull();
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("false");
  expect(preferences().collapsed).toEqual([`repository:workspace:${repository.id}`]);
});
it.each(["parent", "worker"])("keeps attention within its folder projection when %s is busy", async busy => {
  const repoFolder = JSON.stringify(["workspace", repository.id]);
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], collapsed: [`repository:workspace:${repository.id}`, "folder:custom:workers"],
    customFolders: { "custom:work": { projectId: "workspace", label: "Work" }, "custom:workers": { projectId: "workspace", label: "Workers" } },
    folderParents: { [repoFolder]: "custom:work", "custom:workers": "custom:work" }, threadFolders: { worker: "custom:workers" },
  }));
  const slot = await mount(undefined, [thread("parent", { status: busy === "parent" ? "active" : "idle" }),
    thread("worker", { parentThreadId: "parent", status: busy === "worker" ? "active" : "idle" })]);
  if (busy === "parent") fireEvent.click(slot.getByText("Work").closest("button")!);
  const parents = slot.container.querySelectorAll('[data-wt-thread-id="parent"]');
  expect(parents).toHaveLength(1);
  expect(parents[0].classList.contains("wt-context")).toBe(busy === "worker");
  if (busy === "worker") {
    expect(slot.getByText("worker")).toBeTruthy();
    expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-expanded")).toBe("false");
  } else {
    expect(slot.queryByText("worker")).toBeNull(); expect(slot.queryByText("Workers")).toBeNull();
  }
});
it("keeps Updated filtering for a busy thread retained only as an old parent", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], period: "1" }));
  const slot = await mount(undefined, [thread("old-busy-parent", { status: "active", updatedAt: Date.now() - 10 * DAY }),
    thread("recent-idle-child", { parentThreadId: "old-busy-parent", updatedAt: Date.now() })]);
  fireEvent.click(slot.getByText("sample-app").closest("button")!);
  expect(slot.queryByText("old-busy-parent")).toBeNull(); expect(slot.queryByText("recent-idle-child")).toBeNull();
});
it("reconciles assignments after a disconnected client reconnects", async () => {
  let state: RepositoryState = { environments: [{ environmentId: "env", repository, error: null }], assignments: [] };
  const slot = await mount(() => state);
  await slot.behavior.setRealtimeConnectionState("reconnecting");
  state = { ...state, assignments: [{ threadId: "parent", repository: { ...repository, id: "other", label: "changed-repository" } }] };
  await slot.behavior.setRealtimeConnectionState("connected");
  expect(await slot.findByText("changed-repository")).toBeTruthy();
});
it("opens a folder context menu and pins only after the user selects Pin folder", async () => {
  const slot = await mount();
  expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}:workspace`)!).folderPins).toEqual([]);
  fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.click(await slot.findByText("Pin folder"));
  expect(await slot.findByLabelText("Pinned folder")).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}:workspace`)!).folderPins).toHaveLength(1);
  fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.click(await slot.findByText("Unpin folder"));
  await waitFor(() => expect(slot.queryByLabelText("Pinned folder")).toBeNull());
  expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}:workspace`)!).folderPins).toEqual([]);
});
it("creates a category, nests a repository by dropping into it, and extracts it with an edge drop", async () => {
  const slot = await mount(); const category = await createFolder(slot, "Libraries");
  const repo = slot.getByText("sample-app").closest(".wt-folder")!;
  drop(repo.querySelector(".wt-heading")!, category);
  expect(preferences().folderParents[repo.getAttribute("data-wt-folder-id")!]).toBe(category.getAttribute("data-wt-folder-id"));
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-level")).toBe("3");
  expect(slot.getByText("Libraries").closest("button")!.querySelector(".wt-count")!.textContent).toBe("3");
  expect(preferences().groupWith).toEqual({}); expect(preferences().folderPins).toEqual([]);
  drop(slot.getByText("sample-app").closest("button")!, slot.getByText("Libraries").closest(".wt-folder")!, 0);
  expect(preferences().folderParents[repo.getAttribute("data-wt-folder-id")!]).toBeUndefined();
  expect(slot.getByText("sample-app").closest(".wt-folder")!.getAttribute("aria-level")).toBe("2");
});
it("drags a thread subtree into a category without changing its repository, and removes only the category", async () => {
  const slot = await mount(); const category = await createFolder(slot, "Active work");
  drop(slot.getByLabelText("Drag to organize parent"), category);
  expect(Object.keys(preferences().threadFolders).sort()).toEqual(["child", "parent"]);
  expect(slot.getByText("child").closest(".wt-row")!.textContent).toContain("sample-app");
  expect(slot.inspection.rpcCalls.some(call => call.method === "assign")).toBe(false);
  fireEvent.contextMenu(slot.getByText("Active work").closest(".wt-folder")!);
  fireEvent.click(await slot.findByText("Remove folder"));
  expect(slot.queryByText("Active work")).toBeNull(); expect(preferences().threadFolders).toEqual({});
  expect(slot.getByText("sample-app").closest("button")!.querySelector(".wt-count")!.textContent).toBe("3");
});
it("reorders sibling threads through drag and keeps children with their parent", async () => {
  const slot = await mount();
  drop(slot.getByLabelText("Drag to organize old"), slot.getByText("parent").closest(".wt-row")!, 0);
  expect([...slot.container.querySelectorAll("[data-wt-thread-id]")].map(e => e.getAttribute("data-wt-thread-id"))).toEqual(["old", "parent", "child"]);
  expect(Object.values(preferences().folderSort)).toEqual(["manual"]);
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "1" } });
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "all" } });
  expect([...slot.container.querySelectorAll("[data-wt-thread-id]")].map(e => e.getAttribute("data-wt-thread-id"))).toEqual(["old", "parent", "child"]);
});
it.each(["Files", "application/x-thread-house"])("ignores an external %s drop after virtualization detached the source of a cancelled drag", async type => {
  const destination = { ...repository, id: "destination", label: "destination", path: "/destination" };
  const targetThread = thread("target"); targetThread.environment = { ...targetThread.environment!, id: "target-env" };
  const sourceThreads = Array.from({ length: 50 }, (_, i) => thread(`source-${String(i).padStart(2, "0")}`));
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null }, { environmentId: "target-env", repository: destination, error: null }], assignments: [] }), [...sourceThreads, targetThread]);
  const source = slot.getByLabelText("Drag to organize source-00");
  const event = (type: string, types: string[]) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: 20 }); Object.defineProperty(event, "dataTransfer", { value: { types, setData: vi.fn(), getData: () => "another-window-drag", effectAllowed: "", dropEffect: "" } }); return event; };
  fireEvent(source, event("dragstart", ["application/x-thread-house"]));
  fireEvent.scroll(slot.container.querySelector(".wt-scroll")!, { target: { scrollTop: 1200 } });
  expect(source.isConnected).toBe(false);
  fireEvent(source, event("dragend", ["application/x-thread-house"]));
  fireEvent.scroll(slot.container.querySelector(".wt-scroll")!, { target: { scrollTop: 0 } });
  const target = slot.getByText("destination").closest(".wt-folder")!;
  fireEvent(target, event("dragover", [type])); fireEvent(target, event("drop", [type]));
  expect(preferences().threadFolders).toEqual({});
});
it("changes Sort by from the folder menu and retains thread hierarchy", async () => {
  const slot = await mount(); fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Sort by"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByRole("menuitemradio", { name: "Title" }));
  expect(Object.values(preferences().folderSort)).toEqual(["title"]);
  expect([...slot.container.querySelectorAll("[data-wt-thread-id]")].map(e => e.getAttribute("data-wt-thread-id"))).toEqual(["old", "parent", "child"]);
});
it("opens the compact folder menu and lets the user sort and group checkouts without Radix submenus", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 767px)", addEventListener() {}, removeEventListener() {} }));
  const clone = { ...repository, id: "clone", label: "release-sample-app", path: "/release" };
  const worker = thread("worker", { parentThreadId: "parent" }); worker.environment = { ...worker.environment!, id: "clone-env" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null }, { environmentId: "clone-env", repository: clone, error: null }], assignments: [] }), [thread("parent"), worker]);
  fireEvent.click(slot.getByLabelText("Folder actions for release-sample-app"));
  expect(await slot.findByText("Pin folder")).toBeTruthy();
  fireEvent.change(await slot.findByLabelText("Folder sort"), { target: { value: "title" } });
  expect(Object.values(preferences().folderSort)).toEqual(["title"]);
  fireEvent.change(slot.getByLabelText("Group with"), { target: { value: repository.id } });
  expect(preferences().groupWith.clone).toEqual(repository);
  fireEvent.click(await slot.findByLabelText("Folder actions for sample-app"));
  fireEvent.change(await slot.findByLabelText("Group with"), { target: { value: "separate" } });
  expect(preferences().groupWith).toEqual({});
  expect(await slot.findByLabelText("Folder actions for release-sample-app")).toBeTruthy();
  expect(preferences().folderPins).toEqual([]);
});
it("merges clones only through Group with and can separate them again", async () => {
  const clone = { ...repository, id: "clone", label: "release-sample-app", path: "/release" };
  const worker = thread("worker", { parentThreadId: "parent" }); worker.environment = { ...worker.environment!, id: "clone-env" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null }, { environmentId: "clone-env", repository: clone, error: null }], assignments: [] }), [thread("parent"), worker]);
  fireEvent.contextMenu(slot.getByText("release-sample-app").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Group with…"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByRole("menuitem", { name: "sample-app" }));
  expect(preferences().groupWith.clone).toEqual(repository);
  expect(slot.queryByLabelText("Folder actions for release-sample-app")).toBeNull();
  expect(slot.getByText("sample-app").closest("button")!.querySelector(".wt-count")!.textContent).toBe("2");
  fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Group with…"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByText("Keep checkouts separate"));
  expect(await slot.findByLabelText("Folder actions for release-sample-app")).toBeTruthy();
  expect(preferences().groupWith).toEqual({});
});
it("automatically groups release clones by origin and preserves checkout labels and separate overrides", async () => {
  const base = { ...repository, origin: "github.com/example/sample-app" };
  const clone = { ...base, id: "clone", label: "release-sample-app", path: "/release" };
  const worker = thread("worker", { parentThreadId: "parent" }); worker.environment = { ...worker.environment!, id: "clone-env", path: clone.path };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository: base, error: null }, { environmentId: "clone-env", repository: clone, error: null }], assignments: [] }), [thread("parent"), worker]);
  expect(slot.queryByLabelText("Folder actions for release-sample-app")).toBeNull();
  expect(slot.getByText("sample-app").closest("button")!.querySelector(".wt-count")!.textContent).toBe("2");
  expect(slot.getByText("worker").closest(".wt-row")!.textContent).toContain("release-sample-app");
  expect(preferences().folderPins).toEqual([]); expect(preferences().groupWith).toEqual({});
  fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Group with…"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByText("Keep checkouts separate"));
  expect(await slot.findByLabelText("Folder actions for release-sample-app")).toBeTruthy();
  fireEvent.contextMenu(slot.getByText("release-sample-app").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Group with…"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByRole("menuitem", { name: "sample-app" }));
  expect(slot.queryByLabelText("Folder actions for release-sample-app")).toBeNull();
  expect(slot.inspection.rpcCalls.some(call => call.method === "assign")).toBe(false);
});
it("keeps saved virtual children under their auto-grouped checkout and restores old thread placements", async () => {
  const base = { ...repository, origin: "github.com/example/sample-app" };
  const clone = { ...base, id: "clone", label: "release-sample-app", path: "/release" };
  const sourceFolder = JSON.stringify(["workspace", clone.id]);
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({
    customFolders: { "custom:saved": { projectId: "workspace", label: "Saved category" } },
    folderParents: { "custom:saved": sourceFolder }, threadFolders: { parent: sourceFolder },
  }));
  const worker = thread("worker", { parentThreadId: "parent" }); worker.environment = { ...worker.environment!, id: "clone-env" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository: base, error: null }, { environmentId: "clone-env", repository: clone, error: null }], assignments: [] }), [thread("parent"), worker]);
  expect(slot.getByText("Saved category").closest(".wt-folder")!.getAttribute("aria-level")).toBe("3");
  fireEvent.contextMenu(slot.getByText("sample-app").closest(".wt-folder")!);
  fireEvent.click(await slot.findByText("Restore thread locations"));
  expect(preferences().threadFolders).toEqual({});
  expect(preferences().folderParents["custom:saved"]).toBe(sourceFolder);
  expect(preferences().folderPins).toEqual([]);
});
it("shows the actual checkout label when only a release clone is available", async () => {
  const clone = { ...repository, label: "release-sample-app", origin: "github.com/example/sample-app" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository: clone, error: null }], assignments: [] }), [thread("task")]);
  expect(slot.getByText("task").closest(".wt-row")!.textContent).toContain("release-sample-app");
  expect(slot.queryByLabelText("Folder actions for release-sample-app")).toBeNull();
});
it("restores thread locations from the destination after merging a manually chosen folder", async () => {
  const source = { ...repository, id: "source", label: "source", path: "/source" };
  const sourceThread = thread("source-thread"); sourceThread.environment = { ...sourceThread.environment!, id: "source-env" };
  const destination = thread("destination-thread"); destination.environment = { ...destination.environment!, id: "destination-env" };
  const other = { ...repository, id: "destination", label: "destination", path: "/destination" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null }, { environmentId: "source-env", repository: source, error: null }, { environmentId: "destination-env", repository: other, error: null }], assignments: [] }), [thread("task"), sourceThread, destination]);
  drop(slot.getByLabelText("Drag to organize task"), slot.getByText("source").closest(".wt-folder")!);
  fireEvent.contextMenu(slot.getByText("source").closest(".wt-folder")!);
  fireEvent.keyDown(await slot.findByText("Group with…"), { key: "ArrowRight" });
  fireEvent.click(await slot.findByRole("menuitem", { name: "destination" }));
  fireEvent.contextMenu(slot.getByText("destination").closest(".wt-folder")!);
  fireEvent.click(await slot.findByText("Restore thread locations"));
  expect(preferences().threadFolders).toEqual({});
  expect(slot.getByText("sample-app").closest("button")!.querySelector(".wt-count")!.textContent).toBe("1");
});
it("shows Needs input with waiting children and Recent with roots and aggregate activity only", async () => {
  const slot = await mount(undefined, [thread("task", { updatedAt: 1 }), thread("waiting-worker", { parentThreadId: "task", hasPendingInteraction: true }), thread("running-worker", { parentThreadId: "task", status: "active" })]);
  expect(slot.getByText("Needs input").closest("button")!.querySelector(".wt-count")!.textContent).toBe("1");
  expect([...slot.container.querySelectorAll('[data-wt-smart-view="input"] [data-wt-thread-id]')].map(e => e.getAttribute("data-wt-thread-id"))).toEqual(["task", "waiting-worker"]);
  fireEvent.click(slot.getByText("Recent"));
  const recent = [...slot.container.querySelectorAll('[data-wt-smart-view="recent"] [data-wt-thread-id]')];
  expect(recent.map(e => e.getAttribute("data-wt-thread-id"))).toEqual(["task"]);
  expect(recent[0].textContent).toContain("1 need input · 1 running");
  const targets = [...slot.container.querySelectorAll("[data-sidebar-thread-shortcut-target]")].map(e => e.getAttribute("data-sidebar-thread-id"));
  expect(new Set(targets).size).toBe(targets.length);
});
it("shows mixed-repository children in their own groups with independently collapsible parent copies", async () => {
  const workspace = { ...repository, id: "workspace/.git", label: "workspace-repository" };
  const ati = { ...repository, id: "ati-agents/.git", label: "ati-agents" };
  const worker = thread("worker", { parentThreadId: "orchestrator" });
  worker.environment = { ...worker.environment!, id: "pb-env" };
  const reviewer = thread("reviewer", { parentThreadId: "orchestrator" });
  reviewer.environment = { ...reviewer.environment!, id: "ati-env" };
  const errors = vi.spyOn(console, "error");
  cleanup.push(() => errors.mockRestore());
  const slot = await mount(() => ({
    environments: [{ environmentId: "env", repository: workspace, error: null }, { environmentId: "pb-env", repository, error: null }, { environmentId: "ati-env", repository: ati, error: null }], assignments: [],
  }), [thread("orchestrator"), worker, reviewer], { orchestrator: { label: "⌘1", ariaKeyshortcuts: "Meta+1" } });
  for (const label of ["workspace-repository", "sample-app", "ati-agents"]) {
    expect(slot.getAllByText(label).find(element => element.closest("button"))!.closest("button")!.querySelector(".wt-count")!.textContent).toBe("1");
  }
  expect(slot.getByText("workspace").closest("button")!.querySelector(".wt-count")!.textContent).toBe("3");
  expect(slot.getAllByText("orchestrator")).toHaveLength(3);
  expect(slot.getAllByText("orchestrator").filter(element => element.closest("a")!.hasAttribute("data-sidebar-thread-shortcut-target"))).toHaveLength(1);
  expect(slot.container.querySelectorAll('[data-sidebar-thread-id="orchestrator"]')).toHaveLength(1);
  expect(slot.getAllByText("⌘1")).toHaveLength(1);
  fireEvent.click(slot.getAllByText("orchestrator")[2].closest("a")!);
  expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread" }));
  expect(slot.getAllByLabelText("Collapse orchestrator")).toHaveLength(2);
  fireEvent.click(slot.getByText("worker").closest(".wt-positioned")!.previousElementSibling!.querySelector('button[aria-label="Collapse orchestrator"]')!);
  expect(slot.queryByText("worker")).toBeNull();
  expect(slot.getByText("reviewer")).toBeTruthy();
  expect(slot.getByLabelText("Collapse orchestrator")).toBeTruthy();
  fireEvent.click(slot.getByLabelText("Expand orchestrator"));
  expect(slot.getByText("worker")).toBeTruthy();
  fireEvent.scroll(slot.container.querySelector(".wt-scroll")!, { target: { scrollTop: 400 } });
  expect(slot.getAllByText("orchestrator").length).toBeGreaterThan(0);
  expect(slot.container.querySelectorAll('[data-sidebar-thread-id="orchestrator"]')).toHaveLength(1);
  expect(slot.getAllByText("⌘1")).toHaveLength(1);
  expect(errors.mock.calls.flat().some(value => String(value).includes("same key"))).toBe(false);
});
it("renders foreign parent copies as compact links without metadata or selected state", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [] }));
  const other = { ...repository, id: "other", label: "other-repo" };
  const worker = thread("worker", { parentThreadId: "parent" });
  worker.environment = { ...worker.environment!, id: "other-env" };
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null },
    { environmentId: "other-env", repository: other, error: null }], assignments: [] }), [thread("parent"), worker], {}, "parent");
  const parents = slot.getAllByText("parent").map(element => element.closest<HTMLElement>(".wt-row")!);
  const own = parents.find(row => !row.classList.contains("wt-context"))!;
  const copy = parents.find(row => row.classList.contains("wt-context"))!;
  expect(own.classList.contains("wt-selected")).toBe(true);
  expect(own.querySelector(".wt-location")?.textContent).toBe("main");
  expect(copy.classList.contains("wt-compact")).toBe(true);
  expect(copy.classList.contains("wt-selected")).toBe(false);
  expect(copy.querySelector("[aria-current]")).toBeNull();
  expect(copy.querySelector(".wt-location")).toBeNull();
  expect(own.querySelector("[data-sidebar-thread-shortcut-target]")).toBeTruthy();
  expect(copy.querySelector("[data-sidebar-thread-shortcut-target]")).toBeNull();
  expect(copy.closest<HTMLElement>(".wt-positioned")!.style.height).toBe("28px");
  fireEvent.click(copy.querySelector("a")!);
  expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread", threadId: "parent" }));
  fireEvent.click(copy.querySelector('button[aria-label="Collapse parent"]')!);
  expect(slot.queryByText("worker")).toBeNull();
  expect(slot.getByLabelText("Expand parent")).toBeTruthy();
});
it("keeps a filtered parent in its own repository as a full row", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [], period: "1" }));
  const slot = await mount(undefined, [thread("parent", { updatedAt: Date.now() - 10 * DAY }),
    thread("worker", { updatedAt: Date.now(), parentThreadId: "parent" })]);
  const row = slot.getByText("parent").closest(".wt-row")!;
  expect(row.classList.contains("wt-context")).toBe(true);
  expect(row.classList.contains("wt-compact")).toBe(false);
  expect(row.querySelector(".wt-location")?.textContent).toBe("main · Parent");
});
it.each(["workspace", "personal"])("omits machine names from %s thread rows", async projectId => {
  const pluginApp = await loadPluginApp(async () => app);
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId: "task", activeProjectId: projectId, isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
    settings: { project: "workspace" },
    sidebarThreads: { status: "ready", projects: [{ id: projectId, name: projectId, isPersonal: projectId === "personal", href: "/", settingsHref: "/" }], sections: [],
      threads: [thread("task", { projectId, host: { id: "host", name: "MacBook Pro — Павел" }, environment: projectId === "personal" ? null : thread("task").environment })] },
    rpc: { state: () => ({ environments: [{ environmentId: "env", repository, error: null }], assignments: [] }) },
  });
  cleanup.push(() => slot.lifecycle.unmount());
  const row = (await slot.findByText("task")).closest(".wt-row")!;
  expect(row.textContent).not.toContain("MacBook Pro — Павел");
  expect(row.querySelector(".wt-location")?.textContent ?? "").toBe(projectId === "personal" ? "" : "main");
});
it.each([true, false, null])("marks worktree sessions only when isWorktree=%s is true", async isWorktree => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [] }));
  const task = thread("task"); task.environment = { ...task.environment!, isWorktree, path: "/worktrees/task" };
  const slot = await mount(undefined, [task]);
  const icon = slot.getByText("task").closest(".wt-row")!.querySelector('[aria-label="Git worktree"]');
  if (isWorktree) { expect(icon).toBeTruthy(); expect(icon!.getAttribute("title")).toBe("Git worktree"); }
  else expect(icon).toBeNull();
});
it("positions mixed-height rows without gaps and reaches the final worker when scrolling", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ smartExpanded: [] }));
  const now = Date.now();
  const workers = Array.from({ length: 30 }, (_, i) => {
    const worker = thread(`worker-${i}`, { parentThreadId: "parent", updatedAt: now - (i + 1) * 1000 });
    worker.environment = { ...worker.environment!, id: `env-${i}` }; return worker;
  });
  const slot = await mount(() => ({ environments: [{ environmentId: "env", repository, error: null },
    ...workers.map((worker, i) => ({ environmentId: worker.environment!.id!, repository: { ...repository, id: `repo-${i}`, label: `repo-${i}` }, error: null }))], assignments: [] }),
    [thread("parent", { updatedAt: now }), ...workers], {}, "parent");
  const tree = slot.getByRole("tree");
  const height = 5 * 40 + 30 * (40 + 28 + 40);
  expect(tree.style.height).toBe(`${height}px`);
  fireEvent.scroll(slot.container.querySelector(".wt-scroll")!, { target: { scrollTop: height - 600 } });
  const last = slot.getByText("worker-29").closest<HTMLElement>(".wt-positioned")!;
  expect(last.style.top).toBe(`${height - 40}px`);
  const positioned = [...tree.querySelectorAll<HTMLElement>(".wt-positioned")];
  expect(positioned.some(row => row.style.height === "28px")).toBe(true);
  for (let i = 1; i < positioned.length; i++) {
    expect(Number.parseInt(positioned[i - 1].style.top) + Number.parseInt(positioned[i - 1].style.height)).toBe(Number.parseInt(positioned[i].style.top));
  }
});
const renderedThreads = (slot: Awaited<ReturnType<typeof mount>>) => [...slot.container.querySelectorAll("[data-wt-thread-id]")].map(e => e.getAttribute("data-wt-thread-id"));
it("shows a thread created after a manual order above it and keeps it there when a sibling moves", async () => {
  const folder = JSON.stringify(["workspace", repository.id]);
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ folderSort: { [folder]: "manual" }, threadOrder: { [JSON.stringify([folder, null])]: ["old", "parent"] } }));
  const slot = await mount(undefined, [thread("parent"), thread("old"), thread("fresh")]);
  expect(renderedThreads(slot)).toEqual(["fresh", "old", "parent"]);
  drop(slot.getByLabelText("Drag to organize parent"), slot.getByText("old").closest(".wt-row")!, 0);
  expect(renderedThreads(slot)).toEqual(["fresh", "parent", "old"]);
});
it("saves siblings hidden by Updated when reordering, so they do not count as new later", async () => {
  const now = Date.now();
  const slot = await mount(undefined, [thread("first", { updatedAt: now }), thread("second", { updatedAt: now - 1000 }), thread("stale", { updatedAt: now - 10 * DAY })]);
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "1" } });
  expect(renderedThreads(slot)).toEqual(["first", "second"]);
  drop(slot.getByLabelText("Drag to organize second"), slot.getByText("first").closest(".wt-row")!, 0);
  expect(Object.values(preferences().threadOrder)).toEqual([["second", "first", "stale"]]);
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "all" } });
  expect(renderedThreads(slot)).toEqual(["second", "first", "stale"]);
});
it("keeps a child created after its parent was moved in the parent's virtual folder", async () => {
  localStorage.setItem(`${STORAGE_KEY}:workspace`, JSON.stringify({ customFolders: { "custom:active": { projectId: "workspace", label: "Active work" } }, threadFolders: { parent: "custom:active" } }));
  const slot = await mount();
  expect(slot.getByText("Active work").closest("button")!.querySelector(".wt-count")!.textContent).toBe("2");
  expect(slot.getByText("sample-app").closest("button")!.querySelector(".wt-count")!.textContent).toBe("1");
  expect(renderedThreads(slot)).toEqual(["parent", "child", "old"]);
  expect(preferences().threadFolders).toEqual({ parent: "custom:active" });
});
it("adopts a layout saved by another window instead of overwriting it", async () => {
  const slot = await mount(); const key = `${STORAGE_KEY}:workspace`;
  const saved = JSON.stringify({ customFolders: { "custom:other": { projectId: "workspace", label: "From another window" } } });
  localStorage.setItem(key, saved);
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key, newValue: saved })); });
  expect(slot.getByText("From another window")).toBeTruthy();
  expect(localStorage.getItem(key)).toBe(saved);
  fireEvent.change(slot.getByLabelText("Activity period"), { target: { value: "7" } });
  expect(preferences()).toEqual(expect.objectContaining({ period: "7", customFolders: { "custom:other": { projectId: "workspace", label: "From another window" } } }));
});
