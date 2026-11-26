import { useState } from "react";
import { toast } from "sonner";
import { AppWindow, Keyboard } from "lucide-react";
import { Button, LoadingSpinner } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import type { DesktopApp } from "../../../shared/api/live";
import type { DesktopShortcut } from "../../lib/desktop-keys";
import { errorMessage } from "../../lib/errors";
import type { AppsApi } from "./surface";

const menuTool = "text-muted-foreground hover:text-foreground";

export function AppsMenu({
  apps: api,
  profile,
  testId,
}: {
  apps: AppsApi;
  profile: string;
  testId: string;
}) {
  const [apps, setApps] = useState<DesktopApp[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      setApps((await api.list(profile)).apps);
    } catch (error) {
      setApps([]);
      toast.error(errorMessage(error, "Could not list the apps"));
    }
  };

  const launch = async (app: DesktopApp) => {
    try {
      await api.open(profile, app.id);
      toast.success(`Opening ${app.name}…`);
    } catch (error) {
      toast.error(errorMessage(error, `Could not open ${app.name}`));
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={menuTool}
            aria-label="Apps"
            title="Open an app on this desktop"
            data-testid={testId}
          />
        }
      >
        <AppWindow className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuLabel>Open an app</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps === null && (
          <div className="flex justify-center py-3">
            <LoadingSpinner size="sm" />
          </div>
        )}
        {apps?.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No apps found.</div>
        )}
        {apps?.map((app) => (
          <DropdownMenuItem key={app.id} onSelect={() => void launch(app)}>
            {app.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function KeysMenu({
  shortcuts,
  onSend,
  testId,
}: {
  shortcuts: readonly DesktopShortcut[];
  onSend: (index: number) => void;
  testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={menuTool}
            aria-label="Keys"
            title="Send a shortcut to the desktop"
            data-testid={testId}
          />
        }
      >
        <Keyboard className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Send to the desktop</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {shortcuts.map((shortcut, index) => (
          <DropdownMenuItem key={shortcut.keys} onSelect={() => onSend(index)}>
            <span className="flex-1">{shortcut.label}</span>
            <span className="text-xs text-muted-foreground">{shortcut.keys}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
