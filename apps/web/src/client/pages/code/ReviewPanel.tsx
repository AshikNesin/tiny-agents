/**
 * Review for a project thread (issue #297 §8): every change since the merge
 * base with the project's base branch, committed or not. A file list with
 * +/− and a filter (generated files and lockfiles muted and last), Viewed
 * marks that come back unmarked when the agent changes the file again,
 * `[` / `]` between files, and line comments kept as drafts until Send to
 * agent posts them as one message, each with its file, lines and the
 * quoted lines.
 */
import { useEffect, useMemo, useState } from "react";
import { FileDiff as FileDiffIcon, MessageSquare, RefreshCw, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Checkbox,
  EmptyState,
  Input,
  Textarea,
  metaLabelClass,
  monoClass,
} from "@groot/ui";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { projectsApi } from "../../lib/code/projects";
import type { ReviewDraft, ReviewFile } from "../../../shared/api/code";
import { FileDiff, type LineSelection } from "./UnifiedDiff";

const STATUS_TONE: Record<ReviewFile["status"], string> = {
  added: "text-success",
  modified: "text-warning",
  deleted: "text-destructive",
};

/** Real files first, generated ones last; each group by path. */
function reviewOrder(files: ReviewFile[]): ReviewFile[] {
  return [...files].sort(
    (a, b) => Number(a.isGenerated) - Number(b.isGenerated) || a.path.localeCompare(b.path),
  );
}

