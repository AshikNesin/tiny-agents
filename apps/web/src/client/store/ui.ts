import { create } from "zustand";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import { errorMessage } from "../lib/errors";
import { useBotsStore } from "./bots";

const SIDEBAR_COLLAPSED_KEY = "tiny-agents.sidebar.collapsed";

const CODE_SIDEBAR_KEY = "tiny-agents:code-sidebar";

function readCodeSidebar(): boolean {
  try {
    return localStorage.getItem(CODE_SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}

const CODE_PANE_KEY = "tiny-agents:code-pane";

export type CodePane = "changes" | "pr" | "files";

const storageIsBlockedInPrivateWindows = (): void => undefined;

function readCodePane(): CodePane | null {
  try {
    const saved = localStorage.getItem(CODE_PANE_KEY);
    if (saved === "closed") return null;
    return saved === "pr" || saved === "files" ? saved : "changes";
  } catch {
    return "changes";
  }
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export type AppMode = "chat" | "code";

export function modeOf(pathname: string): AppMode {
  return pathname === "/code" || pathname.startsWith("/code/") ? "code" : "chat";
}

interface UiState {
  lastPath: Record<AppMode, string>;
  rememberPath: (pathname: string, search?: string) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  codeSidebarOpen: boolean;
  toggleSidebar: (mode: AppMode) => void;
  codePane: CodePane | null;
  lastCodePane: CodePane;
  setCodePane: (pane: CodePane | null) => void;
  codeTerminalOpen: boolean;
  toggleCodeTerminal: () => void;
  codeTerminals: Record<string, string>;
  setCodeTerminal: (threadId: string, name: string | null) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;

  botDialogOpen: boolean;
  editingBot: Bot | null;
  openCreateBot: () => void;
  openEditBot: (botId: string) => Promise<void>;
  setBotDialogOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  lastPath: { chat: "/chats", code: "/code" },
  rememberPath: (pathname, search = "") => {
    if (pathname === "/settings" || pathname.startsWith("/settings/")) return;
    const mode = modeOf(pathname);
    const isModeLanding =
      mode === "chat" ? pathname.startsWith("/chats") : pathname.startsWith("/code");
    if (!isModeLanding) return;
    set((state) =>
      state.lastPath[mode] === pathname + search
        ? state
        : { lastPath: { ...state.lastPath, [mode]: pathname + search } },
    );
  },
  collapsed: readCollapsed(),
  setCollapsed: (collapsed) => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {}
    set({ collapsed });
  },
  codeSidebarOpen: readCodeSidebar(),
  toggleSidebar: (mode) => {
    if (mode === "chat") {
      useUiStore.getState().setCollapsed(!useUiStore.getState().collapsed);
      return;
    }
    const open = !useUiStore.getState().codeSidebarOpen;
    try {
      localStorage.setItem(CODE_SIDEBAR_KEY, open ? "open" : "closed");
    } catch {}
    set({ codeSidebarOpen: open });
  },
  codePane: readCodePane(),
  lastCodePane: readCodePane() ?? "changes",
  setCodePane: (codePane) => {
    try {
      localStorage.setItem(CODE_PANE_KEY, codePane ?? "closed");
    } catch {
      storageIsBlockedInPrivateWindows();
    }
    set(codePane ? { codePane, lastCodePane: codePane } : { codePane });
  },
  codeTerminalOpen: false,
  toggleCodeTerminal: () => set((state) => ({ codeTerminalOpen: !state.codeTerminalOpen })),
  codeTerminals: {},
  setCodeTerminal: (threadId, name) =>
    set((state) => {
      const { [threadId]: _gone, ...rest } = state.codeTerminals;
      return { codeTerminals: name ? { ...rest, [threadId]: name } : rest };
    }),
  mobileOpen: false,
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),

  botDialogOpen: false,
  editingBot: null,
  openCreateBot: () => set({ botDialogOpen: true, editingBot: null, mobileOpen: false }),
  openEditBot: async (botId) => {
    try {
      const bot = await useBotsStore.getState().loadBot(botId, { fresh: true });
      set({ botDialogOpen: true, editingBot: bot, mobileOpen: false });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load bot"));
    }
  },
  setBotDialogOpen: (botDialogOpen) => set({ botDialogOpen }),
}));
