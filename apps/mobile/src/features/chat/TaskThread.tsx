import { threadMessageKey } from "@yatma/core";
import { useEffect, useRef, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { MessagePartView } from "./RefUnfurl";
import { useThreadTimeline, type ActiveThreadTurn } from "./useThreadTimeline";
import type { TimelineRow } from "./messageParts";
import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";

/** One bounded virtual list: message parts and individual task occurrences share stable keys. */
export function TaskThread(props: {
  readonly activeTurn?: ActiveThreadTurn;
  readonly busy?: boolean;
  readonly followRequest: number;
  readonly footer?: ReactNode;
}) {
  const theme = useTheme();
  const store = useAppStore();
  const timeline = useThreadTimeline(store.state.folded, props.activeTurn);
  const scroll = useRef<FlatList<TimelineRow>>(null);
  const visibleMessage = useRef<string | undefined>(undefined);
  const initialPositioned = useRef(false);
  const positionedContent = useRef("");
  const tail = timeline.messages.at(-1);
  const followContent = tail
    ? JSON.stringify([tail.chatId, tail.message.id, tail.message.text])
    : "";
  const timelineRef = useRef(timeline);
  timelineRef.current = timeline;
  const viewability = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: { readonly item: TimelineRow; readonly isViewable: boolean }[];
    }) => {
      const first = viewableItems.find((item) => item.isViewable)?.item;
      visibleMessage.current = first ? threadMessageKey(first.entry) : undefined;
    },
  );
  useEffect(() => {
    if (props.followRequest) {
      timelineRef.current.jumpToLatest();
      requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }));
    }
  }, [props.followRequest]);
  function jumpToLatest() {
    timeline.jumpToLatest();
    requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: false }));
  }
  function renderRow({ item }: { item: TimelineRow }) {
    const user = item.entry.message.role === "user";
    return (
      <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
        <View
          style={[
            styles.message,
            user ? { backgroundColor: theme.colors.surface, marginLeft: 36 } : null,
          ]}
        >
          {item.kind === "heading" ? (
            <Text
              style={{ color: theme.colors.muted, fontSize: 12, paddingTop: 16, paddingBottom: 5 }}
            >
              {user ? "You" : item.entry.message.role === "assistant" ? "Yatma" : "Note"}
              {" · "}
              {new Date(item.entry.message.at).toLocaleString([], {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          ) : (
            <MessagePartView part={item.part} />
          )}
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={scroll}
        data={timeline.rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        accessibilityLabel="Conversation"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingTop: 8, paddingBottom: 24 }}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onViewableItemsChanged={viewability.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const atBottom = contentSize.height - layoutMeasurement.height - contentOffset.y < 80;
          timelineRef.current.reportViewport(visibleMessage.current, atBottom);
        }}
        scrollEventThrottle={32}
        onContentSizeChange={() => {
          if (
            !initialPositioned.current ||
            (timelineRef.current.followingLatest && positionedContent.current !== followContent)
          ) {
            initialPositioned.current = true;
            positionedContent.current = followContent;
            scroll.current?.scrollToEnd({ animated: false });
          }
        }}
        ListHeaderComponent={
          timeline.hasOlder ? (
            <ThreadAction label="Load 50 older messages" onPress={timeline.pageOlder} />
          ) : undefined
        }
        ListEmptyComponent={
          <View style={[styles.column, { padding: theme.space.screenX }]}>
            <Text style={{ color: theme.colors.muted, lineHeight: 24 }}>
              Ask a question, plan what belongs in Today, or type /list to see your open backlog.
              Use @task and @project to bring specific context into the conversation.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={[styles.column, { paddingHorizontal: theme.space.screenX }]}>
            {timeline.hasNewer ? (
              <ThreadAction label="Load 50 newer messages" onPress={timeline.pageNewer} />
            ) : (
              <>
                {props.busy && !props.activeTurn?.text ? (
                  <Text style={{ color: theme.colors.muted, paddingVertical: 12 }}>
                    Yatma is thinking…
                  </Text>
                ) : null}
                {props.footer}
              </>
            )}
          </View>
        }
      />
      {timeline.hasNewer || (!timeline.followingLatest && props.busy) ? (
        <ThreadAction
          label={props.busy ? "New reply · Jump to latest" : "Jump to latest"}
          onPress={jumpToLatest}
        />
      ) : null}
    </View>
  );
}
function ThreadAction(props: { readonly label: string; readonly onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={styles.action}>
      <Text style={{ color: theme.colors.pine, fontWeight: "600" }}>{props.label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  column: { width: "100%", maxWidth: 760, alignSelf: "center" },
  message: { paddingHorizontal: 12, paddingBottom: 5, borderRadius: 10 },
  action: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
