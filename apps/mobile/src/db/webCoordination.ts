/** Hold a short cross-tab lock for an operation; native has no browser globals. */
export async function withBrowserLock<A>(name: string, task: () => Promise<A>): Promise<A> {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.locks) {
    return task();
  }
  return navigator.locks.request(name, { mode: "exclusive" }, task);
}

let changes: BroadcastChannel | undefined;
function changeChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  changes ??= new BroadcastChannel("yatma:database-changes");
  return changes;
}

/** Notify sibling tabs only after a storage operation has completed successfully. */
export function notifyDatabaseChanged(databaseName: string) {
  changeChannel()?.postMessage(databaseName);
}

/** Subscribe to committed changes from sibling tabs; callers fence account switches. */
export function subscribeDatabaseChanges(listener: (databaseName: string) => void) {
  const channel = changeChannel();
  function receive(event: MessageEvent) {
    if (typeof event.data === "string") listener(event.data);
  }
  channel?.addEventListener("message", receive);
  return () => channel?.removeEventListener("message", receive);
}
