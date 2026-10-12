import { describe, expect, it } from "vitest";
import { buildGroups } from "./model";
import { buildFolderTree, moveFolder, removeFolder } from "./folders";
import { folderKey, parsePreferences } from "./preferences";
import { NOW, repository, thread } from "./test-fixtures";

const group = () => buildGroups([thread("a"), thread("child", { parentThreadId: "a" })], new Map([["env", repository]]), new Map(), "all", NOW)[0];
describe("virtual folder tree", () => {
  it("nests repositories and categories without duplicating thread counts", () => {
    const prefs = parsePreferences(null); const repo = group();
    prefs.customFolders.library = { projectId: "workspace", label: "Libraries" };
    prefs.customFolders.tools = { projectId: "workspace", label: "Tools" };
    prefs.folderParents.tools = "library"; prefs.folderParents[folderKey(repo)] = "tools";
    const roots = buildFolderTree([repo], [repo], prefs, "workspace");
    expect(roots).toHaveLength(1); expect(roots[0].count).toBe(2);
    expect(roots[0].children[0].children[0].repository).toEqual(repository);
    expect(roots[0].children[0].children[0].group?.roots[0].children[0].thread.id).toBe("child");
  });
  it("retains a repository parent when its own threads are filtered out", () => {
    const repo = group(); const child = { ...repo, repository: { ...repository, id: "child-repo", label: "child-repo" }, count: 1 };
    const prefs = parsePreferences(null); prefs.folderParents[folderKey(child)] = folderKey(repo);
    const roots = buildFolderTree([child], [repo, child], prefs, "workspace");
    expect(roots[0].group).toBeUndefined(); expect(roots[0].count).toBe(1);
    expect(roots[0].children[0].group).toBe(child);
  });
  it("keeps nested categories with the destination after merging repository groups", () => {
    const repo = group(); const clone = { ...repository, id: "clone", label: "release" };
    const prefs = parsePreferences({ customFolders: { child: { projectId: "workspace", label: "Child" } },
      folderParents: { child: JSON.stringify(["workspace", clone.id]) }, groupWith: { [clone.id]: repository } });
    const roots = buildFolderTree([repo], [repo], prefs, "workspace");
    expect(roots).toHaveLength(1); expect(roots[0].children[0].id).toBe("child");
  });
  it("refuses nesting into self, a descendant, or another BB project", () => {
    const prefs = parsePreferences({ customFolders: { a: { projectId: "workspace", label: "A" }, b: { projectId: "workspace", label: "B" }, remote: { projectId: "other", label: "Other" } }, folderParents: { b: "a" } });
    const roots = buildFolderTree([], [], prefs, "workspace");
    expect(moveFolder(prefs, roots, "a", "a", "inside")).toBeNull();
    expect(moveFolder(prefs, roots, "a", "b", "inside")).toBeNull();
    expect(moveFolder(prefs, roots, "a", "remote", "inside")).toBeNull();
    expect(buildFolderTree([], [], parsePreferences({ ...prefs, folderParents: { a: "b", b: "a" } }), "workspace")).toHaveLength(2);
  });
  it("moves a nested folder between root folders and preserves their order", () => {
    const prefs = parsePreferences({ customFolders: { a: { projectId: "workspace", label: "A" }, b: { projectId: "workspace", label: "B" }, c: { projectId: "workspace", label: "C" } }, folderParents: { c: "a" } });
    const moved = moveFolder(prefs, buildFolderTree([], [], prefs, "workspace"), "c", "b", "before")!;
    expect(moved.folderParents.c).toBeUndefined();
    expect(buildFolderTree([], [], moved, "workspace").map(n => n.id)).toEqual(["a", "c", "b"]);
  });
  it("keeps pins among siblings and does not change pin state while moving", () => {
    const prefs = parsePreferences({ customFolders: { a: { projectId: "workspace", label: "A" }, b: { projectId: "workspace", label: "B" } }, folderPins: ["a"] });
    const roots = buildFolderTree([], [], prefs, "workspace");
    expect(moveFolder(prefs, roots, "b", "a", "before")).toBeNull();
    expect(moveFolder(prefs, roots, "a", "b", "inside")!.folderPins).toEqual(["a"]);
  });
  it("removes only a category, returning its child folders and threads to the remaining layout", () => {
    const prefs = parsePreferences({ customFolders: { a: { projectId: "workspace", label: "A" }, b: { projectId: "workspace", label: "B" } }, folderParents: { b: "a" }, threadFolders: { thread: "a" }, folderPins: ["a"] });
    const result = removeFolder(prefs, "a");
    expect(result.customFolders.a).toBeUndefined(); expect(result.customFolders.b).toBeTruthy();
    expect(result.folderParents.b).toBeUndefined(); expect(result.threadFolders.thread).toBeUndefined();
    expect(result.folderPins).toEqual([]);
  });
});
