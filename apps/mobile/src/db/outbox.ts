import { compareEvents, type Event } from "@yatma/core";

/** Outbox rows are events that have not received a server `seq`. */
export function isOutboxEvent(event: Event): boolean {
  return event.seq == null;
}

/** Pure outbox selection: unordered events → outbox sorted by (at, id). */
export function selectOutboxEvents(events: readonly Event[]): Event[] {
  return events.filter(isOutboxEvent).toSorted(compareEvents);
}

/** True when every event has a server sequence (nothing left to push). */
export function isOutboxEmpty(events: readonly Event[]): boolean {
  return !events.some(isOutboxEvent);
}
