import { createContext, useContext, type ReactNode } from "react";
import { LayoutDashboard, type LucideIcon } from "lucide-react";
import { useAuthStore } from "@groot/shell/store/auth";

export interface LoginFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface NavDestination {
  label: string;
  icon?: LucideIcon;
  to: string;
  primary?: boolean;

  adminOnly?: boolean;

  fullPage?: boolean;
  shortcut?: string;
}

export function isNavActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + "/");
}

export interface ShellBrand {
  label: string;
  icon?: LucideIcon;
  to?: string;
}
export interface ShellConfig {
  brand?: ShellBrand;
  nav?: NavDestination[];
  openNav?: () => void;
  login?: {
    tagline?: string;
    description?: string;
    features?: LoginFeature[];
  };
}

const ShellConfigContext = createContext<ShellConfig>({});

export function ShellProvider({ config, children }: { config: ShellConfig; children: ReactNode }) {
  return <ShellConfigContext.Provider value={config}>{children}</ShellConfigContext.Provider>;
}

export function useShellConfig() {
  const config = useContext(ShellConfigContext);
  const user = useAuthStore((state) => state.user);
  const brand: Required<ShellBrand> = {
    label: config.brand?.label ?? "Groot",
    icon: config.brand?.icon ?? LayoutDashboard,
    to: config.brand?.to ?? "/",
  };
  return {
    ...config,
    brand,
    nav: (config.nav ?? []).filter((destination) => !destination.adminOnly || user?.isAdmin),
  };
}
