import { LegendList } from "@legendapp/list/react-native";
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";

import { useFoldedState } from "../../state/atoms";
import { selectChats } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { EmptyState, IconButton, Row, Screen, ScreenHeader } from "../../ui";

type ListItem =
  | { readonly kind: "chat"; readonly id: string; readonly title: string; readonly summary: string }
  | { readonly kind: "empty" };

/** Global chat history list. Composer lives on the thread screen. */
export function ChatScreen() {
  const router = useRouter();
  const theme = useTheme();
  const folded = useFoldedState();
  const chats = selectChats(folded);

  const data: ListItem[] =
    chats.length === 0
      ? [{ kind: "empty" }]
      : chats.map((chat) => ({
          kind: "chat" as const,
          id: chat.id,
          title: chat.title ?? "Untitled chat",
          summary: chat.summary ?? chat.messages.at(-1)?.text ?? "No messages yet",
        }));

  function openNewChat() {
    router.push("/chat/new");
  }

  return (
    <Screen>
      <ScreenHeader
        title="Chat"
        trailing={
          <IconButton
            name="create-outline"
            accessibilityLabel="New chat"
            color={theme.colors.pine}
            onPress={openNewChat}
          />
        }
      />

      <LegendList
        data={data}
        keyExtractor={(item: ListItem) => (item.kind === "empty" ? "empty" : item.id)}
        estimatedItemSize={72}
        style={styles.list}
        recycleItems
        renderItem={({ item, index }: { item: ListItem; index: number }) => {
          if (item.kind === "empty") {
            return (
              <EmptyState
                message="Start a conversation about your tasks."
                actionLabel="New chat"
                onAction={openNewChat}
              />
            );
          }
          return (
            <Row
              title={item.title}
              subtitle={item.summary}
              last={index === data.length - 1}
              onPress={() => router.push(`/chat/${item.id}`)}
            />
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
});
