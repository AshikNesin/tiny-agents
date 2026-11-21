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
