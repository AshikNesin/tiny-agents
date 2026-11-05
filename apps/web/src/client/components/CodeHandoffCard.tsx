/**
 * A bot handed coding work to a coding agent (issue #143, ADR 0011): the
 * `code_start` (or older `shelley_start`) call as a card with the thread's
 * live state, opening it on the Code page.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, CircleCheck, Code2 } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { normalizeThreadId, shortPath, threadPath } from "../lib/code/api";
import type { ChatToolCall } from "../lib/chat-types";
import { useCodeStore } from "../store/code";
import { Spinner } from "./ui/spinner";

export function CodeHandoffCard({ handoff }: { handoff: NonNullable<ChatToolCall["code"]> }) {
  const threadId = normalizeThreadId(handoff.threadId);
  const row = useCodeStore((s) => s.threads?.find((t) => t.id === threadId));
  const title = row?.title || handoff.title || threadId;
  const working = row?.working;
  return (
    <div
      className="border-border flex max-w-md min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5"
      data-testid="code-handoff"
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-xl">
        <Code2 className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground shrink-0">{handoff.harness}</span>
          <span className="truncate font-medium">{title}</span>
          {working ? (
            <Spinner className="size-3.5 shrink-0" aria-label="Working" />
          ) : row ? (
            <CircleCheck className="text-muted-foreground size-3.5 shrink-0" aria-label="Idle" />
          ) : null}
        </p>
        <p className={cn("text-muted-foreground truncate text-xs", monoClass)}>
          {working ? "working" : row ? "idle" : "started"}
          {handoff.cwd ? ` · ${shortPath(handoff.cwd)}` : ""}
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to={threadPath(threadId)}>
          Open in Code
          <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}
