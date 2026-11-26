import { useState, type ReactNode } from "react";
import { ChevronDown, FileDiff as FileDiffIcon } from "lucide-react";
import { EmptyState } from "@groot/ui";
import { SearchSelect } from "@groot/ui/search-select";
import type { ThreadCommenting } from "../../lib/code/comments";
import type { PullReviewView } from "../../../shared/api/code";
import type { FileConversations } from "./PullThreads";
import { DiffWorkspace, type DiffView } from "./DiffWorkspace";
import { useReviewFiles } from "./use-review-files";

type Scope = "base" | "review" | "mine";

export function PullDiffs({
  review,
  refreshKey,
  view,
  commenting,
  github,
  conversations,
  yourChanges,
  onAskedAssistant,
}: {
  review: PullReviewView;
  refreshKey: unknown;
  view: DiffView;
  commenting?: ThreadCommenting;
  github?: ThreadCommenting;
  conversations?: (path: string) => FileConversations;
  yourChanges?: (done: () => void) => ReactNode;
  onAskedAssistant?: () => void;
}) {
  const threadId = review.key;
  const reviewedSha = review.reviewedSha !== review.headSha ? review.reviewedSha : null;
  const [picked, setScope] = useState<Scope | null>(null);
  const scope: Scope = picked ?? (reviewedSha ? "review" : "base");
  const { refresh, workspace } = useReviewFiles(
    threadId,
    scope,
    refreshKey,
    "Saved. It shows under Your changes.",
  );
  const files = workspace.files;

  return (
    <DiffWorkspace
      layout="page"
      {...workspace}
      diffStyle={view.wide ? view.style : "unified"}
      collapse={view.collapse}
      drawer={view.drawer}
      commenting={commenting}
      github={github}
      conversations={conversations}
      onAskedAssistant={onAskedAssistant}
      onViewed={scope === "mine" ? undefined : workspace.onViewed}
      canEdit={() => scope !== "review"}
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
