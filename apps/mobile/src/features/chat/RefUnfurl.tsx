import {
  classifyRefPlacement,
  extractRefs,
  parseRefHref,
  type EntityRef,
} from "@yatma/core";
import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useFoldedState } from "../../state/atoms";
import { selectPage, selectTask } from "../../state/selectors";
import { colors } from "../../theme/colors";

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

/** Live chip or card for a task/page/chat reference. */
export function RefUnfurl(props: RefUnfurlProps) {
  const { refItem } = props;
  const folded = useFoldedState();

  if (refItem.kind === "task") {
    const task = selectTask(folded, refItem.id);
    if (!task) {
      return <Text className="text-sm text-slate-500">{refItem.label}</Text>;
    }
    const href = `/task/${task.id}` as const;
    if (refItem.block) {
      return (
        <Link href={href} asChild>
          <Pressable className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <Text className="text-xs uppercase" style={{ color: colors.muted }}>
              Task · {task.status}
            </Text>
            <Text className="mt-1 text-base font-medium text-slate-900 dark:text-slate-50">
              {task.title}
            </Text>
          </Pressable>
        </Link>
      );
    }
    return (
      <Link href={href} asChild>
        <Pressable
          className="rounded-full px-2.5 py-1"
          style={{ backgroundColor: `${colors.brand}22` }}
        >
          <Text className="text-sm" style={{ color: colors.brand }}>
            {task.title}
          </Text>
        </Pressable>
      </Link>
    );
  }

  if (refItem.kind === "page") {
    const page = selectPage(folded, refItem.id);
    if (!page) {
      return <Text className="text-sm text-slate-500">{refItem.label}</Text>;
    }
    const href = `/page/${page.id}` as const;
    return (
      <Link href={href} asChild>
        <Pressable className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <Text className="text-xs uppercase" style={{ color: colors.muted }}>
            Page
          </Text>
          <Text className="mt-1 text-base font-medium text-slate-900 dark:text-slate-50">
            {page.title}
          </Text>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={`/chat/${refItem.id}`} asChild>
      <Pressable className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
        <Text className="text-sm text-slate-700 dark:text-slate-200">{refItem.label}</Text>
      </Pressable>
    </Link>
  );
}

type MessageBodyProps = {
  readonly text: string;
};

/** Render message text with unfurled refs. */
export function MessageWithRefs(props: MessageBodyProps) {
  const { refs } = parseRefs(props.text);
  if (refs.length === 0) {
    return <Text className="text-base text-slate-800 dark:text-slate-100">{props.text}</Text>;
  }
  return (
    <View className="gap-2">
      <Text className="text-base text-slate-800 dark:text-slate-100">{props.text}</Text>
      {refs
        .filter((ref) => ref.block)
        .map((ref) => (
          <RefUnfurl key={`${ref.kind}:${ref.id}:${ref.label}`} refItem={ref} />
        ))}
    </View>
  );
}
