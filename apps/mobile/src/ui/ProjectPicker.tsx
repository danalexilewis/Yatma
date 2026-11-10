import type { Project, ProjectId } from "@yatma/core";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { useTheme } from "../theme/theme";

/** Single project assignment shared by capture and task editing. */
export function ProjectPicker(props: {
  readonly projects: readonly Project[];
  readonly value: ProjectId | null;
  readonly onChange: (projectId: ProjectId | null) => void;
  readonly disabled?: boolean;
}) {
  const theme = useTheme();
  const options = [{ id: null, title: "Unassigned" }, ...props.projects];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.options}
    >
      {options.map((project) => {
        const selected = props.value === project.id;
        return (
          <Pressable
            key={project.id ?? "unassigned"}
            accessibilityRole="radio"
            accessibilityLabel={`Project: ${project.title}`}
            accessibilityState={{ selected, disabled: props.disabled ?? false }}
            disabled={props.disabled}
            onPress={() => props.onChange(project.id)}
            style={[
              styles.option,
              {
                backgroundColor: selected ? theme.colors.pineSoft : theme.colors.surface,
                borderColor: selected ? theme.colors.pine : theme.colors.line,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? theme.colors.pine : theme.colors.muted,
                fontSize: 13,
                fontWeight: selected ? "600" : "400",
              }}
            >
              {project.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  options: { gap: 6, paddingVertical: 4 },
  option: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
});
