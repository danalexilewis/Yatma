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
  const { getToken, isLoaded, isSignedIn, sessionId, userId } = useAuth({
    treatPendingAsSignedOut: false,
  });
  const { mergeRemoteEvents, state, switchLocalAccount } = useAppStore();
  const setSyncStatus = useSetSyncStatus();
  const engineRef = useRef<SyncEngine | null>(null);
  const accountRequestRef = useRef<string | null>(null);
  const sessionKey = isSignedIn
    ? `${userId ?? ""}\u0000${sessionId ?? ""}\u0000${state.deviceId}\u0000${state.ready}`
    : "signed-out";
  const sessionGenerationRef = useRef({ key: sessionKey, generation: 0 });
  if (sessionGenerationRef.current.key !== sessionKey) {
    sessionGenerationRef.current = {
      key: sessionKey,
      generation: sessionGenerationRef.current.generation + 1,
    };
  }
  const getTokenRef = useRef(getToken);
  const mergeRemoteEventsRef = useRef(mergeRemoteEvents);
  getTokenRef.current = getToken;
  mergeRemoteEventsRef.current = mergeRemoteEvents;

  const accountId = isSignedIn ? userId ?? null : null;
  useEffect(() => {
    if (!isLoaded || (isSignedIn && !userId)) return;
    if (state.accountId === accountId && state.ready) return;
    const requestKey = accountId ?? "anonymous";
    if (accountRequestRef.current === requestKey) return;
    accountRequestRef.current = requestKey;
    void switchLocalAccount(accountId).catch((error) => {
      console.error("Local account switch failed", error);
    });
  }, [accountId, isLoaded, isSignedIn, state.accountId, state.ready, switchLocalAccount, userId]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !userId || !state.ready || state.accountId !== userId) {
      engineRef.current?.stop();
      engineRef.current = null;
      setSyncStatus("idle");
      return;
    }

    const url = resolveSyncUrl();
    if (!url) return;
    const sessionGeneration = sessionGenerationRef.current.generation;
    const isCurrentSession = () =>
      sessionGenerationRef.current.generation === sessionGeneration;

    const engine = startSyncEngine({
      url,
      getToken: () => (isCurrentSession() ? getTokenRef.current() : Promise.resolve(null)),
      deviceId: state.deviceId,
      onStatus: (status) => {
        if (isCurrentSession()) setSyncStatus(status);
      },
      mergeRemoteEvents: (events, cursor) => {
        if (!isCurrentSession()) throw new Error("sync session changed");
        return mergeRemoteEventsRef.current(events, cursor);
      },
    });
    engineRef.current = engine;

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [isLoaded, isSignedIn, sessionId, setSyncStatus, state.accountId, state.deviceId, state.ready, userId]);

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
