import { getSyncMeta, setSyncMeta } from "../../db/database";

const TRIAGE_CAPACITY_KEY = "preference.triageCapacity";
export const DEFAULT_TRIAGE_CAPACITY = 10;

/** Read the per-bucket task limit, falling back to ten for existing installs. */
export async function getTriageCapacity(): Promise<number> {
  const stored = Number(await getSyncMeta(TRIAGE_CAPACITY_KEY));
  return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_TRIAGE_CAPACITY;
}

/** Persist the maximum number of tasks allowed in each classification bucket. */
export async function setTriageCapacity(value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error("Capacity must be between 1 and 1000.");
  }
  await setSyncMeta(TRIAGE_CAPACITY_KEY, String(value));
}
