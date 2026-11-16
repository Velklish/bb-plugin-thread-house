import { expect, it, vi } from "vitest";
import { probeRepository } from "./git";
import { isTransientFailure } from "./network";

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (error: Error) => void;
    callback(Object.assign(new Error("Command failed: git rev-parse"), { killed: true, signal: "SIGTERM" }));
  },
}));
it("classifies a killed Git probe as a transient timeout", async () => {
  const result = await probeRepository(import.meta.dirname);
  expect(result.error).toBe("Git probe timed out after 8 seconds.");
  expect(isTransientFailure(result.error!)).toBe(true);
});
