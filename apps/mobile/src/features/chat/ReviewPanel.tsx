import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { formatRef, isCalendarDate, needsReview, type ReviewItem } from "@yatma/core";
import { useRef, useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { IconButton } from "../../ui";
import type { ReviewDecisionResult } from "../../application/review";
import { decideReview } from "../../application/review";
import { localPlanningDay } from "../../application/dailyStack";
import { useAppStore } from "../../state/atoms";
import { useTheme } from "../../theme/theme";
import { useTaskNavigation } from "../task/useTaskNavigation";

type Filter = "pending" | "later" | "waiting" | "today" | "dismissed";

/** Durable intake choices remain usable while the assistant or connection is unavailable. */
export function ReviewPanel(props: {
  readonly onDiscuss: (text: string) => void;
  readonly busy: boolean;
}) {
  const store = useAppStore();
  const router = useRouter();
  const theme = useTheme();
  const [lastDecision, setLastDecision] = useState<ReviewDecisionResult | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("pending");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = localPlanningDay(new Date(), timezone);
  const items = [...store.state.folded.reviewItems.values()].toSorted((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt),
  );
  const pending = items.filter((item) => {
    const linked = item.taskId ? store.state.folded.tasks.get(item.taskId) : null;
    return (
      needsReview(item, date) &&
      (!item.taskId || (linked && !linked.deletedAt && linked.status !== "done"))
    );
  });
  const selected =
    filter === "pending" ? pending : items.filter((item) => item.disposition === filter);
  function discuss(text: string) {
    setOpen(false);
    props.onDiscuss(text);
  }
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Needs review, ${pending.length} items`}
        onPress={() => setOpen(true)}
        style={[styles.button, { backgroundColor: theme.colors.pineSoft }]}
      >
        <Text style={{ color: theme.colors.pine }}>Needs review · {pending.length}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={props.busy}
        onPress={() =>
          discuss(
            "Help me decide what work to do today. Review new items, existing commitments and important work across my projects. Explain tradeoffs and ask about my available time before proposing a plan.",
          )
        }
        style={styles.button}
      >
        <Text style={{ color: theme.colors.pine }}>Plan today</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { backgroundColor: theme.colors.canvas }]}>
          <View style={styles.actions}>
            <Text
              accessibilityRole="header"
              style={{ color: theme.colors.ink, fontSize: 24, flex: 1 }}
            >
              Review work
            </Text>
            <IconButton
              name="options-outline"
              accessibilityLabel="Review settings"
              color={theme.colors.muted}
              onPress={() => {
                setOpen(false);
                router.push("/settings?section=connections");
              }}
            />
            <IconButton
              name="close-outline"
              accessibilityLabel="Close review"
              color={theme.colors.muted}
              onPress={() => setOpen(false)}
            />
          </View>
          <Text style={{ color: theme.colors.muted }}>
            Choose what deserves your attention. Today contains your chosen commitments.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.actions}
          >
            {(["pending", "later", "waiting", "today", "dismissed"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === value }}
                onPress={() => setFilter(value)}
                style={[
                  styles.button,
                  {
                    backgroundColor: filter === value ? theme.colors.surface : "transparent",
                    borderWidth: 1,
                    borderColor: filter === value ? theme.colors.line : "transparent",
                  },
                ]}
              >
                <Text
                  style={{
                    color: filter === value ? theme.colors.ink : theme.colors.muted,
                    fontSize: 13,
                  }}
                >
                  {value === "pending" ? "Needs review" : value[0]!.toUpperCase() + value.slice(1)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {lastDecision ? (
            <View style={styles.actions}>
              <Text style={{ color: theme.colors.muted }}>Decision saved.</Text>
              <Pressable
                accessibilityRole="button"
                disabled={undoing}
                style={styles.button}
                onPress={() => {
                  setUndoing(true);
                  setUndoError(null);
                  void store
                    .undoBatch(lastDecision.batchId, lastDecision.events, "Undo review decision")
                    .then((result) => {
                      setLastDecision(null);
                      if (result.skipped.length)
                        setUndoError(`${result.skipped.length} later changes were preserved.`);
                    })
                    .catch((cause: unknown) =>
                      setUndoError(
                        cause instanceof Error ? cause.message : "Could not undo this decision.",
                      ),
                    )
                    .finally(() => setUndoing(false));
                }}
              >
                <Text style={{ color: theme.colors.pine }}>Undo decision</Text>
              </Pressable>
            </View>
          ) : null}
          {undoError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              {undoError}
            </Text>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
          >
            {selected.length === 0 ? (
              <Text style={{ color: theme.colors.muted, paddingVertical: 20 }}>
                No items here. You can still discuss your existing backlog with Yatma.
              </Text>
            ) : (
              selected.map((item) => (
                <ReviewItemCard
                  key={item.id}
                  item={item}
                  date={date}
                  timezone={timezone}
                  onDiscuss={discuss}
                  onClose={() => setOpen(false)}
                  onSaved={setLastDecision}
                />
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function ReviewItemCard(props: {
  readonly item: ReviewItem;
  readonly date: string;
  readonly timezone: string;
  readonly onDiscuss: (text: string) => void;
  readonly onClose: () => void;
  readonly onSaved: (result: ReviewDecisionResult) => void;
}) {
  const store = useAppStore();
  const theme = useTheme();
  const navigation = useTaskNavigation();
  const [reason, setReason] = useState(props.item.reason ?? "");
  const [revisit, setRevisit] = useState(props.item.revisitOn ?? "");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = useRef(store.state.accountId);
  account.current = store.state.accountId;
  const task = props.item.taskId ? store.state.folded.tasks.get(props.item.taskId) : null;
  const title = task?.title ?? props.item.title;
  const selectedDayIds = new Set(
    [...store.state.folded.days.values()]
      .filter((day) => day.date === props.date)
      .map((day) => day.id),
  );
  const alreadySelected =
    props.item.taskId !== null &&
    [...store.state.folded.dayEntries.values()].some(
      (entry) =>
        entry.taskId === props.item.taskId &&
        selectedDayIds.has(entry.dayId) &&
        entry.status !== "removed",
    );
  async function decide(disposition: ReviewItem["disposition"]) {
    if (saving) return;
    const revisitOn =
      disposition === "later" || disposition === "waiting" ? revisit.trim() || null : null;
    if (revisitOn && !isCalendarDate(revisitOn)) {
      setError("Enter a valid revisit date as YYYY-MM-DD.");
      return;
    }
    const owner = account.current;
    setSaving(true);
    setError(null);
    try {
      const result = await decideReview(store, props.item, {
        disposition,
        reason,
        revisitOn,
        date: props.date,
        timezone: props.timezone,
      });
      if (account.current === owner) props.onSaved(result);
    } catch (cause) {
      if (account.current === owner)
        setError(cause instanceof Error ? cause.message : "Could not save this decision.");
    } finally {
      if (account.current === owner) setSaving(false);
    }
  }
  function discuss() {
    props.onDiscuss(
      `Help me decide what to do about ${props.item.taskId ? formatRef("task", props.item.taskId, title) : `review item ${props.item.id}`}. Compare it with today's commitments and relevant work across my projects.`,
    );
  }
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
      ]}
    >
      <Text style={{ color: theme.colors.muted }}>
        {props.item.source === "gmail" ? "Gmail" : "Captured task"} ·{" "}
        {props.item.receivedAt.slice(0, 10)} · {props.item.disposition}
      </Text>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.ink, fontSize: 18, fontWeight: "600" }}
      >
        {title}
      </Text>
      {props.item.sourceText ? (
        <Text numberOfLines={5} style={{ color: theme.colors.muted }}>
          {props.item.sourceText}
        </Text>
      ) : null}
      {task?.projectId ? (
        <Text style={{ color: theme.colors.muted }}>
          {store.state.folded.projects.get(task.projectId)?.title}
        </Text>
      ) : null}
      {alreadySelected ? (
        <Text style={{ color: theme.colors.muted }}>
          Already selected for {props.date}. Adjust that commitment in Today.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={discuss}
          style={[
            styles.button,
            {
              borderWidth: 1,
              borderColor: theme.colors.line,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            },
          ]}
        >
          <Ionicons name="chatbubble-outline" size={16} color={theme.colors.ink} />
          <Text style={{ color: theme.colors.ink, fontSize: 13 }}>Discuss</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {props.item.taskId ? (
          <IconButton
            name="open-outline"
            size={18}
            accessibilityLabel="Task details"
            color={theme.colors.muted}
            onPress={() => {
              props.onClose();
              navigation.openTask(props.item.taskId!);
            }}
          />
        ) : null}
        {props.item.sourceUrl && /^https:\/\//i.test(props.item.sourceUrl) ? (
          <IconButton
            name="link-outline"
            size={18}
            accessibilityLabel="Open source"
            color={theme.colors.muted}
            onPress={() =>
              void Linking.openURL(props.item.sourceUrl!).catch(() =>
                setError("Could not open the source."),
              )
            }
          />
        ) : null}
        <IconButton
          name="ellipsis-horizontal"
          size={18}
          accessibilityLabel={moreOpen ? "Hide more actions" : "More review actions"}
          color={theme.colors.muted}
          onPress={() => setMoreOpen(!moreOpen)}
        />
      </View>
      <TextInput
        accessibilityLabel={`Reason for reviewing ${title}`}
        value={reason}
        onChangeText={setReason}
        placeholder="Why this choice?"
        placeholderTextColor={theme.colors.muted}
        editable={!saving}
        multiline
        style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
      />
      <View style={[styles.actions, { gap: 8, paddingTop: 4 }]}>
        <Pressable
          accessibilityRole="button"
          disabled={saving || alreadySelected}
          onPress={() => void decide("today")}
          style={[
            styles.button,
            {
              backgroundColor: alreadySelected ? theme.colors.pineSoft : theme.colors.pine,
              opacity: saving ? 0.5 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            },
          ]}
        >
          <Ionicons
            name={alreadySelected ? "checkmark" : "add"}
            size={17}
            color={alreadySelected ? theme.colors.pine : theme.colors.onPine}
          />
          <Text
            style={{
              color: alreadySelected ? theme.colors.pine : theme.colors.onPine,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {alreadySelected ? "On Today" : "Choose Today"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => void decide("later")}
          style={[
            styles.button,
            { borderWidth: 1, borderColor: theme.colors.line, opacity: saving ? 0.5 : 1 },
          ]}
        >
          <Text style={{ color: theme.colors.ink, fontSize: 13 }}>Later</Text>
        </Pressable>
      </View>
      {moreOpen ? (
        <View
          style={{
            gap: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.line,
            paddingTop: 12,
          }}
        >
          <TextInput
            accessibilityLabel={`Revisit date for ${title}`}
            value={revisit}
            onChangeText={setRevisit}
            placeholder="Revisit on YYYY-MM-DD · optional"
            placeholderTextColor={theme.colors.muted}
            editable={!saving}
            maxLength={10}
            style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
          />
          <View style={styles.actions}>
            {!props.item.seenAt ? (
              <IconButton
                name="checkmark-done-outline"
                size={18}
                accessibilityLabel="Mark read"
                color={theme.colors.muted}
                disabled={saving}
                onPress={() =>
                  void store
                    .executeLocalCommands([{ type: "review.seen", id: props.item.id }])
                    .catch(() => setError("Could not mark this item read."))
                }
              />
            ) : null}
            {(
              [
                ["waiting", "Waiting"],
                ["dismissed", "Dismiss"],
                ["pending", "Review again"],
              ] as const
            )
              .filter(([value]) => value !== props.item.disposition)
              .map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void decide(value)}
                  style={styles.button}
                >
                  <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{label}</Text>
                </Pressable>
              ))}
          </View>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4 },
  button: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 22 },
  modal: {
    flex: 1,
    padding: 20,
    paddingTop: 50,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    gap: 12,
  },
  card: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 8 },
  input: { minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8 },
});
