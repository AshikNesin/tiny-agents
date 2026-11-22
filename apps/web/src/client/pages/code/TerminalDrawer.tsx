import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { DEFAULT_FONT_SIZE } from "../../lib/xterm";
import type { TerminalConnectionState } from "../../lib/terminal-ws";
import { TerminalView } from "../terminal/TerminalView";
import { useUiStore } from "../../store/ui";
import { Kbd } from "./keys";

export function TerminalDrawer({
  threadId,
  place,
  onClose,
}: {
  threadId: string;
  place: string;
  onClose(): void;
}) {
  const name = useUiStore((s) => s.codeTerminals[threadId]);
  const remember = useUiStore((s) => s.setCodeTerminal);
  const [state, setState] = useState<TerminalConnectionState>("connecting");
  const opened = useResource(
    ["code", "terminal", threadId],
    () => projectsApi.terminal(threadId),
    "Could not open a terminal.",
    { enabled: !name },
  );
  const openedName = opened.data?.name;
  const error = opened.loadError;

  useEffect(() => {
    if (!name && openedName) remember(threadId, openedName);
  }, [name, openedName, threadId, remember]);

  useEffect(() => {
    if (state === "closed") remember(threadId, null);
  }, [state, threadId, remember]);

  return (
    <section
      aria-label="Terminal"
      className="border-border flex h-[38%] min-h-40 shrink-0 flex-col border-t"
      data-testid="code-terminal"
      data-state={state}
    >
      <div className="border-border flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span className={cn("text-muted-foreground min-w-0 flex-1 truncate", monoClass)}>
          {place}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the terminal"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Kbd keys="`" />
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="text-destructive p-3 text-xs">{error}</p>
        ) : !name ? (
          <Spinner className="m-3 size-3.5" />
        ) : (
          <TerminalView
            key={name}
            name={name}
            active
            fontSize={DEFAULT_FONT_SIZE - 1}
            onState={setState}
          />
        )}
      </div>
    </section>
  );
}
