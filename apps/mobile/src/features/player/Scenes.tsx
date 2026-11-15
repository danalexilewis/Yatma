import type { StackPreferences, StackPreferencesUpdatedFields } from "@yatma/core";
import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { useTheme } from "../../theme/theme";
import { IconButton } from "../../ui";
import { useStackPlayer } from "./PlayerProvider";

const scenes = [
  {
    id: "quiet",
    label: "Quiet",
    description: "Room to think",
    icon: "moon-outline",
    color: "#263B36",
    accent: "#86A496",
  },
  {
    id: "forest",
    label: "Forest",
    description: "Air, leaves & distant birds",
    icon: "leaf-outline",
    color: "#173D30",
    accent: "#9AB794",
  },
  {
    id: "rain",
    label: "Rain",
    description: "Soft rain & scattered drops",
    icon: "rainy-outline",
    color: "#273E50",
    accent: "#9BB8C7",
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Slow swells & coastal air",
    icon: "water-outline",
    color: "#174A5C",
    accent: "#8CC8C5",
  },
] as const;
const sceneImages = {
  forest: require("../../../assets/focus-scenes/forest-waterfall.png"),
  rain: require("../../../assets/focus-scenes/rain-window.png"),
  ocean: require("../../../assets/focus-scenes/ocean-coast.png"),
};

/** Original bundled scene images fill the ambience pane without network media. */
export function SceneBackdrop(props: { readonly scene: StackPreferences["scene"] }) {
  const scene = scenes.find((item) => item.id === props.scene) ?? scenes[0];
  const image = props.scene === "quiet" ? null : sceneImages[props.scene];
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", inset: 0, overflow: "hidden", backgroundColor: scene.color }}
    >
      {image ? (
        <Image
          source={image}
          resizeMode="cover"
          accessible={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      ) : (
        <>
          <View
            style={{
              position: "absolute",
              width: 160,
              height: 160,
              borderRadius: 80,
              top: 50,
              right: "12%",
              backgroundColor: scene.accent,
              opacity: 0.3,
            }}
          />
          {[0, 1, 2].map((layer) => (
            <View
              key={layer}
              style={{
                position: "absolute",
                width: "150%",
                height: 320,
                borderRadius: 180,
                bottom: -100 + layer * 45,
                left: -100 + layer * 40,
                transform: [{ rotate: `${layer * 7 - 12}deg` }],
                backgroundColor: scene.accent,
                opacity: 0.08 + layer * 0.06,
              }}
            />
          ))}
        </>
      )}
    </View>
  );
}

/** Committed scene and gain preferences stay independent of the work player. */
export function SceneControls() {
  const { preferences, daily } = useStackPlayer();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [trackWidth, setTrackWidth] = useState(1);
  const inFlight = useRef(false);
  const quiet = preferences.scene === "quiet";
  const selectedScene = scenes.find((scene) => scene.id === preferences.scene) ?? scenes[0];
  async function update(set: StackPreferencesUpdatedFields) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await daily.preferences(set);
      setError(null);
    } catch {
      setError("Could not save your soundscape. Try again.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  function setVolume(value: number) {
    void update({ volume: Math.round(Math.max(0, Math.min(1, value)) * 100) / 100 });
  }
  return (
    <View style={{ gap: 18, padding: 20 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <View style={{ gap: 3 }}>
          <Text style={{ color: theme.colors.ink, fontSize: 16, fontWeight: "600" }}>
            Soundscapes
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            A little atmosphere. Space to focus.
          </Text>
        </View>
        <Ionicons name="headset-outline" size={19} color={theme.colors.muted} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {scenes.map((scene) => {
          const selected = preferences.scene === scene.id;
          return (
            <Pressable
              key={scene.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: saving }}
              accessibilityLabel={`${scene.label} soundscape. ${scene.description}`}
              disabled={saving}
              onPress={() => {
                void update({ scene: scene.id, muted: scene.id === "quiet" });
              }}
              style={({ pressed }) => ({
                flexGrow: 1,
                flexBasis: 138,
                minWidth: 126,
                minHeight: 116,
                overflow: "hidden",
                borderRadius: 14,
                backgroundColor: scene.color,
                borderWidth: 2,
                borderColor: selected ? scene.accent : "transparent",
                padding: 14,
                opacity: pressed ? 0.82 : 1,
                justifyContent: "space-between",
              })}
            >
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: 112,
                  height: 112,
                  borderRadius: 56,
                  right: -30,
                  top: -34,
                  backgroundColor: scene.accent,
                  opacity: 0.11,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Ionicons name={scene.icon} size={23} color={scene.accent} />
                {selected ? (
                  <Ionicons name="checkmark-circle" size={18} color={scene.accent} />
                ) : null}
              </View>
              <View style={{ gap: 3, marginTop: 14 }}>
                <Text style={{ color: "#F4F7F4", fontWeight: "600", fontSize: 14 }}>
                  {scene.label}
                </Text>
                <Text style={{ color: scene.accent, fontSize: 11, lineHeight: 16 }}>
                  {scene.description}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ gap: 7 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ color: theme.colors.ink, fontSize: 13, fontWeight: "500" }}>
              {selectedScene.label}
            </Text>
            <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
              {quiet
                ? "A quiet place to work"
                : preferences.muted
                  ? "Muted · your scene stays ready"
                  : "A continuous, unhurried loop"}
            </Text>
          </View>
          <IconButton
            name={preferences.muted || quiet ? "volume-mute-outline" : "volume-medium-outline"}
            accessibilityLabel={preferences.muted ? "Unmute soundscape" : "Mute soundscape"}
            disabled={quiet || saving}
            size={20}
            onPress={() => {
              void update({ muted: !preferences.muted });
            }}
          />
        </View>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 4, opacity: quiet ? 0.4 : 1 }}
        >
          <IconButton
            name="remove"
            accessibilityLabel="Lower soundscape volume"
            size={16}
            disabled={quiet || saving || preferences.volume <= 0}
            onPress={() => setVolume(preferences.volume - 0.1)}
          />
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Soundscape volume"
            accessibilityState={{ disabled: quiet || saving }}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(preferences.volume * 100) }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) => {
              if (!quiet && !saving)
                setVolume(
                  preferences.volume + (event.nativeEvent.actionName === "increment" ? 0.1 : -0.1),
                );
            }}
            disabled={quiet || saving}
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onPress={(event) => setVolume(event.nativeEvent.locationX / Math.max(1, trackWidth))}
            style={{ flex: 1, minWidth: 80, minHeight: 44, justifyContent: "center" }}
          >
            <View
              pointerEvents="none"
              style={{
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.colors.line,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  width: `${Math.round(preferences.volume * 100)}%`,
                  height: "100%",
                  borderRadius: 3,
                  backgroundColor: theme.colors.pine,
                }}
              />
            </View>
          </Pressable>
          <IconButton
            name="add"
            accessibilityLabel="Raise soundscape volume"
            size={16}
            disabled={quiet || saving || preferences.volume >= 1}
            onPress={() => setVolume(preferences.volume + 0.1)}
          />
          <Text
            style={{
              color: theme.colors.muted,
              fontSize: 11,
              width: 34,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            {Math.round(preferences.volume * 100)}%
          </Text>
        </View>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger, fontSize: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
