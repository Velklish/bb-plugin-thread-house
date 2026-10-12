import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, experimental_scanPublicSdkOnly, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { repository } from "./test-fixtures";

const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
async function setup(origin?: string) {
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
      return [{ path: "/work/sample-app", root: "/work/sample-app", commonDir: "sample-app/.git", ...(origin ? { origin } : {}), error: null }];
    },
  });
  await plugin(host.bb); disposals.push(() => host.harness.lifecycle.dispose());
  return { ...host, metadata, calls };
}
describe("repository assignments", () => {
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
