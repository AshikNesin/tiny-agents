/**
 * A thread's line comments that have not reached its agent yet, shared by
 * the Changes and Review panels (where they are written, under their lines)
 * and the thread (where they wait above the composer and go with the next
 * message). Kept on the server per thread, so they survive a reload and work
 * for every harness. A guest has none: the panels put a guest's comment in
 * the composer instead.
 *
 * A PR review's pending GitHub comments (issue #345) live in the same store
 * under `githubCommentsKey(reviewId)`, read from and saved to the review.
 */
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "../errors";
import { useIsGuest } from "../../store/people";
import type { ReviewDraft, ReviewDraftBody } from "../../../shared/api/code";
import { projectsApi } from "./projects";

const GITHUB = "github:";

/** Where a PR review's pending GitHub comments are kept in the store. */
export const githubCommentsKey = (reviewId: string) => `${GITHUB}${reviewId}`;

/** The server's comments behind a store key: a thread's (or review's) for the agent, or GitHub's. */
function draftsOf(key: string) {
  const github = key.startsWith(GITHUB);
  const id = github ? `review:${key.slice(GITHUB.length)}` : key;
  const target = github ? "github" : undefined;
  return {
    list: () => projectsApi.drafts(id, target),
    add: (body: ReviewDraftBody) => projectsApi.addDraft(id, body, target),
    remove: (draftId: string) => projectsApi.removeDraft(id, draftId, target),
  };
}

interface CommentsState {
  byThread: Record<string, ReviewDraft[] | undefined>;
  load(threadId: string): Promise<void>;
  add(threadId: string, body: ReviewDraftBody): Promise<void>;
  remove(threadId: string, draftId: string): Promise<void>;
  /** They went to the agent (with a message, or on their own). */
  sent(threadId: string): void;
}

/** Reads in flight, so the panels and the thread opening together read once. */
const reading = new Map<string, Promise<void>>();

export const useCommentStore = create<CommentsState>((set, get) => ({
  byThread: {},
  load(threadId) {
    const pending = reading.get(threadId);
    if (pending) return pending;
    const read = draftsOf(threadId)
      .list()
      .then((drafts) => set({ byThread: { ...get().byThread, [threadId]: drafts } }))
      .finally(() => reading.delete(threadId));
    reading.set(threadId, read);
    return read;
  },
  async add(threadId, body) {
    const draft = await draftsOf(threadId).add(body);
    const list = get().byThread[threadId] ?? [];
    set({ byThread: { ...get().byThread, [threadId]: [...list, draft] } });
  },
  async remove(threadId, draftId) {
    await draftsOf(threadId).remove(draftId);
    const list = get().byThread[threadId] ?? [];
    set({ byThread: { ...get().byThread, [threadId]: list.filter((d) => d.id !== draftId) } });
  },
  sent(threadId) {
    set({ byThread: { ...get().byThread, [threadId]: [] } });
  },
}));

const NONE: ReviewDraft[] = [];

/** The thread's unsent comments, read once when it opens (none for a guest). */
export function useThreadComments(threadId: string | undefined, enabled = true): ReviewDraft[] {
  const load = useCommentStore((s) => s.load);
  const comments = useCommentStore((s) => (threadId ? s.byThread[threadId] : undefined));
  useEffect(() => {
    if (!threadId || !enabled) return;
    load(threadId).catch(() => undefined);
  }, [threadId, enabled, load]);
  return enabled ? (comments ?? NONE) : NONE;
}

/** A comment as plain text for the composer (a guest's, which cannot be saved). */
function commentText(draft: ReviewDraftBody): string {
  const lines =
    draft.startLine === draft.endLine
      ? `${draft.startLine}`
      : `${draft.startLine}-${draft.endLine}`;
  return `\`${draft.path}:${lines}\`${draft.side === "old" ? " (old side)" : ""} ${draft.body}`;
}

/** How a panel takes and shows a thread's comments (built by the Code page). */
export interface ThreadCommenting {
  comments: ReviewDraft[];
  add(body: ReviewDraftBody): Promise<void>;
  remove(draftId: string): void;
}

