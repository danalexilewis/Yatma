import { type Event } from "@yatma/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

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
      if (event.set.title !== undefined) title = event.set.title;
      if (event.set.body !== undefined) body = event.set.body;
      versions.push({ eventId: event.id, at: event.at, body, title });
    }
  }
  return versions.toReversed();
}

/** Page and brief editor with markdown reading, pinning, and version restore. */
export function PageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const store = useAppStore();
  const folded = useFoldedState();
  const page = id ? selectPage(folded, id) : undefined;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);

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
  const history = pageHistory(folded.events, id);

  function beginEditing() {
    setDraftTitle(activePage.title);
    setDraftBody(activePage.body);
    setEditing(true);
  }

  async function saveEdits() {
    const title = draftTitle.trim();
    if (!title) {
      Alert.alert("Title required", "Enter a title before saving.");
      return;
    }
    const changedTitle = title !== activePage.title;
    const changedBody = draftBody !== activePage.body;
    if (!changedTitle && !changedBody) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await store.executeLocalCommands([{
        type: "page.update",
        input: {
          pageId: activePage.id,
          ...(changedTitle ? { title } : {}),
          ...(changedBody ? { body: draftBody } : {}),
          reason: activePage.kind === "brief" ? "Edited project brief" : "Edited page",
        },
      }]);
      setEditing(false);
    } catch (error) {
      Alert.alert("Could not save page", error instanceof Error ? error.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned() {
    try {
      await store.executeLocalCommands([{
        type: "page.update",
        input: { pageId: activePage.id, pinned: !activePage.pinned, reason: activePage.pinned ? "Unpinned page" : "Pinned page" },
      }]);
    } catch (error) {
      Alert.alert("Could not update pin", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function onRestore(version: PageVersion) {
    if (version.body === activePage.body && version.title === activePage.title) return;
    try {
      await store.executeLocalCommands([{
        type: "page.update",
        input: {
          pageId: activePage.id,
          ...(version.title !== activePage.title ? { title: version.title } : {}),
          ...(version.body !== activePage.body ? { body: version.body } : {}),
          reason: "Restored prior version",
        },
      }]);
    } catch (error) {
      Alert.alert("Could not restore version", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Screen edges={["bottom"]} scroll contentStyle={{ paddingHorizontal: theme.space.screenX, paddingBottom: 40 }}>
      <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, textTransform: "capitalize", marginTop: 8 }}>
        {activePage.kind}
      </Text>
      {editing ? (
        <>
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Title"
            placeholderTextColor={theme.colors.muted}
            style={[styles.titleInput, { color: theme.colors.ink, borderColor: theme.colors.line }]}
            accessibilityLabel="Page title"
          />
          <TextInput
            value={draftBody}
            onChangeText={setDraftBody}
            multiline
            textAlignVertical="top"
            placeholder="Write page content in markdown…"
            placeholderTextColor={theme.colors.muted}
            style={[styles.bodyInput, { color: theme.colors.ink, borderColor: theme.colors.line }]}
            accessibilityLabel="Page content in markdown"
          />
          <View style={styles.actions}>
            <Action label={saving ? "Saving…" : "Save"} onPress={() => void saveEdits()} disabled={saving} primary />
            <Action label="Cancel" onPress={() => setEditing(false)} disabled={saving} />
          </View>
        </>
      ) : (
        <>
          <Text style={{ color: theme.colors.ink, fontSize: 24, fontWeight: "700", marginTop: 4 }}>
            {activePage.title}
          </Text>
          <View style={styles.actions}>
            <Action label="Edit" onPress={beginEditing} primary />
            <Action label={activePage.pinned ? "Unpin" : "Pin"} onPress={() => void togglePinned()} />
          </View>
          <MarkdownBody body={activePage.body} />
        </>
      )}

      <Pressable style={[styles.ask, { backgroundColor: theme.colors.pine, marginTop: 24 }]} onPress={() => router.dismissTo({ pathname: "/", params: { pageId: activePage.id } })}>
        <Text style={{ color: theme.colors.onPine, fontWeight: "600" }}>Ask about this</Text>
      </Pressable>

      <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, fontWeight: "600", marginTop: 32, marginBottom: 8 }}>
        History
      </Text>
      {history.length === 0 ? (
        <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>No prior versions.</Text>
      ) : history.map((version, index) => (
        <View key={version.eventId} style={[styles.version, { borderBottomColor: theme.colors.line, borderBottomWidth: index === history.length - 1 ? 0 : StyleSheet.hairlineWidth }]}>
          <Row title={version.title} subtitle={new Date(version.at).toLocaleString()} style={{ marginHorizontal: -theme.space.screenX }} />
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta, marginBottom: 8 }} numberOfLines={3}>{version.body}</Text>
          <Action label="Restore" onPress={() => void onRestore(version)} />
        </View>
      ))}
    </Screen>
  );
}

