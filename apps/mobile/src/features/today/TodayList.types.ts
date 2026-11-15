import type { DayEntry } from "@yatma/core";
import type { ReactElement } from "react";
import type { FlatListProps } from "react-native";
import type { DragEndParams, RenderItemParams } from "react-native-draggable-flatlist";

export type TodayListProps = Omit<
  FlatListProps<DayEntry>,
  "renderItem" | "data" | "keyExtractor"
> & {
  readonly data: DayEntry[];
  readonly keyExtractor: (entry: DayEntry, index: number) => string;
  readonly disabled: boolean;
  readonly renderItem: (params: RenderItemParams<DayEntry>) => ReactElement;
  readonly onDragEnd: (params: DragEndParams<DayEntry>) => void;
};
