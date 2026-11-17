import { cliCommand, defineCli, PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, repositorySchema, rpcContract } from "./contracts";
import type { Repository } from "./model";
import { isTransientFailure } from "./network";
import { createRepositoryDiscovery } from "./repository-discovery";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({ project: { type: "project", label: "Enabled Project", description: "Enable repository folders and agent trees for this Project. Other Projects use a plain thread list." } });
  let enabledProject = (await settings.get()).project;
  settings.onChange(next => { enabledProject = next.project; discovery.invalidate(); });
  bb.agents.configure(context => ({ tools: [], skills: context.project.id === enabledProject ? ["thread-house"] : [] }));
  const host = bb.hosts.experimental_client({ contract: hostContract });
  let activeReads = 0;
  const waitingReads: (() => void)[] = [];
  async function read<T>(operation: string, run: () => Promise<T>): Promise<T> {
    if (activeReads >= 8) await new Promise<void>(resolve => waitingReads.push(resolve));
    else activeReads++;
    try { return await run(); }
    catch (cause) {
      let detail = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof Error && cause.cause instanceof Error) {
        const network = cause.cause as Error & { code?: string };
        detail += ` (${network.code ?? network.name}: ${network.message})`;
      }
      bb.log.warn(`${operation} failed: ${detail}`);
      throw cause;
    } finally {
      const next = waitingReads.shift();
      if (next) next(); else activeReads--;
    }
  }

  const discovery = createRepositoryDiscovery(async (hostId, path, signal) => {
    const [probe] = await read("host.probe", () => host.call("probe", { paths: [path] }, { hostId, signal }));
    return probe;
  });
  async function resolveEnvironment(environmentId: string, getEnvironment: (id: string) => ReturnType<typeof bb.sdk.environments.get>, project: string, signal?: AbortSignal) {
    try {
      const env = await getEnvironment(environmentId);
      if (env.projectId !== project) return null;
      if (!env.path) return { environmentId, repository: null, error: null };
      const { repository, error, missing } = await discovery.resolve(env.hostId, env.path, signal);
      return { environmentId, repository, error: missing ? null : error };
    } catch (cause) {
      if (signal?.aborted) throw cause;
      return { environmentId, repository: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
  async function state(threadIds: string[], environmentIds: string[], signal?: AbortSignal) {
    const project = enabledProject;
    if (!project) return { environments: [], assignments: [] };
    const environmentReads = new Map<string, ReturnType<typeof bb.sdk.environments.get>>();
    function getEnvironment(environmentId: string) {
      let pending = environmentReads.get(environmentId);
      if (!pending) {
        pending = read("environments.get", () => bb.sdk.environments.get({ environmentId, signal }));
        environmentReads.set(environmentId, pending);
      }
      return pending;
    }
    const selectedThreads = (await Promise.all([...new Set(threadIds)].map(async threadId => {
      try { return [await read("threads.get", () => bb.sdk.threads.get({ threadId, signal }))]; }
      catch (cause) {
        // A thread deleted a moment ago must not fail the load for the others; any other failure still surfaces.
        if (signal?.aborted || !/\b404\b|not found/i.test(cause instanceof Error ? cause.message : String(cause))) throw cause;
        return [];
      }
    }))).flat().filter(thread => thread.projectId === project);
    const allowed = selectedThreads.map(thread => thread.id);
    const [environments, metadata] = await Promise.all([
      Promise.all([...new Set(environmentIds)].map(id => resolveEnvironment(id, getEnvironment, project, signal))),
      allowed.length ? read("threads.experimental_listPluginMetadata", () => bb.sdk.threads.experimental_listPluginMetadata({ threadIds: allowed, signal })) : { threads: [] },
    ]);
    const saved = metadata.threads.flatMap(row => {
      const parsed = repositorySchema.safeParse(row.metadata.repository);
      return parsed.success ? [{ threadId: row.threadId, repository: parsed.data }] : [];
    });
    const resolvedAssignments = await Promise.all(saved.map(async row => {
      try {
        const thread = selectedThreads.find(thread => thread.id === row.threadId);
        if (!thread?.environmentId) return null;
        const env = await getEnvironment(thread.environmentId);
        if (env.projectId !== project || env.hostId !== row.repository.hostId) return null;
        const resolved = await discovery.resolve(env.hostId, row.repository.path, signal);
        // A deleted checkout can resolve to a different, enclosing repository.
        return { ...row, resolved: resolved.repository?.id === row.repository.id ? resolved.repository : null };
      } catch (cause) {
        if (signal?.aborted || isTransientFailure(cause instanceof Error ? cause.message : String(cause))) throw cause;
        return null;
      }
    }));
    const liveRepositories = new Map<string, Repository>();
    for (const repository of [...environments.map(row => row?.repository), ...resolvedAssignments.map(row => row?.resolved)]) {
      if (repository) liveRepositories.set(repository.id, repository);
    }
    const assignments = resolvedAssignments.flatMap(row => row ? [{
      threadId: row.threadId, repository: row.resolved ?? liveRepositories.get(row.repository.id) ?? row.repository,
    }] : []);
    return { environments: environments.filter(row => row !== null), assignments };
  }
  async function assign(threadId: string, path: string | null, signal?: AbortSignal) {
    const thread = await bb.sdk.threads.get({ threadId, signal });
    if (!enabledProject || thread.projectId !== enabledProject) throw new Error("Thread House is not enabled for this Project.");
    let repository: Repository | null = null;
    if (path !== null) {
      if (!thread.environmentId) throw new Error("This thread has no environment. Choose a thread with an environment.");
      const env = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
      const resolved = await discovery.resolve(env.hostId, path, signal, true);
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
      if (refresh) discovery.invalidate();
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
