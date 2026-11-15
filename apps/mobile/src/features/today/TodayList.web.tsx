import { useRef, useState, type DragEvent } from "react";
import { FlatList } from "react-native";

import type { TodayListProps } from "./TodayList.types";
import { useTheme } from "../../theme/theme";

/** Browser drag events keep mouse reordering independent of native pan-gesture ownership. */
export function TodayList({ disabled, renderItem, onDragEnd, ...props }: TodayListProps) {
  const theme = useTheme();
  const source = useRef<string | null>(null);
  const armed = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ id: string; after: boolean } | null>(null);

  function clearDrag() {
    source.current = null;
    armed.current = null;
    setDragging(null);
    setDestination(null);
  }
  function drop(event: DragEvent<HTMLDivElement>, id: string) {
    if (!source.current || disabled) return;
    event.preventDefault();
    const data = [...props.data];
    const from = data.findIndex((entry) => entry.id === source.current);
    const target = data.findIndex((entry) => entry.id === id);
    if (from < 0 || target < 0) return clearDrag();
    const after =
      event.clientY >
      event.currentTarget.getBoundingClientRect().top + event.currentTarget.offsetHeight / 2;
    const to = target + (after ? 1 : 0) - (from < target + (after ? 1 : 0) ? 1 : 0);
    const [moved] = data.splice(from, 1);
    data.splice(to, 0, moved!);
    clearDrag();
    onDragEnd({ data, from, to });
  }

  return (
    <FlatList
      {...props}
      renderItem={({ item, index }) => (
        <div
          draggable={!disabled}
          onPointerDownCapture={(event) => {
            armed.current =
              event.target instanceof Element && event.target.closest('[role="slider"]')
                ? item.id
                : null;
          }}
          onDragStart={(event) => {
            if (disabled || armed.current !== item.id) return event.preventDefault();
            source.current = item.id;
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            setDragging(item.id);
          }}
          onDragOver={(event) => {
            if (!source.current || disabled) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            setDestination({ id: item.id, after: event.clientY > rect.top + rect.height / 2 });
          }}
          onDrop={(event) => drop(event, item.id)}
          onDragEnd={clearDrag}
          style={{
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          {renderItem({
            item,
            getIndex: () => index,
            drag: () => {},
            isActive: dragging === item.id,
          })}
          {destination?.id === item.id && source.current !== item.id ? (
            <div
              style={{
                position: "absolute",
                left: 16,
                right: 16,
                height: 2,
                background: theme.colors.pine,
                ...(destination.after ? { bottom: 0 } : { top: 0 }),
              }}
            />
          ) : null}
        </div>
      )}
    />
  );
}
