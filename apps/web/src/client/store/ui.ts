/**
 * App chrome state: sidebar collapse (desktop, persisted) and drawer (mobile),
 * plus the single create/edit bot dialog the sidebar and chat header share.
 */
import { create } from "zustand";
import { botsApi, type Bot } from "../lib/bots-api";
import { toast } from "sonner";
import { errorMessage } from "../lib/errors";

export const SIDEBAR_COLLAPSED_KEY = "tiny-agents.sidebar.collapsed";

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
  /** Fetches the full bot first: the list entry lacks the editable fields. */
  openEditBot: (botId: string) => Promise<void>;
  setBotDialogOpen: (open: boolean) => void;
  /** Bumped after every save so an open chat refetches its full bot. */
  savedTick: number;
  markSaved: () => void;
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
      const bot = await botsApi.get(botId);
      set({ botDialogOpen: true, editingBot: bot, mobileOpen: false });
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load bot"));
    }
  },
  setBotDialogOpen: (botDialogOpen) => set({ botDialogOpen }),
  savedTick: 0,
  markSaved: () => set((state) => ({ savedTick: state.savedTick + 1 })),
}));
