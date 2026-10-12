import { basename } from "node:path";
import { cliCommand, defineCli, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, repositorySchema, rpcContract } from "./contracts";
import type { Repository } from "./model";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({ project: { type: "project", label: "Enabled Project", description: "Enable repository folders and agent trees for this Project. Other Projects use a plain thread list." } });
  let enabledProject = (await settings.get()).project;
  settings.onChange(next => { enabledProject = next.project; cache.clear(); });
  bb.agents.configure(context => ({ tools: [], skills: context.project.id === enabledProject ? ["thread-house"] : [] }));
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const cache = new Map<string, { repository: Repository | null; at: number }>();

  async function resolvePath(hostId: string, path: string, signal?: AbortSignal) {
    const key = JSON.stringify([hostId, path]);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 300_000) return { repository: cached.repository, error: null };
    const [probe] = await host.call("probe", { paths: [path] }, { hostId, signal });
    const repository = probe.root && probe.commonDir ? {
      id: `${hostId}:${probe.commonDir}`, hostId, path: probe.root, label: basename(probe.root),
      ...(probe.origin ? { origin: probe.origin } : {}),
    } : null;
    if (!probe.error) cache.set(key, { repository, at: Date.now() });
    return { repository, error: probe.error };
  }
  async function resolveEnvironment(environmentId: string, signal?: AbortSignal) {
    try {
      const env = await bb.sdk.environments.get({ environmentId, signal });
      if (!enabledProject || env.projectId !== enabledProject) return null;
      if (!env.path) return { environmentId, repository: null, error: null };
      return { environmentId, ...await resolvePath(env.hostId, env.path, signal) };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { environmentId, repository: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  async function state(threadIds: string[], environmentIds: string[], signal?: AbortSignal) {
    if (!enabledProject) return { environments: [], assignments: [] };
    const selectedThreads = (await Promise.all([...new Set(threadIds)].map(threadId => bb.sdk.threads.get({ threadId, signal })))).filter(thread => thread.projectId === enabledProject);
    const allowed = selectedThreads.map(thread => thread.id);
    const [environments, metadata] = await Promise.all([
      Promise.all([...new Set(environmentIds)].map(id => resolveEnvironment(id, signal))),
      allowed.length ? bb.sdk.threads.experimental_listPluginMetadata({ threadIds: allowed, signal }) : { threads: [] },
    ]);
    const saved = metadata.threads.flatMap(row => {
      const parsed = repositorySchema.safeParse(row.metadata.repository);
      return parsed.success ? [{ threadId: row.threadId, repository: parsed.data }] : [];
    });
    const assignments = await Promise.all(saved.map(async row => {
      try {
        const thread = selectedThreads.find(thread => thread.id === row.threadId);
        if (!thread?.environmentId) return null;
        const env = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
        if (env.projectId !== enabledProject || env.hostId !== row.repository.hostId) return null;
        const resolved = await resolvePath(env.hostId, row.repository.path, signal);
        return { ...row, repository: resolved.repository ?? row.repository };
      } catch (cause) {
        if (signal?.aborted) throw cause;
        return null;
      }
    }));
    return { environments: environments.filter(row => row !== null), assignments: assignments.filter(row => row !== null) };
  }
  async function assign(threadId: string, path: string | null, signal?: AbortSignal) {
    const thread = await bb.sdk.threads.get({ threadId, signal });
    if (!enabledProject || thread.projectId !== enabledProject) throw new Error("Thread House is not enabled for this Project.");
    let repository: Repository | null = null;
    if (path !== null) {
      if (!thread.environmentId) throw new Error("This thread has no environment. Choose a thread with an environment.");
      const env = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
      const resolved = await resolvePath(env.hostId, path, signal);
      if (resolved.error) throw new Error(resolved.error);
      if (!resolved.repository) throw new Error("The path is not inside a Git repository.");
      repository = resolved.repository;
    }
    await bb.sdk.threads.updatePluginMetadata({ threadId, signal,
      ...(repository ? { set: { repository: { ...repository } } } : { remove: ["repository"] }),
    });
    bb.realtime.publish("changed", { threadId });
    return repository;
  }
  bb.rpc.register(rpcContract, {
    state: ({ threadIds, environmentIds, refresh }) => {
      if (refresh) cache.clear();
      return state(threadIds, environmentIds);
    },
    assign: ({ threadId, path }) => assign(threadId, path),
  });
  const threadOption = { type: "string" as const, description: "Thread ID; defaults to the invoking thread." };
  function currentThread(id: string | undefined, contextId: string | undefined) {
    const selected = id ?? contextId;
    if (!selected) throw new PluginCliError("A thread is required.", { code: "thread_required", hint: "Pass --thread <thread-id>." });
    return selected;
  }
  bb.cli.register(defineCli({
    name: "thread-house", summary: "Assign sidebar threads to their Git repository.",
    commands: {
      assign: cliCommand({
        summary: "Assign a repository on the thread's machine.",
        options: { thread: threadOption, path: { type: "string", required: true, description: "Absolute repository or worktree path on the thread's machine." }, json: { type: "boolean", description: "Print JSON." } },
        run: async (input, ctx) => ({ exitCode: 0, stdout: JSON.stringify(await assign(currentThread(input.options.thread, ctx.threadId), input.options.path, ctx.signal)) }),
      }),
      clear: cliCommand({
        summary: "Clear an assignment and use environment or parent discovery.",
        options: { thread: threadOption, json: { type: "boolean", description: "Print JSON." } },
        run: async (input, ctx) => {
          const threadId = currentThread(input.options.thread, ctx.threadId);
          await assign(threadId, null, ctx.signal);
          return { exitCode: 0, stdout: JSON.stringify({ threadId, repository: null }) };
        },
      }),
    },
  }));
}
