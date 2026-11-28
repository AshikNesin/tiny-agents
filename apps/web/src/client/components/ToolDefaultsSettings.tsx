import { useState } from "react";
import { toast } from "sonner";
import type { ToolPermission } from "../../shared/api/bots";
import { errorMessage } from "../lib/errors";
import {
  useSaveToolPermissions,
  useToolPermissions,
  useToolkits,
} from "../queries/tool-permissions";
import { ToolkitGroup } from "./bot-dialog/ToolkitGroup";

type Permissions = Record<string, ToolPermission>;

export function ToolDefaultsSettings() {
  const toolkits = useToolkits();
  const saved = useToolPermissions();
  const save = useSaveToolPermissions();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (toolkits.status === "failed") {
    return <p className="text-muted-foreground py-6 text-center text-sm">{toolkits.loadError}</p>;
  }
  if (saved.status === "failed") {
    return <p className="text-muted-foreground py-6 text-center text-sm">{saved.loadError}</p>;
  }
  if (toolkits.status === "loading" || saved.status === "loading") {
    return <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>;
  }
  const permissions = saved.data.permissions;
  const groups = toolkits.data.filter((toolkit) => !toolkit.auto);
  const setPermissions = (next: (current: Permissions) => Permissions) => {
    save(next(permissions)).catch((error: unknown) =>
      toast.error(errorMessage(error, "Failed to save tools")),
    );
  };
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Every bot starts from these. A change in a bot's own settings wins for that bot.
      </p>
      {groups.map((toolkit) => (
        <ToolkitGroup
          key={toolkit.id}
          toolkit={toolkit}
          shown={toolkit.tools}
          searching={false}
          expanded={expanded}
          setExpanded={setExpanded}
          toolPermissions={permissions}
          setToolPermissions={setPermissions}
        />
      ))}
    </div>
  );
}
