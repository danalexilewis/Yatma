import { getSyncMeta, setSyncMeta } from "../../db/database";

const AUTO_SEND_KEY = "preference.autoSendDictation";

/** Read the persisted dictation auto-send preference. */
export async function getAutoSendDictation(): Promise<boolean> {
  return (await getSyncMeta(AUTO_SEND_KEY)) === "true";
}

/** Persist whether completed dictation should submit as a capture command. */
export async function setAutoSendDictation(enabled: boolean): Promise<void> {
  await setSyncMeta(AUTO_SEND_KEY, String(enabled));
}
