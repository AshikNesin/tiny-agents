import type { LucideIcon } from "lucide-react";
import { Brain, CalendarClock, ListTodo, Plug, Sparkles, SquareTerminal } from "lucide-react";

export interface AppNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

/** Everyday destinations besides Chats: always visible in the sidebar. */
export const PRIMARY_NAV: AppNavItem[] = [
  { label: "Tasks", icon: ListTodo, to: "/tasks" },
  { label: "Terminal", icon: SquareTerminal, to: "/terminal" },
];

/** Set-up-and-forget pages: in the sidebar's account menu, not its nav. */
export const SECONDARY_NAV: AppNavItem[] = [
  { label: "Routines", icon: CalendarClock, to: "/routines" },
  { label: "Skills", icon: Sparkles, to: "/skills" },
  { label: "Memory", icon: Brain, to: "/memory" },
  { label: "Connections", icon: Plug, to: "/connections" },
];

/** Every destination besides Chats: the ⌘K palette and the mobile profile menu. */
export const APP_NAV: AppNavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];
