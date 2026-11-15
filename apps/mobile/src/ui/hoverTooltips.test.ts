// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { installHoverTooltips } from "./installHoverTooltips";
let cleanup: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  cleanup = installHoverTooltips(document);
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});
function hover(element: Element) {
  element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
}
function text() {
  return document.querySelector('[role="tooltip"]')?.textContent;
}
it("shows a short label after 150ms while preserving the accessible task name", () => {
  document.body.innerHTML =
    '<button aria-label="Start Write proposal" data-tooltip="Play"><span>\uf123</span></button>';
  hover(document.querySelector("span")!);
  vi.advanceTimersByTime(149);
  expect(text()).toBeUndefined();
  vi.advanceTimersByTime(1);
  expect(text()).toBe("Play");
  expect(document.querySelector("button")?.getAttribute("aria-label")).toBe("Start Write proposal");
});
it("cancels on exit, changes labels between controls, and dismisses on Escape", () => {
  document.body.innerHTML =
    '<button aria-label="Complete Write proposal"></button><a href="/today" aria-label="Today"><span>\uf123</span></a>';
  const button = document.querySelector("button")!;
  hover(button);
  button.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  vi.advanceTimersByTime(200);
  expect(text()).toBeUndefined();
  hover(button);
  vi.advanceTimersByTime(150);
  expect(text()).toBe("Complete");
  hover(document.querySelector("a")!);
  vi.advanceTimersByTime(150);
  expect(text()).toBe("Today");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(text()).toBeUndefined();
});
it("suppresses the native tooltip during hover and restores explicit titles on cleanup", () => {
  document.body.innerHTML = '<button title="Custom help">\uf123</button>';
  const button = document.querySelector("button")!;
  hover(button);
  vi.advanceTimersByTime(150);
  expect(text()).toBe("Custom help");
  expect(button.hasAttribute("title")).toBe(false);
  cleanup();
  expect(button.title).toBe("Custom help");
});

it("does not show tooltips for text buttons, text links or icons alongside text", () => {
  document.body.innerHTML =
    '<button title="Save">Save</button><a href="/today" aria-label="Today">Today</a><button aria-label="New task"><span>\uf123</span>New task</button>';
  for (const control of Array.from(document.querySelectorAll("button, a"))) {
    hover(control);
    vi.advanceTimersByTime(200);
    expect(text()).toBeUndefined();
    expect(control.hasAttribute("title")).toBe(false);
  }
});
