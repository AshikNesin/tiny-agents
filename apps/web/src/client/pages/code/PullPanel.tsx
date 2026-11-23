import type { WorkflowName } from "../../../shared/code-status";
import { Kbd } from "../../components/keys";
import { useCallback, useState } from "react";
import {
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ScanEye,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { Button, EmptyState, Input, Textarea, metaLabelClass, monoClass } from "@groot/ui";
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
import { markdownComponents } from "../../lib/markdown";
import { projectsApi } from "../../lib/code/projects";
import { useRefreshOn, useResource } from "../../queries/resource";
import { useThreadPulls } from "../../lib/code/use-thread-pulls";
import type { MergeMethod, PullView, ThreadPullsView } from "../../../shared/api/code";
import { PullChecks } from "./PullChecks";
import { PullComments } from "./PullComments";

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
  onReview,
}: {
  threadId: string;
  refreshKey: unknown;
  onAttach(text: string): void;
  onReview?: (url: string) => Promise<void>;
}) {
  const { view, error, setView, reload } = useThreadPulls(threadId, {
    refreshKey,
    live: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [linkNumber, setLinkNumber] = useState("");

  const act = useCallback(
    async (what: string, work: () => Promise<ThreadPullsView | void>) => {
      setBusy(what);
      try {
        const next = await work();
        if (next) setView(next);
      } catch (e) {
        toast.error(errorMessage(e, `Could not ${what}.`));
      } finally {
        setBusy(null);
      }
    },
    [setView],
  );

  const pr = view?.active ?? null;
  const snap = pr?.snapshot ?? null;
  const merged = !pr && view?.earlier[0]?.state === "merged" ? view.earlier[0] : null;
  const canPublish = !merged || (view?.ahead ?? 0) > 0;
  const earlier = merged ? (view?.earlier.slice(1) ?? []) : (view?.earlier ?? []);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-pr">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {pr && (
          <header className="space-y-1">
            <div className="flex min-h-7 items-center gap-2">
              {pr.draft ? (
                <GitPullRequestDraft className="text-muted-foreground size-4 shrink-0" />
              ) : (
                <GitPullRequest className="text-muted-foreground size-4 shrink-0" />
              )}
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium tabular-nums hover:underline"
              >
                #{pr.number}
              </a>
              <StateBadge pr={pr} />
              <span className="flex-1" />
              {onReview && <ReviewButton onOpen={() => onReview(pr.url)} />}
              <RefreshButton onClick={reload} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
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
            </div>
            <h2 className="text-base leading-snug font-medium [overflow-wrap:anywhere]">
              <a href={pr.url} target="_blank" rel="noreferrer" className="hover:underline">
                {pr.title}
              </a>
            </h2>
            <p
              className={cn("text-muted-foreground truncate text-xs", monoClass)}
              aria-label="Status"
            >
              {pr.headRef} → {pr.baseRef}
            </p>
          </header>
        )}
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
        ) : !pr && !canPublish && merged ? (
          <section className="space-y-1" aria-label="Merged">
            <div className="flex items-center gap-2">
              <GitMerge className="text-primary size-4 shrink-0" aria-hidden />
              <a href={merged.url} target="_blank" rel="noreferrer" className="hover:underline">
                <span className="tabular-nums">#{merged.number}</span> {merged.title}
              </a>
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium">
                Merged
              </span>
              <span className="flex-1" />
              <RefreshButton onClick={reload} />
            </div>
            <p className="text-muted-foreground text-xs">
              Branch <span className={monoClass}>{view.branch}</span> is in{" "}
              {view.project.baseBranch}.
            </p>
          </section>
        ) : !pr ? (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground min-w-0 flex-1">
                Branch <span className={monoClass}>{view.branch}</span>
                {view.ahead !== null &&
                  ` is ${view.ahead} ${view.ahead === 1 ? "commit" : "commits"} ahead of ${view.project.baseBranch}.`}
              </p>
              <RefreshButton onClick={reload} />
            </div>
            {view.ahead === 0 && (
              <Uncommitted
                threadId={threadId}
                refreshKey={refreshKey}
                onAsk={() => onAttach("Commit your changes on this branch.")}
              />
            )}
            <Button
              onClick={() => void act("publish", () => projectsApi.publish(threadId))}
              disabled={busy !== null || view.ahead === 0}
              data-testid="code-publish"
            >
              {busy === "publish" ? <Spinner /> : <Upload />}
              {view.project?.settings.draftPulls === false ? "Publish PR" : "Publish draft PR"}
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
            threadId={threadId}
            pr={pr}
            busy={busy}
            onAutofix={(enabled) =>
              void act("switch Auto-fix", () => projectsApi.autofix(threadId, enabled))
            }
            onFix={(workflow) =>
              void act("start a pass", async () => {
                const result = await projectsApi.runWorkflow(threadId, workflow);
                if (!result.started) toast.message(result.reason ?? "Nothing to fix.");
                return result.view;
              })
            }
            onMerge={(method) => void act("merge", () => projectsApi.merge(threadId, method))}
            onDraft={(draft) =>
              void act(draft ? "convert it to a draft" : "mark it ready", () =>
                projectsApi.setDraft(threadId, draft),
              )
            }
            onAttachAll={() => {
              const text = commentsText(pr);
              if (text) onAttach(text);
              else toast.message("No open review comments.");
            }}
            onAttach={onAttach}
          />
        )}
        {snap && pr && (
          <Description
            threadId={threadId}
            body={snap.body}
            editable={pr.state === "open"}
            onSaved={setView}
          />
        )}
        {earlier.length > 0 && (
          <section className="space-y-1">
            <h3 className={metaLabelClass}>Earlier pull requests</h3>
            <ul className="space-y-1">
              {earlier.map((e) => (
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

function Uncommitted({
  threadId,
  refreshKey,
  onAsk,
}: {
  threadId: string;
  refreshKey: unknown;
  onAsk(): void;
}) {
  const files = useResource(
    ["code", "uncommitted", threadId],
    () => projectsApi.reviewFiles(threadId),
    "",
  );
  useRefreshOn(refreshKey, files.refresh);
  const count = files.data?.length ?? 0;
  if (count === 0) return null;
  return (
    <div className="border-border flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <p className="min-w-0 flex-1">
        {count === 1 ? "1 changed file is" : `${count} changed files are`} not committed yet.
      </p>
      <Button size="sm" variant="outline" onClick={onAsk}>
        <MessageSquare />
        Ask to commit
      </Button>
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  open: "bg-success/10 text-success",
  draft: "bg-muted text-muted-foreground",
  queued: "bg-warning/10 text-warning",
  merged: "bg-primary/10 text-primary",
  closed: "bg-destructive/10 text-destructive",
};

function StateBadge({ pr }: { pr: PullView }) {
  const state =
    pr.state === "open" && pr.snapshot?.inMergeQueue
      ? "queued"
      : pr.state === "open" && pr.draft
        ? "draft"
        : pr.state;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        STATE_TONE[state],
      )}
    >
      {state}
    </span>
  );
}

function ActivePull({
  threadId,
  pr,
  busy,
  onAutofix,
  onFix,
  onMerge,
  onDraft,
  onAttachAll,
  onAttach,
}: {
  threadId: string;
  pr: PullView;
  busy: string | null;
  onAutofix(enabled: boolean): void;
  onFix(workflow: WorkflowName): void;
  onMerge(method: MergeMethod): void;
  onDraft(draft: boolean): void;
  onAttachAll(): void;
  onAttach(text: string): void;
}) {
  const snap = pr.snapshot;
  const failing = (snap?.checks ?? []).some((c) => c.state === "failure");
  const open = (snap?.threads ?? []).filter((t) => !t.resolved);
  const methods = snap?.mergeMethods ?? [];
  const conflicting = snap?.mergeable === "conflicting";
  const mergeBlocked =
    failing && conflicting
      ? "Merge opens once checks pass and the conflict is resolved."
      : failing
        ? "Merge opens once checks pass."
        : conflicting
          ? "Merge opens once the conflict is resolved."
          : null;

  return (
    <>
      <PullChecks threadId={threadId} pr={pr} busy={busy} onFix={() => onFix("fix_ci")} />

      <div className="flex flex-wrap gap-2">
        {pr.state === "open" && methods.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                disabled={busy !== null || pr.draft || mergeBlocked !== null}
                title={pr.draft ? "A draft cannot be merged; switch Draft off first" : undefined}
              >
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
        {pr.state === "open" && !pr.draft && mergeBlocked && (
          <span className="text-muted-foreground self-center text-xs">{mergeBlocked}</span>
        )}
        {open.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFix("address_comments")}
            disabled={busy !== null || pr.state !== "open"}
            title="The agent answers the open review comments in this thread"
            data-testid="code-address-comments"
          >
            {busy === "start a pass" ? <Spinner /> : <Wrench />}
            Address comments
            <Kbd keys="a" />
          </Button>
        )}
        {snap?.mergeable === "conflicting" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFix("resolve_conflicts")}
            disabled={busy !== null || pr.state !== "open"}
          >
            <Wrench />
            Resolve conflicts
          </Button>
        )}
        {open.length > 0 && (
          <Button size="sm" variant="outline" onClick={onAttachAll}>
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
            {pr.autofix && (
              <span
                className={cn(
                  "text-xs",
                  pr.loop.status === "needs_input" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {LOOP_LABEL[pr.loop.status]}
              </span>
            )}
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
        {pr.state === "open" && (
          <label
            className="flex items-center gap-3 px-3 py-2.5"
            title="A draft is not ready for review, and cannot be merged"
          >
            <span className="min-w-0 flex-1">Draft</span>
            {(busy === "mark it ready" || busy === "convert it to a draft") && <Spinner />}
            <Switch
              checked={pr.draft}
              onCheckedChange={onDraft}
              disabled={busy !== null}
              aria-label="Draft"
              data-testid="code-draft"
            />
          </label>
        )}
      </section>

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

      <PullComments pr={pr} onAttach={onAttach} />
    </>
  );
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;

function Description({
  threadId,
  body,
  editable,
  onSaved,
}: {
  threadId: string;
  body: string;
  editable: boolean;
  onSaved(view: ThreadPullsView): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = body.replace(HTML_COMMENT, "").trim();
  const save = async () => {
    if (draft === null) return;
    setSaving(true);
    try {
      onSaved(await projectsApi.editPull(threadId, { body: draft }));
      setDraft(null);
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the description."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="Pull request description" className="space-y-1.5">
      <div className="flex min-h-6 items-center gap-1">
        <h3 className={cn(metaLabelClass, "flex-1")}>Description</h3>
        {editable && draft === null && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setDraft(body)}
            aria-label="Edit description"
            className="text-muted-foreground"
          >
            <Pencil />
            Edit
          </Button>
        )}
      </div>
      {draft !== null ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                setDraft(null);
              }
            }}
            autoFocus
            rows={12}
            aria-label="Description"
            placeholder="Describe the change (markdown)"
            className={cn("min-h-40 text-xs", monoClass)}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={saving || draft === body}
              aria-label="Save description"
              title="Save to GitHub (⌘↵)"
            >
              {saving && <Spinner />}
              Save
            </Button>
          </div>
        </div>
      ) : shown ? (
        <div className="chat-md code-md min-w-0 text-sm [overflow-wrap:anywhere] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm">
          <Streamdown components={markdownComponents}>{shown}</Streamdown>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No description.</p>
      )}
    </section>
  );
}

function RefreshButton({ onClick }: { onClick(): void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      aria-label="Refresh"
      title="Refresh from GitHub"
      className="text-muted-foreground shrink-0"
    >
      <RefreshCw />
    </Button>
  );
}

function ReviewButton({ onOpen }: { onOpen(): Promise<void> }) {
  const [opening, setOpening] = useState(false);
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={opening}
      title="Review this PR with an assistant that did not write it"
      className="text-muted-foreground"
      onClick={() => {
        setOpening(true);
        onOpen()
          .catch((error: unknown) => toast.error(errorMessage(error, "Could not open the review.")))
          .finally(() => setOpening(false));
      }}
    >
      {opening ? <Spinner className="size-3" /> : <ScanEye />}
      Review
    </Button>
  );
}
