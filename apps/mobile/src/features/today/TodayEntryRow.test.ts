// @vitest-environment happy-dom
import {
  DeviceId,
  ProjectId,
  TaskId,
  emptyFolded,
  type DayEntry,
  type FoldedEntities,
  type Task,
} from "@yatma/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TodayEntryRow } from "./TodayEntryRow";
import type { useStackPlayer } from "../player/PlayerProvider";

vi.mock("react-native", async () => {
  const native = await vi.importActual<typeof import("react-native")>("react-native-web");
  // RN Web's test export completes animations immediately; exercise the fade lifecycle.
  const { default: Animated } = await vi.importActual<{ default: typeof native.Animated }>(
    "react-native-web/dist/vendor/react-native/Animated/AnimatedImplementation",
  );
  return { ...native, Animated: { ...native.Animated, ...Animated } };
});
vi.mock("../../ui/useDesktopLayout", () => ({ useDesktopLayout: () => true }));
vi.mock("../../ui", () => import("../../ui/IconButton"));
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("../task/useTaskNavigation", () => ({ useTaskNavigation: () => ({ openTask }) }));
vi.mock("../player/PlayerProvider", () => ({ useStackPlayer: () => player }));

const push = vi.fn();
const openTask = vi.fn();
const drag = vi.fn();
const up = vi.fn();
const down = vi.fn();
const play = vi.fn();
const pause = vi.fn();
const select = vi.fn();
const finish = vi.fn();
const later = vi.fn();
const tomorrow = vi.fn();
const execute = vi.fn();
let player: ReturnType<typeof useStackPlayer>;
let root: Root;
let container: HTMLDivElement;
const task: Task = {
  id: TaskId.make("t_AAAAAAA1"),
  title: "Plan the day",
  projectId: null,
  status: "todo",
  position: "n",
  dueDate: null,
  notes: "",
  quadrant: null,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  createdBy: { kind: "user", deviceId: DeviceId.make("test") },
  completedAt: null,
  deletedAt: null,
  lastReason: null,
};
const entry: DayEntry = {
  id: "entry",
  dayId: "today",
  kind: "task",
  taskId: task.id,
  title: task.title,
  allocationMinutes: 30,
  position: "n",
  status: "pending",
  origin: "manual:entry",
  manual: true,
  carryOrder: null,
  preparation: false,
  resumeEntryId: null,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const folded = {
    ...emptyFolded(),
    tasks: new Map([[task.id, task]]),
    dayEntries: new Map([[entry.id, entry]]),
  };
  player = {
    state: { folded, deviceId: "test" },
    now: "2026-11-11T00:10:00.000Z",
    runtimeState: { pending: false, error: null, reminder: "off" },
    runtime: { play, pause, finish, later, tomorrow, execute },
    select,
  } as unknown as ReturnType<typeof useStackPlayer>;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});
function updateFolded(set: Partial<FoldedEntities>) {
  player = { ...player, state: { ...player.state, folded: { ...player.state.folded, ...set } } };
}
async function render(reveal = true) {
  await act(async () =>
    root.render(
      createElement(TodayEntryRow, { entry, drag, dragging: false, moveUp: up, moveDown: down }),
    ),
  );
  if (reveal)
    await act(async () => {
      (container.firstElementChild as HTMLElement).focus();
    });
}

