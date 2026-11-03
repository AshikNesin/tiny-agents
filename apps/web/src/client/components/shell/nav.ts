import type { LucideIcon } from "lucide-react";
import {
  Brain,
  CalendarClock,
  Code2,
  KeyRound,
  ListTodo,
  Monitor,
  Plug,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

export interface AppNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

/** Everyday destinations besides Chats: always visible in the sidebar. */
export const PRIMARY_NAV: AppNavItem[] = [
  { label: "Tasks", icon: ListTodo, to: "/tasks" },
  { label: "Code", icon: Code2, to: "/code" },
  { label: "Terminal", icon: SquareTerminal, to: "/terminal" },
  { label: "Computer", icon: Monitor, to: "/computer" },
];

/** Set-up-and-forget pages: in the sidebar's account menu, not its nav. */
export const SECONDARY_NAV: AppNavItem[] = [
  { label: "Routines", icon: CalendarClock, to: "/routines" },
  { label: "Skills", icon: Sparkles, to: "/skills" },
  { label: "Memory", icon: Brain, to: "/memory" },
  { label: "Connections", icon: Plug, to: "/connections" },
  { label: "Vault", icon: KeyRound, to: "/vault" },
];

/** Every destination besides Chats: the ⌘K palette and the mobile profile menu. */
export const APP_NAV: AppNavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** Pages a guest may open besides Chats and Settings (issue #145): Code. */
export const GUEST_PAGES = ["/code"] as const;

/** The part of a nav list a guest sees. */
export function guestNav(items: readonly AppNavItem[]): AppNavItem[] {
  return items.filter((item) => (GUEST_PAGES as readonly string[]).includes(item.to));
}
