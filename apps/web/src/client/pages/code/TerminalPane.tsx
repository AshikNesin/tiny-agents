import { useEffect, useState } from "react";
import { monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { projectsApi } from "../../lib/code/projects";
import { useResource } from "../../queries/resource";
import { DEFAULT_FONT_SIZE } from "../../lib/xterm";
import type { TerminalConnectionState } from "../../lib/terminal-ws";
import { TerminalView } from "../terminal/TerminalView";
import { useUiStore } from "../../store/ui";

export function TerminalPane({ threadId, place }: { threadId: string; place: string }) {
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
      className="flex h-full min-h-0 flex-col"
      data-testid="code-terminal"
      data-state={state}
    >
      <p
        className={cn(
          "border-border text-muted-foreground flex h-8 shrink-0 items-center truncate border-b px-3 text-xs",
          monoClass,
        )}
      >
        {place}
      </p>
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
