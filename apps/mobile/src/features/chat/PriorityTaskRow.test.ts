// @vitest-environment happy-dom
import { DeviceId, TaskId, type Task, type TaskUpdateInput } from "@yatma/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PriorityTaskRow } from "./PriorityTaskRow";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// Exercise the real Pressable responder, including long-press click suppression.
vi.mock("react-native", () => vi.importActual<typeof import("react-native")>("react-native-web"));

const task: Task = {
  id: TaskId.make("t_AAAAAAA1"),
  title: "Plan the day",
  projectId: null,
  notes: "",
  dueDate: null,
  status: "todo",
  quadrant: null,
  position: "n",
  createdAt: "2026-10-16T00:00:00.000Z",
  updatedAt: "2026-10-16T00:00:00.000Z",
  createdBy: { kind: "user", deviceId: DeviceId.make("test") },
  completedAt: null,
  deletedAt: null,
  lastReason: null,
};
let container: HTMLDivElement;
let root: Root;
let drag = vi.fn<() => void>();
const up = vi.fn();
const down = vi.fn();
let change = vi.fn<(input: TaskUpdateInput) => Promise<void>>();

beforeEach(async () => {
  vi.useFakeTimers();
  push.mockClear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  drag = vi.fn();
  change = vi.fn().mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      createElement(PriorityTaskRow, {
        task,
        projectTitle: undefined,
        saving: false,
        dragging: false,
        onDrag: drag,
        onChange: change,
        canMoveUp: true,
        canMoveDown: true,
        onUp: up,
        onDown: down,
      }),
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function control(label: string) {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing control: ${label}`);
  return element;
}

async function press(element: Element, duration: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(duration);
  });
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("priority row gestures", () => {
  it("opens task details on a short tap without starting a drag", async () => {
    await press(control("Open task: Plan the day"), 100);
    expect(push).toHaveBeenCalledExactlyOnceWith(`/task/${task.id}`);
    expect(drag).not.toHaveBeenCalled();
  });

  it.each(["Open task: Plan the day", "Reorder Plan the day"])(
    "holds %s to drag without navigating or completing on release",
    async (label) => {
      await press(control(label), 300);
      expect(drag).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(change).not.toHaveBeenCalled();
    },
  );

  it("starts dragging immediately when the two-bar handle is pressed", async () => {
    await act(async () => {
      control("Reorder Plan the day").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(drag).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("offers keyboard priority changes on the handle without a submenu", async () => {
    await act(async () => {
      const handle = control("Reorder Plan the day");
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
    expect(drag).not.toHaveBeenCalled();
  });

  it("completes only from the checkbox and has no inline actions menu", async () => {
    await press(control("Complete Plan the day"), 100);
    expect(change).toHaveBeenCalledExactlyOnceWith({ taskId: task.id, status: "done" });
    expect(push).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label^="Task actions:"]')).toBeNull();
  });
});
