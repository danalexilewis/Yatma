import { Platform, useWindowDimensions } from "react-native";

/** Use desktop navigation for wide browser workspaces, retaining touch tabs elsewhere. */
export function useDesktopLayout(): boolean {
  const { width } = useWindowDimensions();
  return Platform.OS === "web" && width >= 1000;
}
