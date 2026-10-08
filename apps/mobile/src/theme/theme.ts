import { useColorScheme } from "react-native";

/** Named palette for one appearance. */
export type ThemeColors = {
  readonly canvas: string;
  readonly ink: string;
  readonly muted: string;
  readonly pine: string;
  readonly pineSoft: string;
  readonly line: string;
  readonly surface: string;
  readonly danger: string;
  readonly do: string;
  readonly schedule: string;
  readonly delegate: string;
  readonly eliminate: string;
  readonly inbox: string;
  readonly onPine: string;
  readonly overlay: string;
};

export type Theme = {
  readonly scheme: "light" | "dark";
  readonly colors: ThemeColors;
  readonly type: {
    readonly title: number;
    readonly row: number;
    readonly composer: number;
    readonly meta: number;
  };
  readonly space: {
    readonly screenX: number;
    readonly rowY: number;
    readonly gap: number;
  };
  readonly touch: number;
};

const lightColors: ThemeColors = {
  canvas: "#EEF2F1",
  ink: "#14221E",
  muted: "#5C6B66",
  pine: "#1F6B4A",
  pineSoft: "#1F6B4A22",
  line: "#D5DDD9",
  surface: "#FFFFFF",
  danger: "#C2413A",
  do: "#C2413A",
  schedule: "#2A5DB0",
  delegate: "#A16207",
  eliminate: "#5C6B66",
  inbox: "#1F6B4A",
  onPine: "#FFFFFF",
  overlay: "rgba(20, 34, 30, 0.45)",
};

const darkColors: ThemeColors = {
  canvas: "#141A18",
  ink: "#E7EEEA",
  muted: "#8A9A94",
  pine: "#6FBF96",
  pineSoft: "#6FBF9628",
  line: "#2A3531",
  surface: "#1C2622",
  danger: "#E07A73",
  do: "#E07A73",
  schedule: "#6B93D6",
  delegate: "#D4A017",
  eliminate: "#8A9A94",
  inbox: "#6FBF96",
  onPine: "#14221E",
  overlay: "rgba(0, 0, 0, 0.55)",
};

/** Build a full theme for light or dark. */
export function createTheme(scheme: "light" | "dark"): Theme {
  return {
    scheme,
    colors: scheme === "dark" ? darkColors : lightColors,
    type: {
      title: 28,
      row: 17,
      composer: 16,
      meta: 13,
    },
    space: {
      screenX: 16,
      rowY: 14,
      gap: 8,
    },
    touch: 44,
  };
}

/** Resolve the active theme from the system color scheme. */
export function useTheme(): Theme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return createTheme(scheme);
}

/** Quadrant → theme color. */
export function quadrantColor(
  theme: Theme,
  quadrant: "do" | "schedule" | "delegate" | "eliminate" | "inbox" | null | undefined,
): string {
  if (quadrant === "do") return theme.colors.do;
  if (quadrant === "schedule") return theme.colors.schedule;
  if (quadrant === "delegate") return theme.colors.delegate;
  if (quadrant === "eliminate") return theme.colors.eliminate;
  return theme.colors.inbox;
}
