import { Ionicons } from "@expo/vector-icons";
import { Link, useGlobalSearchParams, usePathname, useRouter, type Href } from "expo-router";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { requestCaptureOpen } from "../features/capture/captureIntent";
import { useTaskNavigation } from "../features/task/useTaskNavigation";
import { useAppStore } from "../state/atoms";
import { useTheme } from "../theme/theme";
import { IconButton } from "./IconButton";
import { useDesktopLayout } from "./useDesktopLayout";

const destinations = [
  {
    title: "Conversation",
    subtitle: "Your permanent thread",
    href: "/",
    icon: "chatbubble-ellipses-outline",
  },
  {
    title: "Today",
    subtitle: "Plan and play your day",
    href: "/today",
    icon: "play-circle-outline",
  },
  {
    title: "Tasks",
    subtitle: "All tasks, with or without a project",
    href: "/tasks",
    icon: "checkbox-outline",
  },
  {
    title: "Routines",
    subtitle: "Reusable plans and daily defaults",
    href: "/routines",
    icon: "repeat-outline",
  },
  { title: "Projects", subtitle: "All your projects", href: "/projects", icon: "folder-outline" },
  { title: "Skills", subtitle: "Reusable AI instructions", href: "/skills", icon: "sparkles-outline" },
  {
    title: "Settings",
    subtitle: "Workspace preferences",
    href: "/settings",
    icon: "settings-outline",
  },
] as const;
type MenuItem = {
  readonly title: string;
  readonly subtitle: string;
  readonly href?: Href;
  readonly capture?: boolean;
  readonly taskId?: string;
};
const WorkspaceMenuContext = createContext<(() => void) | null>(null);

export function useWorkspaceMenu() {
  return useContext(WorkspaceMenuContext);
}