function control(label: string) {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!element) throw new Error(`Missing control: ${label}`);
  return element;
}
async function press(element: Element, duration = 100) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await vi.advanceTimersByTimeAsync(duration);
  });
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("minimal Today rows", () => {
  it("hides actions until the row receives focus", async () => {
    await render(false);
    expect(container.querySelector('[aria-label="Start Plan the day"]')).toBeNull();
    await render();
    expect(control("Start Plan the day")).toBeTruthy();
  });

  it("reveals from a child anywhere in the card and fades out on leaving the card", async () => {
    await render(false);
    const title = control(`Open details: ${task.title}`);
    await act(async () => {
      title.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(control(`Start ${task.title}`)).toBeTruthy();
    await act(async () => {
      title.dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(control(`Start ${task.title}`).closest('[aria-hidden="true"]')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(container.querySelector('[aria-label="Start Plan the day"]')).toBeNull();
  });

  it("keeps metadata minimal and puts one-click actions beside Play and Open", async () => {
    await render();
    expect(container.textContent).toBe(task.title);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[aria-label^="Task actions:"]')).toBeNull();
    await press(control(`Later: ${task.title}`));
    expect(later).toHaveBeenCalledExactlyOnceWith(entry.id, undefined);
    await press(control(`Tomorrow: ${task.title}`));
    expect(tomorrow).toHaveBeenCalledExactlyOnceWith(entry.id, undefined);
    await press(control(`Remove from Today: ${task.title}`));
    expect(execute).toHaveBeenCalledExactlyOnceWith([{ type: "day.remove", entryId: entry.id }]);
    await press(control(`Open ${task.title}`));
    expect(openTask).toHaveBeenCalledExactlyOnceWith(task.id);
  });

  it("shows project and worked time without zero placeholders", async () => {
    const projectId = ProjectId.make("p_AAAAAAA1");
    updateFolded({
      tasks: new Map([[task.id, { ...task, projectId }]]),
      projects: new Map([
        [
          projectId,
          {
            id: projectId,
            title: "Yatma",
            color: null,
            archivedAt: null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        ],
      ]),
    });
    await render();
    expect(container.textContent).toBe(`${task.title}Yatma`);
    updateFolded({
      workIntervals: new Map([
        [
          "run",
          {
            id: "run",
            entryId: entry.id,
            dayId: entry.dayId,
            deviceId: DeviceId.make("test"),
            startedAt: "2026-11-11T00:00:00.000Z",
            endedAt: "2026-11-11T00:05:00.000Z",
            correctedSeconds: null,
            updatedAt: player.now,
          },
        ],
      ]),
    });
    await render();
    expect(container.textContent).toBe(`${task.title}Yatma · 5:00 worked`);
  });

  it("reserves extra controls for the current task", async () => {
    player = { ...player, selected: entry };
    await render();
    expect(container.textContent).toContain("Current · 30:00 remaining");
    await press(control(`Finish ${task.title}`));
    expect(finish).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(container.querySelector("input")).toBeNull();
  });

  it("starts dragging on handle press without opening or starting a task", async () => {
    await render();
    await act(async () => {
      control(`Reorder ${task.title}`).dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(drag).toHaveBeenCalledTimes(1);
    expect(openTask).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("opens details on tap and suppresses navigation on a long-press drag", async () => {
    await render();
    await press(control(`Open details: ${task.title}`));
    expect(openTask).toHaveBeenCalledExactlyOnceWith(task.id);
    openTask.mockClear();
    await press(control(`Open details: ${task.title}`), 300);
    expect(drag).toHaveBeenCalledTimes(1);
    expect(openTask).not.toHaveBeenCalled();
  });

  it("offers keyboard reordering and blocks it during writes", async () => {
    await render();
    for (const key of ["ArrowUp", "ArrowDown"]) {
      await act(async () =>
        control(`Reorder ${task.title}`).dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        ),
      );
    }
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).toHaveBeenCalledTimes(1);
    player = { ...player, runtimeState: { ...player.runtimeState, pending: true } };
    await render();
    await act(async () =>
      control(`Reorder ${task.title}`).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      ),
    );
    expect(up).toHaveBeenCalledTimes(1);
    expect(drag).not.toHaveBeenCalled();
  });

  it("starts a queued task without navigating away from Today", async () => {
    await render();
    await press(control(`Start ${task.title}`));
    expect(select).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(play).toHaveBeenCalledExactlyOnceWith(entry.id);
    expect(push).not.toHaveBeenCalled();
    expect(openTask).not.toHaveBeenCalled();
  });
});
