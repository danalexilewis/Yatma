import { describe, expect, it, vi } from "vite-plus/test";

import { createAudioSessionCoordinator } from "./audioSession";

describe("microphone and ambient audio ownership", () => {
  it("keeps ambience interrupted until every recording owner releases", () => {
    const session = createAudioSessionCoordinator();
    const observed: boolean[] = [];
    session.subscribe(() => {
      observed.push(session.getSnapshot());
    });
    expect(session.getSnapshot()).toBe(false);
    const releaseDictation = session.acquireRecording();
    const releaseSecondCapture = session.acquireRecording();
    expect(session.getSnapshot()).toBe(true);
    releaseDictation();
    expect(session.getSnapshot()).toBe(true);
    releaseSecondCapture();
    expect(session.getSnapshot()).toBe(false);
    expect(observed).toEqual([true, true, true, false]);
  });

  it("releases each owner once and never releases another recording accidentally", () => {
    const session = createAudioSessionCoordinator();
    const listener = vi.fn();
    session.subscribe(listener);
    const releaseOld = session.acquireRecording();
    releaseOld();
    const releaseCurrent = session.acquireRecording();
    releaseOld();
    expect(session.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);
    releaseCurrent();
    releaseCurrent();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(session.getSnapshot()).toBe(false);
  });

  it("does not retain an unmounted subscriber or share recording ownership across sessions", () => {
    const first = createAudioSessionCoordinator();
    const second = createAudioSessionCoordinator();
    const listener = vi.fn();
    const unsubscribe = first.subscribe(listener);
    const release = first.acquireRecording();
    unsubscribe();
    release();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(second.getSnapshot()).toBe(false);
    expect(first.getSnapshot()).toBe(false);
  });
});
