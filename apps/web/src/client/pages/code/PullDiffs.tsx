/**
 * A PR review's changes in the diff workspace (`DiffWorkspace`): the file tree
 * beside one column of every changed file. Which changes: since the owner's
 * last review, the whole PR, or Your changes in this checkout. Comment adds a
 * line comment to the PR's review on GitHub (sent with Submit review), Ask
 * assistant keeps it for the assistant; GitHub's conversations sit under their
 * lines.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, FileDiff as FileDiffIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@groot/ui";
import { SearchSelect } from "../../components/ui/search-select";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { ThreadCommenting } from "../../lib/code/comments";
import { useSteadyKey } from "../../lib/code/use-live-changes";
import type { PullReviewView, ReviewFile } from "../../../shared/api/code";
import type { FileConversations } from "./PullThreads";
import { DiffWorkspace, treeOrder, type CollapseAll, type DiffStyle } from "./DiffWorkspace";

/** `base` (the whole PR), `review` (since the owner's last review) or `mine` (Your changes). */
type Scope = "base" | "review" | "mine";

export function PullDiffs({
  review,
  refreshKey,
  diffStyle,
  collapse,
  commenting,
  github,
  conversations,
  yourChanges,
  drawer,
  onAskedAssistant,
}: {
  review: PullReviewView;
  refreshKey: unknown;
  diffStyle: DiffStyle;
  collapse: CollapseAll;
  /** Line comments for the assistant. */
  commenting?: ThreadCommenting;
  /** Line comments for the PR's review on GitHub. */
  github?: ThreadCommenting;
  /** A PR review's conversations from GitHub, per file. */
  conversations?: (path: string) => FileConversations;
  /** Push to PR, Post as suggestions and Discard, over Your changes; `done` reads them again. */
  yourChanges?: (done: () => void) => ReactNode;
  /** Phones: the file tree slides over the diff. */
  drawer: { open: boolean; onOpenChange(open: boolean): void };
  /** A comment went to the assistant: the page shows it. */
  onAskedAssistant?: () => void;
}) {
  const threadId = review.key;
  const settledKey = useSteadyKey(refreshKey);
  const reviewedSha = review.reviewedSha !== review.headSha ? review.reviewedSha : null;
  const [picked, setScope] = useState<Scope | null>(null);
  const scope: Scope = picked ?? (reviewedSha ? "review" : "base");
  const [reload, setReload] = useState(0);
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    projectsApi
      .reviewFiles(threadId, scope)
      .then((list) => !cancelled && setFiles(treeOrder(list)))
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, settledKey, reload, scope]);

  const read = useCallback(
    (path: string) => projectsApi.reviewFile(threadId, path, scope),
    [threadId, scope],
  );
  const refresh = () => setReload((n) => n + 1);

  return (
    <DiffWorkspace
      layout="page"
      files={files}
      error={error}
      scopeKey={`${threadId}\u0000${scope}`}
      readKey={String(reload)}
      read={read}
      diffStyle={diffStyle}
      collapse={collapse}
      drawer={drawer}
      commenting={commenting}
      github={github}
      conversations={conversations}
      onAskedAssistant={onAskedAssistant}
      // Viewed marks are per file content, so they hold in either whole-PR scope.
      onViewed={
        scope === "mine"
          ? undefined
          : (file, viewed) => {
              setFiles(
                (list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list,
              );
              projectsApi.setViewed(threadId, file.path, file.hash, viewed).catch((e: unknown) => {
                toast.error(errorMessage(e, "Could not save that."));
                refresh();
              });
            }
      }
      canEdit={() => scope !== "review"}
      onSave={async (path, original, content) => {
        await projectsApi.editFile(threadId, { path, original, content });
        refresh();
        toast.success("Saved. It shows under Your changes.");
      }}
      scope={
        <ScopePicker
          scope={scope}
          onScope={setScope}
          baseBranch={review.baseRef}
          reviewedSha={reviewedSha}
          withMine={Boolean(yourChanges)}
        />
      }
      actions={scope === "mine" && files && files.length > 0 ? yourChanges?.(refresh) : null}
      onRefresh={refresh}
      empty={
        scope === "mine" ? (
          <EmptyState
            icon={FileDiffIcon}
            title="You have not changed anything"
            description="Ask the assistant to change something, or open a terminal in this checkout."
          />
        ) : (
          <EmptyState
            icon={FileDiffIcon}
            title="No changes"
            description={`Nothing differs from ${review.baseRef} yet.`}
          />
        )
      }
    />
  );
}

/** Which changes the column shows: since your review, the whole PR, or your changes. */
function ScopePicker({
  scope,
  onScope,
  baseBranch,
  reviewedSha,
  withMine,
}: {
  scope: Scope;
  onScope(scope: Scope): void;
  baseBranch: string;
  reviewedSha: string | null;
  withMine: boolean;
}) {
  const label =
    scope === "review"
      ? "Since your review"
      : scope === "mine"
        ? "Your changes"
        : `Since ${baseBranch}`;
  if (!reviewedSha && !withMine) {
    return (
      <span className="text-muted-foreground flex h-8 items-center gap-1.5 px-2 text-xs">
        <FileDiffIcon className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <SearchSelect
      label="Changes to show"
      value={scope}
      onValueChange={(v) => onScope(v as Scope)}
      searchable={false}
      options={[
        ...(reviewedSha
          ? [
              {
                value: "review",
                label: "Since your review",
                description: `What changed after ${reviewedSha.slice(0, 7)}`,
              },
            ]
          : []),
        {
          value: "base",
          label: `Since ${baseBranch}`,
          description: "The whole pull request",
        },
        ...(withMine
          ? [
              {
                value: "mine",
                label: "Your changes",
                description: "Changed in this checkout, not on GitHub yet",
              },
            ]
          : []),
      ]}
      triggerClassName="text-foreground h-8 w-full justify-start text-xs"
    >
      <FileDiffIcon className="text-muted-foreground size-3.5" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <ChevronDown className="opacity-50" />
    </SearchSelect>
  );
}
