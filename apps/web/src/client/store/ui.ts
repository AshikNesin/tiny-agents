import { create } from "zustand";
import { toast } from "sonner";
import type { Bot } from "../../shared/api/bots";
import { errorMessage } from "../lib/errors";
import { useBotsStore } from "./bots";
import { readStored, readStoredJson, writeStored } from "../lib/browser-storage";

const SIDEBAR_COLLAPSED_KEY = "tiny-agents.sidebar.collapsed";

const CODE_SIDEBAR_KEY = "tiny-agents:code-sidebar";

function readCodeSidebar(): boolean {
  return readStored(CODE_SIDEBAR_KEY) !== "closed";
}

const CODE_PANE_KEY = "tiny-agents:code-pane";

export type CodePane = "changes" | "pr" | "files" | "terminal";

function readCodePane(): CodePane | null {
  const saved = readStored(CODE_PANE_KEY);
  if (saved === "closed") return null;
  return saved === "pr" || saved === "files" || saved === "terminal" ? saved : "changes";
}

const FOLDED_SECTIONS_KEY = "tiny-agents:sidebar-folded";

function readFoldedSections(): string[] {
  const saved = readStoredJson(FOLDED_SECTIONS_KEY);
  return Array.isArray(saved) ? saved.filter((name) => typeof name === "string") : [];
}

const CODE_PANE_WIDE_KEY = "tiny-agents:code-pane-wide";

function readCodePaneWide(): boolean {
  return readStored(CODE_PANE_WIDE_KEY) === "wide";
}

function readCollapsed(): boolean {
  return readStored(SIDEBAR_COLLAPSED_KEY) === "true";
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
  foldedSections: string[];
  toggleSection: (name: string) => void;
  toggleSidebar: (mode: AppMode) => void;
  newThreadDraft: { text: string; projectId: string };
  setNewThreadDraft: (draft: Partial<{ text: string; projectId: string }>) => void;
  codePane: CodePane | null;
  lastCodePane: CodePane;
  setCodePane: (pane: CodePane | null) => void;
  codePaneWide: boolean;
  toggleCodePaneWide: () => void;
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
    writeStored(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    set({ collapsed });
  },
  codeSidebarOpen: readCodeSidebar(),
  foldedSections: readFoldedSections(),
  toggleSection: (name) => {
    const folded = useUiStore.getState().foldedSections;
    const next = folded.includes(name) ? folded.filter((n) => n !== name) : [...folded, name];
    writeStored(FOLDED_SECTIONS_KEY, JSON.stringify(next));
    set({ foldedSections: next });
  },
  newThreadDraft: { text: "", projectId: "" },
  setNewThreadDraft: (draft) =>
    set((state) => ({ newThreadDraft: { ...state.newThreadDraft, ...draft } })),
  toggleSidebar: (mode) => {
    if (mode === "chat") {
      useUiStore.getState().setCollapsed(!useUiStore.getState().collapsed);
      return;
    }
    const open = !useUiStore.getState().codeSidebarOpen;
    writeStored(CODE_SIDEBAR_KEY, open ? "open" : "closed");
    set({ codeSidebarOpen: open });
  },
  codePane: readCodePane(),
  lastCodePane: readCodePane() ?? "changes",
  setCodePane: (codePane) => {
    writeStored(CODE_PANE_KEY, codePane ?? "closed");
    set(codePane ? { codePane, lastCodePane: codePane } : { codePane });
  },
  codePaneWide: readCodePaneWide(),
  toggleCodePaneWide: () => {
    const wide = !useUiStore.getState().codePaneWide;
    writeStored(CODE_PANE_WIDE_KEY, wide ? "wide" : "normal");
    set({ codePaneWide: wide });
  },
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
