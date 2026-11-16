/**
 * The PR tab (issue #297 §7.5): beside Changes in the right panel, for a
 * thread started in a project. With no open PR it offers Publish (push the
 * branch, open a draft PR) and Link. With one: checks at a glance (failures
 * link to their log; stalled ones are marked), reviews and unresolved
 * comments (from authors Auto-fix does not trust, labelled Ignored), the
 * actions (Merge, Fix CI, Attach all comments) in one row, the Auto-fix and
 * Auto-merge switches (and a spend limit where the harness reports cost),
 * the pass history, the folded description, and earlier PRs. Opening the
 * tab reconciles with GitHub, and so does each re-read while it is on screen
 * (every 15 seconds), so a project without the App's webhooks (`gh` or a
 * token) keeps up as fast as one with them.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Link2,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, EmptyState, Input, metaLabelClass, monoClass } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "../../components/ui/switch";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { MergeMethod, PullView, ThreadPullsView } from "../../../shared/api/code";

/** How often the tab re-reads (and so reconciles) its PR while it is on screen. */
const LIVE_MS = 15_000;

const LOOP_LABEL: Record<PullView["loop"]["status"], string> = {
  watching: "Watching",
  fixing: "Fixing",
  needs_input: "Needs you",
  green: "Green",
  paused: "Paused",
  merged: "Merged",
  off: "Off",
};

const OUTCOME_LABEL: Record<string, string> = {
  pushed: "Pushed",
  clean: "Nothing to change",
  no_progress: "No commit",
  rejected: "Push rejected",
  protected_path: "Not pushed: protected path",
  timed_out: "Timed out",
  diverged: "Branch diverged",
  send_failed: "Could not start",
};

/** The unresolved review comments as one composer message. */
function commentsText(view: PullView): string {
  const threads = (view.snapshot?.threads ?? []).filter(
    (t) => !t.resolved && !view.ignored.includes(t.id),
  );
  return threads
    .map((t) => {
      const where = `\`${t.path}${t.line ? `:${t.line}` : ""}\``;
      const body = t.comments.map((c) => `${c.author.login}: ${c.body}`).join("\n");
      return `${where}\n${body}`;
    })
    .join("\n\n");
}

