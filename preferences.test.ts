import { describe, expect, it } from "vitest";
import { buildGroups } from "./model";
import { folderKey, moveOrder, orderedTree, parsePreferences, siblingKey } from "./preferences";
import { buildFolderTree } from "./folders";
import { NOW, repository, thread } from "./test-fixtures";

const groups = () => buildGroups([
  thread("a", { updatedAt: NOW - 2, createdAt: NOW, displayTitle: "Alpha" }),
  thread("b", { updatedAt: NOW, createdAt: 1, displayTitle: "Bravo" }),
  thread("c", { updatedAt: NOW - 1, isPinned: true, displayTitle: "Charlie" }),
], new Map([["env", repository]]), new Map(), "all", NOW);
describe("sidebar layout preferences", () => {
  it("keeps old preferences and defaults to no folder pins or links", () => {
    const prefs = parsePreferences({ period: "3", collapsed: ["old-key"] });
    expect(prefs.period).toBe("3"); expect(prefs.collapsed).toEqual(["old-key"]);
    expect(prefs.folderPins).toEqual([]); expect(prefs.groupWith).toEqual({});
  });
  it("rejects invalid persisted values", () => {
    expect(parsePreferences({ folderSort: { example: "random" } }).folderSort).toEqual({});
    expect(parsePreferences({ groupWith: { example: { label: "missing-fields" } } }).groupWith).toEqual({});
  });
  it.each([
    ["updated", ["b", "c", "a"]], ["created", ["a", "c", "b"]],
    ["title", ["a", "b", "c"]], ["pinned", ["c", "b", "a"]],
  ] as const)("sorts siblings by %s", (mode, expected) => {
    const group = groups()[0]; const key = folderKey(group); const prefs = parsePreferences(null);
    prefs.folderSort[key] = mode;
    expect(orderedTree(group.roots, key, prefs).map(n => n.thread.id)).toEqual(expected);
  });
  it("applies manual order within each parent without moving children between parents", () => {
    const group = buildGroups([thread("root"), thread("a", { parentThreadId: "root" }), thread("b", { parentThreadId: "root" }), thread("other")], new Map([["env", repository]]), new Map(), "all", NOW)[0];
    const key = folderKey(group); const prefs = parsePreferences(null);
    prefs.folderSort[key] = "manual";
    prefs.threadOrder[siblingKey(key, null)] = ["other", "root"];
    prefs.threadOrder[siblingKey(key, "root")] = ["b", "a"];
    const roots = orderedTree(group.roots, key, prefs);
    expect(roots.map(n => n.thread.id)).toEqual(["other", "root"]);
    expect(roots[1].children.map(n => n.thread.id)).toEqual(["b", "a"]);
  });
  it("keeps keyed pins before unkeyed pins and sorts unkeyed pins by pin time", () => {
    const group = buildGroups([thread("keyed", { isPinned: true, pinSortKey: "a", updatedAt: 1 }),
      thread("new-pin", { isPinned: true, pinnedAt: NOW }), thread("old-pin", { isPinned: true, pinnedAt: 1 })], new Map([["env", repository]]), new Map(), "all", NOW)[0];
    const key = folderKey(group); const prefs = parsePreferences(null); prefs.folderSort[key] = "pinned";
    expect(orderedTree(group.roots, key, prefs).map(n => n.thread.id)).toEqual(["keyed", "new-pin", "old-pin"]);
  });
  it("keeps pinned folders first and honors the saved order of unpinned folders", () => {
    const folders = ["a", "b", "c"].map((id, i) => ({ ...groups()[0], repository: { ...repository, id }, updatedAt: NOW + i }));
    const prefs = parsePreferences(null);
    prefs.folderOrder.workspace = [folderKey(folders[0]), folderKey(folders[2]), folderKey(folders[1])];
    prefs.folderPins = [folderKey(folders[1])];
    expect(buildFolderTree(folders, folders, prefs, "workspace").map(g => g.repository?.id)).toEqual(["b", "a", "c"]);
  });
  it("moves a filtered sibling without losing the saved position of hidden siblings", () => {
    expect(moveOrder(["a", "hidden", "b", "c"], ["a", "b", "c"], "c", "a")).toEqual(["c", "a", "hidden", "b"]);
    expect(moveOrder([], ["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"]);
    expect(moveOrder(["a", "b"], ["a", "b"], "foreign-child", "a")).toEqual(["a", "b"]);
  });
});
