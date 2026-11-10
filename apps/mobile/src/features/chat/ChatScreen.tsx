import { Redirect } from "expo-router";

/** Older chat-list links resolve to the app's one permanent thread. */
export function ChatScreen() {
  return <Redirect href="/" />;
}
