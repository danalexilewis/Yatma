type RecordingLease = { readonly release: () => void; released: boolean };

/** Fence asynchronous microphone setup and release each session lease exactly once. */
export function createRecordingLifecycle(deps: {
  readonly requestPermission: () => Promise<boolean>;
  readonly configure: () => Promise<void>;
  readonly prepare: () => Promise<void>;
  readonly record: () => void | Promise<void>;
  readonly stop: () => Promise<void>;
  readonly acquireSession: () => () => void;
}) {
  let generation = 0;
  let disposed = false;
  let starting = false;
  let recording = false;
  let nativeEngaged = false;
  let lease: RecordingLease | null = null;
  let stopTail = Promise.resolve();

  function release(current: RecordingLease | null) {
    if (!current || current.released) return;
    current.released = true;
    current.release();
    if (lease === current) lease = null;
  }

  function stopNative() {
    const next = stopTail.catch(() => {}).then(deps.stop);
    stopTail = next;
    return next;
  }

  async function start(): Promise<boolean> {
    if (disposed || starting || recording) return false;
    starting = true;
    const ownGeneration = generation;
    let ownLease: RecordingLease | null = null;
    let attemptedNativeSetup = false;
    function current() {
      return !disposed && ownGeneration === generation;
    }
    async function cleanup() {
      try {
        if (attemptedNativeSetup) {
          nativeEngaged = false;
          await stopNative().catch(() => {});
        }
      } finally {
        release(ownLease);
        if (ownLease) await deps.configure().catch(() => {});
      }
    }
    try {
      await stopTail.catch(() => {});
      if (!current()) return false;
      const granted = await deps.requestPermission();
      if (!current()) return false;
      if (!granted)
        throw new Error("Microphone access was denied. Enable it in device settings to dictate.");
      ownLease = { release: deps.acquireSession(), released: false };
      lease = ownLease;
      await deps.configure();
      if (!current()) {
        await cleanup();
        return false;
      }
      attemptedNativeSetup = true;
      nativeEngaged = true;
      await deps.prepare();
      if (!current()) {
        await cleanup();
        return false;
      }
      await deps.record();
      if (!current()) {
        await cleanup();
        return false;
      }
      recording = true;
      return true;
    } catch (error) {
      await cleanup();
      if (!current()) return false;
      throw error;
    } finally {
      starting = false;
    }
  }

  async function stop(): Promise<void> {
    generation += 1;
    recording = false;
    const ownedLease = lease;
    const pendingStartOwnsCleanup = starting;
    const shouldStop = nativeEngaged;
    nativeEngaged = false;
    try {
      if (shouldStop) await stopNative();
    } finally {
      // Ambience stays interrupted until native capture has actually stopped.
      // A still-pending setup releases its lease in its fenced continuation.
      if (!pendingStartOwnsCleanup) release(ownedLease);
      await deps.configure();
    }
  }

  function dispose(): Promise<void> {
    disposed = true;
    return stop();
  }

  function isRecording() {
    return recording;
  }
  return { start, stop, dispose, isRecording };
}
