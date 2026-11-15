// @vitest-environment happy-dom
import type { DayEntry } from "@yatma/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TodayList } from "./TodayList.web";

vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));

const entries: DayEntry[] = ["One", "Two", "Three"].map((title) => ({
  id: title,
  title,
  dayId: "today",
  taskId: null,
  kind: "activity",
  allocationMinutes: 30,
  position: title,
  status: "pending",
  origin: `manual:${title}`,
  manual: true,
  carryOrder: null,
  preparation: false,
  resumeEntryId: null,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
}));
let container: HTMLDivElement;
let root: Root;
const onDrop = vi.fn();
const transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(disabled = false) {
  await act(async () =>
    root.render(
      createElement(TodayList, {
        data: entries,
        keyExtractor: (entry) => entry.id,
        disabled,
        onDragEnd: onDrop,
        renderItem: ({ item }) =>
          createElement(
            "div",
            {},
            createElement(
              "div",
              { role: "slider", "aria-label": `Reorder ${item.title}` },
              item.title,
            ),
            createElement("button", {}, `Open ${item.title}`),
          ),
      }),
    ),
  );
}
function handle(title: string) {
  return container.querySelector(`[aria-label="Reorder ${title}"]`)!;
}
function row(title: string) {
  return handle(title).closest("[draggable]")!;
}
async function dispatch(element: Element, type: string, clientY = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  await act(async () => {
    element.dispatchEvent(event);
  });
  return event;
}

describe("browser Today drag surface", () => {
  it.each([
    ["Three", "One", -1, ["Three", "One", "Two"], 2, 0],
    ["One", "Three", 1, ["Two", "Three", "One"], 0, 2],
    ["One", "Two", 1, ["Two", "One", "Three"], 0, 1],
  ] as const)(
    "drops %s at %s with the correct daily indices",
    async (source, target, y, expected, from, to) => {
      await render();
      await dispatch(handle(source), "pointerdown");
      await dispatch(row(source), "dragstart");
      await dispatch(row(target), "dragover", y);
      await dispatch(row(target), "drop", y);
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(onDrop.mock.calls[0]![0]).toMatchObject({ from, to });
      expect(onDrop.mock.calls[0]![0].data.map((entry: DayEntry) => entry.title)).toEqual(expected);
    },
  );

  it("ignores detail-button drags, external drops, cancelled drags and disabled edits", async () => {
    await render();
    await dispatch(row("One").querySelector("button")!, "pointerdown");
    expect((await dispatch(row("One"), "dragstart")).defaultPrevented).toBe(true);
    await dispatch(row("Two"), "drop");
    await dispatch(handle("One"), "pointerdown");
    await dispatch(row("One"), "dragstart");
    await dispatch(row("One"), "dragend");
    await dispatch(row("Two"), "drop");
    await render(true);
    await dispatch(handle("One"), "pointerdown");
    expect((await dispatch(row("One"), "dragstart")).defaultPrevented).toBe(true);
    await dispatch(row("Two"), "drop");
    expect(onDrop).not.toHaveBeenCalled();
  });
});
