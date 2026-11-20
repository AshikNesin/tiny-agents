import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  ExternalLink,
  Wrench,
} from "lucide-react";
import { Badge, Button, metaLabelClass, monoClass } from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { relativeTime } from "../../lib/bot-groups";
import { copyText } from "../../lib/clipboard";
import { formatDuration } from "../../lib/code/format";
import { projectsApi } from "../../lib/code/projects";
import { useRefreshOn, useResource } from "../../queries/resource";
import type { CheckLogView, CheckStepView, PullView } from "../../../shared/api/code";

type Check = NonNullable<PullView["snapshot"]>["checks"][number];

const ORDER: Record<Check["state"], number> = { failure: 0, pending: 1, success: 2, neutral: 3 };
const FOLD_AFTER = 6;

function CheckIcon({ state, className }: { state: Check["state"]; className?: string }) {
  if (state === "failure")
    return <CircleX className={cn("text-destructive size-3.5", className)} />;
  if (state === "pending")
    return <CircleDashed className={cn("text-warning size-3.5", className)} />;
  return <CircleCheck className={cn("text-success size-3.5", className)} />;
}

function took(c: Check): string | null {
  if (!c.startedAt || !c.completedAt) return null;
  const ms = Date.parse(c.completedAt) - Date.parse(c.startedAt);
  return ms >= 1000 ? formatDuration(ms) : null;
}

const STEPS_EVERY_MS = 5000;

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Not yet";

function ChecksBar({
  passed,
  failed,
  pending,
}: {
  passed: number;
  failed: number;
  pending: number;
}) {
  return (
    <span
      role="img"
      aria-label={`${passed} passed, ${failed} failed, ${pending} pending`}
      className="bg-muted flex h-1.5 w-full gap-px overflow-hidden rounded-full"
    >
      <span className="bg-success" style={{ flexGrow: passed }} />
      <span className="bg-destructive" style={{ flexGrow: failed }} />
      <span className="bg-warning/70" style={{ flexGrow: pending }} />
    </span>
  );
}

function checksSummary(raw: Check[]) {
  const checks = [...raw].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name),
  );
  const passed = checks.filter((c) => c.state === "success" || c.state === "neutral").length;
  const failed = checks.filter((c) => c.state === "failure").length;
  const pending = checks.length - passed - failed;
  const tally = [
    passed && `${passed} passing`,
    failed && `${failed} failing`,
    pending && `${pending} pending`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { checks, passed, failed, pending, tally };
}

