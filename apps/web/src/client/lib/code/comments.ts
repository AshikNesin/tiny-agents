import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { toast } from "sonner";
import { errorMessage } from "../errors";
import { useIsGuest } from "../../store/people";
import type { ReviewDraft, ReviewDraftBody } from "../../../shared/api/code";
import { projectsApi } from "./projects";

const GITHUB = "github:";

export const githubCommentsKey = (reviewId: string) => `${GITHUB}${reviewId}`;

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
  sent(threadId: string): void;
}

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

export function useThreadComments(threadId: string | undefined, enabled = true): ReviewDraft[] {
  const load = useCommentStore((s) => s.load);
  const comments = useCommentStore((s) => (threadId ? s.byThread[threadId] : undefined));
  useEffect(() => {
    if (!threadId || !enabled) return;
    load(threadId).catch(() => undefined);
  }, [threadId, enabled, load]);
  return enabled ? (comments ?? NONE) : NONE;
}

function commentText(draft: ReviewDraftBody): string {
  const lines =
    draft.startLine === draft.endLine
      ? `${draft.startLine}`
      : `${draft.startLine}-${draft.endLine}`;
  return `\`${draft.path}:${lines}\`${draft.side === "old" ? " (old side)" : ""} ${draft.body}`;
}

export interface ThreadCommenting {
  comments: ReviewDraft[];
  add(body: ReviewDraftBody): Promise<void>;
  remove(draftId: string): void;
}

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

export interface SentComment {
  path: string;
  lines: string;
  old: boolean;
  quote: string;
  body: string;
}

const COMMENT =
  /^\*\*`(.+):(\d+(?:-\d+)?)`\*\*( \(old side\))?(?:\n```\n([\s\S]*?)\n```)?\n([\s\S]*)$/;

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