/** Persistent desktop navigation and keyboard switcher over the existing route tree. */
export function WorkspaceShell(props: { readonly children: ReactNode }) {
  const desktop = useDesktopLayout();
  const pathname = usePathname();
  const { origin } = useGlobalSearchParams<{ origin?: string }>();
  const router = useRouter();
  const navigation = useTaskNavigation();
  const theme = useTheme();
  const { state } = useAppStore();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const returnFocus = useRef<Element | null>(null);
  const search = useRef<ComponentRef<typeof TextInput>>(null);
  const focusMode = pathname === "/focus" || (pathname.startsWith("/task/") && origin === "/focus");
  const projects = [...state.folded.projects.values()].filter(
    (project) => project.archivedAt === null,
  );
  const needle = query.trim().toLowerCase();
  const allItems: MenuItem[] = [
    ...destinations,
    { title: "Focus mode", subtitle: "Timer, soundscape and upcoming work", href: "/focus" },
    { title: "New task", subtitle: "Capture a task in your conversation", capture: true },
    ...projects.map((project) => ({
      title: project.title,
      subtitle: "Project",
      href: `/project/${project.id}/tasks` as Href,
    })),
    ...(needle
      ? [...state.folded.tasks.values()]
          .filter((task) => task.deletedAt === null)
          .map((task) => ({
            title: task.title,
            subtitle: task.status === "done" ? "Completed task" : "Task",
            href: `/task/${task.id}` as Href,
            taskId: task.id,
          }))
      : []),
  ];
  const items = allItems
    .filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(needle))
    .slice(0, 30);
  const currentHighlight = Math.min(highlighted, Math.max(0, items.length - 1));

  function openMenu() {
    returnFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    setQuery("");
    setHighlighted(0);
    setMenuOpen(true);
  }
  function closeMenu(restore = true) {
    setMenuOpen(false);
    if (restore)
      requestAnimationFrame(() => {
        const element = returnFocus.current;
        if (element instanceof HTMLElement && element.isConnected) element.focus();
      });
  }
  function activate(item: MenuItem) {
    closeMenu(false);
    if (item.capture) {
      router.navigate("/");
      requestAnimationFrame(requestCaptureOpen);
    } else if (item.taskId) navigation.openTask(item.taskId);
    else if (item.href) router.navigate(item.href);
  }
  useEffect(() => {
    if (!desktop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (menuOpen) closeMenu();
        else openMenu();
      } else if (menuOpen && event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      } else if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setHighlighted((index) =>
          Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))),
        );
      } else if (
        menuOpen &&
        event.key === "Enter" &&
        event.target instanceof HTMLInputElement &&
        items[currentHighlight]
      ) {
        event.preventDefault();
        activate(items[currentHighlight]!);
      } else if (menuOpen && event.key === "Tab") {
        // The search field owns keyboard selection; keep focus within the switcher.
        event.preventDefault();
        search.current?.focus();
      }
    }
    // RN Web TextInput stops bubbling keyboard events; capture keeps menu keys available while searching.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });
  useEffect(() => {
    if (!desktop) setMenuOpen(false);
  }, [desktop]);
  useEffect(() => {
    setMenuOpen(false);
  }, [state.accountId]);
  useEffect(() => {
    if (desktop && menuOpen)
      document
        .getElementById(`workspace-result-${currentHighlight}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [desktop, menuOpen, currentHighlight]);

  return (
    <WorkspaceMenuContext.Provider value={openMenu}>
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        {desktop && !focusMode ? (
          <View
            role="navigation"
            accessibilityLabel="Workspace navigation"
            style={{
              width: collapsed ? 76 : 236,
              backgroundColor: theme.colors.surface,
              borderRightWidth: 1,
              borderRightColor: theme.colors.line,
              padding: 12,
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingTop: 12,
                  paddingBottom: 24,
                  paddingLeft: 8,
                  gap: 10,
                }}
              >
                <View
                  style={{
                    height: 32,
                    width: 32,
                    backgroundColor: theme.colors.pine,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="leaf-outline" color={theme.colors.onPine} size={18} />
                </View>
                {!collapsed ? (
                  <Text
                    style={{ color: theme.colors.ink, fontSize: 21, fontWeight: "700", flex: 1 }}
                  >
                    Yatma
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open command menu"
                onPress={openMenu}
                style={{
                  minHeight: 40,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: theme.colors.line,
                  borderRadius: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                  marginBottom: 24,
                }}
              >
                <Ionicons name="search-outline" size={18} color={theme.colors.muted} />
                {!collapsed ? (
                  <>
                    <Text style={{ color: theme.colors.muted, flex: 1, fontSize: 13 }}>
                      Quick switch
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11 }}>⌘ / Ctrl K</Text>
                  </>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Create a task"
                onPress={() => activate({ title: "New task", subtitle: "", capture: true })}
                style={{
                  minHeight: 40,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: theme.colors.pineSoft,
                  marginBottom: 20,
                }}
              >
                <Ionicons name="add-outline" size={19} color={theme.colors.pine} />
                {!collapsed ? (
                  <Text style={{ color: theme.colors.pine, fontSize: 13, fontWeight: "600" }}>
                    New task
                  </Text>
                ) : null}
              </Pressable>
              {!collapsed ? (
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 10,
                    letterSpacing: 1.4,
                    fontWeight: "600",
                    paddingHorizontal: 12,
                    marginBottom: 10,
                  }}
                >
                  WORKSPACE
                </Text>
              ) : null}
              {destinations
                .filter((item) => item.title !== "Settings")
                .map((item) => (
                  <NavigationItem
                    key={item.href}
                    {...item}
                    collapsed={collapsed}
                    active={
                      pathname === item.href ||
                      (item.href === "/projects" && pathname.startsWith("/project/"))
                    }
                  />
                ))}
              <View style={{ height: 20 }} />
              {!collapsed ? (
                <>
                  <Text
                    style={{
                      color: theme.colors.muted,
                      fontSize: 10,
                      letterSpacing: 1.4,
                      fontWeight: "600",
                      paddingHorizontal: 12,
                      marginBottom: 10,
                    }}
                  >
                    PROJECTS
                  </Text>
                  <View>
                    {projects.length ? (
                      projects.map((project) => (
                        <NavigationItem
                          key={project.id}
                          title={project.title}
                          href={`/project/${project.id}/tasks`}
                          icon="ellipse-outline"
                          active={pathname.startsWith(`/project/${project.id}/`)}
                        />
                      ))
                    ) : (
                      <Text style={{ color: theme.colors.muted, fontSize: 12, padding: 12 }}>
                        Your projects will appear here.
                      </Text>
                    )}
                  </View>
                </>
              ) : null}
              <View style={{ flex: 1 }} />
              <NavigationItem
                title="Focus mode"
                href="/focus"
                icon="expand-outline"
                collapsed={collapsed}
              />
              <NavigationItem
                title="Settings"
                href="/settings"
                icon="settings-outline"
                collapsed={collapsed}
                active={pathname === "/settings"}
              />
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.line,
                  marginTop: 12,
                  paddingTop: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                {!collapsed ? (
                  <Text style={{ color: theme.colors.muted, fontSize: 11, paddingLeft: 12 }}>
                    {state.accountId ? "Personal workspace" : "Local workspace"}
                  </Text>
                ) : null}
                <IconButton
                  name={collapsed ? "chevron-forward-outline" : "chevron-back-outline"}
                  size={16}
                  accessibilityLabel={collapsed ? "Expand desktop menu" : "Collapse desktop menu"}
                  onPress={() => setCollapsed(!collapsed)}
                />
              </View>
            </ScrollView>
          </View>
        ) : null}
        <View key="workspace-content" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {props.children}
        </View>
        <Modal
          transparent
          visible={menuOpen && desktop}
          animationType="fade"
          onRequestClose={() => closeMenu()}
          onShow={() => search.current?.focus()}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: theme.colors.overlay,
              paddingTop: 100,
              alignItems: "center",
            }}
          >
            <Pressable
              style={{ position: "absolute", inset: 0 }}
              accessibilityLabel="Close command menu"
              onPress={() => closeMenu()}
            />
            <View
              role="dialog"
              aria-label="Quick switch"
              style={{
                width: "90%",
                maxWidth: 580,
                maxHeight: "75%",
                backgroundColor: theme.colors.surface,
                borderRadius: 18,
                overflow: "hidden",
                borderWidth: 1,
                borderColor: theme.colors.line,
              }}
            >
              <View
                style={{
                  padding: 16,
                  gap: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: theme.colors.line,
                }}
              >
                <Ionicons name="search-outline" size={22} color={theme.colors.pine} />
                <TextInput
                  ref={search}
                  autoFocus
                  accessibilityLabel="Search pages, projects and tasks"
                  placeholder="Where would you like to go?"
                  placeholderTextColor={theme.colors.muted}
                  value={query}
                  onChangeText={(text) => {
                    setQuery(text);
                    setHighlighted(0);
                  }}
                  style={{ flex: 1, color: theme.colors.ink, fontSize: 17, minHeight: 40 }}
                />
                <IconButton
                  name="close-outline"
                  accessibilityLabel="Dismiss quick switch"
                  onPress={() => closeMenu()}
                />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}>
                {items.map((item, index) => (
                  <Pressable
                    key={`${item.subtitle}:${item.title}:${item.href ?? "capture"}`}
                    nativeID={`workspace-result-${index}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: currentHighlight === index }}
                    onPress={() => activate(item)}
                    style={{
                      minHeight: 62,
                      paddingHorizontal: 22,
                      paddingVertical: 10,
                      backgroundColor:
                        currentHighlight === index ? theme.colors.pineSoft : "transparent",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: theme.colors.ink, fontSize: 15, fontWeight: "600" }}>
                      {item.title}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 3 }}>
                      {item.subtitle}
                    </Text>
                  </Pressable>
                ))}
                {!items.length ? (
                  <Text style={{ color: theme.colors.muted, padding: 24 }}>
                    No matching pages or tasks.
                  </Text>
                ) : null}
              </ScrollView>
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: theme.colors.muted,
                  fontSize: 11,
                  padding: 14,
                  borderTopWidth: 1,
                  borderTopColor: theme.colors.line,
                }}
              >
                {items[currentHighlight]?.title ?? "No matches"} · ↑ ↓ choose · Enter open · Esc
                close
              </Text>
            </View>
          </View>
        </Modal>
      </View>
    </WorkspaceMenuContext.Provider>
  );
}

function NavigationItem(props: {
  readonly title: string;
  readonly href: Href;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly collapsed?: boolean;
  readonly active?: boolean;
}) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Link href={props.href} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={props.title}
        aria-current={props.active ? "page" : undefined}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          gap: 11,
          paddingHorizontal: 12,
          borderRadius: 10,
          marginVertical: 2,
          backgroundColor: props.active
            ? theme.colors.pineSoft
            : hovered
              ? theme.colors.canvas
              : "transparent",
        }}
      >
        <Ionicons
          name={props.icon}
          size={19}
          color={props.active ? theme.colors.pine : theme.colors.muted}
        />
        {!props.collapsed ? (
          <Text
            numberOfLines={1}
            style={{
              color: props.active ? theme.colors.pine : theme.colors.ink,
              fontSize: 14,
              fontWeight: props.active ? "600" : "400",
              flex: 1,
            }}
          >
            {props.title}
          </Text>
        ) : null}
      </Pressable>
    </Link>
  );
}
