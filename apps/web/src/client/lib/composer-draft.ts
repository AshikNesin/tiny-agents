import { z } from "zod";
import { trackPickedMentions, type MentionToken, type PickedMention } from "./mentions";
import { isUploading, readyRefs, type StagedUpload } from "./staged-uploads";

export const composerTextSchema = z.object({
  text: z.string(),
  picked: z.array(z.object({ start: z.number(), botId: z.string(), name: z.string() })),
});

export type ComposerText = z.infer<typeof composerTextSchema>;

export const EMPTY_TEXT: ComposerText = { text: "", picked: [] };

export interface ComposerDraft<Ref> extends ComposerText {
  staged: StagedUpload<Ref>[];
}

export interface OutgoingDraft<Ref> {
  body: string;
  picked: PickedMention[];
  attachments: Ref[];
}

export function emptyDraft<Ref>(text = ""): ComposerDraft<Ref> {
  return { text, picked: [], staged: [] };
}

export function editText<Draft extends ComposerText>(draft: Draft, next: string): Draft {
  if (next === draft.text) return draft;
  return {
    ...draft,
    text: next,
    picked: trackPickedMentions(draft.text, next, draft.picked),
  };
}

export function insertMention<Draft extends ComposerText>(
  draft: Draft,
  token: MentionToken,
  caret: number,
  chosen: { id: string; name: string },
): { draft: Draft; caret: number } {
  const insertion = `@${chosen.name} `;
  const text = draft.text.slice(0, token.start) + insertion + draft.text.slice(caret);
  const picked = [
    ...trackPickedMentions(draft.text, text, draft.picked).filter(
      (pick) => pick.start !== token.start,
    ),
    { start: token.start, botId: chosen.id, name: chosen.name },
  ];
  return {
    draft: { ...draft, text, picked },
    caret: token.start + insertion.length,
  };
}

export function startMention<Draft extends ComposerText>(
  draft: Draft,
  at: number,
): { draft: Draft; caret: number } {
  const before = draft.text.slice(0, at);
  const insertion = before && !/\s$/.test(before) ? " @" : "@";
  const next = editText(draft, before + insertion + draft.text.slice(at));
  return { draft: next, caret: at + insertion.length };
}

export function hasContent<Ref>(draft: ComposerDraft<Ref>): boolean {
  return draft.text.trim().length > 0 || readyRefs(draft.staged).length > 0;
}

export function isNewChatCommand<Ref>(draft: ComposerDraft<Ref>): boolean {
  return draft.staged.length === 0 && draft.text.trim() === "/new";
}

export function canSend<Ref>(draft: ComposerDraft<Ref>): boolean {
  return hasContent(draft) && !isUploading(draft.staged);
}

export function outgoing<Ref>(draft: ComposerDraft<Ref>): OutgoingDraft<Ref> {
  const indent = draft.text.length - draft.text.trimStart().length;
  return {
    body: draft.text.trim(),
    picked: draft.picked.map((pick) => ({
      ...pick,
      start: pick.start - indent,
    })),
    attachments: readyRefs(draft.staged),
  };
}

export function restoreRefused<Ref>(
  current: ComposerDraft<Ref>,
  sent: OutgoingDraft<Ref>,
  restage: (ref: Ref) => { name: string; previewUrl?: string },
): ComposerDraft<Ref> {
  const typed = current.text.trim() ? current.text : "";
  const typedPicked = typed ? current.picked : [];
  const shift = sent.body && typed ? sent.body.length + 2 : 0;
  return {
    text: sent.body && typed ? `${sent.body}\n\n${typed}` : sent.body || typed,
    picked: [
      ...sent.picked,
      ...typedPicked.map((pick) => ({ ...pick, start: pick.start + shift })),
    ],
    staged: [
      ...sent.attachments.map((ref) => ({
        key: crypto.randomUUID(),
        status: "done" as const,
        ref,
        ...restage(ref),
      })),
      ...current.staged,
    ],
  };
}

export function activeSkillToken(text: string, caret: number): { query: string } | null {
  const token = /^\/([a-z0-9_-]*)$/.exec(text.slice(0, caret));
  return token ? { query: token[1]! } : null;
}
