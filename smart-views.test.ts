import { expect, it } from "vitest";
import { buildSmartViews } from "./smart-views";
import { DAY, NOW, repository, thread } from "./test-fixtures";
const environments = new Map([["env", repository]]);
it("shows pending descendants with their ancestor context even outside the recent period", () => {
  const result = buildSmartViews([thread("root", { updatedAt: 1 }), thread("worker", { parentThreadId: "root", updatedAt: 1, hasPendingInteraction: true }), thread("idle", { parentThreadId: "root" })], environments, new Map(), "1", NOW);
  expect(result.inputCount).toBe(1); expect(result.input[0].contextOnly).toBe(true);
  expect(result.input[0].children.map(n => n.thread.id)).toEqual(["worker"]);
  expect(result.input[0].children[0].contextOnly).toBe(false);
});
it("Recent contains only roots, promotes a root after descendant activity and rolls up input and running counts", () => {
  const result = buildSmartViews([thread("root", { updatedAt: 1 }), thread("worker", { parentThreadId: "root", hasPendingInteraction: true }), thread("nested", { parentThreadId: "worker", status: "active" }), thread("older", { updatedAt: NOW - DAY - 1 })], environments, new Map(), "1", NOW);
  expect(result.recent.map(n => n.thread.id)).toEqual(["root"]);
  expect(result.recent[0].children).toEqual([]);
  expect(result.summaries.get("root")).toEqual({ needsInput: 1, running: 1 });
});
it("does not list orphan workers, archived or hidden helpers in Recent", () => {
  const result = buildSmartViews([thread("orphan", { parentThreadId: "missing" }), thread("hidden", { isHidden: true, hasPendingInteraction: true }), thread("archived", { isArchived: true, hasPendingInteraction: true }), thread("root")], environments, new Map(), "all", NOW);
  expect(result.recent.map(n => n.thread.id)).toEqual(["root"]); expect(result.inputCount).toBe(0);
});
it("caps Recent at ten roots and uses the inclusive activity boundary", () => {
  const roots = Array.from({ length: 12 }, (_, i) => thread(String(i), { updatedAt: NOW - DAY + i }));
  const result = buildSmartViews(roots, environments, new Map(), "1", NOW);
  expect(result.recent).toHaveLength(10); expect(result.recent[0].thread.id).toBe("11");
  expect(buildSmartViews([roots[0]], environments, new Map(), "1", NOW).recent).toHaveLength(1);
});
