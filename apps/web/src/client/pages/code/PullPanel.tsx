import { preferredMergeMethod, type WorkflowName } from "../../../shared/code-status";
import { Kbd } from "../../components/keys";
import { useState } from "react";
import {
  Archive,
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
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, Input, Textarea, metaLabelClass, monoClass } from "@groot/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@groot/ui/dropdown-menu";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { Switch } from "@groot/ui/switch";
import { errorMessage } from "../../lib/errors";
import { Markdown } from "../../lib/markdown";
import { projectsApi } from "../../lib/code/projects";
import { usePullActions, useThreadPulls } from "../../lib/code/use-thread-pulls";
import { pullStage } from "../../lib/code/pull-stage";
import type { MergeMethod, PullView, ThreadPullsView } from "../../../shared/api/code";
import { PullChecks } from "./PullChecks";
import { PullComments } from "./PullComments";
import { autofixLabels } from "../../../shared/machines/autofix";
import type { StatusLabels } from "../../../shared/machines/status-label";
import { StatusBadge } from "../../components/StatusBadge";

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
  return <StatusBadge status={state} labels={PULL_STATE_LABELS} />;
}

function ActivePull({
  threadId,
  pr,
  busy,
  onAutofix,
  onFix,
  onMerge,
  onYolo,
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
  onYolo(method: MergeMethod | null): void;
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

  const yoloMethod = preferredMergeMethod(methods);

  return (
    <>
      <PullChecks threadId={threadId} pr={pr} busy={busy} onFix={() => onFix("fix_ci")} />

      {pr.yolo && pr.state === "open" && (
        <div
          role="status"
          aria-label="YOLO Merge"
          className="border-warning/40 bg-warning/10 flex items-center gap-3 rounded-xl border px-3 py-2.5"
        >
          <Zap className="text-warning size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">YOLO Merge is on.</span> Merges #{pr.number} by itself
            once it can.{pr.yolo.waiting ? ` ${pr.yolo.waiting}` : ""}
          </p>
          <Button size="sm" variant="outline" onClick={() => onYolo(null)} disabled={busy !== null}>
            Call off
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {pr.state === "open" && methods.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="sm" disabled={busy !== null || pr.draft || mergeBlocked !== null} />
              }
            >
              {busy === "merge" ? <Spinner /> : <GitMerge />}
              Merge
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
        {pr.state === "open" && !pr.yolo && yoloMethod && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onYolo(yoloMethod)}
            disabled={busy !== null}
            title="Resolves every open comment, waits for the checks, then merges by itself"
            data-testid="code-yolo-merge"
          >
            {busy === "arm YOLO Merge" ? <Spinner /> : <Zap />}
            YOLO Merge
          </Button>
        )}
        {pr.state === "open" && (pr.draft || mergeBlocked) && (
          <span className="text-muted-foreground self-center text-xs">
            {pr.draft ? "Turn Draft off to merge" : mergeBlocked}
          </span>
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
              <StatusBadge
                plain
                status={pr.loop.status}
                labels={autofixLabels}
                className="text-xs"
              />
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
          <Markdown>{shown}</Markdown>
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
