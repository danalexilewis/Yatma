// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ModelSettings } from "@yatma/core";

import { ModelSettingsPanel } from "./ModelSettingsPanel";

vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));
vi.mock("../../state/atoms", () => ({ useAppStore: () => ({ state: { accountId } }) }));
vi.mock("../../state/syncStatusAtom", () => ({ useSyncStatus: () => "connected" }));
vi.mock("../../sync/engine", () => ({
  getSyncEngine: () => ({ client: { getModelSettings, saveModelSettings, removeModelSettings } }),
}));

let accountId = "user-a";
const getModelSettings = vi.fn();
const saveModelSettings = vi.fn();
const removeModelSettings = vi.fn();
const configured: ModelSettings = {
  provider: "openrouter",
  model: "openai/gpt-4o-mini",
  source: "personal",
  canSaveKey: true,
};
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.resetAllMocks();
  accountId = "user-a";
  getModelSettings.mockResolvedValue(configured);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render() {
  await act(async () => root.render(createElement(ModelSettingsPanel)));
}

describe("AI settings", () => {
  it("saves an entered key and clears the secret after acknowledgement", async () => {
    getModelSettings.mockResolvedValue({ ...configured, source: "missing" });
    saveModelSettings.mockResolvedValue(configured);
    await render();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="OpenRouter API key"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "sk-or-v1-ui-test-secret",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (element) => element.textContent === "Save API key",
    )!;
    await act(async () => save.click());
    expect(saveModelSettings).toHaveBeenCalledWith({
      apiKey: "sk-or-v1-ui-test-secret",
      model: configured.model,
    });
    expect(input.value).toBe("");
    expect(container.textContent).toContain("Key saved");
  });

  it("shows saved status without populating a credential, and removes a personal key", async () => {
    removeModelSettings.mockResolvedValue({ ...configured, source: "missing" });
    await render();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="OpenRouter API key"]',
    )!;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    expect(container.textContent).toContain("Using your OpenRouter key");
    const remove = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
      (element) => element.textContent === "Remove personal key",
    )!;
    await act(async () => remove.click());
    expect(removeModelSettings).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Personal key removed");
    expect(container.textContent).toContain("Add an OpenRouter key");
  });

  it("ignores an old account's in-flight response after switching accounts", async () => {
    let finish!: (value: ModelSettings) => void;
    getModelSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await render();
    accountId = "user-b";
    getModelSettings.mockResolvedValue({ ...configured, model: "other/model", source: "missing" });
    await render();
    await act(async () => finish(configured));
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="OpenRouter model"]')?.value,
    ).toBe("other/model");
    expect(container.textContent).not.toContain("Using your OpenRouter key");
  });
});
