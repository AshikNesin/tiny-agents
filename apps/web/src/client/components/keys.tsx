import { useEffect } from "react";
import { create } from "zustand";
import { formatShortcut, useHotkey, useIsMac } from "@groot/ui/hotkeys";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@groot/ui/dialog";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";

export interface KeyCommand {
  id: string;
  label: string;
  group: "Go to" | "Thread" | "Pane" | "Chat";
  keys?: string;
  enabled?: boolean;
  run(): void;
}

type CommandSource = "page" | "thread";

interface CommandState {
  sources: Record<CommandSource, KeyCommand[]>;
  commands: KeyCommand[];
  helpOpen: boolean;
  set(source: CommandSource, commands: KeyCommand[]): void;
  setHelp(open: boolean): void;
}

export const useKeyCommands = create<CommandState>((set) => ({
  sources: { page: [], thread: [] },
  commands: [],
  helpOpen: false,
  set: (source, commands) =>
    set((state) => {
      const sources = { ...state.sources, [source]: commands };
      const all = [...sources.page, ...sources.thread];
      return all.length > 0
        ? { sources, commands: all }
        : { sources, commands: all, helpOpen: false };
    }),
  setHelp: (helpOpen) => set({ helpOpen }),
}));

const isLetter = (key: string) => /^[a-z]$/i.test(key);

function keyOf(event: Pick<KeyboardEvent, "key" | "shiftKey">): string {
  if (!isLetter(event.key)) return event.key;
  return event.shiftKey ? event.key.toUpperCase() : event.key.toLowerCase();
}

function KeyBinding({ base, commands }: { base: string; commands: KeyCommand[] }) {
  useHotkey(base, (event) => {
    const pressed = keyOf(event);
    commands.find((command) => command.keys === pressed && command.enabled !== false)?.run();
  });
  return null;
}

export function PageKeys({
  commands,
  source = "page",
}: {
  commands: KeyCommand[];
  source?: CommandSource;
}) {
  const publish = useKeyCommands((s) => s.set);
  useEffect(() => {
    publish(source, commands);
    return () => publish(source, []);
  }, [commands, publish, source]);
  const bases = new Map<string, KeyCommand[]>();
  for (const command of commands) {
    if (!command.keys || command.keys === "Escape") continue;
    const base = command.keys.toLowerCase();
    bases.set(base, [...(bases.get(base) ?? []), command]);
  }
  return (
    <>
      {[...bases].map(([base, bound]) => (
        <KeyBinding key={base} base={base} commands={bound} />
      ))}
      {source === "page" && <KeysDialog />}
    </>
  );
}

export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const mac = useIsMac();
  const caps =
    isLetter(keys) && keys === keys.toUpperCase() ? ["⇧", keys] : formatShortcut(keys, mac);
  return (
    <kbd
      className={cn(
        "border-border text-muted-foreground bg-background inline-flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded border px-1 text-[0.6875rem] leading-none font-medium",
        monoClass,
        className,
      )}
    >
      {caps.map((cap) => (
        <span key={cap}>{cap}</span>
      ))}
    </kbd>
  );
}

function KeysDialog() {
  const open = useKeyCommands((s) => s.helpOpen);
  const setOpen = useKeyCommands((s) => s.setHelp);
  const commands = useKeyCommands((s) => s.commands);
  const groups = ["Go to", "Chat", "Thread", "Pane"] as const;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keys</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2" data-testid="code-keys">
          {groups.map((group) => (
            <section key={group} className="space-y-1.5">
              <h3 className="text-muted-foreground text-xs font-medium">{group}</h3>
              {commands
                .filter((command) => command.group === group && command.keys)
                .map((command) => (
                  <p key={command.id} className="flex items-center gap-2 text-sm">
                    <Kbd keys={command.keys!} />
                    <span>{command.label}</span>
                  </p>
                ))}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
