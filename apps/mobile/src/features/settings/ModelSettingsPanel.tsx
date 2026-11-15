import type { ModelSettings } from "@yatma/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { useAppStore } from "../../state/atoms";
import { useSyncStatus } from "../../state/syncStatusAtom";
import { getSyncEngine } from "../../sync/engine";
import { useTheme } from "../../theme/theme";

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
  }, [state.accountId, connection]);

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
        : await engine.client.saveModelSettings({ apiKey: apiKey.trim(), model: model.trim() });
      if (generation.current !== current) return;
      setSettings(result);
      setModel(result.model);
      setApiKey("");
      setNotice(remove ? "Personal key removed." : "Key saved. New chat requests will use it.");
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
    apiKey.trim().length >= 16 &&
    model.trim().includes("/") &&
    !busy;
  const inputStyle = {
    color: theme.colors.ink,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 8,
    minHeight: 44,
    padding: 10,
  };
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
        The Cloudflare Worker runs chat. Your key is encrypted on the server for this account; it is
        never included in synced tasks or exports. OpenRouter bills your account for usage.
      </Text>
      <TextInput
        accessibilityLabel="OpenRouter API key"
        placeholder="OpenRouter API key"
        placeholderTextColor={theme.colors.muted}
        value={apiKey}
        onChangeText={setApiKey}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        editable={connected && settings?.canSaveKey === true && !busy}
        style={inputStyle}
      />
      <TextInput
        accessibilityLabel="OpenRouter model"
        placeholder="provider/model"
        placeholderTextColor={theme.colors.muted}
        value={model}
        onChangeText={setModel}
        autoCapitalize="none"
        autoCorrect={false}
        editable={connected && !busy}
        style={inputStyle}
      />
      {connected && settings && !settings.canSaveKey ? (
        <Text style={{ color: theme.colors.danger }}>
          The server needs key-storage configuration before you can save a personal key.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={!canSave}
        onPress={() => void update(false)}
        style={{
          backgroundColor: theme.colors.pine,
          borderRadius: 10,
          padding: 12,
          minHeight: 44,
          opacity: canSave ? 1 : 0.5,
        }}
      >
        <Text style={{ color: theme.colors.onPine, textAlign: "center", fontWeight: "600" }}>
          {busy ? "Saving…" : "Save API key"}
        </Text>
      </Pressable>
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
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.muted }}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
