import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { type ReactNode, useEffect, useRef } from "react";

import { useAppStore } from "../../state/atoms";
import { useSetSyncStatus } from "../../state/syncStatusAtom";
import { startSyncEngine, type SyncEngine } from "../../sync/engine";

function resolveClerkPublishableKey(): string | null {
  const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function resolveSyncUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_SYNC_URL?.trim();
  return url && url.length > 0 ? url : null;
}

function SyncBridge(props: { readonly children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { mergeRemoteEvents, state } = useAppStore();
  const setSyncStatus = useSetSyncStatus();
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !state.ready) {
      engineRef.current?.stop();
      engineRef.current = null;
      setSyncStatus("idle");
      return;
    }

    const url = resolveSyncUrl();
    if (!url) return;

    const engine = startSyncEngine({
      url,
      getToken: () => getToken(),
      deviceId: state.deviceId,
      onStatus: setSyncStatus,
      mergeRemoteEvents,
    });
    engineRef.current = engine;

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [getToken, isLoaded, isSignedIn, mergeRemoteEvents, setSyncStatus, state.deviceId, state.ready]);

  return props.children;
}

/** Clerk + optional sync bridge. Renders children when Clerk is unconfigured. */
export function AuthProvider(props: { readonly children: ReactNode }) {
  const publishableKey = resolveClerkPublishableKey();

  if (!publishableKey) {
    return props.children;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SyncBridge>{props.children}</SyncBridge>
    </ClerkProvider>
  );
}
