// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import app from "./app";
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
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); vi.unstubAllGlobals(); });
async function mount(stateProvider?: () => RepositoryState, threads?: ReturnType<typeof thread>[], sidebarShortcuts = {}) {
  const pluginApp = await loadPluginApp(async () => app);
  const now = Date.now();
  const slot = renderSlot(pluginApp.threadLists[0], { activeThreadId: "child", activeProjectId: "workspace", isCompactViewport: false, searchQuery: "", onNavigate: vi.fn() }, {
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
  const slot = await mount();
  const link = slot.getByText("child").closest("a")!;
  expect(link.getAttribute("data-sidebar-thread-id")).toBe("child");
  fireEvent.click(link);
  expect(slot.inspection.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread" }));
  fireEvent.click(slot.getByLabelText("Collapse parent"));
  expect(slot.queryByText("child")).toBeNull();
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
