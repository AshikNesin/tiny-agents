/**
 * App chrome state: sidebar collapse (desktop, persisted) and drawer (mobile),
 * plus the single create/edit bot dialog the sidebar and chat header share.
 */
import { create } from "zustand";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import { errorMessage } from "../lib/errors";
import { useBotsStore } from "./bots";

const SIDEBAR_COLLAPSED_KEY = "tiny-agents.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

interface UiState {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;

  botDialogOpen: boolean;
  /** Bot being edited; null while creating. */
  editingBot: Bot | null;
  openCreateBot: () => void;
  /** Loads the full bot first: the list entry lacks the editable fields. */
  openEditBot: (botId: string) => Promise<void>;
  setBotDialogOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: readCollapsed(),
  setCollapsed: (collapsed) => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Private mode: the toggle still works for this session.
    }
    set({ collapsed });
  },
  mobileOpen: false,
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),

  botDialogOpen: false,
  editingBot: null,
  openCreateBot: () => set({ botDialogOpen: true, editingBot: null, mobileOpen: false }),
  openEditBot: async (botId) => {
    try {
      // Fresh: the form must start from what the server has now.
      const bot = await useBotsStore.getState().loadBot(botId, { fresh: true });
      set({ botDialogOpen: true, editingBot: bot, mobileOpen: false });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load bot"));
    }
  },
  setBotDialogOpen: (botDialogOpen) => set({ botDialogOpen }),
}));
