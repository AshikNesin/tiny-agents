/**
 * A bot handed coding work to Shelley (issue #143): the `shelley_start` call
 * as a card with the conversation's live state, opening it on the Code page.
 */
import { Link } from "react-router-dom";
import { ArrowUpRight, CircleCheck, Code2 } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { shortPath } from "../lib/shelley/api";
import { useShelleyStore } from "../store/shelley";
import { Spinner } from "./ui/spinner";

export function ShelleyHandoffCard({
  handoff,
}: {
  handoff: { conversationId: string; slug: string | null; cwd: string | null; url: string };
}) {
  const row = useShelleyStore((s) =>
    s.conversations?.find((c) => c.conversation_id === handoff.conversationId),
  );
  const title = row?.slug || handoff.slug || handoff.conversationId;
  const working = row?.working;
  return (
    <div
      className="border-border flex max-w-md min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5"
      data-testid="shelley-handoff"
    >
      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-xl">
        <Code2 className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground shrink-0">Shelley</span>
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
        <Link to={`/code/${handoff.conversationId}`}>
          Open in Code
          <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}
