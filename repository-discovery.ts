import { basename } from "node:path";
import type { z } from "zod";
import type { probeSchema } from "./contracts";
import type { Repository } from "./model";

type Probe = z.infer<typeof probeSchema>;
type Resolution = { repository: Repository | null; error: string | null; missing: boolean };

// Entry identity prevents a probe started before invalidation from repopulating the cache.
export function createRepositoryDiscovery(probe: (hostId: string, path: string, signal?: AbortSignal) => Promise<Probe>) {
  const entries = new Map<string, { at: number; pending: Promise<Resolution>; isolated: boolean }>();
  return {
    invalidate() { entries.clear(); },
    resolve(hostId: string, path: string, signal?: AbortSignal, fresh = false): Promise<Resolution> {
      const key = JSON.stringify([hostId, path]);
      const cached = entries.get(key);
      // CLI cancellation belongs to its caller, so it must not own a shared request.
      if (!fresh && !signal && cached && !cached.isolated && Date.now() - cached.at < 300_000) return cached.pending;
      const pending = probe(hostId, path, signal).then(result => {
        const repository = result.root && result.commonDir ? {
          id: `${hostId}:${result.commonDir}`, hostId, path: result.root, label: basename(result.root),
          ...(result.origin ? { origin: result.origin } : {}),
        } : null;
        if ((!repository || result.error) && entries.get(key)?.pending === pending) entries.delete(key);
        return { repository, error: result.error, missing: result.missing === true };
      }, cause => {
        if (entries.get(key)?.pending === pending) entries.delete(key);
        throw cause;
      });
      entries.set(key, { at: Date.now(), pending, isolated: !!signal });
      return pending;
    },
  };
}
