/**
 * Static light-palette aliases for call sites that cannot use hooks.
 * Prefer `useTheme()` for screens that support dark mode.
 */
export const colors = {
  brand: "#1F6B4A",
  brandMuted: "#164F37",
  ink: "#14221E",
  paper: "#EEF2F1",
  muted: "#5C6B66",
  border: "#D5DDD9",
  danger: "#C2413A",
  do: "#C2413A",
  schedule: "#2A5DB0",
  delegate: "#A16207",
  eliminate: "#5C6B66",
  inbox: "#1F6B4A",
  surface: "#FFFFFF",
} as const;
