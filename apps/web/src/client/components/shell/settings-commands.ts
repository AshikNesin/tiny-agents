import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { CommandGroupEntry } from "@groot/shell/components/CommandPalette";
import { errorMessage } from "../../lib/errors";
import { updatesApi } from "../../lib/updates-api";
import { settingsSectionsFor } from "../../pages/settings/sections";

export function settingsCommandGroup(
  guest: boolean,
  code: boolean,
  navigate: (to: string) => void,
): CommandGroupEntry {
  const sections = settingsSectionsFor(guest, code);
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
                void updatesApi
                  .check()
                  .catch((error: unknown) =>
                    toast.error(errorMessage(error, "Could not check for updates.")),
                  )
                  .finally(() => navigate("/settings/updates"));
              },
            },
          ]
        : []),
    ],
  };
}
