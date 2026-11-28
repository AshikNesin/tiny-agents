import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, FilePen, SquareTerminal, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Textarea } from "@groot/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@groot/ui/dialog";
import { useConfirm } from "@groot/ui/primitives";
import { Spinner } from "../../components/ui/spinner";
import { errorMessage } from "../../lib/errors";
import { reviewsApi } from "../../lib/code/projects";
import { threadPath } from "../../lib/code/api";
import { githubCommentsKey, sayCommentsDidNotLoad, useCommentStore } from "../../lib/code/comments";
import type { PullReviewView } from "../../../shared/api/code";

const count = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

function PushDialog({
  review,
  open,
  onOpenChange,
  onPushed,
}: {
  review: PullReviewView;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPushed(sha: string): void;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const whose = review.mine ? "your branch" : `@${review.author}'s branch`;

  const push = async () => {
    setBusy(true);
    try {
      const { sha, branch } = await reviewsApi.push(review.id, message.trim());
      setMessage("");
      onOpenChange(false);
      toast.success(`Pushed ${sha.slice(0, 7)} to ${branch}.`);
      onPushed(sha);
    } catch (e) {
      toast.error(errorMessage(e, "Could not push."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Push to the pull request</DialogTitle>
          <DialogDescription>
            Adds a commit to {whose} {review.headRef}. Never forced: if the branch moved on GitHub,
            the push is refused.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && message.trim() && !busy) {
              e.preventDefault();
              void push();
            }
          }}
          aria-label="Commit message"
          placeholder="Say what this changes…"
          rows={3}
          autoFocus
          className="text-sm"
        />
        <DialogFooter>
          <Button
            type="button"
            disabled={busy || !message.trim()}
            onClick={() => void push()}
            title="Push (⌘↵)"
          >
            {busy && <Spinner />}
            Push
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function YourChangesActions({
  review,
  onChanged,
}: {
  review: PullReviewView;
  onChanged(headSha?: string): void;
}) {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const load = useCommentStore((s) => s.load);
  const [pushing, setPushing] = useState(false);
  const [busy, setBusy] = useState<"suggest" | "discard" | null>(null);

  const suggest = async () => {
    setBusy("suggest");
    try {
      const { added, skipped } = await reviewsApi.suggest(review.id);
      await load(githubCommentsKey(review.id)).catch(sayCommentsDidNotLoad);
      toast.success(
        `${count(added, "suggestion")} added to your review.` +
          (skipped > 0
            ? ` ${count(skipped, "change")} outside the PR's diff could not be suggested.`
            : ""),
      );
    } catch (e) {
      toast.error(errorMessage(e, "Could not turn them into suggestions."));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: "Discard your changes?",
      description: `The checkout goes back to the PR's head (${review.headSha.slice(0, 7)}). Edits, new files and commits you made here are lost.`,
      confirmLabel: "Discard",
    });
    if (!ok) return;
    setBusy("discard");
    try {
      await reviewsApi.discard(review.id);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "Could not discard them."));
    } finally {
      setBusy(null);
    }
  };

  const threadId = review.worktreeThreadId;

  return (
    <>
      {threadId ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(threadPath(threadId))}
          title="This review shows the coding thread's worktree: commit, push or discard there"
        >
          <ArrowUpRight />
          Push from the thread
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPushing(true)}
          disabled={busy !== null}
        >
          <Upload />
          Push to PR
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => void suggest()}
        disabled={busy !== null}
        aria-label="Post as suggestions"
        title="Each change becomes a suggestion in your pending review"
      >
        {busy === "suggest" ? <Spinner /> : <FilePen />}
        <span className="hidden sm:inline">Post as suggestions</span>
      </Button>
      {!threadId && (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => void discard()}
          disabled={busy !== null}
          aria-label="Discard"
          title="Discard your changes"
        >
          {busy === "discard" ? <Spinner /> : <Trash2 />}
        </Button>
      )}
      <PushDialog
        review={review}
        open={pushing}
        onOpenChange={setPushing}
        onPushed={(sha) => onChanged(sha)}
      />
    </>
  );
}

export function useOpenInTerminal(review: PullReviewView) {
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    try {
      const { name } = await reviewsApi.terminal(review.id);
      navigate(`/terminal?tab=${encodeURIComponent(name)}`);
    } catch (e) {
      toast.error(errorMessage(e, "Could not open a terminal on the sandbox."));
      setOpening(false);
    }
  };
  return { open, opening };
}

export function OpenInTerminal({ review }: { review: PullReviewView }) {
  const { open, opening } = useOpenInTerminal(review);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void open()}
      disabled={opening}
      aria-label="Open in terminal"
      title="Open a terminal in this PR's checkout"
      className="text-muted-foreground"
    >
      {opening ? <Spinner /> : <SquareTerminal />}
    </Button>
  );
}
