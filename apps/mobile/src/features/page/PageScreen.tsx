import {
  DeviceId,
  generateEventId,
  type Event,
  type PageUpdatedEvent,
} from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectPage } from "../../state/selectors";
import { useTheme } from "../../theme/theme";
import { Row, Screen } from "../../ui";

type PageVersion = {
  readonly eventId: string;
  readonly at: string;
  readonly body: string;
  readonly title: string;
};

function pageHistory(events: readonly Event[], pageId: string): PageVersion[] {
  const versions: PageVersion[] = [];
  let title = "";
  let body = "";
  for (const event of events) {
    if (event.type === "page.created" && event.pageId === pageId) {
      title = event.title;
      body = event.body;
      versions.push({ eventId: event.id, at: event.at, body, title });
      continue;
    }
    if (event.type === "page.updated" && event.pageId === pageId) {
      const updated = event as PageUpdatedEvent;
      if (updated.set.title !== undefined) title = updated.set.title;
      if (updated.set.body !== undefined) body = updated.set.body;
      versions.push({ eventId: event.id, at: event.at, body, title });
    }
  }
  return versions.toReversed();
}

/** Page / brief screen with history and restore. */
export function PageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const store = useAppStore();
  const folded = useFoldedState();
  const page = id ? selectPage(folded, id) : undefined;

  if (!page || !id) {
    return (
      <Screen edges={["bottom"]}>
        <View style={styles.centered}>
          <Text style={{ color: theme.colors.muted }}>Page not found</Text>
        </View>
      </Screen>
    );
  }

  const activePage = page;
  const pageId = id;
  const history = pageHistory(folded.events, pageId);

  async function onRestore(version: PageVersion) {
    if (version.body === activePage.body && version.title === activePage.title) return;
    const event: Event = {
      v: 1,
      type: "page.updated",
      id: generateEventId(),
      at: new Date().toISOString(),
      by: { kind: "user", deviceId: DeviceId.make(store.state.deviceId) },
      reason: "Restored prior version",
      pageId: activePage.id,
      set: {
        ...(version.title !== activePage.title ? { title: version.title } : {}),
        ...(version.body !== activePage.body ? { body: version.body } : {}),
      },
      prev: {
        title: activePage.title,
        body: activePage.body,
      },
    };
    await store.dispatchLocalEvent(event);
  }

  return (
    <Screen
      edges={["bottom"]}
      scroll
      contentStyle={{ paddingHorizontal: theme.space.screenX, paddingBottom: 40 }}
    >
      <Text
        style={{
          color: theme.colors.muted,
          fontSize: theme.type.meta,
          textTransform: "capitalize",
          marginTop: 8,
        }}
      >
        {activePage.kind}
      </Text>
      <Text
        style={{
          color: theme.colors.ink,
          fontSize: 24,
          fontWeight: "700",
          marginTop: 4,
        }}
      >
        {activePage.title}
      </Text>
      <Text
        style={{
          color: theme.colors.ink,
          fontSize: theme.type.row,
          lineHeight: 24,
          marginTop: 16,
        }}
      >
        {activePage.body}
      </Text>

      <Pressable
        style={[styles.ask, { backgroundColor: theme.colors.pine, marginTop: 24 }]}
        onPress={() => router.push("/chat/new")}
      >
        <Text style={{ color: theme.colors.onPine, fontWeight: "600" }}>Ask about this</Text>
      </Pressable>

      <Text
        style={{
          color: theme.colors.muted,
          fontSize: theme.type.meta,
          fontWeight: "600",
          marginTop: 32,
          marginBottom: 8,
        }}
      >
        History
      </Text>
      {history.length === 0 ? (
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
          No prior versions.
        </Text>
      ) : (
        history.map((version, index) => (
          <View
            key={version.eventId}
            style={[
              styles.version,
              {
                borderBottomColor: theme.colors.line,
                borderBottomWidth: index === history.length - 1 ? 0 : StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Row
              title={version.title}
              subtitle={version.at}
              style={{ marginHorizontal: -theme.space.screenX }}
            />
            <Text
              style={{
                color: theme.colors.muted,
                fontSize: theme.type.meta,
                marginBottom: 8,
              }}
              numberOfLines={3}
            >
              {version.body}
            </Text>
            <Pressable
              onPress={() => void onRestore(version)}
              style={[styles.restore, { backgroundColor: theme.colors.pineSoft }]}
            >
              <Text style={{ color: theme.colors.pine, fontWeight: "600", fontSize: theme.type.meta }}>
                Restore
              </Text>
            </Pressable>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  ask: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  version: {
    paddingBottom: 12,
    marginBottom: 4,
  },
  restore: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
