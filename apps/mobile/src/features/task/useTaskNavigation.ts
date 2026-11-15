import { usePathname, useRouter } from "expo-router";
import { Platform } from "react-native";

let originFocus: Element | null = null;

/** Keeps route identity and web focus when presenting task details over an existing screen. */
export function useTaskNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  function openTask(taskId: string) {
    if (Platform.OS === "web" && typeof document !== "undefined")
      originFocus = document.activeElement;
    router.push({ pathname: "/task/[id]", params: { id: taskId, origin: pathname } });
  }
  function closeTask() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
    const focus = originFocus;
    originFocus = null;
    if (Platform.OS === "web")
      requestAnimationFrame(() => {
        if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
      });
  }
  function openProject(projectId: string) {
    // Replacing the detail route leaves its original screen directly beneath the project.
    router.replace({ pathname: "/project/[id]/overview", params: { id: projectId } });
  }
  return { openTask, closeTask, openProject };
}
