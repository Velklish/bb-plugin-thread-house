import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { repository } from "./test-fixtures";
import type { RepositoryState } from "./contracts";

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
async function setup(origin?: string, probe?: () => Promise<{ path: string; root: string | null; commonDir: string | null; error: string | null }[]>) {
  const metadata = new Map<string, Record<string, unknown>>();
  const calls: { hostId: string; input: unknown }[] = [];
  const host = createFakePluginHost({
    pluginId: "thread-house",
    settings: { project: "selected" },
    agentSkillIds: ["thread-house"],
    sdk: {
      environments: { get: async ({ environmentId }) => ({ projectId: environmentId === "outside-env" ? "outside" : "selected", hostId: "host", path: "/work/sample-app" }) },
      threads: {
        get: async ({ threadId }) => makeThreadResponse({ id: threadId, projectId: threadId === "outside" ? "outside" : "selected", environmentId: "env" }),
        experimental_listPluginMetadata: async ({ threadIds }) => ({ threads: threadIds.flatMap(threadId => metadata.has(threadId) ? [{ threadId, metadata: metadata.get(threadId)! }] : []) }),
        updatePluginMetadata: async ({ threadId, set, remove }) => {
          const value = { ...(metadata.get(threadId) ?? {}), ...set };
          for (const key of remove ?? []) delete value[key];
          metadata.set(threadId, value);
          return value;
        },
      },
    },
    experimental_callHostRpc: async call => {
      calls.push({ hostId: call.hostId, input: call.input });
      if (probe) return probe();
      return [{ path: "/work/sample-app", root: "/work/sample-app", commonDir: "sample-app/.git", ...(origin ? { origin } : {}), error: null }];
    },
  });
  await plugin(host.bb); disposals.push(() => host.harness.lifecycle.dispose());
  return { ...host, metadata, calls };
}
describe("repository assignments", () => {
  it("bounds SDK reads across concurrent sidebar requests", async () => {
    const { harness } = await setup();
    let active = 0, peak = 0;
    harness.sdk.stub("threads.get", async ({ threadId }) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return makeThreadResponse({ id: threadId, projectId: "selected", environmentId: "env" });
    });
    const input = { threadIds: Array.from({ length: 30 }, (_, i) => `t${i}`), environmentIds: [] };
    await Promise.all([harness.behavior.callRpc("state", input), harness.behavior.callRpc("state", input)]);
    expect(peak).toBeLessThanOrEqual(8);
    expect(harness.inspection.sdk.callsTo("threads.get")).toHaveLength(60);
  });
  it("logs the failing SDK operation and network cause before propagating the error", async () => {
    const { harness } = await setup();
    harness.sdk.stub("threads.get", async () => { throw new TypeError("fetch failed", { cause: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }) }); });
    await expect(harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: [] })).rejects.toThrow("fetch failed");
    expect(JSON.stringify(harness.logEntries)).toContain("threads.get");
    expect(JSON.stringify(harness.logEntries)).toContain("UND_ERR_SOCKET");
  });
  it("propagates assignment network failures so the sidebar can retain and retry the assignment", async () => {
    const { harness, metadata } = await setup();
    metadata.set("t", { repository });
    harness.sdk.stub("environments.get", async () => { throw new TypeError("fetch failed"); });
    await expect(harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: ["env"] })).rejects.toThrow("fetch failed");
  });
  it("keeps loading the sidebar when one thread no longer exists, and still reports other failures", async () => {
    const { harness, metadata } = await setup();
    metadata.set("t", { repository });
    harness.sdk.stub("threads.get", async ({ threadId }) => {
      if (threadId === "gone") throw new Error("HTTP 404: Thread not found");
      if (threadId === "broken") throw new RangeError("Set maximum size exceeded");
      return makeThreadResponse({ id: threadId, projectId: "selected", environmentId: "env" });
    });
    const result = await harness.behavior.callRpc("state", { threadIds: ["gone", "t"], environmentIds: ["env"] }) as RepositoryState;
    expect(result.assignments.map(row => row.threadId)).toEqual(["t"]);
    expect(result.environments).toHaveLength(1);
    await expect(harness.behavior.callRpc("state", { threadIds: ["broken", "t"], environmentIds: ["env"] })).rejects.toThrow("Set maximum size");
  });
  it("does not probe environments or change assignments outside the selected project", async () => {
    const { harness, calls, metadata } = await setup();
    expect(await harness.behavior.callRpc("state", { threadIds: ["outside"], environmentIds: ["outside-env"] })).toEqual({ environments: [], assignments: [] });
    await expect(harness.behavior.callRpc("assign", { threadId: "outside", path: "/work/sample-app" })).rejects.toThrow("not enabled");
    await expect(harness.behavior.callRpc("assign", { threadId: "outside", path: null })).rejects.toThrow("not enabled");
    expect(calls).toEqual([]);
    expect(metadata.size).toBe(0);
  });
  it("ignores saved assignments pointing to a previous machine without probing that machine", async () => {
    const { harness, calls, metadata } = await setup();
    metadata.set("t", { repository: { ...repository, hostId: "previous-host" } });
    expect(await harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: [] })).toEqual({ environments: [], assignments: [] });
    expect(calls).toEqual([]);
  });
  it("resolves Git on the environment's host and caches reads", async () => {
    const { harness, calls } = await setup();
    const input = { threadIds: ["t"], environmentIds: ["env"] };
    const state = await harness.behavior.callRpc("state", input);
    expect(state).toEqual({ environments: [{ environmentId: "env", repository, error: null }], assignments: [] });
    await harness.behavior.callRpc("state", input);
    expect(calls).toHaveLength(1); expect(calls[0].hostId).toBe("host");
  });
  it("treats missing environment paths as unassigned while keeping assignment errors", async () => {
    const host = createFakePluginHost({
      pluginId: "thread-house", settings: { project: "selected" }, agentSkillIds: ["thread-house"],
      sdk: {
        environments: { get: async () => ({ projectId: "selected", hostId: "host", path: "/missing" }) },
        threads: {
          get: async () => makeThreadResponse({ id: "t", projectId: "selected", environmentId: "env" }),
          experimental_listPluginMetadata: async () => ({ threads: [{ threadId: "t", metadata: { repository } }] }),
        },
      },
      experimental_callHostRpc: async () => [{ path: "/missing", root: null, commonDir: null, error: "missing path", missing: true }],
    });
    await plugin(host.bb); disposals.push(() => host.harness.lifecycle.dispose());
    expect(await host.harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: ["env"] })).toEqual({ environments: [{ environmentId: "env", repository: null, error: null }], assignments: [{ threadId: "t", repository }] });
    await expect(host.harness.behavior.callRpc("assign", { threadId: "t", path: "/missing" })).rejects.toThrow("missing path");
  });
  it("reports other environment probe errors", async () => {
    const host = createFakePluginHost({
      pluginId: "thread-house", settings: { project: "selected" }, agentSkillIds: ["thread-house"],
      sdk: { environments: { get: async () => ({ projectId: "selected", hostId: "host", path: "/work" }) } },
      experimental_callHostRpc: async () => [{ path: "/work", root: null, commonDir: null, error: "permission denied" }],
    });
    await plugin(host.bb); disposals.push(() => host.harness.lifecycle.dispose());
    expect(await host.harness.behavior.callRpc("state", { threadIds: [], environmentIds: ["env"] })).toEqual({ environments: [{ environmentId: "env", repository: null, error: "permission denied" }], assignments: [] });
  });
  it("persists assignments, publishes changes, and clears only its repository key", async () => {
    const { harness, metadata } = await setup(); metadata.set("t", { unrelated: "keep" });
    await harness.behavior.callRpc("assign", { threadId: "t", path: "/work/sample-app" });
    expect(metadata.get("t")).toEqual({ unrelated: "keep", repository });
    const state = await harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: [] });
    expect(state).toEqual({ environments: [], assignments: [{ threadId: "t", repository }] });
    expect(harness.realtimeSignals).toHaveLength(1);
    await harness.behavior.callRpc("assign", { threadId: "t", path: null });
    expect(metadata.get("t")).toEqual({ unrelated: "keep" });
  });
  it("refresh invalidates the Git cache", async () => {
    const { harness, calls } = await setup();
    const input = { threadIds: [], environmentIds: ["env"] };
    await harness.behavior.callRpc("state", input);
    await harness.behavior.callRpc("state", { ...input, refresh: true });
    expect(calls).toHaveLength(2);
  });
  it("ignores malformed persisted metadata", async () => {
    const { harness, metadata } = await setup(); metadata.set("t", { repository: { id: 123 } });
    expect(await harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: [] })).toEqual({ environments: [], assignments: [] });
  });
  it("adds origin to old assignments by probing their stored path without rewriting metadata", async () => {
    const origin = "github.com/example/sample-app";
    const { harness, metadata, calls } = await setup(origin); metadata.set("t", { repository, unrelated: "keep" });
    const state = await harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: [] });
    expect(state).toEqual({ environments: [], assignments: [{ threadId: "t", repository: { ...repository, origin } }] });
    expect(calls[0]).toEqual({ hostId: "host", input: { paths: [repository.path] } });
    expect(metadata.get("t")).toEqual({ repository, unrelated: "keep" });
    expect(harness.inspection.sdk.callsTo("threads.updatePluginMetadata")).toHaveLength(0);
  });
  it("rejects oversized batches and unknown input keys before calling a host", async () => {
    const { harness, calls } = await setup();
    await expect(harness.behavior.callRpc("state", { threadIds: Array(201).fill("t"), environmentIds: [] })).rejects.toThrow();
    await expect(harness.behavior.callRpc("assign", { threadId: "t", path: "/work", unknown: true })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("CLI defaults to the invoking thread", async () => {
    const { harness, metadata } = await setup();
    const result = await harness.behavior.runCli(["assign", "--path", "/work/sample-app", "--json"], { threadId: "t" });
    expect(result.exitCode).toBe(0); expect(metadata.get("t")?.repository).toEqual(repository);
  });
});
it("uses only public SDK surfaces", () => {
  const scan = experimental_scanPublicSdkOnly(import.meta.dirname, { allow: [
    "react", "react-dom", "@testing-library/react", "@radix-ui/react-slot",
    "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-context-menu", "class-variance-authority", "clsx", "tailwind-merge", "jsdom",
  ].map(name => new RegExp(`^${name}$`)) });
  expect(scan.violations).toEqual([]); expect(scan.privateDependencies).toEqual([]);
});

it("checks explicit assignments freshly after a directory becomes a Git repository", async () => {
  let initialized = false;
  const { harness, metadata } = await setup(undefined, async () => [{ path: repository.path,
    root: initialized ? repository.path : null, commonDir: initialized ? "sample-app/.git" : null, error: null }]);
  await harness.behavior.callRpc("state", { threadIds: [], environmentIds: ["env"] });
  initialized = true;
  await harness.behavior.callRpc("assign", { threadId: "t", path: repository.path });
  expect(metadata.get("t")?.repository).toEqual(repository);
});
it("does not let a pre-refresh probe overwrite the refreshed cache", async () => {
  let release!: (value: { path: string; root: string; commonDir: string; error: null }[]) => void;
  const old = new Promise<{ path: string; root: string; commonDir: string; error: null }[]>(resolve => { release = resolve; });
  let started!: () => void;
  const probing = new Promise<void>(resolve => { started = resolve; });
  let count = 0;
  const { harness } = await setup(undefined, async () => {
    if (++count === 1) { started(); return old; }
    return [{ path: repository.path, root: "/new", commonDir: "/new/.git", error: null }];
  });
  const input = { threadIds: [], environmentIds: ["env"] };
  const first = harness.behavior.callRpc("state", input);
  await probing;
  await harness.behavior.callRpc("state", { ...input, refresh: true });
  release([{ path: repository.path, root: "/old", commonDir: "/old/.git", error: null }]);
  await first;
  const result = await harness.behavior.callRpc("state", input) as RepositoryState;
  expect(result.environments[0].repository?.path).toBe("/new");
});
it("shares environment reads between discovery and saved assignments in one load", async () => {
  const { harness, metadata } = await setup();
  metadata.set("a", { repository }); metadata.set("b", { repository });
  await harness.behavior.callRpc("state", { threadIds: ["a", "b"], environmentIds: ["env"] });
  expect(harness.inspection.sdk.callsTo("environments.get")).toHaveLength(1);
});

it("shares in-flight Git probes across simultaneous state requests", async () => {
  const { harness, calls } = await setup();
  const input = { threadIds: [], environmentIds: ["env"] };
  await Promise.all([harness.behavior.callRpc("state", input), harness.behavior.callRpc("state", input)]);
  expect(calls).toHaveLength(1);
});
it("does not reuse a previously successful probe for an explicit assignment", async () => {
  let root = "/old";
  const { harness, metadata } = await setup(undefined, async () => [{ path: repository.path, root, commonDir: `${root}/.git`, error: null }]);
  await harness.behavior.callRpc("state", { threadIds: [], environmentIds: ["env"] });
  root = "/new";
  await harness.behavior.callRpc("assign", { threadId: "t", path: repository.path });
  expect(metadata.get("t")?.repository).toEqual(expect.objectContaining({ path: "/new" }));
});

it("retains a saved assignment when its Git probe times out without failing other environments", async () => {
  let calls = 0;
  const { harness, metadata } = await setup(undefined, async () => ++calls === 1
    ? [{ path: repository.path, root: repository.path, commonDir: "sample-app/.git", error: null }]
    : [{ path: "/slow", root: null, commonDir: null, error: "Git probe timed out after 8 seconds." }]);
  const saved = { ...repository, id: "host:/slow/.git", path: "/slow", label: "slow" };
  metadata.set("t", { repository: saved });
  const result = await harness.behavior.callRpc("state", { threadIds: ["t"], environmentIds: ["env"] }) as RepositoryState;
  expect(result.environments[0].repository).toEqual(repository);
  expect(result.assignments).toEqual([{ threadId: "t", repository: saved }]);
});