/**
 * One file's share of the thread's comments, as `FileDiff` takes them: a new
 * comment carries its quoted lines (from the side it was made on). With
 * `github` (a PR review), comments for the PR's review sit beside the
 * assistant's, each tagged with where it goes.
 */
export function fileCommenting(
  commenting: ThreadCommenting | undefined,
  file: { path: string; oldContent: string; newContent: string },
  github?: ThreadCommenting,
) {
  if (!commenting) return {};
  const mine = (list: ReviewDraft[]) => list.filter((c) => c.path === file.path);
  const githubIds = new Set(github?.comments.map((c) => c.id));
  return {
    comments: github
      ? [
          ...mine(github.comments).map((c) => ({ ...c, tag: "Pending" })),
          ...mine(commenting.comments).map((c) => ({ ...c, tag: "For the assistant" })),
        ]
      : mine(commenting.comments),
    onRemoveComment: (id: string) =>
      github && githubIds.has(id) ? github.remove(id) : commenting.remove(id),
    reviewing: github ? true : undefined,
    onComment: (
      selection: { from: number; to: number; side: "old" | "new" },
      body: string,
      target: "agent" | "github" = "agent",
    ) =>
      (target === "github" && github ? github : commenting).add({
        path: file.path,
        side: selection.side,
        startLine: selection.from,
        endLine: selection.to,
        quote: (selection.side === "old" ? file.oldContent : file.newContent)
          .split("\n")
          .slice(selection.from - 1, selection.to)
          .join("\n"),
        body,
      }),
  };
}

/** One line comment as the agent received it. */
export interface SentComment {
  path: string;
  /** `30` or `30-34`. */
  lines: string;
  /** On removed lines (old-file numbers). */
  old: boolean;
  quote: string;
  body: string;
}

const COMMENT =
  /^\*\*`(.+):(\d+(?:-\d+)?)`\*\*( \(old side\))?(?:\n```\n([\s\S]*?)\n```)?\n([\s\S]*)$/;

/**
 * A message of line comments (the server's `reviewMessage`, with the owner's
 * message after a `---` line) back into its comments and that message; null
 * for any other message.
 */
export function parseReviewMessage(
  text: string,
): { comments: SentComment[]; message: string } | null {
  const head = /^Review comments \((\d+)\):\n\n/.exec(text);
  if (!head) return null;
  const count = Number(head[1]);
  const parts = text.slice(head[0].length).split("\n\n---\n\n");
  if (count < 1 || parts.length < count) return null;
  const comments: SentComment[] = [];
  for (const part of parts.slice(0, count)) {
    const match = COMMENT.exec(part);
    if (!match) return null;
    comments.push({
      path: match[1]!,
      lines: match[2]!,
      old: Boolean(match[3]),
      quote: (match[4] ?? "").replace(/ʼʼʼ/g, "```"),
      body: match[5]!,
    });
  }
  return { comments, message: parts.slice(count).join("\n\n---\n\n") };
}

/**
 * The thread's commenting for the diff panels: the owner's comments are
 * saved for the thread (a failure says so and keeps the text); a guest's,
 * which cannot be saved, are handed to `onGuestText` for the composer.
 */
export function useThreadCommenting(
  threadId: string | undefined,
  onGuestText: (text: string) => void,
): ThreadCommenting | undefined {
  const guest = useIsGuest();
  const comments = useThreadComments(threadId, !guest);
  const add = useCommentStore((s) => s.add);
  const remove = useCommentStore((s) => s.remove);
  const guestText = useRef(onGuestText);
  useEffect(() => {
    guestText.current = onGuestText;
  });
  return useMemo(() => {
    if (!threadId) return undefined;
    return {
      comments,
      add: async (body: ReviewDraftBody) => {
        if (guest) {
          guestText.current(commentText(body));
          return;
        }
        try {
          await add(threadId, body);
        } catch (error) {
          toast.error(errorMessage(error, "Could not save the comment."));
          throw error;
        }
      },
      remove: (draftId: string) =>
        void remove(threadId, draftId).catch((error: unknown) =>
          toast.error(errorMessage(error, "Could not remove it.")),
        ),
    };
  }, [threadId, comments, guest, add, remove]);
}
