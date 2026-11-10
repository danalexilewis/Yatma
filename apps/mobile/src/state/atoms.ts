import type {
  BatchCommand,
  BatchId,
  Event,
  FoldedEntities,
  ProjectId,
  TaskId,
  TaskUpdateInput,
} from "@yatma/core";
import {
  emptyFolded,
  generateShortId,
  ProjectId as ProjectIdSchema,
  TaskId as TaskIdSchema,
  BatchId as BatchIdSchema,
} from "@yatma/core";
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

import {
  commitLocalBatch,
  hydrateLocalState,
  mergeRemoteBatch,
  openDatabase,
  selectLocalAccount,
  wipeLocalData,
} from "../db/database";
import { lastSeenAtFromEvents } from "../db/entities";
import { storageErrorMessage } from "../db/runtime";
import {
  createLocalMutationWriter,
  localUserActor,
  type LocalMutationResult,
  type LocalUndoResult,
} from "../application/mutations";

export type AppState = {
  readonly accountId: string | null;
  readonly folded: FoldedEntities;
  readonly ready: boolean;
  readonly deviceId: string;
  readonly lastSeenAt: string | null;
  readonly storageError: string | null;
};

type Action =
  | {
      readonly type: "hydrated";
      readonly accountId?: string | null;
      readonly folded: FoldedEntities;
      readonly deviceId: string;
      readonly lastSeenAt: string | null;
      readonly storageError?: string | null;
    }
  | { readonly type: "accountSwitchStarted"; readonly accountId: string | null }
  | { readonly type: "replaceFolded"; readonly folded: FoldedEntities }
  | { readonly type: "hydrationFailure"; readonly message: string }
  | { readonly type: "storageFailure"; readonly message: string }
  | { readonly type: "reset" };

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "hydrated":
      return {
        accountId: action.accountId === undefined ? state.accountId : action.accountId,
        ready: true,
        deviceId: action.deviceId,
        folded: action.folded,
        lastSeenAt: action.lastSeenAt,
        storageError: action.storageError ?? null,
      };
    case "replaceFolded":
      return {
        ...state,
        folded: action.folded,
        lastSeenAt: lastSeenAtFromEvents(action.folded.events),
        storageError: null,
      };
    case "storageFailure":
      return { ...state, storageError: action.message };
    case "hydrationFailure":
      return { ...state, ready: false, storageError: action.message };
    case "accountSwitchStarted":
      return {
        ...state,
        accountId: action.accountId,
        folded: emptyFolded(),
        ready: false,
        deviceId: "device_pending",
        lastSeenAt: null,
        storageError: null,
      };
    case "reset":
      return {
        accountId: state.accountId,
        ready: true,
        deviceId: state.deviceId,
        folded: emptyFolded(),
        lastSeenAt: null,
        storageError: null,
      };
  }
}

const initialState: AppState = {
  accountId: null,
  folded: emptyFolded(),
  ready: false,
  deviceId: "device_pending",
  lastSeenAt: null,
  storageError: null,
};

