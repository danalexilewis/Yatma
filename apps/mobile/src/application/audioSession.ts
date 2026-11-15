/** One session coordinates ambient playback and any microphone capture owner. */
export function createAudioSessionCoordinator() {
  const owners = new Set<symbol>();
  const listeners = new Set<() => void>();
  function notify() {
    for (const listener of listeners) listener();
  }
  function acquireRecording() {
    const owner = Symbol("recording");
    owners.add(owner);
    notify();
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      owners.delete(owner);
      notify();
    };
  }
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function getSnapshot() {
    return owners.size > 0;
  }
  return { acquireRecording, subscribe, getSnapshot };
}

export const audioSession = createAudioSessionCoordinator();
