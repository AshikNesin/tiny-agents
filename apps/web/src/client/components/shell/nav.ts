import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Brain,
  CalendarClock,
  Code2,
  Globe,
  KeyRound,
  ListTodo,
  Monitor,
  Plug,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { isGuestPage } from "../../../shared/guest-access";

export interface AppNavItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

const CODE_NAV: AppNavItem = { label: "Code", icon: Code2, to: "/code" };

export const PRIMARY_NAV: AppNavItem[] = [
  { label: "Tasks", icon: ListTodo, to: "/tasks" },
  { label: "Terminal", icon: SquareTerminal, to: "/terminal" },
  { label: "Computer", icon: Monitor, to: "/computer" },
  { label: "Browser", icon: Globe, to: "/browser" },
];

export const SECONDARY_NAV: AppNavItem[] = [
  { label: "Routines", icon: CalendarClock, to: "/routines" },
  { label: "Skills", icon: Sparkles, to: "/skills" },
  { label: "Memory", icon: Brain, to: "/memory" },
  { label: "Traces", icon: Activity, to: "/traces" },
  { label: "Connections", icon: Plug, to: "/connections" },
  { label: "Vault", icon: KeyRound, to: "/vault" },
];

export const APP_NAV: AppNavItem[] = [CODE_NAV, ...PRIMARY_NAV, ...SECONDARY_NAV];

export function guestNav(items: readonly AppNavItem[]): AppNavItem[] {
  return items.filter((item) => isGuestPage(item.to));
}
