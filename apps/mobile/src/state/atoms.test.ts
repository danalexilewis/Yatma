// @vitest-environment happy-dom
import { emptyFolded } from "@yatma/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AppStateProvider, useAppStore } from "./atoms";

const { openDatabase, hydrateLocalState, selectLocalAccount } = vi.hoisted(() => ({
  openDatabase: vi.fn(),
  hydrateLocalState: vi.fn(),
  selectLocalAccount: vi.fn(),
}));
vi.mock("../db/database", () => ({
  openDatabase,
  hydrateLocalState,
  selectLocalAccount,
  commitLocalBatch: vi.fn(),
  mergeRemoteBatch: vi.fn(),
  wipeLocalData: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

let root: Root;
let container: HTMLDivElement;
let store: ReturnType<typeof useAppStore>;

function Workspace() {
  store = useAppStore();
  return createElement(
    "div",
    null,
    store.state.ready ? "Workspace ready" : store.state.storageError,
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  hydrateLocalState.mockResolvedValue({
    folded: emptyFolded(),
    deviceId: "test",
    lastSeenAt: null,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function openWorkspace() {
  await act(async () =>
    root.render(createElement(AppStateProvider, null, createElement(Workspace))),
  );
}

describe("local workspace startup", () => {
  it("keeps a failed database unready and explains how to release its file lock", async () => {
    openDatabase.mockRejectedValue(new Error("NoModificationAllowedError: createSyncAccessHandle"));
    await openWorkspace();

    expect(store.state.ready).toBe(false);
    expect(store.state.deviceId).toBe("device_pending");
    expect(container.textContent).toContain("Close the other Yatma tabs");
    expect(hydrateLocalState).not.toHaveBeenCalled();
  });

  it("can retry a failed account open and publishes only the recovered workspace", async () => {
    openDatabase.mockRejectedValueOnce(new Error("Invalid VFS state"));
    await openWorkspace();
    await act(async () => store.switchLocalAccount(null));

    expect(selectLocalAccount).toHaveBeenCalledExactlyOnceWith(null);
    expect(store.state.ready).toBe(true);
    expect(store.state.storageError).toBeNull();
    expect(store.state.deviceId).toBe("test");
    expect(container.textContent).toBe("Workspace ready");
  });

  it("waits for hydration before publishing an editable workspace", async () => {
    let finishHydration!: (value: unknown) => void;
    hydrateLocalState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHydration = resolve;
        }),
    );
    await openWorkspace();
    expect(store.state.ready).toBe(false);
    await act(async () =>
      finishHydration({ folded: emptyFolded(), deviceId: "test", lastSeenAt: null }),
    );
    expect(store.state.ready).toBe(true);
  });
});
