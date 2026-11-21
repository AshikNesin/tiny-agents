import { PanelLeft } from "lucide-react";
import type { CommandItemEntry } from "@groot/shell/components/CommandPalette";
import { useUiStore, type AppMode } from "../../store/ui";

export function sidebarCommand(mode: AppMode): CommandItemEntry {
  return {
    id: "toggle-sidebar",
    label: "Toggle sidebar",
    icon: PanelLeft,
    keywords: ["collapse", "expand", "hide", "show", "sidebar"],
    shortcut: "mod+b",
    onSelect: () => useUiStore.getState().toggleSidebar(mode),
  };
}
