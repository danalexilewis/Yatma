// Copyright (c) T3 Tools / MIT — adapted for Yatma

/**
 * In-memory detached-turn registry.
 * Proves a turn can finish after the socket that started it is gone.
 */

export type TurnStatus = "running" | "completed" | "stopped" | "failed";

export type Turn = {
  readonly turnId: string;
  readonly chatId: string;
  readonly text: string;
  readonly startedAt: number;
  status: TurnStatus;
  finishedAt: number | null;
};

export type TurnRegistry = {
  turns: Map<string, Turn>;
  order: string[];
};

export function createRegistry(): TurnRegistry {
  return { turns: new Map(), order: [] };
}

export function clearRegistry(registry: TurnRegistry): void {
  registry.turns.clear();
  registry.order.length = 0;
}

let turnCounter = 0;

export function startTurn(
  registry: TurnRegistry,
  input: { readonly chatId: string; readonly text: string; readonly nowMs?: number },
): Turn {
  turnCounter += 1;
  const turnId = `turn_${turnCounter}_${input.chatId}`;
  const turn: Turn = {
    turnId,
    chatId: input.chatId,
    text: input.text,
    startedAt: input.nowMs ?? Date.now(),
    status: "running",
    finishedAt: null,
  };
  registry.turns.set(turnId, turn);
  registry.order.push(turnId);
  return turn;
}

/** Simulate socket close: turn stays in the registry and can still complete. */
export function detachSocket(_registry: TurnRegistry, _turnId: string): void {
  // Intentionally empty — presence of the turn after "close" is the proof.
}

export function completeTurn(
  registry: TurnRegistry,
  turnId: string,
  result: { readonly status: Exclude<TurnStatus, "running">; readonly nowMs?: number },
): Turn | null {
  const turn = registry.turns.get(turnId);
  if (!turn || turn.status !== "running") return null;
  turn.status = result.status;
  turn.finishedAt = result.nowMs ?? Date.now();
  return turn;
}

export function stopTurn(registry: TurnRegistry, turnId: string): boolean {
  return completeTurn(registry, turnId, { status: "stopped" }) !== null;
}

export function latestTurnId(registry: TurnRegistry): string | null {
  return registry.order[registry.order.length - 1] ?? null;
}

export function getTurn(registry: TurnRegistry, turnId: string): Turn | undefined {
  return registry.turns.get(turnId);
}
