import type { Quadrant } from "./schemas.ts";

/** Existing wire keys stay readable; the matrix describes personal urgency and importance. */
export const MATRIX_QUADRANTS = [
  { key: "do", label: "Urgent & important", urgent: true, important: true },
  { key: "schedule", label: "Important, not urgent", urgent: false, important: true },
  { key: "delegate", label: "Urgent, not important", urgent: true, important: false },
  { key: "eliminate", label: "Neither urgent nor important", urgent: false, important: false },
] as const satisfies readonly {
  readonly key: Quadrant;
  readonly label: string;
  readonly urgent: boolean;
  readonly important: boolean;
}[];

export function quadrantLabel(quadrant: Quadrant | null): string {
  return MATRIX_QUADRANTS.find((entry) => entry.key === quadrant)?.label ?? "Unsorted";
}
