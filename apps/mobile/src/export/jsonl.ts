import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { exportEventsJsonl } from "../db/database";

/** Write the local event log to a temp JSONL file and open the share sheet. */
export async function shareEventsJsonl(): Promise<void> {
  const body = await exportEventsJsonl();
  const directory = FileSystem.cacheDirectory;
  if (!directory) {
    throw new Error("Cache directory unavailable");
  }
  const path = `${directory}yatma-events-${Date.now()}.jsonl`;
  await FileSystem.writeAsStringAsync(path, body);

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device");
  }
  await Sharing.shareAsync(path, {
    mimeType: "application/x-ndjson",
    dialogTitle: "Export Yatma events",
  });
}
