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
  /**
   * `floating` (default): every page's TopBar carries the circular back
   * button and profile menu. `sidebar`: the app renders its own persistent
   * sidebar, so TopBar drops both from md up and keeps title + actions.
   */
  pageChrome?: "floating" | "sidebar";
  /**
   * Opens the app's own navigation (e.g. its sidebar as a phone drawer).
   * With `pageChrome: "sidebar"`, phones then get one menu button where the
   * back button and profile circle were, so every page navigates the same
   * way. Pages that set `backTo` keep their back button.
   */
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
  return useContext(ShellConfigContext);
}
