import { Kbd } from "../../components/keys";
import { useState } from "react";
import {
  Archive,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestDraft,
  Link2,
  MoreHorizontal,
  RefreshCw,
  ScanEye,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Input, metaLabelClass, monoClass } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import { usePullActions, useThreadPulls } from "../../lib/code/use-thread-pulls";
import { pullStage } from "../../lib/code/pull-stage";
import type { PullView } from "../../../shared/api/code";
import type { StatusLabels } from "../../../shared/machines/status-label";
import { MachineStatusBadge } from "../../components/MachineStatusBadge";
import { ActivePull } from "./ActivePull";
import { Description } from "./PullDescription";

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
  onArchive,
}: {
  threadId: string;
  refreshKey: unknown;
  onAttach(text: string): void;
  onReview?: (url: string) => Promise<void>;
  onArchive?: () => void;
}) {
  const { view, error, setView, reload } = useThreadPulls(threadId, {
    refreshKey,
    live: true,
  });
  const [linkNumber, setLinkNumber] = useState("");
  const [linking, setLinking] = useState(false);
  const [title, setTitle] = useState("");

  const { busy, act } = usePullActions(threadId);

  const pr = view?.active ?? null;
  const snap = pr?.snapshot ?? null;
  const stage = view ? pullStage(view) : null;
  const merged = stage?.kind === "merged" ? stage : null;
  const earlier = merged ? (view?.earlier.slice(1) ?? []) : (view?.earlier ?? []);
  const draftLabel = view?.project?.settings.draftPulls === false ? "PR" : "draft PR";
  const linkForm = (
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
        autoFocus
        value={linkNumber}
        onChange={(e) => setLinkNumber(e.target.value)}
        placeholder="#123"
        aria-label="Pull request number"
        className="w-28"
      />
      <Button type="submit" variant="outline" disabled={busy !== null || !linkNumber}>
        <Link2 />
        Link
      </Button>
      <Button type="button" variant="ghost" onClick={() => setLinking(false)}>
        Cancel
      </Button>
    </form>
  );
  const moreMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More"
            className="text-muted-foreground"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setLinking(true)}>
          <Link2 />
          Link an existing PR
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

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
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="PR actions"
                      className="text-muted-foreground"
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    render={(linkProps) => (
                      <a {...linkProps} href={pr.url} target="_blank" rel="noreferrer">
                        {linkProps.children}
                      </a>
                    )}
                  >
                    <ExternalLink />
                    Open on GitHub
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
        ) : merged ? (
          <section className="space-y-3" aria-label="Merged">
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
              {view.project.baseBranch}. The work is done.
            </p>
            {onArchive && (
              <Button onClick={onArchive} data-testid="code-archive-merged">
                <Archive />
                Archive thread
              </Button>
            )}
          </section>
        ) : stage?.kind === "landed" ? (
          <section className="space-y-3" aria-label="In main">
            <div className="flex items-center gap-2">
              <GitMerge className="text-primary size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">In {view.project.baseBranch} on GitHub.</span>{" "}
                <span className="text-muted-foreground">
                  The work on <span className={monoClass}>{view.branch}</span> reached{" "}
                  {view.project.baseBranch} without a pull request. The work is done.
                </span>
              </p>
              <RefreshButton onClick={reload} />
            </div>
            {onArchive && (
              <Button onClick={onArchive} data-testid="code-archive-merged">
                <Archive />
                Archive thread
              </Button>
            )}
          </section>
        ) : stage?.kind === "local" ? (
          <section className="space-y-3" aria-label="Merged on this machine">
            <div className="flex items-center gap-2">
              <GitMerge className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">Merged into {stage.base} on this machine.</span>{" "}
                <span className="text-muted-foreground">
                  GitHub does not have it yet. Push {stage.base} to finish, or open a pull request
                  instead.
                </span>
              </p>
              <RefreshButton onClick={reload} />
              {moreMenu}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void act(`push ${stage.base}`, () => projectsApi.pushBase(threadId))}
                disabled={busy !== null}
                data-testid="code-push-base"
              >
                {busy === `push ${stage.base}` ? <Spinner /> : <Upload />}
                Push {stage.base}
              </Button>
              <Button
                variant="outline"
                onClick={() => void act("create the PR", () => projectsApi.publish(threadId))}
                disabled={busy !== null}
              >
                Create PR instead
              </Button>
            </div>
            {linking && linkForm}
          </section>
        ) : stage?.kind === "nothing" ? (
          <section className="space-y-3" aria-label="Nothing to publish">
            <div className="flex items-center gap-2">
              <p className="text-muted-foreground min-w-0 flex-1">
                Nothing to publish yet. When the agent changes files on{" "}
                <span className={monoClass}>{view.branch}</span>, Create PR appears here.
              </p>
              <RefreshButton onClick={reload} />
              {moreMenu}
            </div>
            {linking && linkForm}
          </section>
        ) : stage?.kind === "create" ? (
          <section className="space-y-3" aria-label="Create a pull request">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1">
                <span className="font-medium">Ready for a pull request.</span>{" "}
                <span className="text-muted-foreground">
                  {[
                    stage.commits > 0 &&
                      `${stage.commits} ${stage.commits === 1 ? "commit" : "commits"} on`,
                    stage.uncommitted > 0 &&
                      `${stage.uncommitted} uncommitted ${stage.uncommitted === 1 ? "file" : "files"} on`,
                  ]
                    .filter(Boolean)
                    .join(" and ")}{" "}
                  <span className={monoClass}>{view.branch}</span>.
                </span>
              </p>
              <RefreshButton onClick={reload} />
              {moreMenu}
            </div>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act("create the PR", () =>
                  projectsApi.publish(threadId, {
                    ...(title.trim() ? { title: title.trim() } : {}),
                    ...(stage.uncommitted > 0 ? { commit: true } : {}),
                  }),
                );
              }}
            >
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (written from the commits if empty)"
                aria-label="Pull request title"
              />
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={busy !== null} data-testid="code-publish">
                  {busy === "create the PR" ? <Spinner /> : <Upload />}
                  {stage.uncommitted > 0
                    ? `Commit and create ${draftLabel}`
                    : `Create ${draftLabel}`}
                  <Kbd keys="P" className="ml-1" />
                </Button>
                {stage.uncommitted > 0 && (
                  <span className="text-muted-foreground text-xs">
                    Commits the changes as “{view.branch}”&apos;s thread title first.
                  </span>
                )}
              </div>
            </form>
            {linking && linkForm}
          </section>
        ) : pr ? (
          <>
            {(view.uncommitted ?? 0) > 0 && (
              <div
                className="border-border flex items-center gap-3 rounded-xl border px-3 py-2.5"
                data-testid="code-uncommitted"
              >
                <p className="min-w-0 flex-1">
                  {view.uncommitted === 1 ? "1 file is" : `${view.uncommitted} files are`} changed
                  since the last push.
                </p>
                <Button
                  size="sm"
                  onClick={() =>
                    void act("commit and push", () =>
                      projectsApi.publish(threadId, { commit: true }),
                    )
                  }
                  disabled={busy !== null}
                >
                  {busy === "commit and push" ? <Spinner /> : <Upload />}
                  Commit and push
                </Button>
              </div>
            )}
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
              onYolo={(method) =>
                void act("arm YOLO Merge", () =>
                  method
                    ? projectsApi.yoloMerge(threadId, method)
                    : projectsApi.callOffYoloMerge(threadId),
                )
              }
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
          </>
        ) : null}
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

type PullBadgeState = PullView["state"] | "draft" | "queued";

const PULL_STATE_LABELS: StatusLabels<PullBadgeState> = {
  open: { label: "Open", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  queued: { label: "Queued", tone: "warning" },
  merged: { label: "Merged", tone: "accent" },
  closed: { label: "Closed", tone: "danger" },
};

function StateBadge({ pr }: { pr: PullView }) {
  const state: PullBadgeState =
    pr.state === "open" && pr.snapshot?.inMergeQueue
      ? "queued"
      : pr.state === "open" && pr.draft
        ? "draft"
        : pr.state;
  return <MachineStatusBadge status={state} labels={PULL_STATE_LABELS} />;
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
