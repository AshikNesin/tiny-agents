import { createContext, useContext, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface LoginFeature {
  icon: LucideIcon;
  title: string;
  desc: string;
}

/** A destination row in the profile menu (replaces the old sidebar nav). */
export interface NavDestination {
  label: string;
  icon?: LucideIcon;
  to: string;
}

export interface ShellConfig {
  brand?: {
    label: string;
    icon?: LucideIcon;
    to?: string;
  };
  /** Rows shown in the profile menu. Empty disables the menu rows. */
  nav?: NavDestination[];
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
  return useContext(ShellConfigContext);
}
