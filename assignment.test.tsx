// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import app from "./app";
import { repository, thread } from "./test-fixtures";

// SDK 0.6.37's menu fake does not implement choices. Drive the public action contract through a choice adapter.
vi.mock("@get-bb/plugin-sdk/app", async original => {
  const sdk = await original<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...sdk, experimental_ThreadActionsMenu: ({ inline }: ComponentProps<typeof sdk.experimental_ThreadActionsMenu>) => <div>
    {inline?.flatMap(item => item.action.choices?.items.map(choice => <button key={choice.id} onClick={() => {
      void Promise.resolve(item.action.run({ value: choice.id, requestRename() {} }));
    }}>{choice.label}</button>) ?? [])}
  </div> };
});
let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); vi.unstubAllGlobals(); });
it("keeps assignment errors with Edit path instead of retrying repository discovery", async () => {
  vi.stubGlobal("localStorage", new JSDOM("", { url: "https://bb.test" }).window.localStorage);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  let attempts = 0;
  const loaded = await loadPluginApp(async () => app);
  const slot = renderSlot(loaded.threadLists[0], { activeThreadId: "parent", activeProjectId: "workspace", isCompactViewport: false, searchQuery: "", onNavigate() {} }, {
    settings: { project: "workspace" },
    sidebarThreads: { status: "ready", projects: [{ id: "workspace", name: "workspace", isPersonal: false, href: "/", settingsHref: "/" }], sections: [], threads: [thread("parent")] },
    rpc: { state: () => ({ environments: [{ environmentId: "env", repository, error: null }], assignments: [] }), assign: () => {
      if (++attempts === 1) throw new Error("The path is not inside a Git repository.");
      return null;
    } },
  });
  unmount = () => slot.lifecycle.unmount();
  await waitFor(() => expect(slot.container.querySelector(".wt-folder")).not.toBeNull());
  fireEvent.click(await slot.findByText("Choose path…"));
  fireEvent.click(await slot.findByRole("button", { name: "Assign" }));
  await slot.findByText("The path is not inside a Git repository.");
  fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
  expect(slot.queryByRole("button", { name: "Retry" })).toBeNull();
  fireEvent.click(slot.getByRole("button", { name: "Edit path…" }));
  expect((slot.getByLabelText("Repository path") as HTMLInputElement).value).toBe(repository.path);
  fireEvent.click(await slot.findByRole("button", { name: "Assign" }));
  await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  expect(attempts).toBe(2);
  expect(slot.queryByRole("alert")).toBeNull();
});
