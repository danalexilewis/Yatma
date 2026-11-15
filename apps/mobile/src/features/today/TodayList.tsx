import DraggableFlatList from "react-native-draggable-flatlist";

import type { TodayListProps } from "./TodayList.types";

/** Native touch dragging retains the list's animation and edge autoscroll. */
export function TodayList({ disabled, ...props }: TodayListProps) {
  return (
    <DraggableFlatList
      {...props}
      activationDistance={8}
      containerStyle={{ flex: 1 }}
      scrollEnabled={!disabled && props.scrollEnabled !== false}
    />
  );
}
