import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
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
    const options = { signal, timeout: 8000, maxBuffer: 65_536, encoding: "utf8" as const };
    const [commonDir, root] = await Promise.all(["--git-common-dir", "--show-toplevel"].map(async flag => {
      const { stdout } = await run("git", ["-C", path, "rev-parse", "--path-format=absolute", flag], options);
      return realpath(stdout.replace(process.platform === "win32" ? /\r?\n$/ : /\n$/, ""));
    }));
    const commonName = basename(commonDir);
    const label = commonName === ".git" ? basename(dirname(commonDir)) : commonName.replace(/\.git$/, "");
    let origin: string | undefined;
    try {
      const result = await run("git", ["--git-dir", commonDir, "config", "--get", "remote.origin.url"], options);
      origin = normalizeOrigin(result.stdout.trim());
    } catch (cause) {
      if (signal?.aborted || (cause as { code?: number }).code !== 1) throw cause;
    }
    return { path, root, commonDir, label, ...(origin ? { origin } : {}), error: null };
  } catch (cause) {
    if (signal?.aborted) throw cause;
    const error = cause as Error & { stderr?: string; killed?: boolean };
    if (error.killed) return { ...empty, error: "Git probe timed out after 8 seconds." };
    if (error.stderr?.includes("not a git repository")) return empty;
    try { await stat(path); }
    catch (statError) {
      if ((statError as NodeJS.ErrnoException).code === "ENOENT") return { ...empty, error: error.stderr?.trim() || error.message, missing: true };
    }
    return { ...empty, error: error.stderr?.trim() || error.message };
  }
}
