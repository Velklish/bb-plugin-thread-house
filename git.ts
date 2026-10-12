import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { z } from "zod";
import type { probeSchema } from "./contracts";

const run = promisify(execFile);
export function normalizeOrigin(value: string): string | undefined {
  let host: string, path: string;
  try {
    if (value.includes("://")) {
      const url = new URL(value);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol) || !url.hostname) return;
      const defaultPort = { "https:": "443", "http:": "80", "ssh:": "22", "git:": "9418" }[url.protocol];
      host = url.hostname.toLowerCase() + (url.port && url.port !== defaultPort ? `:${url.port}` : ""); path = url.pathname;
    } else {
      const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(value);
      if (!scp || value.includes("\\")) return;
      host = scp[1].toLowerCase(); path = scp[2];
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return path ? `${host}/${path}` : undefined;
  } catch { return; }
}
export async function probeRepository(path: string, signal?: AbortSignal): Promise<z.infer<typeof probeSchema>> {
  const empty = { path, root: null, commonDir: null, error: null };
  if (!isAbsolute(path)) return { ...empty, error: "Repository path must be absolute." };
  try {
    const { stdout } = await run("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], {
      signal, timeout: 8000, maxBuffer: 65_536, encoding: "utf8",
    });
    const [gitDir, worktreeRoot] = stdout.trimEnd().split("\n");
    const commonDir = await realpath(gitDir);
    const root = basename(commonDir) === ".git" ? dirname(commonDir) : worktreeRoot;
    let origin: string | undefined;
    try {
      const result = await run("git", ["-C", root, "config", "--get", "remote.origin.url"], { signal, timeout: 8000, maxBuffer: 65_536, encoding: "utf8" });
      origin = normalizeOrigin(result.stdout.trim());
    } catch (cause) {
      if (signal?.aborted || (cause as { code?: number }).code !== 1) throw cause;
    }
    return { path, root, commonDir, ...(origin ? { origin } : {}), error: null };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const error = cause as Error & { stderr?: string };
    if (error.stderr?.includes("not a git repository")) return empty;
    return { ...empty, error: error.stderr?.trim() || error.message };
  }
}