export function ReviewPanel({
  threadId,
  baseBranch,
  refreshKey,
  onClose,
  onOtherScopes,
}: {
  threadId: string;
  baseBranch: string;
  refreshKey: unknown;
  onClose(): void;
  /** Uncommitted changes or one commit, from the harness (when it serves diffs). */
  onOtherScopes?: () => void;
}) {
  const [files, setFiles] = useState<ReviewFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ oldContent: string; newContent: string } | null>(null);
  const [drafts, setDrafts] = useState<ReviewDraft[]>([]);
  const [composing, setComposing] = useState<LineSelection | null>(null);
  const [body, setBody] = useState("");
  const [reload, setReload] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([projectsApi.reviewFiles(threadId), projectsApi.drafts(threadId)])
      .then(([list, saved]) => {
        if (cancelled) return;
        const ordered = reviewOrder(list);
        setFiles(ordered);
        setDrafts(saved);
        setCurrent((c) =>
          c && ordered.some((f) => f.path === c) ? c : (ordered[0]?.path ?? null),
        );
      })
      .catch(
        (e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the changes.")),
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, refreshKey, reload]);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setDiff(null);
    setComposing(null);
    projectsApi
      .reviewFile(threadId, current)
      .then((d) => !cancelled && setDiff(d))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e, "Could not read the diff.")));
    return () => {
      cancelled = true;
    };
  }, [threadId, current, reload]);

  const shown = useMemo(
    () =>
      (files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase())),
    [files, filter],
  );

  // `[` and `]` move between files (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "[" && event.key !== "]") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      const index = shown.findIndex((f) => f.path === current);
      const next = shown[index + (event.key === "]" ? 1 : -1)];
      if (next) {
        event.preventDefault();
        setCurrent(next.path);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, current]);

  const toggleViewed = (file: ReviewFile) => {
    const viewed = !file.viewed;
    setFiles((list) => list?.map((f) => (f.path === file.path ? { ...f, viewed } : f)) ?? list);
    projectsApi.setViewed(threadId, file.path, file.hash, viewed).catch((e: unknown) => {
      toast.error(errorMessage(e, "Could not save that."));
      setReload((n) => n + 1);
    });
  };

  const saveDraft = async () => {
    if (!composing || !current || !diff || !body.trim()) return;
    const quote = diff.newContent
      .split("\n")
      .slice(composing.from - 1, composing.to)
      .join("\n");
    try {
      const draft = await projectsApi.addDraft(threadId, {
        path: current,
        startLine: composing.from,
        endLine: composing.to,
        quote,
        body: body.trim(),
      });
      setDrafts((d) => [...d, draft]);
      setComposing(null);
      setBody("");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save the comment."));
    }
  };

  const send = async () => {
    setSending(true);
    try {
      const { sent } = await projectsApi.sendDrafts(threadId);
      setDrafts([]);
      toast.success(`Sent ${sent} ${sent === 1 ? "comment" : "comments"} to the agent.`);
    } catch (e) {
      toast.error(errorMessage(e, "Could not send the comments."));
    } finally {
      setSending(false);
    }
  };

  const totals = (files ?? []).reduce(
    (sum, f) => ({
      add: sum.add + f.additions,
      del: sum.del + f.deletions,
      viewed: sum.viewed + Number(f.viewed),
    }),
    { add: 0, del: 0, viewed: 0 },
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="code-review">
      <div className="border-border flex h-13 shrink-0 items-center gap-1 border-b px-2">
        <span className="flex items-center gap-2 px-2 text-sm font-medium">
          <FileDiffIcon className="text-muted-foreground size-4" />
          Since {baseBranch}
        </span>
        {files && files.length > 0 && (
          <span className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums">
            {totals.viewed}/{files.length} viewed{" "}
            <span className="text-success">+{totals.add}</span>{" "}
            <span className="text-destructive">−{totals.del}</span>
          </span>
        )}
        <span className="flex-1" />
        {onOtherScopes && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOtherScopes}
            className="text-muted-foreground"
          >
            Uncommitted or a commit
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setReload((n) => n + 1)}
          aria-label="Refresh changes"
          className="text-muted-foreground"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close changes"
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>

      {error ? (
        <p className="text-destructive p-4 text-sm">{error}</p>
      ) : !files ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileDiffIcon}
          title="No changes"
          description={`Nothing differs from ${baseBranch} yet.`}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            className="border-border flex max-h-56 shrink-0 flex-col border-b md:max-h-none md:w-64 md:border-r md:border-b-0"
            aria-label="Changed files"
          >
            <div className="p-2">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter files"
                aria-label="Filter files"
                className="h-8"
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
              {shown.map((f) => (
                <li key={f.path} className="flex items-center gap-1">
                  <Checkbox
                    checked={f.viewed}
                    onCheckedChange={() => toggleViewed(f)}
                    aria-label={`Viewed ${f.path}`}
                    className="ml-1 shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => setCurrent(f.path)}
                    aria-current={f.path === current}
                    className={cn(
                      "hover:bg-muted flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs",
                      f.path === current && "bg-muted",
                      (f.isGenerated || f.viewed) && "text-muted-foreground",
                    )}
                    title={f.path}
                  >
                    <span className={cn("min-w-0 flex-1 truncate", monoClass)}>{f.path}</span>
                    <span className={cn("shrink-0 tabular-nums", STATUS_TONE[f.status])}>
                      +{f.additions} −{f.deletions}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {!diff ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              <FileDiff
                path={current ?? ""}
                oldContent={diff.oldContent}
                newContent={diff.newContent}
                onComment={(selection) => setComposing(selection)}
              />
            )}
            {composing && (
              <form
                className="border-border space-y-2 border-t p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveDraft();
                }}
              >
                <p className={cn("text-muted-foreground text-xs", monoClass)}>
                  {current}:
                  {composing.from === composing.to
                    ? composing.from
                    : `${composing.from}-${composing.to}`}
                </p>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  autoFocus
                  rows={3}
                  aria-label="Comment"
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={!body.trim()}>
                    <MessageSquare />
                    Add comment
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setComposing(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <section
          className="border-border max-h-60 shrink-0 space-y-2 overflow-y-auto border-t p-3"
          aria-label="Draft comments"
        >
          <div className="flex items-center gap-2">
            <h3 className={metaLabelClass}>
              {drafts.length} {drafts.length === 1 ? "comment" : "comments"}
            </h3>
            <span className="flex-1" />
            <Button
              size="sm"
              onClick={() => void send()}
              disabled={sending}
              data-testid="code-review-send"
            >
              {sending ? <Spinner /> : <Send />}
              Send to agent
            </Button>
          </div>
          <ul className="space-y-1">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-xs">
                <button
                  type="button"
                  className={cn("text-muted-foreground shrink-0 hover:underline", monoClass)}
                  onClick={() => setCurrent(d.path)}
                >
                  {d.path}:{d.startLine === d.endLine ? d.startLine : `${d.startLine}-${d.endLine}`}
                </button>
                <span className="min-w-0 flex-1 whitespace-pre-wrap">{d.body}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove comment"
                  onClick={() =>
                    void projectsApi
                      .removeDraft(threadId, d.id)
                      .then(() => setDrafts((list) => list.filter((x) => x.id !== d.id)))
                      .catch((e: unknown) => toast.error(errorMessage(e, "Could not remove it.")))
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
