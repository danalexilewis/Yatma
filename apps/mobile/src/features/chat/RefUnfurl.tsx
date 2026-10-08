import {
  classifyRefPlacement,
  extractRefs,
  parseRefHref,
  type EntityRef,
} from "@yatma/core";
import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useFoldedState } from "../../state/atoms";
import { selectPage, selectTask } from "../../state/selectors";
import { useTheme } from "../../theme/theme";

export type RefKind = EntityRef["kind"];

export type ParsedRef = {
  readonly kind: RefKind;
  readonly id: string;
  readonly label: string;
  readonly block: boolean;
};

/** Parse markdown-style refs using @yatma/core parsers. */
export function parseRefs(text: string): {
  readonly plain: string;
  readonly refs: ParsedRef[];
} {
  const refs: ParsedRef[] = [];
  const lines = text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    const placement = classifyRefPlacement(text, lineIndex);
    const alone = line.trim().match(/^\[([^\]]*)\]\((task|page|chat):([^)\s]+)\)$/);
    if (alone) {
      const parsed = parseRefHref(`${alone[2]}:${alone[3]}`, alone[1] ?? "");
      if (parsed.ok) {
        refs.push({
          kind: parsed.ref.kind,
          id: parsed.ref.id,
          label: parsed.ref.label || alone[1] || parsed.ref.id,
          block: placement !== "chip",
        });
      }
      continue;
    }
  }
  for (const ref of extractRefs(text)) {
    if (refs.some((existing) => existing.id === ref.id && existing.kind === ref.kind)) {
      continue;
    }
    refs.push({
      kind: ref.kind,
      id: ref.id,
      label: ref.label || ref.id,
      block: false,
    });
  }
  return { plain: text, refs };
}

type RefUnfurlProps = {
  readonly refItem: ParsedRef;
};

/** Live chip or block for a task/page/chat reference. */
export function RefUnfurl(props: RefUnfurlProps) {
  const { refItem } = props;
  const theme = useTheme();
  const folded = useFoldedState();

  if (refItem.kind === "task") {
    const task = selectTask(folded, refItem.id);
    if (!task) {
      return <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>{refItem.label}</Text>;
    }
    const href = `/task/${task.id}` as const;
    if (refItem.block) {
      return (
        <Link href={href} asChild>
          <Pressable
            style={[
              styles.block,
              { borderColor: theme.colors.line, backgroundColor: theme.colors.surface },
            ]}
          >
            <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>
              Task · {task.status.replace("_", " ")}
            </Text>
            <Text
              style={{
                marginTop: 4,
                color: theme.colors.ink,
                fontSize: theme.type.row,
                fontWeight: "500",
              }}
            >
              {task.title}
            </Text>
          </Pressable>
        </Link>
      );
    }
    return (
      <Link href={href} asChild>
        <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
          <Text style={{ color: theme.colors.pine, fontSize: theme.type.meta }}>{task.title}</Text>
        </Pressable>
      </Link>
    );
  }

  if (refItem.kind === "page") {
    const page = selectPage(folded, refItem.id);
    if (!page) {
      return <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>{refItem.label}</Text>;
    }
    const href = `/page/${page.id}` as const;
    return (
      <Link href={href} asChild>
        <Pressable
          style={[
            styles.block,
            { borderColor: theme.colors.line, backgroundColor: theme.colors.surface },
          ]}
        >
          <Text style={{ color: theme.colors.muted, fontSize: theme.type.meta }}>Page</Text>
          <Text
            style={{
              marginTop: 4,
              color: theme.colors.ink,
              fontSize: theme.type.row,
              fontWeight: "500",
            }}
          >
            {page.title}
          </Text>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/chat/${refItem.id}`} asChild>
      <Pressable style={[styles.chip, { backgroundColor: theme.colors.pineSoft }]}>
        <Text style={{ color: theme.colors.ink, fontSize: theme.type.meta }}>{refItem.label}</Text>
      </Pressable>
    </Link>
  );
}

type MessageBodyProps = {
  readonly text: string;
};

/** Render message text with unfurled refs. */
export function MessageWithRefs(props: MessageBodyProps) {
  const theme = useTheme();
  const { refs } = parseRefs(props.text);
  if (refs.length === 0) {
    return (
      <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>{props.text}</Text>
    );
  }
  return (
    <View style={styles.message}>
      <Text style={{ color: theme.colors.ink, fontSize: theme.type.row }}>{props.text}</Text>
      {refs
        .filter((ref) => ref.block)
        .map((ref) => (
          <RefUnfurl key={`${ref.kind}:${ref.id}:${ref.label}`} refItem={ref} />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  message: {
    gap: 8,
  },
});
