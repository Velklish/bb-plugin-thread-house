import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, RepositoryState } from "./contracts";
import { isTransientFailure } from "./network";

export function useRepositoryData(threadIds: string[], environmentIds: string[], environmentPaths: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [state, setState] = useState<RepositoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<(force?: boolean) => void>(() => {});
  const refresh = useCallback((force = false) => request.current(force), []);
  const changed = useCallback(() => refresh(), [refresh]);
  useRealtime("changed", changed);
  const idsKey = JSON.stringify([threadIds, environmentIds]);
  useEffect(() => {
    const [ids, envs] = JSON.parse(idsKey) as [string[], string[]];
    if (!ids.length && !envs.length) { setState({ environments: [], assignments: [] }); setError(null); setLoading(false); return; }
    if (connection !== "connected") { setLoading(false); return; }
    let cancelled = false, running = false, queued = false, force = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const count = Math.max(1, Math.ceil(Math.max(ids.length, envs.length) / 200));
    function schedule(fresh = false) {
      force ||= fresh;
      if (running) { queued = true; return; }
      clearTimeout(timer);
      void load();
    }
    async function load(attempt = 0): Promise<void> {
      running = true; queued = false;
      const refreshCache = force; force = false;
      setLoading(true);
      let retry = false;
      try {
        const parts: RepositoryState[] = [];
        for (let i = 0; i < count; i++) {
          if (cancelled) return;
          parts.push(await rpc.call("state", {
            threadIds: ids.slice(i * 200, (i + 1) * 200),
            environmentIds: envs.slice(i * 200, (i + 1) * 200), refresh: refreshCache && i === 0,
          }));
        }
        if (cancelled) return;
        const environments = parts.flatMap(p => p.environments);
        setState(previous => ({
          environments: environments.map(row => row.error ? { ...row, repository: previous?.environments.find(old => old.environmentId === row.environmentId)?.repository ?? row.repository } : row),
          assignments: parts.flatMap(p => p.assignments),
        }));
        setError(null);
        retry = environments.some(row => row.error && isTransientFailure(row.error));
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message); retry = isTransientFailure(message);
      } finally {
        running = false;
        if (!cancelled) {
          if (queued) schedule();
          else if (retry && attempt < 2) timer = setTimeout(() => void load(attempt + 1), attempt ? 750 : 250);
          else setLoading(false);
        }
      }
    }
    request.current = schedule;
    schedule();
    return () => { cancelled = true; clearTimeout(timer); request.current = () => {}; };
  }, [rpc, idsKey, environmentPaths, connection]);
  return { rpc, state, error, loading, connected: connection === "connected", refresh };
}
