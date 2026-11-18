/**
 * The ⌘K "Settings" group: one entry per settings section the viewer has,
 * plus "Check for updates", so settings are reachable without the menus.
 */
import { RefreshCw } from "lucide-react";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { updatesApi } from "../../lib/updates-api";
import { settingsSectionsFor } from "../../pages/settings/sections";

export function settingsCommandGroup(
  guest: boolean,
  navigate: (to: string) => void,
): CommandGroupEntry {
  const sections = settingsSectionsFor(guest);
  return {
    heading: "Settings",
    items: [
      ...sections.map((s) => ({
        id: `settings-${s.id}`,
        label: s.label,
        icon: s.icon,
        action: `Open ${s.label} settings`,
        keywords: s.keywords,
        onSelect: () => navigate(`/settings/${s.id}`),
      })),
      ...(sections.some((s) => s.id === "updates")
        ? [
            {
              id: "settings-check-updates",
              label: "Check for updates",
              icon: RefreshCw,
              keywords: ["update", "upgrade", "version", "release"],
              onSelect: () => {
                // Ask first so Updates opens on "Checking". A server not run by
                // `pnpm local` refuses, and that page says how to turn it on.
                void updatesApi
                  .check()
                  .catch(() => undefined)
                  .finally(() => navigate("/settings/updates"));
              },
            },
          ]
        : []),
    ],
  };
}
