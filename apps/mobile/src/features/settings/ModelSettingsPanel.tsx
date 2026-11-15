import type { ModelSettings } from "@yatma/core";
import { SaveModelSettings } from "@yatma/core";
import * as Schema from "effect/Schema";
import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { useSyncStatus } from "../../state/syncStatusAtom";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";
import { SettingsAction, SettingsField } from "./SettingsControls";

/** Browser and native settings use the same account-owned Worker credential. */
export function ModelSettingsPanel() {
  const theme = useTheme();
  const { state } = useAppStore();
  const connection = useSyncStatus();
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const mountedAccount = useRef(state.accountId);
  if (mountedAccount.current !== state.accountId) {
    mountedAccount.current = state.accountId;
    generation.current++;
  }

  useEffect(() => {
    const current = ++generation.current;
    setSettings(null);
    setApiKey("");
    setShowKey(false);
    setModel("openai/gpt-4o-mini");
    setBusy(false);
    setNotice(null);
    setError(null);
    const engine = getSyncEngine();
    if (!engine) return;
    void engine.client
      .getModelSettings()
      .then((result) => {
        if (generation.current !== current) return;
        setSettings(result);
        setModel(result.model);
      })
      .catch(() => {
        if (generation.current === current)
          setError("Could not load AI settings. Reconnect or refresh to retry.");
      });
    return () => {
      generation.current++;
    };
  }, [state.accountId, connection, reload]);

  async function update(remove: boolean) {
    if (busy) return;
    const engine = getSyncEngine();
    if (!engine) {
      setError("Sign in and connect to save AI settings.");
      return;
    }
    const current = generation.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = remove
        ? await engine.client.removeModelSettings()
        : await engine.client.saveModelSettings({
            ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
            model: model.trim(),
          });
      if (generation.current !== current) return;
      setSettings(result);
      setModel(result.model);
      setApiKey("");
      setShowKey(false);
      setNotice(
        remove
          ? "Personal key removed."
          : apiKey.trim()
            ? "Key saved. New chat requests will use it."
            : "Model saved. New chat requests will use it.",
      );
    } catch {
      if (generation.current === current)
        setError("Could not save AI settings. Check the key and model, then reconnect and retry.");
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }

  const connected = Boolean(state.accountId) && connection === "connected";
  const canSave =
    connected &&
    settings?.canSaveKey &&
    (apiKey.trim().length > 0 || settings.source === "personal") &&
    (apiKey.trim().length > 0 || model.trim() !== settings.model) &&
    Schema.is(SaveModelSettings)({
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      model: model.trim(),
    }) &&
    !busy;
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: theme.colors.ink }}>
        {!connected
          ? "Sign in and connect to configure AI chat."
          : settings?.source === "personal"
            ? "Using your OpenRouter key."
            : settings?.source === "server"
              ? "Using the server's OpenRouter key."
              : settings
                ? "Add an OpenRouter key to enable AI chat."
                : "Loading AI settings…"}
      </Text>
      <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
        Your key is encrypted and stored for this account, outside task sync and exports. OpenRouter
        bills your account for usage. Saving a key does not test provider access.
      </Text>
      {!state.accountId ? (
        <Link href="/(auth)/sign-in" style={{ color: theme.colors.pine, paddingVertical: 12 }}>
          Sign in to add your API key →
        </Link>
      ) : null}
      <SettingsField
        label="OpenRouter API key"
        accessibilityLabel="OpenRouter API key"
        placeholder={
          settings?.source === "personal" ? "Key saved · enter a replacement" : "sk-or-v1-…"
        }
        placeholderTextColor={theme.colors.muted}
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry={!showKey}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        editable={connected && settings?.canSaveKey === true && !busy}
        hint={
          settings?.source === "personal"
            ? "Leave blank to keep your saved key when changing the model."
            : "Enter your personal OpenRouter key to choose a model."
        }
      />
      {apiKey ? (
        <SettingsAction
          label={showKey ? "Hide key" : "Show key"}
          onPress={() => setShowKey(!showKey)}
        />
      ) : null}
      <SettingsField
        label="Model"
        accessibilityLabel="OpenRouter model"
        placeholder="provider/model"
        placeholderTextColor={theme.colors.muted}
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        editable={connected && !busy}
        hint="Use the model ID from OpenRouter, for example provider/model."
      />
      {connected && settings && !settings.canSaveKey ? (
        <Text style={{ color: theme.colors.danger }}>
          The server needs key-storage configuration before you can save a personal key.
        </Text>
      ) : null}
      <SettingsAction
        primary
        disabled={!canSave}
        onPress={() => void update(false)}
        label={
          busy
            ? "Saving…"
            : apiKey.trim() || settings?.source !== "personal"
              ? "Save API key"
              : "Save model"
        }
      />
      {settings?.source === "personal" ? (
        <Pressable
          accessibilityRole="button"
          disabled={!connected || busy}
          onPress={() => void update(true)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: theme.colors.danger }}>Remove personal key</Text>
        </Pressable>
      ) : null}
      {error ? (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
            {error}
          </Text>
          <SettingsAction
            label="Reload AI settings"
            disabled={!connected || busy}
            onPress={() => setReload(reload + 1)}
          />
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
