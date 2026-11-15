import type { BatchCommand, DayEntry } from "@yatma/core";

/** A drop anchors the moved daily entry before its new successor; task priority stays untouched. */
export function dayMoveFromDrop(
  data: readonly DayEntry[],
  from: number,
  to: number,
): BatchCommand | null {
  if (from === to || from < 0 || from >= data.length || to < 0 || to >= data.length) return null;
  return { type: "day.move", entryId: data[to]!.id, beforeEntryId: data[to + 1]?.id ?? null };
}
