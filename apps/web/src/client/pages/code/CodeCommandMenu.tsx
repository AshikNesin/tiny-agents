import { useMemo } from "react";
import {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuEmpty,
  CommandMenuFooter,
  CommandMenuInput,
  CommandMenuItem,
  CommandMenuList,
  type CommandMenuItemData,
} from "@groot/ui/command-menu";
import type { KeyCommand } from "../../components/keys";
import type { ThreadSummary } from "../../lib/code/api";

const GROUP_ORDER: KeyCommand["group"][] = ["Thread", "Chat", "Pane", "Go to"];

export function CodeCommandMenu({
  open,
  onOpenChange,
  commands,
  threads,
  onThread,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  commands: KeyCommand[];
  threads: ThreadSummary[];
  onThread(id: string): void;
}) {
  const items = useMemo<CommandMenuItemData[]>(
    () => [
      ...commands
        .filter((command) => command.enabled !== false && command.keys !== ":")
        .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
        .map((command) => ({
          value: `command:${command.id}`,
          label: command.label,
          shortcut: command.keys,
          group: command.group,
          onSelect: command.run,
        })),
      ...threads.map((thread) => ({
        value: `thread:${thread.id}`,
        label: thread.title || "Untitled",
        action: "Open thread",
        group: "Threads",
        onSelect: () => onThread(thread.id),
      })),
    ],
    [commands, threads, onThread],
  );
  return (
    <CommandMenuDialog open={open} onOpenChange={onOpenChange} shortcut={null} title="Commands">
      <CommandMenu items={items}>
        <CommandMenuInput placeholder="Run a command or jump to a thread" />
        <CommandMenuList renderItem={(item) => <CommandMenuItem value={item.value} />}>
          <CommandMenuEmpty>No command or thread matches.</CommandMenuEmpty>
        </CommandMenuList>
        <CommandMenuFooter />
      </CommandMenu>
    </CommandMenuDialog>
  );
}
