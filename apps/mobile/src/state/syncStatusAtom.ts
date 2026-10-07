import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";

import type { SyncClientStatus } from "../sync/client";

/** Effect atom for websocket sync connection status. */
export const syncStatusAtom: Atom.Writable<SyncClientStatus, SyncClientStatus> =
  Atom.make<SyncClientStatus>("idle");

export function useSyncStatus(): SyncClientStatus {
  return useAtomValue(syncStatusAtom);
}

/** Setter bound to the current RegistryProvider. */
export function useSetSyncStatus(): (status: SyncClientStatus) => void {
  return useAtomSet(syncStatusAtom);
}
