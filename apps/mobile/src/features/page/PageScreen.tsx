import {
  DeviceId,
  generateEventId,
  type Event,
  type PageUpdatedEvent,
} from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useAppStore, useFoldedState } from "../../state/atoms";
import { selectPage } from "../../state/selectors";
import { colors } from "../../theme/colors";

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
  const store = useAppStore();
  const folded = useFoldedState();
  const page = id ? selectPage(folded, id) : undefined;

  if (!page || !id) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Text className="text-slate-500">Page not found</Text>
      </View>
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
    <ScrollView className="flex-1 bg-slate-50 px-4 pt-3 dark:bg-slate-950">
      <Text className="text-xs uppercase text-slate-500">{activePage.kind}</Text>
      <Text className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">{activePage.title}</Text>
      <Text className="mt-4 text-base leading-6 text-slate-700 dark:text-slate-200">{activePage.body}</Text>

      <Pressable
        className="mt-6 self-start rounded-full px-4 py-2"
        style={{ backgroundColor: colors.brand }}
        onPress={() => router.push("/chat")}
      >
        <Text className="font-medium text-white">Ask about this</Text>
      </Pressable>

      <Text className="mb-2 mt-8 text-sm font-semibold text-slate-700 dark:text-slate-200">
        History
      </Text>
      {history.length === 0 ? (
        <Text className="text-sm text-slate-500">No prior versions.</Text>
      ) : (
        history.map((version) => (
          <View
            key={version.eventId}
            className="mb-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          >
            <Text className="text-xs text-slate-500">{version.at}</Text>
            <Text className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-50">
              {version.title}
            </Text>
            <Text className="mt-1 text-sm text-slate-600 dark:text-slate-300" numberOfLines={3}>
              {version.body}
            </Text>
            <Pressable
              className="mt-2 self-start rounded-full px-3 py-1.5"
              style={{ backgroundColor: colors.brandMuted }}
              onPress={() => void onRestore(version)}
            >
              <Text className="text-sm font-medium text-white">Restore</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
