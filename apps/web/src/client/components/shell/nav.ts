import type { LucideIcon } from "lucide-react";
import { Brain, CalendarClock, ListTodo, Plug, Sparkles } from "lucide-react";

export interface AppNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

/** Destinations besides Chats; the sidebar and the mobile profile menu share them. */
export const APP_NAV: AppNavItem[] = [
  { label: "Tasks", icon: ListTodo, to: "/tasks" },
  { label: "Routines", icon: CalendarClock, to: "/routines" },
  { label: "Skills", icon: Sparkles, to: "/skills" },
  { label: "Memory", icon: Brain, to: "/memory" },
  { label: "Connections", icon: Plug, to: "/connections" },
];
