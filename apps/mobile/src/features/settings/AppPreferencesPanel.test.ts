// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { AppPreferencesPanel } from "./AppPreferencesPanel";

vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));
vi.mock("../../db/database", () => ({
  getSyncMeta: (key: string) => Promise.resolve(saved.get(key) ?? null),
  setSyncMeta: (key: string, value: string) => persist(key, value),
}));
const saved = new Map<string, string>();
const persist = vi.fn();
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  saved.clear();
  saved.set("preference.triageCapacity", "14");
  persist.mockReset().mockImplementation(async (key, value) => {
    saved.set(key, value);
  });
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
  await act(async () => root.render(createElement(AppPreferencesPanel)));
}
async function enter(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Tasks per bucket"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  const button = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
    (element) => element.textContent === "Save triage limit",
  )!;
  await act(async () => button.click());
}

it("loads existing preferences, rejects invalid capacity and persists a valid limit across remount", async () => {
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Tasks per bucket"]')!.value,
  ).toBe("14");
  await enter("0");
  await save();
  expect(persist).not.toHaveBeenCalled();
  expect(container.textContent).toContain("whole number between 1 and 1000");
  await enter("22");
  await save();
  expect(persist).toHaveBeenCalledWith("preference.triageCapacity", "22");
  await act(async () => root.render(null));
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="Tasks per bucket"]')!.value,
  ).toBe("22");
});

it("shows a persistence failure without announcing a saved preference", async () => {
  await render();
  persist.mockRejectedValue(new Error("database unavailable"));
  await enter("25");
  await save();
  expect(saved.get("preference.triageCapacity")).toBe("14");
  expect(container.textContent).toContain("Could not save app preferences");
  expect(container.textContent).not.toContain("Triage capacity saved");
});