function Action(props: { readonly label: string; readonly onPress: () => void; readonly disabled?: boolean; readonly primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityRole="button"
      style={[styles.action, { backgroundColor: props.primary ? theme.colors.pine : theme.colors.pineSoft, opacity: props.disabled ? 0.6 : 1 }]}
    >
      <Text style={{ color: props.primary ? theme.colors.onPine : theme.colors.pine, fontWeight: "600", fontSize: theme.type.meta }}>{props.label}</Text>
    </Pressable>
  );
}

function MarkdownBody(props: { readonly body: string }) {
  const theme = useTheme();
  const lines = props.body.split("\n");
  const blocks: string[][] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (blocks[blocks.length - 1]?.length) blocks.push([]);
      continue;
    }
    if (!blocks.length) blocks.push([]);
    blocks[blocks.length - 1]?.push(line);
  }
  return (
    <View style={styles.markdown}>
      {blocks.filter((block) => block.length).map((block, index) => {
        const first = block[0] ?? "";
        const heading = /^(#{1,3})\s+(.+)$/.exec(first);
        const bullet = /^\s*[-*+]\s+(.+)$/.exec(first);
        const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(first);
        const quote = /^\s*>\s?(.*)$/.exec(first);
        if (heading) {
          const size = heading[1]?.length === 1 ? 20 : heading[1]?.length === 2 ? 18 : 16;
          return <Text key={index} style={{ color: theme.colors.ink, fontSize: size, fontWeight: "700", marginTop: 8 }}><InlineMarkdown text={heading[2] ?? ""} /></Text>;
        }
        if (bullet || ordered) {
          const content = bullet?.[1] ?? ordered?.[1] ?? "";
          return <View key={index} style={styles.listItem}><Text style={{ color: theme.colors.pine }}>•</Text><Text style={{ color: theme.colors.ink, fontSize: theme.type.row, lineHeight: 24, flex: 1 }}><InlineMarkdown text={content} /></Text></View>;
        }
        if (quote) {
          return <View key={index} style={[styles.quote, { borderLeftColor: theme.colors.pine }]}><Text style={{ color: theme.colors.muted, fontSize: theme.type.row, lineHeight: 24 }}><InlineMarkdown text={quote[1] ?? ""} /></Text></View>;
        }
        return <Text key={index} style={{ color: theme.colors.ink, fontSize: theme.type.row, lineHeight: 24 }}>
          {block.map((line, lineIndex) => <Text key={lineIndex}>{lineIndex > 0 ? "\n" : ""}<InlineMarkdown text={line} /></Text>)}
        </Text>;
      })}
    </View>
  );
}

function InlineMarkdown(props: { readonly text: string }) {
  const chunks = props.text.split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g);
  return <>{chunks.map((chunk, index) => {
    if ((chunk.startsWith("**") && chunk.endsWith("**")) || (chunk.startsWith("__") && chunk.endsWith("__"))) {
      return <Text key={index} style={{ fontWeight: "700" }}>{chunk.slice(2, -2)}</Text>;
    }
    if ((chunk.startsWith("*") && chunk.endsWith("*")) || (chunk.startsWith("_") && chunk.endsWith("_"))) {
      return <Text key={index} style={{ fontStyle: "italic" }}>{chunk.slice(1, -1)}</Text>;
    }
    if (chunk.startsWith("`") && chunk.endsWith("`")) {
      return <Text key={index} style={{ fontFamily: "monospace" }}>{chunk.slice(1, -1)}</Text>;
    }
    return chunk;
  })}</>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleInput: { fontSize: 24, fontWeight: "700", marginTop: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  bodyInput: { fontSize: 16, lineHeight: 24, marginTop: 16, minHeight: 220, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  action: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  markdown: { marginTop: 16, gap: 12 },
  listItem: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  ask: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12 },
  version: { paddingBottom: 12, marginBottom: 4 },
});
