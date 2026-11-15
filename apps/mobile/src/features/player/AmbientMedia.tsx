import type { StackPreferences } from "@yatma/core";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import { audioSession } from "../../application/audioSession";
import { configureAudioSession } from "../../application/audioMode";
import { createAmbientPlayback } from "./ambientPlayback";

const sources = {
  forest: require("../../../assets/ambience/forest.wav"),
  rain: require("../../../assets/ambience/rain.wav"),
  ocean: require("../../../assets/ambience/ocean.wav"),
};

/** Ambient errors and interruptions are isolated from the durable work runtime. */
export function AmbientMedia(props: { readonly preferences: StackPreferences }) {
  const recording = useSyncExternalStore(
    audioSession.subscribe,
    audioSession.getSnapshot,
    audioSession.getSnapshot,
  );
  const [foreground, setForeground] = useState(
    AppState.currentState === "active" || AppState.currentState === null,
  );
  const [error, setError] = useState<string | null>(null);
  const { scene, volume, muted } = props.preferences;
  const source = scene === "quiet" ? null : sources[scene];
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const playbackRef = useRef<ReturnType<typeof createAmbientPlayback> | null>(null);
  if (!playbackRef.current) {
    playbackRef.current = createAmbientPlayback({
      player,
      configure: configureAudioSession,
      recording: audioSession.getSnapshot,
      onError: setError,
    });
  }
  const playback = playbackRef.current;
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    playback.activate();
    return () => playback.dispose();
  }, [playback]);
  useEffect(() => {
    playback.setGain(volume, muted);
  }, [volume, muted, playback]);
  useEffect(() => {
    void playback.update(source, recording || !foreground);
  }, [source, recording, foreground, playback]);
  const paused = status.isLoaded && !status.playing;
  if (source === null || muted || recording || !foreground || (!error && !status.error && !paused))
    return null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 8,
        padding: 8,
      }}
    >
      <Text accessibilityRole="alert" style={{ color: "#B65A40", fontSize: 12 }}>
        {error ?? "Start your soundscape when you're ready."}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start ambient sound"
        onPress={() => playback.retry(!status.isLoaded)}
        style={{
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: "#1F6B4A",
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "600", fontSize: 12 }}>Start sound</Text>
      </Pressable>
    </View>
  );
}