export function PullChecks({
  threadId,
  pr,
  busy,
  onFix,
}: {
  threadId: string;
  pr: PullView;
  busy: string | null;
  onFix(): void;
}) {
  const { checks, passed, failed, pending, tally } = useMemo(
    () => checksSummary(pr.snapshot?.checks ?? []),
    [pr.snapshot?.checks],
  );
  const stalled = useMemo(() => new Set(pr.stalled), [pr.stalled]);
  const [open, setOpen] = useState<string | null>(null);
  const [showPassing, setShowPassing] = useState(false);
  const fold = checks.length > FOLD_AFTER && passed > 0 && passed < checks.length && !showPassing;
  const shown = fold ? checks.filter((c) => ORDER[c.state] < 2) : checks;

  return (
    <section aria-label="Checks" className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={cn(metaLabelClass, "flex-1")}>Checks</h3>
        {checks.length > 0 && <span className="text-muted-foreground text-xs">{tally}</span>}
      </div>
      {checks.length === 0 ? (
        <p className="text-muted-foreground text-sm">No checks on this commit.</p>
      ) : (
        <>
          <ChecksBar passed={passed} failed={failed} pending={pending} />
          {failed > 0 && pr.state === "open" && (
            <div className="border-destructive/30 bg-destructive/5 flex items-center gap-2 rounded-lg border px-3 py-2">
              <CircleX className="text-destructive size-4 shrink-0" />
              <span className="min-w-0 flex-1 text-sm font-medium">
                {failed === 1 ? "1 failing check" : `${failed} failing checks`}
              </span>
              <Button size="xs" variant="outline" onClick={onFix} disabled={busy !== null}>
                {busy === "start a pass" ? <Spinner /> : <Wrench />}
                Fix CI
              </Button>
            </div>
          )}
          <ul className="border-border divide-border divide-y rounded-lg border">
            {shown.map((c) => (
              <CheckRow
                key={c.name}
                threadId={threadId}
                check={c}
                stalled={stalled.has(c.name)}
                open={open === c.name}
                onToggle={() => setOpen((o) => (o === c.name ? null : c.name))}
              />
            ))}
            {fold && (
              <li>
                <button
                  type="button"
                  onClick={() => setShowPassing(true)}
                  className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
                >
                  <CircleCheck className="text-success size-3.5" />
                  Show {passed} passing
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function CheckRow({
  threadId,
  check,
  stalled,
  open,
  onToggle,
}: {
  threadId: string;
  check: Check;
  stalled: boolean;
  open: boolean;
  onToggle(): void;
}) {
  const duration = took(check);
  const age = check.completedAt ?? check.startedAt;
  return (
    <li>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="hover:bg-muted/50 flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CheckIcon state={check.state} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{check.name}</span>
          {stalled && <Badge variant="secondary">Stalled</Badge>}
          {duration && (
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{duration}</span>
          )}
          {age && (
            <span className="text-muted-foreground hidden w-12 shrink-0 text-right text-xs tabular-nums sm:inline">
              {relativeTime(age)}
            </span>
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        {check.url && (
          <Button asChild variant="ghost" size="icon-xs" className="text-muted-foreground">
            <a
              href={check.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${check.name} on GitHub`}
              title="Open on GitHub"
            >
              <ExternalLink />
            </a>
          </Button>
        )}
      </div>
      {open && <CheckDetails threadId={threadId} check={check} />}
    </li>
  );
}

function CheckDetails({ threadId, check }: { threadId: string; check: Check }) {
  return (
    <div className="space-y-3 px-3 pt-1 pb-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="capitalize">{check.state}</dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd>{when(check.startedAt)}</dd>
        <dt className="text-muted-foreground">Completed</dt>
        <dd>{when(check.completedAt)}</dd>
      </dl>
      {check.jobId ? (
        <LogExcerpt threadId={threadId} jobId={check.jobId} check={check} />
      ) : (
        check.url && <FullLog url={check.url} label="View details" />
      )}
    </div>
  );
}

function FullLog({ url, label = "View full log" }: { url: string; label?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs hover:underline"
    >
      {label}
      <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

function LogExcerpt({ threadId, jobId, check }: { threadId: string; jobId: number; check: Check }) {
  const [copied, setCopied] = useState(false);
  const read = useResource<CheckLogView>(
    ["code", "check-log", threadId, jobId],
    () => projectsApi.checkLog(threadId, jobId),
    "Could not read the log.",
    { structuralSharing: false },
  );
  const { data: log, loadError: error, refresh } = read;

  useRefreshOn(check.state, refresh);
  useEffect(() => {
    if (!log?.running) return;
    const timer = setTimeout(() => void refresh(), STEPS_EVERY_MS);
    return () => clearTimeout(timer);
  }, [log, refresh]);

  const running = log?.running != null;

  const copy = async () => {
    if (!log || !(await copyText(log.lines.join("\n")))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const url = log?.url ?? check.url;
  return (
    <section aria-label={`${check.name} log`} className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <h4 className={cn(metaLabelClass, "flex-1")}>{running ? "Steps" : "Log excerpt"}</h4>
        {log && log.lines.length > 0 && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy log excerpt"}
            title="Copy"
            className="text-muted-foreground"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-muted-foreground text-xs">{error}</p>
      ) : !log ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : log.running ? (
        <RunningSteps steps={log.running} />
      ) : (
        <FinishedLog log={log} />
      )}
      {url && <FullLog url={url} />}
    </section>
  );
}

function FinishedLog({ log }: { log: CheckLogView }) {
  const marked = new Set(log.highlight);
  return (
    <>
      {log.summary && (
        <p className={cn("text-destructive text-xs font-medium break-words", monoClass)}>
          {log.summary}
        </p>
      )}
      {log.lines.length === 0 ? (
        <p className="text-muted-foreground text-xs">The log is empty.</p>
      ) : (
        <pre
          className={cn(
            "bg-muted/50 border-border max-h-72 overflow-auto rounded-md border py-2 text-[11px] leading-relaxed",
            monoClass,
          )}
        >
          {log.lines.map((line, i) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              className={cn(
                "px-3 whitespace-pre-wrap break-all",
                marked.has(i) && "bg-destructive/10 text-destructive",
              )}
            >
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </>
  );
}

function StepIcon({ state }: { state: CheckStepView["state"] }) {
  if (state === "running") return <Spinner className="text-warning size-3.5" />;
  if (state === "success") return <CircleCheck className="text-success size-3.5" />;
  if (state === "failure") return <CircleX className="text-destructive size-3.5" />;
  return <CircleDashed className="text-muted-foreground size-3.5" />;
}

function RunningSteps({ steps }: { steps: CheckStepView[] }) {
  return (
    <div className="space-y-1.5">
      {steps.length > 0 && (
        <ol className="space-y-1 text-xs">
          {steps.map((step) => (
            <li key={step.number} className="flex min-w-0 items-center gap-2">
              <StepIcon state={step.state} />
              <span
                className={cn(
                  "truncate",
                  step.state === "queued" || step.state === "skipped"
                    ? "text-muted-foreground"
                    : undefined,
                  step.state === "skipped" && "line-through",
                )}
              >
                {step.name}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-muted-foreground text-xs">
        The log excerpt shows here when the check finishes.
      </p>
    </div>
  );
}
