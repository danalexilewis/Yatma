import type { Event, FoldedEntities, ProjectId, TaskId, TaskUpdateInput } from "@yatma/core";
import { emptyFolded, foldEvents } from "@yatma/core";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { appendEventAndUpsert, hydrateLocalState, openDatabase } from "../db/database";
import { lastSeenAtFromEvents } from "../db/entities";
import {
  createProject as writeCreateProject,
  createTask as writeCreateTask,
  updateTask as writeUpdateTask,
  type WriteDeps,
} from "../events/write";

export type AppState = {
  readonly folded: FoldedEntities;
  readonly ready: boolean;
  readonly deviceId: string;
  readonly lastSeenAt: string | null;
};

type Action =
  | {
      readonly type: "hydrated";
      readonly folded: FoldedEntities;
      readonly deviceId: string;
      readonly lastSeenAt: string | null;
    }
  | { readonly type: "replaceFolded"; readonly folded: FoldedEntities }
  | { readonly type: "reset" };

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrated":
      return {
        ready: true,
        deviceId: action.deviceId,
        folded: action.folded,
        lastSeenAt: action.lastSeenAt,
      };
    case "replaceFolded":
      return {
        ...state,
        folded: action.folded,
        lastSeenAt: lastSeenAtFromEvents(action.folded.events),
      };
    case "reset":
      return {
        ready: true,
        deviceId: state.deviceId,
        folded: emptyFolded(),
        lastSeenAt: null,
      };
  }
}

const initialState: AppState = {
  folded: emptyFolded(),
  ready: false,
  deviceId: "device_pending",
  lastSeenAt: null,
};

type AppStore = {
  readonly state: AppState;
  readonly dispatchLocalEvent: (event: Event) => Promise<void>;
  readonly mergeRemoteEvents: (events: readonly Event[]) => void;
  readonly resetState: () => void;
  readonly createTask: (input: {
    readonly title: string;
    readonly projectId?: string | null;
  }) => Promise<TaskId>;
  readonly updateTask: (input: TaskUpdateInput) => Promise<"updated" | "noop">;
  readonly createProject: (input: {
    readonly title: string;
    readonly color?: string | null;
  }) => Promise<ProjectId>;
};

const AppStateContext = createContext<AppStore | null>(null);

type DepsHolder = { deps: WriteDeps };

async function seedDevSample(holder: DepsHolder): Promise<void> {
  const projectId = await writeCreateProject(holder.deps, {
    title: "Sample project",
    color: "#0F766E",
  });
  await writeCreateTask(holder.deps, { title: "Welcome to Yatma", projectId });
  await writeCreateTask(holder.deps, {
    title: "Swipe right to complete",
    projectId,
  });
  await writeCreateTask(holder.deps, { title: "Triage me from the Inbox tab" });
}

function advanceDeps(holder: DepsHolder, event: Event): void {
  const folded = foldEvents([...holder.deps.folded.events, event]);
  holder.deps = {
    ...holder.deps,
    folded,
    lastSeenAt: lastSeenAtFromEvents(folded.events),
  };
}

/** Local-first store: SQLite hydrate → fold → dispatch appends to outbox. */
export function AppStateProvider(props: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [bootstrapped, setBootstrapped] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      await openDatabase();
      let hydrated = await hydrateLocalState();
      if (cancelled) return;

      if (
        typeof __DEV__ !== "undefined" &&
        __DEV__ &&
        hydrated.folded.events.length === 0
      ) {
        const holder: DepsHolder = {
          deps: {
            deviceId: hydrated.deviceId,
            lastSeenAt: hydrated.lastSeenAt,
            folded: hydrated.folded,
            dispatch: async () => undefined,
          },
        };
        holder.deps = {
          ...holder.deps,
          dispatch: async (event) => {
            const next = await appendEventAndUpsert(event, stateRef.current.folded);
            stateRef.current = {
              ...stateRef.current,
              folded: next,
              lastSeenAt: lastSeenAtFromEvents(next.events),
            };
            advanceDeps(holder, event);
          },
        };
        await seedDevSample(holder);
        if (cancelled) return;
        hydrated = await hydrateLocalState();
      }

      if (cancelled) return;
      dispatch({
        type: "hydrated",
        folded: hydrated.folded,
        deviceId: hydrated.deviceId,
        lastSeenAt: hydrated.lastSeenAt,
      });
      setBootstrapped(true);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function dispatchLocalEvent(event: Event): Promise<void> {
    const next = await appendEventAndUpsert(event, stateRef.current.folded);
    stateRef.current = {
      ...stateRef.current,
      folded: next,
      lastSeenAt: lastSeenAtFromEvents(next.events),
      ready: true,
    };
    dispatch({ type: "replaceFolded", folded: next });
  }

  function writeDeps(): WriteDeps {
    return {
      deviceId: stateRef.current.deviceId,
      lastSeenAt: stateRef.current.lastSeenAt,
      folded: stateRef.current.folded,
      dispatch: dispatchLocalEvent,
    };
  }

  function mergeRemoteEvents(events: readonly Event[]): void {
    if (events.length === 0) return;
    // Sync engine persists to SQLite first; this only updates folded memory.
    const folded = foldEvents([...stateRef.current.folded.events, ...events]);
    stateRef.current = {
      ...stateRef.current,
      folded,
      lastSeenAt: lastSeenAtFromEvents(folded.events),
    };
    dispatch({ type: "replaceFolded", folded });
  }

  function resetState(): void {
    dispatch({ type: "reset" });
  }

  async function createTask(input: {
    readonly title: string;
    readonly projectId?: string | null;
  }): Promise<TaskId> {
    return writeCreateTask(writeDeps(), input);
  }

  async function updateTask(input: TaskUpdateInput): Promise<"updated" | "noop"> {
    return writeUpdateTask(writeDeps(), input);
  }

  async function createProject(input: {
    readonly title: string;
    readonly color?: string | null;
  }): Promise<ProjectId> {
    return writeCreateProject(writeDeps(), input);
  }

  const store: AppStore = {
    state: bootstrapped ? state : { ...state, ready: false },
    dispatchLocalEvent,
    mergeRemoteEvents,
    resetState,
    createTask,
    updateTask,
    createProject,
  };

  return createElement(AppStateContext.Provider, { value: store }, props.children);
}

export function useAppStore(): AppStore {
  const store = useContext(AppStateContext);
  if (!store) {
    throw new Error("useAppStore must be used within AppStateProvider");
  }
  return store;
}

export function useFoldedState(): FoldedEntities {
  return useAppStore().state.folded;
}
