import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { normalizeOrigin, probeRepository } from "./git";

const run = promisify(execFile);
let directory: string;
let repo: string;
let worktree: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "thread-house-test-"));
  repo = join(directory, "repo with spaces"); worktree = join(directory, "worker");
  await mkdir(repo);
  await run("git", ["init", "-b", "main", repo]);
  await run("git", ["-C", repo, "-c", "user.name=Plugin test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture"]);
  await run("git", ["-C", repo, "worktree", "add", "--detach", worktree]);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
it("resolves a real checkout and worktree to the same Git common directory", async () => {
  const base = await probeRepository(repo);
  const worker = await probeRepository(worktree);
  expect(base.error).toBeNull(); expect(worker.error).toBeNull();
  expect(base.root).toBe(await realpath(repo));
  expect(worker.root).toBe(base.root);
  expect(worker.commonDir).toBe(base.commonDir);
});
it("treats an existing non-Git directory as unassigned", async () => {
  expect(await probeRepository(directory)).toEqual({ path: directory, root: null, commonDir: null, error: null });
});
it("reports a missing checkout instead of pretending it is a non-Git directory", async () => {
  expect((await probeRepository(join(directory, "missing"))).error).toContain("cannot change to");
});
it("rejects relative paths at the host boundary", async () => {
  expect((await probeRepository("../repo")).error).toBe("Repository path must be absolute.");
});
it("propagates cancellation", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(probeRepository(repo, controller.signal)).rejects.toHaveProperty("name", "AbortError");
});
it.each([
  ["https://github.com/example/sample-app.git", "github.com/example/sample-app"],
  ["git@github.com:example/sample-app.git", "github.com/example/sample-app"],
  ["ssh://git@git.example.com/agent-workspace/ati-agents.git/", "git.example.com/agent-workspace/ati-agents"],
  ["https://user:secret@github.com/example/sample-app.git?token=secret", "github.com/example/sample-app"],
])("normalizes the origin %s without transporting credentials", (value, expected) => {
  expect(normalizeOrigin(value)).toBe(expected);
});
it.each(["/work/sample-app", "../sample-app", "not a URL"])("does not infer a network identity from %s", value => {
  expect(normalizeOrigin(value)).toBeUndefined();
});
it("keeps a non-default remote port in the repository identity", () => {
  expect(normalizeOrigin("ssh://git@git.example.com:2222/agent-workspace/ati-agents.git")).toBe("git.example.com:2222/agent-workspace/ati-agents");
});
it("discovers matching origins from two independent Git clones", async () => {
  const source = join(directory, "sample-app"); const clone = join(directory, "release-sample-app");
  await run("git", ["clone", "--no-hardlinks", repo, source]);
  await run("git", ["clone", "--no-hardlinks", repo, clone]);
  await run("git", ["-C", source, "remote", "set-url", "origin", "https://github.com/example/sample-app.git"]);
  await run("git", ["-C", clone, "remote", "set-url", "origin", "git@github.com:example/sample-app.git"]);
  const base = await probeRepository(source), worker = await probeRepository(clone);
  expect(base.origin).toBe("github.com/example/sample-app");
  expect(worker.origin).toBe(base.origin); expect(worker.commonDir).not.toBe(base.commonDir);
});
