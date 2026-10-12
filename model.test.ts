import { describe, expect, it } from "vitest";
import { buildGroups, groupedRepository, repositoryLinks, type Period } from "./model";
import { DAY, NOW, repository, thread } from "./test-fixtures";

const environments = new Map([["env", repository]]);
const assignments = new Map();
describe("automatic origin grouping", () => {
  const base = { ...repository, origin: "github.com/example/sample-app" };
  const clone = { ...base, id: "clone", label: "release-sample-app", path: "/sandbox/release-sample-app" };
  it("chooses the repository-named checkout independently of input order", () => {
    for (const input of [[clone, base], [base, clone]]) {
      const links = repositoryLinks(input);
      expect(groupedRepository(clone, links)).toEqual(base);
      const groups = buildGroups([thread("root"), thread("worker", { parentThreadId: "root", environment: { ...thread("worker").environment!, id: "clone" } })], new Map([["env", base], ["clone", clone]]), assignments, "all", NOW, links);
      expect(groups).toHaveLength(1); expect(groups[0].count).toBe(2);
      expect(groups[0].roots[0].children[0].repository).toEqual(clone);
    }
  });
  it("names the group after origin even when only release clones are available", () => {
    expect(groupedRepository(clone, repositoryLinks([clone]))).toEqual({ ...clone, label: "sample-app" });
  });
  it("does not conflate machines, different origin namespaces, or origin-less repositories", () => {
    const otherHost = { ...clone, id: "other-host", hostId: "other-host" };
    const otherOrigin = { ...base, id: "other-origin", origin: "git.example.com/other/sample-app" };
    const noOrigin = { ...repository, id: "no-origin" };
    const links = repositoryLinks([base, clone, otherHost, otherOrigin, noOrigin]);
    expect(groupedRepository(otherHost, links)?.id).toBe(otherHost.id);
    expect(groupedRepository(otherOrigin, links)?.id).toBe(otherOrigin.id);
    expect(groupedRepository(noOrigin, links)).toBe(noOrigin);
  });
  it("keeps BB projects separate even when their clones share an origin", () => {
    const groups = buildGroups([thread("a"), thread("b", { projectId: "other-project", environment: { ...thread("b").environment!, id: "clone" } })], new Map([["env", base], ["clone", clone]]), assignments, "all", NOW, repositoryLinks([base, clone]));
    expect(groups.map(g => [g.projectId, g.repository?.id, g.count])).toEqual([["workspace", base.id, 1], ["other-project", base.id, 1]]);
  });
  it("lets explicit separation and merging override automatic grouping", () => {
    const separated = new Map([[base.id, base], [clone.id, clone]]);
    expect(groupedRepository(clone, repositoryLinks([base, clone], separated))).toEqual(clone);
    separated.set(clone.id, base);
    expect(groupedRepository(clone, repositoryLinks([base, clone], separated))).toEqual(base);
  });
  it("retains an old manual merge into a release checkout without introducing an automatic cycle", () => {
    const links = repositoryLinks([base, clone], new Map([[base.id, clone]]));
    expect(groupedRepository(base, links)?.id).toBe(clone.id);
    expect(groupedRepository(clone, links)?.id).toBe(clone.id);
    expect(groupedRepository(base, links)?.label).toBe("sample-app");
  });
  it("retains a manually chosen clone destination even when the canonical checkout has no override", () => {
    const third = { ...clone, id: "acceptance", label: "release-pb-acceptance" };
    const links = repositoryLinks([base, clone, third], new Map([[third.id, clone]]));
    expect([base, clone, third].map(repository => groupedRepository(repository, links)?.id)).toEqual([clone.id, clone.id, clone.id]);
  });
  it("does not introduce cycles through manual links between two origin groups", () => {
    const other = { ...base, id: "other", label: "ati-agents", origin: "git.example.com/agent-workspace/ati-agents" };
    const otherClone = { ...other, id: "other-clone", label: "release-ati-agents" };
    const links = repositoryLinks([base, clone, other, otherClone], new Map([[base.id, otherClone], [other.id, clone]]));
    const targets = [base, clone, other, otherClone].map(repository => groupedRepository(repository, links)?.id);
    expect(new Set(targets).size).toBe(1);
  });
});
describe("repository thread tree and last-update filter", () => {
  it.each(["1", "3", "7"] as Period[])("includes the exact %s-day boundary and excludes older updates", (period) => {
    const cutoff = NOW - Number(period) * DAY;
    const groups = buildGroups([thread("boundary", { updatedAt: cutoff }), thread("older", { updatedAt: cutoff - 1 })], environments, assignments, period, NOW);
    expect(groups.flatMap(g => g.roots.map(n => n.thread.id))).toEqual(["boundary"]);
  });
  it("All includes old threads", () => {
    expect(buildGroups([thread("old", { updatedAt: 1 })], environments, assignments, "all", NOW)[0].count).toBe(1);
  });
  it("preserves every ancestor of a recent child, without unrelated old siblings", () => {
    const groups = buildGroups([
      thread("root", { updatedAt: 1 }),
      thread("parent", { parentThreadId: "root", updatedAt: 1 }),
      thread("child", { parentThreadId: "parent" }),
      thread("sibling", { parentThreadId: "root", updatedAt: 1 }),
    ], environments, assignments, "1", NOW);
    expect(groups[0].count).toBe(3);
    expect(groups[0].roots[0].contextOnly).toBe(true);
    expect(groups[0].roots[0].children.map(n => n.thread.id)).toEqual(["parent"]);
    expect(groups[0].roots[0].children[0].children[0].thread.id).toBe("child");
  });
  it("does not reintroduce hidden internal parents", () => {
    const groups = buildGroups([thread("hidden", { isHidden: true }), thread("child", { parentThreadId: "hidden" })], environments, assignments, "all", NOW);
    expect(groups[0].roots.map(n => n.thread.id)).toEqual(["child"]);
    expect(groups[0].count).toBe(1);
  });
  it("merges different environments of the same repository", () => {
    const envs = new Map([["env", repository], ["worktree", repository]]);
    const worktree = thread("worker");
    worktree.environment!.id = "worktree";
    expect(buildGroups([thread("root"), worktree], envs, assignments, "all", NOW)).toHaveLength(1);
  });
  it("explicit assignment overrides the environment and passes to children in that environment", () => {
    const workspace = { ...repository, id: "workspace/.git", label: "workspace" };
    const groups = buildGroups([thread("root"), thread("child", { parentThreadId: "root" })], new Map([["env", workspace]]), new Map([["root", repository]]), "all", NOW);
    expect(groups[0].repository).toEqual(repository);
    expect(groups[0].roots[0].children[0].repository).toEqual(repository);
  });
  it("groups a child by its own repository and retains its parent as context", () => {
    const other = { ...repository, id: "other/.git", label: "other" };
    const child = thread("child", { parentThreadId: "root" });
    child.environment = { ...child.environment!, id: "other-env", path: "/other" };
    const groups = buildGroups([thread("root"), child], new Map([["env", repository], ["other-env", other]]), assignments, "all", NOW);
    const parentGroup = groups.find(g => g.repository?.id === repository.id)!;
    const childGroup = groups.find(g => g.repository?.id === other.id)!;
    expect(parentGroup.roots[0].children).toEqual([]);
    expect(childGroup.count).toBe(1);
    expect(childGroup.roots[0].contextOnly).toBe(true);
    expect(childGroup.roots[0].children[0].repository).toEqual(other);
    expect(childGroup.roots[0].children[0].contextOnly).toBe(false);
  });
  it("keeps a child in a non-Git environment unassigned", () => {
    const child = thread("child", { parentThreadId: "root" });
    child.environment = { ...child.environment!, id: "non-git", path: "/tmp/non-git" };
    const groups = buildGroups([thread("root"), child], new Map([["env", repository], ["non-git", null]]), assignments, "all", NOW);
    const group = groups.find(g => g.repository === null)!;
    expect(group.count).toBe(1);
    expect(group.roots[0].contextOnly).toBe(true);
    expect(group.roots[0].children[0].repository).toBeNull();
  });
  it("separates a workspace orchestrator, Promptobus worker and ATI reviewer without counting parent copies", () => {
    const workspace = { ...repository, id: "workspace/.git", label: "workspace" };
    const ati = { ...repository, id: "ati-agents/.git", label: "ati-agents" };
    const worker = thread("worker", { parentThreadId: "orchestrator", updatedAt: NOW - 1 });
    worker.environment = { ...worker.environment!, id: "pb-env" };
    const reviewer = thread("reviewer", { parentThreadId: "orchestrator", updatedAt: NOW - 2 });
    reviewer.environment = { ...reviewer.environment!, id: "ati-env" };
    const groups = buildGroups([thread("orchestrator"), worker, reviewer], new Map([["env", workspace], ["pb-env", repository], ["ati-env", ati]]), assignments, "all", NOW);
    expect(groups.map(g => [g.repository?.label, g.count, g.updatedAt])).toEqual([
      ["workspace", 1, NOW], ["sample-app", 1, NOW - 1], ["ati-agents", 1, NOW - 2],
    ]);
    expect(groups[0].roots[0].children).toEqual([]);
    expect(groups[1].roots[0].children.map(n => n.thread.id)).toEqual(["worker"]);
    expect(groups[2].roots[0].children.map(n => n.thread.id)).toEqual(["reviewer"]);
    expect(groups.slice(1).every(g => g.roots[0].contextOnly)).toBe(true);
    expect(groups.reduce((count, g) => count + g.count, 0)).toBe(3);
  });
  it("preserves an intermediate parent in another repository when a grandchild returns to the first", () => {
    const other = { ...repository, id: "other/.git", label: "other" };
    const parent = thread("parent", { parentThreadId: "root" });
    parent.environment = { ...parent.environment!, id: "other-env" };
    const groups = buildGroups([thread("root"), parent, thread("child", { parentThreadId: "parent" })], new Map([["env", repository], ["other-env", other]]), assignments, "all", NOW);
    const group = groups.find(g => g.repository?.id === repository.id)!;
    expect(group.count).toBe(2);
    expect(group.roots[0].contextOnly).toBe(false);
    expect(group.roots[0].children[0].contextOnly).toBe(true);
    expect(group.roots[0].children[0].children[0].contextOnly).toBe(false);
  });
  it("keeps only recent cross-repository descendants and their ancestors", () => {
    const other = { ...repository, id: "other/.git", label: "other" };
    const child = thread("child", { parentThreadId: "root" });
    child.environment = { ...child.environment!, id: "other-env" };
    const sibling = thread("old-sibling", { parentThreadId: "root", updatedAt: 1 });
    sibling.environment = { ...sibling.environment!, id: "other-env" };
    const groups = buildGroups([thread("root", { updatedAt: 1 }), child, sibling], new Map([["env", repository], ["other-env", other]]), assignments, "1", NOW);
    expect(groups.reduce((count, g) => count + g.count, 0)).toBe(2);
    const group = groups.find(g => g.repository?.id === other.id)!;
    expect(group.roots[0].contextOnly).toBe(true);
    expect(group.roots[0].children.map(n => n.thread.id)).toEqual(["child"]);
  });
  it("keeps BB projects separate even when they share a repository", () => {
    expect(buildGroups([thread("a"), thread("b", { projectId: "other" })], environments, assignments, "all", NOW)).toHaveLength(2);
  });
  it("orders root trees by their latest descendant update", () => {
    const groups = buildGroups([thread("old-root", { updatedAt: 1 }), thread("child", { parentThreadId: "old-root" }), thread("other", { updatedAt: NOW - 1 })], environments, assignments, "all", NOW);
    expect(groups[0].roots.map(n => n.thread.id)).toEqual(["old-root", "other"]);
  });
  it("shows an unknown environment as Unassigned", () => {
    expect(buildGroups([thread("a")], new Map(), assignments, "all", NOW)[0].repository).toBeNull();
  });
  it("groups explicitly linked clones together while preserving their actual checkout", () => {
    const clone = { ...repository, id: "release/.git", label: "release-sample-app", path: "/release" };
    const child = thread("child", { parentThreadId: "root" });
    child.environment = { ...child.environment!, id: "release-env" };
    const groups = buildGroups([thread("root"), child], new Map([["env", repository], ["release-env", clone]]), assignments, "all", NOW, new Map([[clone.id, repository]]));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].repositories.map(r => r.id)).toEqual([repository.id, clone.id]);
    expect(groups[0].roots[0].children[0].repository).toEqual(clone);
    expect(groups[0].roots[0].children[0].contextOnly).toBe(false);
  });
  it("follows grouping links without merging machines or hanging on a cycle", () => {
    const clone = { ...repository, id: "release/.git", label: "release" };
    const other = { ...repository, id: "other/.git", label: "other" };
    const remote = { ...repository, id: "remote/.git", hostId: "remote" };
    expect(buildGroups([thread("a")], new Map([["env", clone]]), assignments, "all", NOW, new Map([[clone.id, other], [other.id, repository]]))[0].repository).toEqual(repository);
    expect(buildGroups([thread("a")], environments, assignments, "all", NOW, new Map([[repository.id, remote]]))[0].repository).toEqual(repository);
    expect(buildGroups([thread("a")], environments, assignments, "all", NOW, new Map([[repository.id, clone], [clone.id, repository]]))[0].repository).toEqual(repository);
  });
  it("places a thread in a virtual category with its ancestor context and actual repository", () => {
    const groups = buildGroups([thread("root"), thread("worker", { parentThreadId: "root" })], environments, assignments, "all", NOW,
      new Map(), new Map([["worker", { folderId: "category", repository: null }]]));
    const category = groups.find(g => g.folderId === "category")!;
    expect(category.count).toBe(1); expect(category.repository).toBeNull();
    expect(category.roots[0].contextOnly).toBe(true);
    expect(category.roots[0].children[0].repository).toEqual(repository);
    expect(groups.reduce((count, g) => count + g.count, 0)).toBe(2);
  });
});
