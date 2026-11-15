import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { exportEventsJsonl } from "../db/database";

/** Write the local event log to a temp JSONL file and open the share sheet. */
export async function shareEventsJsonl(): Promise<void> {
  const body = await exportEventsJsonl();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([body], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `yatma-events-${Date.now()}.jsonl`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
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
