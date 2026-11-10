import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";

import { DATABASE_NAME } from "./schema";

type DatabaseRuntime = {
  databases: Map<string, Promise<SQLiteDatabase>>;
  openTail: Promise<void>;
  writeTail: Promise<void>;
  activeDatabaseName: string;
  accountSelectionGeneration: number;
  ownership?: Promise<void>;
};

const browserScope = globalThis as typeof globalThis & {
  __yatmaDatabaseRuntime?: DatabaseRuntime;
};

/** Keep web connections and serialization alive across Metro Fast Refresh. */
export function getDatabaseRuntime(): DatabaseRuntime {
  if (Platform.OS === "web" && browserScope.__yatmaDatabaseRuntime) {
    return browserScope.__yatmaDatabaseRuntime;
  }
  const runtime: DatabaseRuntime = {
    databases: new Map(),
    openTail: Promise.resolve(),
    writeTail: Promise.resolve(),
    activeDatabaseName: DATABASE_NAME,
    accountSelectionGeneration: 0,
  };
  if (Platform.OS === "web") browserScope.__yatmaDatabaseRuntime = runtime;
  return runtime;
}

/** Claim Expo's entire OPFS pool before opening any account file; released on page exit. */
export async function ensureWebStorageOwner(runtime: DatabaseRuntime): Promise<void> {
  if (Platform.OS !== "web") return;
  if (!runtime.ownership) {
    const ownership = new Promise<void>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.locks) {
        reject(
          new Error("Web Locks are unavailable. Use a supported browser on localhost or HTTPS."),
        );
        return;
      }
      void navigator.locks
        .request("yatma:expo-sqlite", { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!lock) {
            const error = new Error("Local storage is already open in another tab.");
            error.name = "StorageInUseError";
            reject(error);
            return;
          }
          resolve();
          // Closing a SQLite connection does not release Expo's pooled access handles.
          // Hold ownership until the browser disposes this page and its worker together.
          await new Promise<void>(() => {});
        })
        .catch(reject);
    });
    runtime.ownership = ownership;
    void ownership.catch(() => {
      if (runtime.ownership === ownership) delete runtime.ownership;
    });
  }
  return runtime.ownership;
}

/** Explain recoverable startup failures without discarding the journal or unsent edits. */
export function storageErrorMessage(error: unknown): string {
  if (Platform.OS !== "web") {
    return "Local storage is unavailable. Try again to open your saved workspace.";
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (
    /StorageInUseError|NoModificationAllowedError|createSyncAccessHandle|Invalid VFS state/.test(
      message,
    )
  ) {
    return "Yatma is open in another tab or window. Close the other Yatma tabs, then reload this page to open your saved workspace.";
  }
  return "Local storage could not be opened. Use a supported browser on localhost or HTTPS, then reload this page. Your saved data has not been cleared.";
}
