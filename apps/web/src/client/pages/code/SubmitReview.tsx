import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SquareCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, Textarea, monoClass } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { cn } from "@groot/ui/lib/utils";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { threadPath } from "../../lib/code/api";
import { reviewsApi } from "../../lib/code/projects";
import { githubCommentsKey, useCommentStore, type ThreadCommenting } from "../../lib/code/comments";
import type { PullReviewView, ReviewDraft, ReviewVerdict } from "../../../shared/api/code";

const VERDICTS: Array<{ value: ReviewVerdict; label: string }> = [
  { value: "COMMENT", label: "Comment" },
  { value: "APPROVE", label: "Approve" },
  { value: "REQUEST_CHANGES", label: "Request changes" },
];

const lines = (c: { startLine: number; endLine: number }) =>
  c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;

function SubmitReview({
  review,
  github,
  initialVerdict,
  open,
  onOpenChange,
}: {
  review: PullReviewView;
  github: ThreadCommenting;
  initialVerdict: ReviewVerdict;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const navigate = useNavigate();
  const sent = useCommentStore((s) => s.sent);
  const [body, setBody] = useState(() => draftSummary(github.comments));
  const [verdict, setVerdict] = useState<ReviewVerdict>(review.mine ? "COMMENT" : initialVerdict);
  const [busy, setBusy] = useState<"submit" | "thread" | null>(null);
  const { comments } = github;
  const needsBody = verdict === "REQUEST_CHANGES" && !body.trim();
  const empty = verdict === "COMMENT" && !body.trim() && comments.length === 0;

  const done = () => {
    sent(githubCommentsKey(review.id));
    setBody("");
    setVerdict("COMMENT");
    onOpenChange(false);
  };

  const submit = async () => {
    setBusy("submit");
    try {
      const { url } = await reviewsApi.submit(review.id, { event: verdict, body: body.trim() });
      done();
      toast.success("Review submitted on GitHub.", {
        action: { label: "View", onClick: () => window.open(url, "_blank", "noreferrer") },
      });
    } catch (e) {
      toast.error(errorMessage(e, "Could not submit the review."));
    } finally {
      setBusy(null);
    }
  };

  const toThread = async () => {
    if (!review.codingThreadId) return;
    setBusy("thread");
    try {
      const { threadId, sent: count } = await reviewsApi.toThread(review.id);
      done();
      toast.success(
        `Sent ${count === 1 ? "1 comment" : `${count} comments`} to the coding thread.`,
        {
          action: { label: "Open", onClick: () => navigate(threadPath(threadId)) },
        },
      );
    } catch (e) {
      toast.error(errorMessage(e, "Could not send them to the coding thread."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submit review</DialogTitle>
          <DialogDescription>
            {comments.length === 0
              ? `No line comments yet. Select lines in the diff to add some.`
              : `${comments.length === 1 ? "1 comment goes" : `${comments.length} comments go`} with it, on the commit you read.`}
          </DialogDescription>
        </DialogHeader>
        {comments.length > 0 && (
          <ul aria-label="Review comments" className="max-h-56 space-y-1 overflow-y-auto">
            {comments.map((c) => (
              <li
                key={c.id}
                className="border-border flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className={cn("text-muted-foreground truncate text-xs", monoClass)}>
                    {c.path}:{lines(c)}
                  </p>
                  <p className="line-clamp-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {c.body}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remove comment on ${c.path}:${lines(c)}`}
                  className="text-muted-foreground"
                  onClick={() => github.remove(c.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Review summary"
          placeholder={
            verdict === "REQUEST_CHANGES" ? "Say what to change…" : "Leave a summary (optional)"
          }
          rows={3}
          className="text-sm"
        />
        <div className="space-y-1.5">
          <div role="group" aria-label="Verdict" className="flex flex-wrap gap-1.5">
            {VERDICTS.map((v) => (
              <Button
                key={v.value}
                type="button"
                size="xs"
                variant={verdict === v.value ? "secondary" : "ghost"}
                aria-pressed={verdict === v.value}
                disabled={review.mine && v.value !== "COMMENT"}
                onClick={() => setVerdict(v.value)}
              >
                {v.label}
              </Button>
            ))}
          </div>
          {review.mine && (
            <p className="text-muted-foreground text-xs">
              This is your pull request: GitHub lets you comment on it, not approve it.
            </p>
          )}
        </div>
        <DialogFooter>
          {review.codingThreadId && comments.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() => void toThread()}
              title="The agent that opened this PR gets them as one message, instead of GitHub"
            >
              {busy === "thread" && <Spinner />}
              Send to coding thread
            </Button>
          )}
          <Button
            type="button"
            disabled={busy !== null || needsBody || empty}
            onClick={() => void submit()}
          >
            {busy === "submit" && <Spinner />}
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function draftSummary(comments: ReviewDraft[]): string {
  if (comments.length === 0) return "";
  const files = [...new Set(comments.map((comment) => comment.path.split("/").at(-1)))];
  const where = files.length > 3 ? `${files.slice(0, 3).join(", ")} and others` : files.join(", ");
  return `I left ${comments.length === 1 ? "one comment" : `${comments.length} comments`} inline, in ${where}.`;
}

export function SubmitReviewButton({
  review,
  github,
  open,
  verdict,
  onOpenChange,
}: {
  review: PullReviewView;
  github: ThreadCommenting;
  open: boolean;
  verdict: ReviewVerdict;
  onOpenChange(open: boolean): void;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => onOpenChange(true)}
        aria-label="Submit review"
        title="Submit your review on GitHub"
      >
        <SquareCheck />
        <span className="hidden sm:inline">Submit review</span>
        {github.comments.length > 0 && (
          <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs tabular-nums">
            {github.comments.length}
          </span>
        )}
      </Button>
      {open && (
        <SubmitReview
          review={review}
          github={github}
          initialVerdict={verdict}
          open
          onOpenChange={onOpenChange}
        />
      )}
    </>
  );
}
