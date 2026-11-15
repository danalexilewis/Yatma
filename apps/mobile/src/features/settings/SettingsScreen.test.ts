// @vitest-environment happy-dom
import { emptyFolded, defaultStackPreferences, type UsageGetResult } from "@yatma/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SettingsScreen } from "./SettingsScreen";

vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("@clerk/expo", () => ({ useAuth: vi.fn(), useUser: vi.fn() }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  Link: ({ children, href }: { children: React.ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("../../ui", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => createElement("div", {}, children),
}));
vi.mock("../../state/atoms", () => ({
  useAppStore: () => ({ state: { accountId, ready: true } }),
}));
vi.mock("../../state/syncStatusAtom", () => ({ useSyncStatus: () => connection }));
vi.mock("../../sync/engine", () => ({
  getSyncEngine: () => (accountId ? { client: { getModelSettings, usageGet } } : null),
}));
vi.mock("../../db/database", () => ({
  wipeLocalData: vi.fn(),
  getSyncMeta: async () => null,
  setSyncMeta: vi.fn(),
}));
vi.mock("../../export/jsonl", () => ({ shareEventsJsonl: vi.fn() }));
vi.mock("../player/Scenes", () => ({ SceneControls: () => null }));
vi.mock("../player/PlayerProvider", () => ({
  useStackPlayer: () => ({
    preferences: defaultStackPreferences,
    state: { ready: true, folded: emptyFolded() },
    daily: { preferences: savePlanning },
    runtimeState: { reminder: "off" },
  }),
}));
let params: { section?: string } = {};
let accountId: string | null = null;
let connection = "idle";
const getModelSettings = vi.fn();
const usageGet = vi.fn();
const savePlanning = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  params = {};
  accountId = null;
  connection = "idle";
  getModelSettings.mockResolvedValue({
    provider: "openrouter",
    model: "example/model",
    source: "missing",
    canSaveKey: true,
  });
  usageGet.mockResolvedValue({ used: 20, limit: 100, resetsAt: "2026-11-17T00:00:00Z" });
  savePlanning.mockResolvedValue(undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});
async function render() {
  await act(async () => root.render(createElement(SettingsScreen)));
}
async function click(label: string, role = "button") {
  const element = Array.from(container.querySelectorAll<HTMLElement>(`[role="${role}"]`)).find(
    (element) => element.textContent === label,
  )!;
  expect(element).toBeDefined();
  await act(async () => element.click());
}
async function enter(label: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("opens AI settings by default and keeps personal cloud settings disabled while signed out", async () => {
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label="OpenRouter API key"]')!.readOnly,
  ).toBe(true);
  expect(container.textContent).not.toContain("Skills");
  await click("Connections", "tab");
  expect(container.textContent).toContain("Sign in and connect to configure morning reviews");
  await click("App & account", "tab");
  expect(container.querySelector('input[aria-label="Tasks per bucket"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Delete account");
});

it("opens the planning shortcut and validates durations before writing all three defaults atomically", async () => {
  params = { section: "planning" };
  await render();
  await enter("Default task allocation (minutes)", "40");
  await enter("Work minutes between breaks", "0");
  await click("Save durations");
  expect(savePlanning).not.toHaveBeenCalled();
  await enter("Work minutes between breaks", "90");
  await enter("Break duration (minutes)", "10");
  await click("Save durations");
  expect(savePlanning).toHaveBeenCalledWith({
    defaultAllocationMinutes: 40,
    workIntervalMinutes: 90,
    breakMinutes: 10,
  });
  expect(container.textContent).toContain("Planning defaults saved");
});

it("never displays usage returned for an account after switching to another account", async () => {
  let finish!: (usage: UsageGetResult) => void;
  accountId = "first";
  connection = "connected";
  usageGet.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  accountId = "second";
  await render();
  await act(async () => finish({ used: 98765, limit: 100000, resetsAt: "2026-11-17T00:00:00Z" }));
  expect(container.textContent).toContain("20 / 100 tokens");
  expect(container.textContent).not.toContain("98,765");
});