type AppStore = {
  readonly state: AppState;
  readonly dispatchLocalEvent: (event: Event) => Promise<void>;
  readonly executeLocalCommands: (
    commands: readonly BatchCommand[],
    context?: { readonly batchId?: BatchId; readonly undoes?: BatchId },
  ) => Promise<LocalMutationResult>;
  readonly undoBatch: (
    batchId: string,
    events: readonly Event[],
    reason: string,
  ) => Promise<LocalUndoResult>;
  readonly mergeRemoteEvents: (
    events: readonly Event[],
    cursor?: { readonly key: string; readonly after: number },
  ) => Promise<void>;
  readonly resetState: () => Promise<void>;
  readonly switchLocalAccount: (accountId: string | null) => Promise<void>;
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

function commandFromEvent(event: Event): BatchCommand {
  switch (event.type) {
    case "task.created":
      return {
        type: "task.create",
        taskId: event.taskId,
        input: {
          title: event.title,
          tags: event.tags,
          projectId: event.projectId,
          notes: event.notes,
          dueDate: event.dueDate,
          reason: event.reason,
        },
      };
    case "task.updated":
      return {
        type: "task.update",
        input: { taskId: event.taskId, ...event.set, reason: event.reason },
      };
    case "project.created":
      return {
        type: "project.create",
        projectId: event.projectId,
        input: { title: event.title, color: event.color, reason: event.reason },
      };
    case "project.updated":
      return {
        type: "project.update",
        input: { projectId: event.projectId, ...event.set, reason: event.reason },
      };
    case "page.created":
      return {
        type: "page.create",
        pageId: event.pageId,
        input: {
          projectId: event.projectId,
          kind: event.kind,
          title: event.title,
          body: event.body,
          pinned: event.pinned,
          reason: event.reason,
        },
      };
    case "page.updated":
      return {
        type: "page.update",
        input: { pageId: event.pageId, ...event.set, reason: event.reason },
      };
    case "chat.created":
      return {
        type: "chat.create",
        chatId: event.chatId,
        input: { projectId: event.projectId, title: event.title },
      };
    case "chat.message":
      return {
        type: "chat.message",
        chatId: event.chatId,
        messageId: event.messageId,
        role: event.role,
        text: event.text,
      };
    case "chat.updated":
      return { type: "chat.update", input: { chatId: event.chatId, ...event.set } };
  }
}

const AppStateContext = createContext<AppStore | null>(null);

/** Local-first store: SQLite hydrate → fold → dispatch appends to outbox. */
export function AppStateProvider(props: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [bootstrapped, setBootstrapped] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const generationRef = useRef(0);
  const switchingAccountRef = useRef(false);
  const mutationWriterRef = useRef<ReturnType<typeof createLocalMutationWriter> | null>(null);
  if (!mutationWriterRef.current) {
    mutationWriterRef.current = createLocalMutationWriter({
      readSnapshot: hydrateLocalState,
      commitBatch: commitLocalBatch,
      sessionGeneration: () => generationRef.current,
      onStorageFailure: (error) => {
        console.error("Local mutation failed", error);
        dispatch({
          type: "storageFailure",
          message: "Local storage is unavailable. Changes could not be saved.",
        });
      },
      publish: (folded) => {
        stateRef.current = {
          ...stateRef.current,
          folded,
          lastSeenAt: lastSeenAtFromEvents(folded.events),
          ready: true,
          storageError: null,
        };
        dispatch({ type: "replaceFolded", folded });
      },
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const generation = generationRef.current;
      try {
        await openDatabase();
        let hydrated = await hydrateLocalState();
        if (cancelled || generation !== generationRef.current) return;

        if (typeof __DEV__ !== "undefined" && __DEV__ && hydrated.folded.events.length === 0) {
          const projectId = ProjectIdSchema.make(generateShortId("p_"));
          const commands: BatchCommand[] = [
            {
              type: "project.create",
              projectId,
              input: { title: "Sample project", color: "#1F6B4A" },
            },
            {
              type: "task.create",
              taskId: TaskIdSchema.make(generateShortId("t_")),
              input: { title: "Welcome to Yatma", projectId },
            },
            {
              type: "task.create",
              taskId: TaskIdSchema.make(generateShortId("t_")),
              input: { title: "Hold a task to change its priority", projectId },
            },
            {
              type: "task.create",
              taskId: TaskIdSchema.make(generateShortId("t_")),
              input: { title: "Place this task in the Eisenhower matrix", projectId: null },
            },
          ];
          await mutationWriterRef.current!.execute(commands, localUserActor(hydrated.deviceId));
          if (cancelled || generation !== generationRef.current) return;
          hydrated = await hydrateLocalState();
        }

        if (cancelled || generation !== generationRef.current) return;
        dispatch({
          type: "hydrated",
          folded: hydrated.folded,
          deviceId: hydrated.deviceId,
          lastSeenAt: hydrated.lastSeenAt,
        });
      } catch (error) {
        if (cancelled || generation !== generationRef.current) return;
        console.error("Local database hydration failed", error);
        dispatch({
          type: "hydrationFailure",
          message: storageErrorMessage(error),
        });
      }
      setBootstrapped(true);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function dispatchLocalEvent(event: Event): Promise<void> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    await mutationWriterRef.current!.execute([commandFromEvent(event)], event.by, {
      ...(event.batch ? { batchId: event.batch } : {}),
      ...(event.undoes ? { undoes: event.undoes } : {}),
    });
  }

  async function undoBatch(
    batchId: string,
    events: readonly Event[],
    reason: string,
  ): Promise<LocalUndoResult> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    return mutationWriterRef.current!.executeUndo(
      BatchIdSchema.make(batchId),
      events,
      localUserActor(stateRef.current.deviceId),
      reason,
    );
  }

  async function executeLocalCommands(
    commands: readonly BatchCommand[],
    context?: { readonly batchId?: BatchId; readonly undoes?: BatchId },
  ): Promise<LocalMutationResult> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    return mutationWriterRef.current!.execute(
      commands,
      localUserActor(stateRef.current.deviceId),
      context,
    );
  }

  async function mergeRemoteEvents(
    events: readonly Event[],
    cursor?: { readonly key: string; readonly after: number },
  ): Promise<void> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    if (events.length === 0 && !cursor) return;
    const generation = generationRef.current;
    await mutationWriterRef.current!.serialize(async () => {
      if (generation !== generationRef.current) return;
      const folded = await mergeRemoteBatch(events, cursor);
      if (generation !== generationRef.current) return;
      stateRef.current = {
        ...stateRef.current,
        folded,
        lastSeenAt: lastSeenAtFromEvents(folded.events),
      };
      dispatch({ type: "replaceFolded", folded });
    });
  }

  async function resetState(): Promise<void> {
    generationRef.current += 1;
    await mutationWriterRef.current!.serialize(async () => {
      await wipeLocalData();
      stateRef.current = { ...stateRef.current, folded: emptyFolded(), lastSeenAt: null };
      dispatch({ type: "reset" });
    });
  }

  async function switchLocalAccount(accountId: string | null): Promise<void> {
    if (switchingAccountRef.current && stateRef.current.accountId === accountId) return;
    if (stateRef.current.accountId === accountId && stateRef.current.ready) return;
    const generation = ++generationRef.current;
    switchingAccountRef.current = true;
    stateRef.current = {
      ...stateRef.current,
      accountId,
      folded: emptyFolded(),
      ready: false,
      deviceId: "device_pending",
      lastSeenAt: null,
    };
    dispatch({ type: "accountSwitchStarted", accountId });
    try {
      await mutationWriterRef.current!.serialize(async () => {
        await selectLocalAccount(accountId);
        if (generation !== generationRef.current) return;
        const hydrated = await hydrateLocalState();
        if (generation !== generationRef.current) return;
        stateRef.current = { accountId, ...hydrated, ready: true, storageError: null };
        dispatch({ type: "hydrated", accountId, ...hydrated });
        setBootstrapped(true);
      });
    } catch (error) {
      if (generation === generationRef.current) {
        dispatch({
          type: "hydrationFailure",
          message: storageErrorMessage(error),
        });
      }
      throw error;
    } finally {
      if (generation === generationRef.current) switchingAccountRef.current = false;
    }
  }

  async function createTask(input: {
    readonly title: string;
    readonly projectId?: string | null;
  }): Promise<TaskId> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    const taskId = TaskIdSchema.make(generateShortId("t_"));
    await mutationWriterRef.current!.execute(
      [
        {
          type: "task.create",
          taskId,
          input: {
            title: input.title,
            projectId: input.projectId ? ProjectIdSchema.make(input.projectId) : null,
          },
        },
      ],
      localUserActor(stateRef.current.deviceId),
    );
    return taskId;
  }

  async function updateTask(input: TaskUpdateInput): Promise<"updated" | "noop"> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    const result = await mutationWriterRef.current!.execute(
      [{ type: "task.update", input }],
      localUserActor(stateRef.current.deviceId),
    );
    return result.events.length > 0 ? "updated" : "noop";
  }

  async function createProject(input: {
    readonly title: string;
    readonly color?: string | null;
  }): Promise<ProjectId> {
    if (switchingAccountRef.current) throw new Error("Local account is switching");
    const projectId = ProjectIdSchema.make(generateShortId("p_"));
    await mutationWriterRef.current!.execute(
      [
        {
          type: "project.create",
          projectId,
          input: { title: input.title, color: input.color ?? null },
        },
      ],
      localUserActor(stateRef.current.deviceId),
    );
    return projectId;
  }

  useEffect(() => {
    if (!state.ready || state.storageError || switchingAccountRef.current) return;
    const hasLegacyGrouping =
      [...state.folded.tasks.values()].some((task) => task.tags?.length) ||
      [...state.folded.chats.values()].some((chat) => chat.headings?.length);
    if (!hasLegacyGrouping) return;
    const generation = generationRef.current;
    void mutationWriterRef
      .current!.consolidateProjects(localUserActor(state.deviceId))
      .catch((error: unknown) => {
        if (generation !== generationRef.current) return;
        console.error("Project consolidation failed", error);
        dispatch({
          type: "storageFailure",
          message: "Could not convert old headings into projects. Reopen the app to retry.",
        });
      });
  }, [state.ready, state.accountId, state.folded]);

  const store: AppStore = {
    state: bootstrapped ? state : { ...state, ready: false },
    dispatchLocalEvent,
    executeLocalCommands,
    undoBatch,
    mergeRemoteEvents,
    resetState,
    switchLocalAccount,
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
