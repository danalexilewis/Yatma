import { describe, expect, it, vi } from "vite-plus/test";

import { createAudioSessionCoordinator } from "./audioSession";
import { createRecordingLifecycle } from "./recordingLifecycle";

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<A>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness(overrides: Partial<Parameters<typeof createRecordingLifecycle>[0]> = {}) {
  const session = createAudioSessionCoordinator();
  const release = vi.fn();
  const deps = {
    requestPermission: vi.fn(async () => true),
    configure: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    record: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    acquireSession: vi.fn(() => {
      const releaseOwner = session.acquireRecording();
      return () => {
        release();
        releaseOwner();
      };
    }),
    ...overrides,
  };
  return { lifecycle: createRecordingLifecycle(deps), deps, session, release };
}

describe("recording setup and teardown", () => {
  it("locks synchronously before permission and acquires only one microphone owner", async () => {
    const permission = deferred<boolean>();
    const h = harness({ requestPermission: () => permission.promise });
    const started = h.lifecycle.start();
    expect(await h.lifecycle.start()).toBe(false);
    permission.resolve(true);
    expect(await started).toBe(true);
    expect(h.lifecycle.isRecording()).toBe(true);
    expect(h.deps.acquireSession).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(true);
    await h.lifecycle.stop();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(false);
  });

  it("never starts recording after disposal while permission is unresolved", async () => {
    const permission = deferred<boolean>();
    const h = harness({ requestPermission: () => permission.promise });
    const started = h.lifecycle.start();
    await Promise.resolve();
    await h.lifecycle.dispose();
    permission.resolve(true);
    expect(await started).toBe(false);
    expect(h.deps.acquireSession).not.toHaveBeenCalled();
    expect(h.deps.record).not.toHaveBeenCalled();
    expect(await h.lifecycle.start()).toBe(false);
  });

  it("keeps pending preparation owned until its fenced cleanup stops the native recorder", async () => {
    const prepare = deferred<void>();
    const h = harness({ prepare: vi.fn(() => prepare.promise) });
    const started = h.lifecycle.start();
    await vi.waitFor(() => expect(h.deps.prepare).toHaveBeenCalledTimes(1));
    expect(h.session.getSnapshot()).toBe(true);
    const disposed = h.lifecycle.dispose();
    expect(h.session.getSnapshot()).toBe(true);
    prepare.resolve();
    await disposed;
    expect(await started).toBe(false);
    expect(h.deps.record).not.toHaveBeenCalled();
    expect(h.deps.stop).toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(false);
  });

  it("fences setup canceled while audio configuration is pending", async () => {
    const configured = deferred<void>();
    let calls = 0;
    const configure = vi.fn(async () => {
      if (++calls === 1) await configured.promise;
    });
    const h = harness({ configure });
    const started = h.lifecycle.start();
    await vi.waitFor(() => expect(configure).toHaveBeenCalledTimes(1));
    await h.lifecycle.stop();
    expect(h.session.getSnapshot()).toBe(true);
    configured.resolve();
    expect(await started).toBe(false);
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(false);
  });

  it("stops a record call that finishes after cancellation", async () => {
    const record = deferred<void>();
    const h = harness({ record: vi.fn(() => record.promise) });
    const started = h.lifecycle.start();
    await vi.waitFor(() => expect(h.deps.record).toHaveBeenCalledTimes(1));
    await h.lifecycle.stop();
    record.resolve();
    expect(await started).toBe(false);
    expect(h.lifecycle.isRecording()).toBe(false);
    expect(h.session.getSnapshot()).toBe(false);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.deps.stop).toHaveBeenCalledTimes(2);
  });

  it("reports permission denial without acquiring resources and allows a later retry", async () => {
    let granted = false;
    const h = harness({ requestPermission: async () => granted });
    await expect(h.lifecycle.start()).rejects.toThrow("Microphone access was denied");
    expect(h.deps.acquireSession).not.toHaveBeenCalled();
    granted = true;
    expect(await h.lifecycle.start()).toBe(true);
    await h.lifecycle.dispose();
  });

  it("releases ownership and preserves the setup error when native preparation fails", async () => {
    const h = harness({
      prepare: async () => {
        throw new Error("native prepare failed");
      },
    });
    await expect(h.lifecycle.start()).rejects.toThrow("native prepare failed");
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(false);
    expect(h.lifecycle.isRecording()).toBe(false);
    expect(h.deps.stop).toHaveBeenCalledTimes(1);
  });

  it("releases only its own owner when another recorder is active", async () => {
    const h = harness();
    const releaseOther = h.session.acquireRecording();
    expect(await h.lifecycle.start()).toBe(true);
    await h.lifecycle.stop();
    await h.lifecycle.dispose();
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.session.getSnapshot()).toBe(true);
    releaseOther();
    expect(h.session.getSnapshot()).toBe(false);
  });

  it("keeps ambience interrupted until an active native stop finishes", async () => {
    const stopped = deferred<void>();
    const h = harness({ stop: vi.fn(() => stopped.promise) });
    expect(await h.lifecycle.start()).toBe(true);
    const stopping = h.lifecycle.stop();
    await Promise.resolve();
    expect(h.session.getSnapshot()).toBe(true);
    expect(h.release).not.toHaveBeenCalled();
    stopped.resolve();
    await stopping;
    expect(h.session.getSnapshot()).toBe(false);
    expect(h.release).toHaveBeenCalledTimes(1);
  });

  it("waits for an earlier native stop before starting the next preparation", async () => {
    const stopped = deferred<void>();
    const h = harness({ stop: vi.fn(() => stopped.promise) });
    expect(await h.lifecycle.start()).toBe(true);
    const stopping = h.lifecycle.stop();
    expect(h.session.getSnapshot()).toBe(true);
    const restarting = h.lifecycle.start();
    await Promise.resolve();
    expect(h.deps.prepare).toHaveBeenCalledTimes(1);
    stopped.resolve();
    await stopping;
    expect(await restarting).toBe(true);
    expect(h.deps.prepare).toHaveBeenCalledTimes(2);
    await h.lifecycle.dispose();
  });
});
