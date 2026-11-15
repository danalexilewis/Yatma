// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Skill, SkillList } from "@yatma/core";

import { SkillsScreen } from "./SkillsScreen";

vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));
vi.mock("expo-crypto", () => ({ randomUUID: () => "12345678-new-skill" }));
vi.mock("expo-router", () => ({
  Link: ({ children }: { children: ReactNode }) => createElement("a", {}, children),
}));
vi.mock("../../ui", () => ({
  Screen: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  ScreenHeader: ({ title, trailing }: { title: string; trailing: ReactNode }) =>
    createElement("div", {}, title, trailing),
  IconButton: ({
    accessibilityLabel,
    disabled,
    onPress,
  }: {
    accessibilityLabel: string;
    disabled: boolean;
    onPress: () => void;
  }) =>
    createElement(
      "button",
      { "aria-label": accessibilityLabel, disabled, onClick: onPress },
      accessibilityLabel,
    ),
  EmptyState: ({
    message,
    actionLabel,
    onAction,
  }: {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) =>
    createElement(
      "div",
      {},
      message,
      actionLabel ? createElement("button", { onClick: onAction }, actionLabel) : null,
    ),
}));
vi.mock("../../state/atoms", () => ({ useAppStore: () => ({ state: { accountId } }) }));
vi.mock("../../state/syncStatusAtom", () => ({ useSyncStatus: () => connection }));
vi.mock("../../sync/engine", () => ({
  getSyncEngine: () => ({ client: { listSkills, saveSkill, deleteSkill } }),
}));
let accountId: string | null = "account-a";
let connection = "connected";
const listSkills = vi.fn();
const saveSkill = vi.fn();
const deleteSkill = vi.fn();
const skill: Skill = {
  id: "skill_12345678",
  title: "Concise",
  instructions: "Use short bullets.",
  enabled: true,
  updatedAt: "2026-11-16T00:00:00Z",
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  accountId = "account-a";
  connection = "connected";
  listSkills.mockResolvedValue({ skills: [skill] });
  saveSkill.mockImplementation(async (input) => ({
    skills: [{ ...input, updatedAt: skill.updatedAt }],
  }));
  deleteSkill.mockResolvedValue({ skills: [] });
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
  await act(async () => root.render(createElement(SkillsScreen)));
}
async function click(label: string) {
  const element = Array.from(
    document.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ).find((element) => (element.getAttribute("aria-label") ?? element.textContent) === label)!;
  expect(element).toBeDefined();
  await act(async () => element.click());
}
async function enter(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[aria-label="${label}"]`,
  )!;
  await act(async () => {
    const prototype =
      input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("creates a skill, edits its instructions and deletes it only after confirmation", async () => {
  await render();
  await click("New skill");
  await enter("Skill name", "Weekly review");
  await enter("Skill instructions", "Summarise progress, then list the next three actions.");
  await click("Save skill");
  expect(saveSkill).toHaveBeenCalledWith({
    id: "skill_12345678-new-skill",
    title: "Weekly review",
    instructions: "Summarise progress, then list the next three actions.",
    enabled: true,
  });
  await click("Edit Weekly review");
  await enter("Skill instructions", "Use a short table.");
  await click("Save skill");
  expect(saveSkill).toHaveBeenLastCalledWith(
    expect.objectContaining({ instructions: "Use a short table." }),
  );
  await click("Delete Weekly review");
  expect(deleteSkill).not.toHaveBeenCalled();
  await click("Delete skill");
  expect(deleteSkill).toHaveBeenCalledWith("skill_12345678-new-skill");
  expect(container.textContent).toContain("No skills yet");
});

it("keeps committed enable state and the editor draft when persistence fails", async () => {
  await render();
  saveSkill.mockRejectedValue({ code: "invalid_request", message: "Disable one first." });
  const toggle = container.querySelector<HTMLElement>('[aria-label="Enable Concise"]')!;
  await act(async () => toggle.click());
  expect(saveSkill).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  expect((toggle as HTMLInputElement).checked).toBe(true);
  await click("Edit Concise");
  await enter("Skill instructions", "My unsaved draft");
  await click("Save skill");
  expect(
    document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[aria-label="Skill instructions"]',
    )?.value,
  ).toBe("My unsaved draft");
  expect(document.body.textContent).toContain("Disable one first");
});

it("ignores a previous account's response and prevents editing while signed out", async () => {
  let finish!: (result: SkillList) => void;
  listSkills.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  accountId = "account-b";
  listSkills.mockResolvedValue({ skills: [] });
  await render();
  await act(async () => finish({ skills: [skill] }));
  expect(container.textContent).not.toContain("Concise");
  accountId = null;
  connection = "idle";
  await render();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="New skill"]')!.disabled).toBe(
    true,
  );
  expect(container.textContent).toContain("Sign in to use skills");
});
