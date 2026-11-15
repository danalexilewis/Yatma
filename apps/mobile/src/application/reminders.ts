import { Platform } from "react-native";

import type { ReminderPort } from "./stackPlayer";

const REMINDER_ID = "yatma-work-allowance";
let currentOwner: symbol | null = null;
let operations: Promise<unknown> = Promise.resolve();

/** Best-effort native reminder; callbacks never complete tasks or advance the queue. */
export function createReminderAdapter(): ReminderPort {
  const owner = Symbol("player-reminders");
  currentOwner = owner;
  async function replaceOwned(reminder: { readonly title: string; readonly at: string } | null) {
    if (currentOwner !== owner) return "off" as const;
    if (Platform.OS === "web") return reminder ? ("unavailable" as const) : ("off" as const);
    const notifications = await import("expo-notifications");
    if (currentOwner !== owner) return "off" as const;
    await notifications.cancelScheduledNotificationAsync(REMINDER_ID);
    if (!reminder) return "off" as const;
    const permission = await notifications.getPermissionsAsync();
    if (currentOwner !== owner) return "off" as const;
    if (!permission.granted) return "unavailable" as const;
    await notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: "Time to check in",
        body: `${reminder.title}: your planned time has elapsed. Continue, extend, or take a break.`,
      },
      trigger: {
        type: notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.at),
      },
    });
    if (currentOwner !== owner) {
      // The successor's operation is queued behind this one, so cleanup cannot
      // remove its reminder even if scheduling finished after the account switch.
      await notifications.cancelScheduledNotificationAsync(REMINDER_ID);
      return "off" as const;
    }
    return "scheduled" as const;
  }
  function replace(reminder: { readonly title: string; readonly at: string } | null) {
    const operation = operations.catch(() => {}).then(() => replaceOwned(reminder));
    operations = operation;
    return operation;
  }
  return { replace };
}

/** Ask only from an explicit user action; denied permission leaves work controls usable. */
export async function requestPlayerReminders(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const notifications = await import("expo-notifications");
  if (Platform.OS === "android") {
    await notifications.setNotificationChannelAsync("default", {
      name: "Work check-ins",
      importance: notifications.AndroidImportance.DEFAULT,
    });
  }
  return (await notifications.requestPermissionsAsync()).granted;
}
