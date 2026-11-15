import { MAX_ENABLED_SKILLS, MAX_SKILL_INSTRUCTIONS, SaveSkill, type Skill } from "@yatma/core";
import { randomUUID } from "expo-crypto";
import { Link } from "expo-router";
import * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { deleteSkill, listSkills, saveSkill, skillsErrorMessage } from "../../application/skills";
import { useAppStore } from "../../state/atoms";
import { useSyncStatus } from "../../state/syncStatusAtom";
import { useTheme } from "../../theme/theme";
import { EmptyState, IconButton, Screen, ScreenHeader } from "../../ui";

/** Account-owned reusable instructions; enabled skills apply to subsequent conversation turns. */
export function SkillsScreen() {
  const { state } = useAppStore();
  return <AccountSkills key={state.accountId ?? "local"} />;
}

function AccountSkills() {
  const theme = useTheme();
  const { state } = useAppStore();
  const connection = useSyncStatus();
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<SaveSkill | null>(null);
  const [removing, setRemoving] = useState<Skill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const connected = Boolean(state.accountId) && connection === "connected";

  useEffect(() => {
    const current = ++generation.current;
    setBusy(false);
    inFlight.current = false;
    if (!connected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void listSkills()
      .then((result) => {
        if (current !== generation.current) return;
        setSkills(result.skills);
        setLoaded(true);
      })
      .catch((cause) => {
        if (current === generation.current) setError(skillsErrorMessage(cause));
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [state.accountId, connected, reload]);

  async function run(
    action: () => ReturnType<typeof saveSkill>,
    message: string,
    closeEditor = false,
  ) {
    if (inFlight.current || !connected) return;
    const current = generation.current;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (current !== generation.current) return;
      setSkills(result.skills);
      setLoaded(true);
      setNotice(message);
      if (closeEditor) {
        setDraft(null);
        setRemoving(null);
      }
    } catch (cause) {
      if (current === generation.current) setError(skillsErrorMessage(cause));
    } finally {
      if (current === generation.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  function create() {
    setError(null);
    setNotice(null);
    setDraft({ id: `skill_${randomUUID()}`, title: "", instructions: "", enabled: true });
  }
  function saveDraft() {
    if (!draft) return;
    const input = { ...draft, title: draft.title.trim(), instructions: draft.instructions.trim() };
    if (!Schema.is(SaveSkill)(input)) {
      setError(
        `Add a name (up to 80 characters) and instructions (up to ${MAX_SKILL_INSTRUCTIONS} characters).`,
      );
      return;
    }
    void run(() => saveSkill(input), "Skill saved. Enabled skills apply to new replies.", true);
  }
  const disabled = busy || loading || !connected || !loaded;

  return (
    <Screen>
      <ScreenHeader
        title="Skills"
        subtitle="Reusable instructions for the way you work"
        trailing={
          <IconButton
            name="add"
            accessibilityLabel="New skill"
            disabled={disabled}
            onPress={create}
          />
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={[styles.intro, { backgroundColor: theme.colors.pineSoft }]}>
          <Text style={{ color: theme.colors.ink, fontSize: 16, fontWeight: "600" }}>
            Make your preferred outputs repeatable
          </Text>
          <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
            Save a writing style, planning approach or response format. Enabled skills apply across
            your conversations from the next turn, without changing past replies.
          </Text>
          <Text style={{ color: theme.colors.pine, fontSize: 12 }}>
            {loaded
              ? `${skills.filter((skill) => skill.enabled).length} of ${MAX_ENABLED_SKILLS} enabled`
              : `Up to ${MAX_ENABLED_SKILLS} enabled`}{" "}
            · Applies across conversations
          </Text>
        </View>
        {!state.accountId ? (
          <EmptyState message="Sign in to create and use skills across your devices." />
        ) : !connected ? (
          <Text style={{ color: theme.colors.muted }}>
            Connect to load and edit your skills. Any open draft is kept while you reconnect.
          </Text>
        ) : null}
        {!state.accountId ? (
          <Link href="/(auth)/sign-in" style={{ color: theme.colors.pine, paddingVertical: 12 }}>
            Sign in to use skills →
          </Link>
        ) : null}
        {loading ? <Text style={{ color: theme.colors.muted }}>Loading skills…</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.pine }}>
            {notice}
          </Text>
        ) : null}
        {connected ? (
          <SkillButton
            label="Refresh skills"
            disabled={busy || loading}
            onPress={() => setReload(reload + 1)}
          />
        ) : null}
        {connected && loaded && skills.length === 0 ? (
          <EmptyState
            message="No skills yet. Start with instructions you find yourself repeating, such as “Give me a short summary, then concrete next steps.”"
            actionLabel="Create your first skill"
            onAction={create}
          />
        ) : null}
        {skills.map((skill) => (
          <View
            key={skill.id}
            style={[
              styles.card,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.line },
            ]}
          >
            <View style={styles.row}>
              <Text style={{ flex: 1, color: theme.colors.ink, fontSize: 17, fontWeight: "600" }}>
                {skill.title}
              </Text>
              <Switch
                accessibilityLabel={`Enable ${skill.title}`}
                value={skill.enabled}
                disabled={disabled}
                onValueChange={(enabled) =>
                  void run(
                    () =>
                      saveSkill({
                        id: skill.id,
                        title: skill.title,
                        instructions: skill.instructions,
                        enabled,
                      }),
                    enabled ? "Skill enabled for new replies." : "Skill disabled for new replies.",
                  )
                }
                trackColor={{ true: theme.colors.pine, false: theme.colors.line }}
              />
            </View>
            <Text
              numberOfLines={4}
              style={{ color: theme.colors.muted, fontSize: 14, lineHeight: 21 }}
            >
              {skill.instructions}
            </Text>
            <View style={styles.row}>
              <Text style={{ flex: 1, color: theme.colors.muted, fontSize: 12 }}>
                {skill.enabled ? "Enabled" : "Disabled"}
              </Text>
              <SkillButton
                label={`Edit ${skill.title}`}
                text="Edit"
                disabled={disabled}
                onPress={() => {
                  setError(null);
                  setNotice(null);
                  setDraft({
                    id: skill.id,
                    title: skill.title,
                    instructions: skill.instructions,
                    enabled: skill.enabled,
                  });
                }}
              />
              <SkillButton
                label={`Delete ${skill.title}`}
                text="Delete"
                danger
                disabled={disabled}
                onPress={() => {
                  setError(null);
                  setRemoving(skill);
                }}
              />
            </View>
          </View>
        ))}
      </ScrollView>
      <Modal
        visible={draft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setDraft(null);
        }}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalScroll}
          >
            <View
              accessibilityViewIsModal
              style={[styles.editor, { backgroundColor: theme.colors.surface }]}
            >
              <Text
                accessibilityRole="header"
                style={{ color: theme.colors.ink, fontSize: 22, fontWeight: "700" }}
              >
                {skills.some((skill) => skill.id === draft?.id) ? "Edit skill" : "New skill"}
              </Text>
              <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
                Describe how you want the AI to respond. Skills guide outputs; they do not grant
                permission to change tasks or run tools.
              </Text>
              <Text style={{ color: theme.colors.ink, fontWeight: "600", fontSize: 13 }}>Name</Text>
              <TextInput
                accessibilityLabel="Skill name"
                placeholder="e.g. Concise action plans"
                placeholderTextColor={theme.colors.muted}
                value={draft?.title ?? ""}
                onChangeText={(title) =>
                  setDraft((current) => (current ? { ...current, title } : null))
                }
                maxLength={80}
                editable={!busy}
                style={[styles.input, { color: theme.colors.ink, borderColor: theme.colors.line }]}
              />
              <Text style={{ color: theme.colors.ink, fontWeight: "600", fontSize: 13 }}>
                Instructions
              </Text>
              <TextInput
                accessibilityLabel="Skill instructions"
                placeholder="Start with a one-sentence summary. Use short bullets for actions and flag any assumptions."
                placeholderTextColor={theme.colors.muted}
                value={draft?.instructions ?? ""}
                onChangeText={(instructions) =>
                  setDraft((current) => (current ? { ...current, instructions } : null))
                }
                maxLength={MAX_SKILL_INSTRUCTIONS}
                multiline
                textAlignVertical="top"
                editable={!busy}
                style={[
                  styles.input,
                  { minHeight: 180, color: theme.colors.ink, borderColor: theme.colors.line },
                ]}
              />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                {draft?.instructions.length ?? 0} / {MAX_SKILL_INSTRUCTIONS} characters
              </Text>
              <View style={styles.row}>
                <Text style={{ flex: 1, color: theme.colors.ink }}>Enable for new replies</Text>
                <Switch
                  accessibilityLabel="Enable skill for new replies"
                  value={draft?.enabled ?? false}
                  disabled={busy}
                  onValueChange={(enabled) =>
                    setDraft((current) => (current ? { ...current, enabled } : null))
                  }
                />
              </View>
              {error ? (
                <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                  {error}
                </Text>
              ) : null}
              {!connected ? (
                <Text style={{ color: theme.colors.muted }}>Reconnect to save this draft.</Text>
              ) : null}
              <View style={[styles.row, { justifyContent: "flex-end" }]}>
                <SkillButton label="Cancel" disabled={busy} onPress={() => setDraft(null)} />
                <SkillButton
                  label={busy ? "Saving…" : "Save skill"}
                  primary
                  disabled={disabled}
                  onPress={saveDraft}
                />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={removing !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setRemoving(null);
        }}
      >
        <View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}>
          <View
            accessibilityViewIsModal
            style={[styles.editor, { backgroundColor: theme.colors.surface, alignSelf: "center" }]}
          >
            <Text
              accessibilityRole="header"
              style={{ color: theme.colors.ink, fontSize: 20, fontWeight: "600" }}
            >
              Delete “{removing?.title}”?
            </Text>
            <Text style={{ color: theme.colors.muted, lineHeight: 21 }}>
              This removes the skill from your account. Past replies stay unchanged.
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
                {error}
              </Text>
            ) : null}
            <View style={styles.row}>
              <SkillButton label="Cancel" disabled={busy} onPress={() => setRemoving(null)} />
              <SkillButton
                label={busy ? "Deleting…" : "Delete skill"}
                danger
                disabled={disabled}
                onPress={() => {
                  if (removing) void run(() => deleteSkill(removing.id), "Skill deleted.", true);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function SkillButton(props: {
  readonly label: string;
  readonly text?: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 10,
        justifyContent: "center",
        alignSelf: "flex-start",
        backgroundColor: props.primary ? theme.colors.pine : "transparent",
        opacity: props.disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: props.primary
            ? theme.colors.onPine
            : props.danger
              ? theme.colors.danger
              : theme.colors.pine,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {props.text ?? props.label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
  },
  intro: { padding: 20, gap: 10, borderRadius: 16 },
  card: { padding: 20, gap: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  backdrop: { flex: 1, padding: 20, justifyContent: "center" },
  modalScroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingVertical: 24 },
  editor: { width: "100%", maxWidth: 580, borderRadius: 16, padding: 24, gap: 14 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 15 },
});
