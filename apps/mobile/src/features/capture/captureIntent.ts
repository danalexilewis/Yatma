type Listener = () => void;

let pendingOpen = false;
const listeners = new Set<Listener>();

/** Queue opening the Capture sheet (e.g. from yatma://capture). */
export function requestCaptureOpen(): void {
  pendingOpen = true;
  for (const listener of listeners) listener();
}

/** Subscribe; returns whether a capture open is currently pending. */
export function subscribeCaptureOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function consumeCaptureOpen(): boolean {
  if (!pendingOpen) return false;
  pendingOpen = false;
  return true;
}