export function PullPanel({
  threadId,
  refreshKey,
  onAttach,
  onClose,
  onExpand,
}: {
  threadId: string;
  /** Changes when the thread's turn ends, to re-read. */
  refreshKey: unknown;
  /** Put text in the composer. */
  onAttach(text: string): void;
  onClose(): void;
  /** Show this at full width on the thread's Review page. */
  onExpand?: () => void;
}) {
  const [view, setView] = useState<ThreadPullsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [linkNumber, setLinkNumber] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .pulls(threadId)
      .then((v) => !cancelled && setView(v))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the PR.")));
    return () => {
      cancelled = true;
    };
  }, [threadId, refreshKey, reload]);

  // While on screen, re-read: each read is a fresh reconcile with GitHub. A
  // hidden page stops, and catches up as soon as it is shown again. A missed
  // background read keeps what is shown; the next one tries again.
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    const read = () => {
      if (reading || document.visibilityState !== "visible") return;
      reading = true;
      projectsApi
        .pulls(threadId)
        .then((v) => {
          if (cancelled) return;
          setView(v);
          setError(null);
        })
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };
    const timer = setInterval(read, LIVE_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [threadId]);

  const act = useCallback(async (what: string, work: () => Promise<ThreadPullsView | void>) => {
    setBusy(what);
    try {
      const next = await work();
      if (next) setView(next);
    } catch (e) {
      toast.error(errorMessage(e, `Could not ${what}.`));
    } finally {
      setBusy(null);
    }
  }, []);

  const pr = view?.active ?? null;
  const snap = pr?.snapshot ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-pr">
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
        <span className="flex min-w-0 items-center gap-2 px-2 text-sm font-medium">
          {pr?.draft ? (
            <GitPullRequestDraft className="text-muted-foreground size-4 shrink-0" />
          ) : (
            <GitPullRequest className="text-muted-foreground size-4 shrink-0" />
          )}
          {pr ? (
            <a href={pr.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
              #{pr.number} {pr.title}
            </a>
          ) : (
            "Pull request"
          )}
        </span>
        <span className="flex-1" />
        {pr && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="PR actions"
                className="text-muted-foreground"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={pr.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Open on GitHub
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => void act("unlink", () => projectsApi.unlink(threadId))}
              >
                <X />
                Unlink from this thread
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh"
          title="Refresh from GitHub"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
        {onExpand && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onExpand}
            aria-label="Open as a page"
            title="Open as a page"
            className="text-muted-foreground"
          >
            <Maximize2 />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close pull request"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {error ? (
          <p className="text-destructive">{error}</p>
        ) : !view ? (
          <div className="flex justify-center p-6">
            <Spinner />
          </div>
        ) : !view.project ? (
          <EmptyState
            icon={GitPullRequest}
            title="Not in a project"
            description="Start a thread in a project to publish its branch and follow the pull request here."
          />
        ) : !pr ? (
          <section className="space-y-4">
            <p className="text-muted-foreground">
              Branch <span className={monoClass}>{view.branch}</span>
              {view.ahead !== null &&
                ` is ${view.ahead} ${view.ahead === 1 ? "commit" : "commits"} ahead of ${view.project.baseBranch}.`}
            </p>
            <Button
              onClick={() => void act("publish", () => projectsApi.publish(threadId))}
              disabled={busy !== null || view.ahead === 0}
              data-testid="code-publish"
            >
              {busy === "publish" ? <Spinner /> : <Upload />}
              Publish draft PR
            </Button>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(linkNumber.replace(/^#/, ""));
                if (!Number.isInteger(n) || n < 1) return;
                void act("link", () => projectsApi.link(threadId, n));
              }}
            >
              <Input
                value={linkNumber}
                onChange={(e) => setLinkNumber(e.target.value)}
                placeholder="#123"
                aria-label="Pull request number"
                className="w-28"
              />
              <Button type="submit" variant="outline" disabled={busy !== null || !linkNumber}>
                <Link2 />
                Link pull request
              </Button>
            </form>
          </section>
        ) : (
          <ActivePull
            pr={pr}
            busy={busy}
            onAutofix={(enabled) =>
              void act("switch Auto-fix", () => projectsApi.autofix(threadId, enabled))
            }
            onFix={() =>
              void act("start a pass", async () => {
                const result = await projectsApi.fix(threadId);
                if (!result.started) toast.message(result.reason ?? "Nothing to fix.");
                return result.view;
              })
            }
            onMerge={(method) => void act("merge", () => projectsApi.merge(threadId, method))}
            onAttach={() => {
              const text = commentsText(pr);
              if (text) onAttach(text);
              else toast.message("No open review comments.");
            }}
            onAutoMerge={(enabled) =>
              void act("switch auto-merge", () => projectsApi.autoMerge(threadId, enabled))
            }
            spend={view.spend}
            onSpendLimit={(limit) =>
              void act("set the spend limit", () => projectsApi.spendLimit(threadId, limit))
            }
          />
        )}
        {snap && snap.body.trim() && (
          <details className="group">
            <summary
              className={cn(
                metaLabelClass,
                "hover:text-foreground flex cursor-pointer list-none items-center gap-1",
              )}
            >
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
              Description
            </summary>
            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{snap.body}</p>
          </details>
        )}
        {view && view.earlier.length > 0 && (
          <section className="space-y-1">
            <h3 className={metaLabelClass}>Earlier pull requests</h3>
            <ul className="space-y-1">
              {view.earlier.map((e) => (
                <li key={e.number}>
                  <a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">
                    #{e.number} {e.title}
                  </a>{" "}
                  <span className="text-muted-foreground text-xs">{e.state}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function ActivePull({
  pr,
  busy,
  onAutofix,
  onFix,
  onMerge,
  onAttach,
  onAutoMerge,
  spend,
  onSpendLimit,
}: {
  pr: PullView;
  busy: string | null;
  onAutofix(enabled: boolean): void;
  onFix(): void;
  onMerge(method: MergeMethod): void;
  onAttach(): void;
  onAutoMerge(enabled: boolean): void;
  spend: { usd: number | null; limitUsd: number | null };
  onSpendLimit(limitUsd: number | null): void;
}) {
  const [limit, setLimit] = useState(spend.limitUsd === null ? "" : String(spend.limitUsd));
  const snap = pr.snapshot;
  const checks = snap?.checks ?? [];
  const passed = checks.filter((c) => c.state === "success" || c.state === "neutral").length;
  const failed = checks.filter((c) => c.state === "failure");
  const open = (snap?.threads ?? []).filter((t) => !t.resolved);
  const reviews = snap?.reviews ?? [];
  const methods = snap?.mergeMethods ?? [];
  const [checksOpen, setChecksOpen] = useState(failed.length > 0);

  return (
    <>
      <section className="flex flex-wrap items-center gap-2" aria-label="At a glance">
        <button
          type="button"
          onClick={() => setChecksOpen((o) => !o)}
          className="hover:bg-muted flex items-center gap-1.5 rounded-lg px-2 py-1"
          aria-expanded={checksOpen}
        >
          {failed.length ? (
            <CircleX className="text-destructive size-4" />
          ) : passed === checks.length ? (
            <CircleCheck className="text-success size-4" />
          ) : (
            <CircleDashed className="text-warning size-4" />
          )}
          Checks {passed} of {checks.length}
        </button>
        <span className="text-muted-foreground px-2">
          {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
        </span>
        <span className="text-muted-foreground flex items-center gap-1 px-2">
          <MessageSquare className="size-3.5" />
          {open.length} open
        </span>
        <Badge variant="outline">
          {pr.state === "open" && snap?.inMergeQueue
            ? "queued"
            : pr.state === "open" && pr.draft
              ? "draft"
              : pr.state}
        </Badge>
      </section>

      {checksOpen && checks.length > 0 && (
        <ul className="space-y-1" aria-label="Checks">
          {checks.map((c) => (
            <li key={c.name} className="flex items-center gap-2">
              {c.state === "failure" ? (
                <CircleX className="text-destructive size-3.5 shrink-0" />
              ) : c.state === "pending" ? (
                <CircleDashed className="text-warning size-3.5 shrink-0" />
              ) : (
                <CircleCheck className="text-success size-3.5 shrink-0" />
              )}
              <span className="truncate">{c.name}</span>
              {pr.stalled.includes(c.name) && <Badge variant="secondary">Stalled</Badge>}
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground ml-auto text-xs hover:underline"
                >
                  Log
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {pr.state === "open" && methods.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" disabled={busy !== null || pr.draft}>
                {busy === "merge" ? <Spinner /> : <GitMerge />}
                Merge
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {methods.map((m) => (
                <DropdownMenuItem key={m} onSelect={() => onMerge(m)}>
                  {m === "squash"
                    ? "Squash and merge"
                    : m === "rebase"
                      ? "Rebase and merge"
                      : "Create a merge commit"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={onFix}
          disabled={busy !== null || pr.state !== "open"}
        >
          {busy === "start a pass" ? <Spinner /> : <Wrench />}
          Fix CI
        </Button>
        {open.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAttach}>
            <MessageSquare />
            Attach all comments
          </Button>
        )}
      </div>

      <section
        className="border-border divide-border divide-y rounded-xl border"
        aria-label="Auto-fix"
      >
        <div className="space-y-1 px-3 py-2.5">
          <label
            className="flex items-center gap-3"
            title="Fixes failing checks, trusted review comments and conflicts while you are away, in this thread's permission mode."
          >
            <span className="min-w-0 flex-1 font-medium">Auto-fix</span>
            <span
              className={cn(
                "text-xs",
                pr.loop.status === "needs_input" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {LOOP_LABEL[pr.loop.status]}
            </span>
            <Switch
              checked={pr.autofix}
              onCheckedChange={onAutofix}
              disabled={busy !== null || pr.state !== "open"}
              aria-label="Auto-fix"
              data-testid="code-autofix"
            />
          </label>
          {pr.loop.reason && pr.loop.status !== "watching" && (
            <p className="text-muted-foreground text-xs">{pr.loop.reason}</p>
          )}
        </div>
        <label className="flex items-center gap-3 px-3 py-2.5">
          <span className="min-w-0 flex-1">Auto-merge when GitHub allows it</span>
          {snap?.autoMerge && <span className="text-muted-foreground text-xs">On at GitHub</span>}
          <Switch
            checked={pr.autoMerge}
            onCheckedChange={onAutoMerge}
            disabled={busy !== null || pr.state !== "open"}
            aria-label="Auto-merge"
            data-testid="code-automerge"
          />
        </label>
        {/* A limit only means something where the harness reports what a turn cost. */}
        {spend.usd !== null && (
          <form
            className="flex items-center gap-2 px-3 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = limit.trim() === "" ? null : Number(limit);
              if (value !== null && !(value > 0)) return;
              onSpendLimit(value);
            }}
          >
            <label htmlFor="code-spend-limit" className="min-w-0 flex-1">
              Spend limit
              <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                ${spend.usd.toFixed(2)} spent
              </span>
            </label>
            <Input
              id="code-spend-limit"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="decimal"
              placeholder="No limit"
              className="h-7 w-24"
            />
            <Button type="submit" size="xs" variant="ghost" disabled={busy !== null}>
              Set
            </Button>
          </form>
        )}
      </section>

      {open.length > 0 && (
        <section className="space-y-2" aria-label="Unresolved comments">
          <h3 className={metaLabelClass}>Unresolved comments</h3>
          <ul className="space-y-2">
            {open.map((t) => (
              <li key={t.id} className="border-border space-y-1 rounded-lg border p-2">
                <p
                  className={cn("text-muted-foreground flex items-center gap-2 text-xs", monoClass)}
                >
                  {t.path}
                  {t.line ? `:${t.line}` : ""}
                  {pr.ignored.includes(t.id) && (
                    <Badge
                      variant="secondary"
                      title="Auto-fix does not take instructions from this author"
                    >
                      Ignored
                    </Badge>
                  )}
                </p>
                {t.comments.map((c) => (
                  <p key={c.id} className="whitespace-pre-wrap">
                    <span className="font-medium">{c.author.login}</span> {c.body}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pr.passes.length > 0 && (
        <section className="space-y-1" aria-label="Auto-fix passes">
          <h3 className={metaLabelClass}>Passes</h3>
          <ul className="space-y-1">
            {pr.passes.map((p) => (
              <li key={p.id} className="flex items-baseline gap-2">
                <span className="text-muted-foreground w-16 shrink-0 text-xs">{p.trigger}</span>
                <span
                  className="min-w-0 flex-1 truncate"
                  title={p.items.map((i) => i.title).join(", ")}
                >
                  {p.items.map((i) => i.title).join(", ") || "Manual pass"}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {p.status === "finished"
                    ? (OUTCOME_LABEL[p.outcome ?? ""] ?? p.outcome)
                    : "Running"}
                  {p.pushedSha ? ` ${p.pushedSha.slice(0, 7)}` : ""}
                  {p.costUsd !== null ? ` · $${p.costUsd.toFixed(2)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
