import { Check, Sparkles, X } from "lucide-react";
import { Button, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import type { FindingView, PullReviewView } from "../../../shared/api/code";
import { Kbd } from "../../components/keys";

const SEVERITY: Record<FindingView["severity"], string> = {
  bug: "text-destructive",
  test: "text-warning",
  nit: "text-muted-foreground",
  question: "text-info",
};

const fileName = (path: string) => path.split("/").at(-1) ?? path;

export function openFindings(review: PullReviewView): FindingView[] {
  return review.findings.filter((finding) => finding.state === "open");
}

export function ReviewFindings({
  review,
  focused,
  busy,
  onFocus,
  onRun,
  onAdd,
  onDismiss,
}: {
  review: PullReviewView;
  focused: string | null;
  busy: boolean;
  onFocus(id: string): void;
  onRun(): void;
  onAdd(finding: FindingView): void;
  onDismiss(finding: FindingView): void;
}) {
  const open = openFindings(review);
  const settled = review.findings.filter((finding) => finding.state !== "open");
  return (
    <section
      aria-label="Agent review"
      className="border-border max-h-[55%] shrink-0 space-y-2 overflow-y-auto border-b px-3 py-2 text-sm"
      data-testid="code-findings"
    >
      {review.reviewing ? (
        <p className="text-muted-foreground flex items-center gap-2" role="status">
          <Spinner className="size-3.5" />
          The agent is reading the change. Its findings will show here.
        </p>
      ) : (
        <Button
          size="sm"
          variant={review.brief === null ? "default" : "outline"}
          onClick={onRun}
          disabled={busy}
          data-testid="code-agent-review"
        >
          <Sparkles />
          {review.brief === null ? "Review with the agent" : "Review again"}
          <Kbd keys="r" />
        </Button>
      )}
      {review.brief && (
        <p data-testid="code-review-brief">
          <span className="text-muted-foreground mr-1.5 text-xs font-medium">Brief</span>
          {review.brief}
        </p>
      )}
      {review.brief !== null && !review.reviewing && (
        <h3 className="text-muted-foreground text-xs font-medium">
          {open.length === 0 ? "No open findings" : `Findings · ${open.length} open`}
        </h3>
      )}
      <ul className="space-y-1">
        {open.map((finding) => {
          const active = finding.id === focused;
          return (
            <li
              key={finding.id}
              aria-current={active ? "true" : undefined}
              className={cn("rounded-lg px-2 py-1.5", active ? "bg-muted" : "hover:bg-muted/60")}
              data-testid="code-finding"
            >
              <button
                type="button"
                className="flex w-full items-baseline gap-2 text-left outline-none"
                onClick={() => onFocus(finding.id)}
              >
                <span className={cn("shrink-0 text-xs font-medium", SEVERITY[finding.severity])}>
                  {finding.severity}
                </span>
                <span className="min-w-0 flex-1">{finding.title}</span>
                <span className={cn("text-muted-foreground shrink-0 text-xs", monoClass)}>
                  {fileName(finding.path)}:{finding.line}
                </span>
              </button>
              {active && (
                <div className="space-y-2 pt-1.5">
                  <p className="text-muted-foreground">{finding.body}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="xs" onClick={() => onAdd(finding)} disabled={busy}>
                      <Check />
                      Add to my review
                      <Kbd keys="y" />
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onDismiss(finding)}
                      disabled={busy}
                    >
                      <X />
                      Dismiss
                      <Kbd keys="d" />
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {settled.map((finding) => (
          <li
            key={finding.id}
            className="text-muted-foreground flex items-baseline gap-2 px-2 text-xs line-through"
          >
            <span className="min-w-0 flex-1 truncate">{finding.title}</span>
            <span className="shrink-0 no-underline">
              {finding.state === "added" ? "in your review" : "dismissed"}
            </span>
          </li>
        ))}
      </ul>
      {open.length > 0 && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span>
            <Kbd keys="n" /> <Kbd keys="p" /> next, previous
          </span>
          <span>Nothing is posted until you submit.</span>
        </p>
      )}
    </section>
  );
}
