import { useState } from "react";
import { Check, ShieldQuestion, X } from "lucide-react";
import { toast } from "sonner";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import type { RequestAnswer, TranscriptItem } from "../../lib/code/api";
import type { TranscriptActions } from "./transcript-context";

export function RequestRow({
  item,
  actions,
}: {
  item: Extract<TranscriptItem, { kind: "request" }>;
  actions: TranscriptActions;
}) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const open = item.status === "open";
  const answer = (value: RequestAnswer) => {
    setBusy(true);
    actions
      .respond(item.id, value)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Could not answer."),
      )
      .finally(() => setBusy(false));
  };
  const { request } = item;
  const outcome =
    item.status === "allowed"
      ? "Allowed"
      : item.status === "denied"
        ? "Denied"
        : item.status === "answered"
          ? "Answered"
          : item.status === "expired"
            ? "No longer waiting"
            : undefined;
  return (
    <div
      className={cn(
        "border-border flex flex-col gap-2 rounded-xl border px-3 py-2 text-sm",
        open && "border-primary/50 bg-primary/5",
      )}
      data-testid="code-request"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          {request.kind === "tool" ? (
            <>
              <p className="font-medium">
                Allow <span className={monoClass}>{request.name}</span>?
              </p>
              {request.summary && (
                <p className={cn("text-muted-foreground truncate text-xs", monoClass)}>
                  {request.summary}
                </p>
              )}
              {request.reason && <p className="text-muted-foreground text-xs">{request.reason}</p>}
            </>
          ) : (
            request.questions.map((q) => (
              <div key={q.question} className="space-y-1.5">
                <p className="font-medium">{q.question}</p>
                <div className="flex flex-wrap gap-1.5">
                  {q.options.map((option) => (
                    <Button
                      key={option.label}
                      size="xs"
                      variant={picked[q.question] === option.label ? "default" : "outline"}
                      disabled={!open || busy}
                      title={option.description}
                      onClick={() => setPicked((p) => ({ ...p, [q.question]: option.label }))}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        {outcome && <span className="text-muted-foreground shrink-0 text-xs">{outcome}</span>}
      </div>
      {open && (
        <div className="flex justify-end gap-1.5">
          {request.kind === "tool" ? (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => answer({ decision: "deny" })}
              >
                <X />
                Deny
              </Button>
              <Button size="xs" disabled={busy} onClick={() => answer({ decision: "allow" })}>
                <Check />
                Allow
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              disabled={busy || request.questions.some((q) => picked[q.question] === undefined)}
              onClick={() => answer({ answers: picked })}
            >
              <Check />
              Answer
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
