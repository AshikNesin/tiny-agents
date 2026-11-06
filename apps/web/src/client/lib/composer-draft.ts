/**
 * A composer's draft as one value: the text, the mentions picked from the
 * autocomplete (placed in the text, issue #80) and the staged attachments.
 * Every change is a pure step, so the offsets that move under the owner's
 * edits (a pick after trimming, a refused send put back ahead of what was
 * typed meanwhile) are worked out here and tested without a DOM. The bot
 * chat's composer uses all of it; the Code page's has no picks.
 */
import { trackPickedMentions, type MentionToken, type PickedMention } from "./mentions";
import { isUploading, readyRefs, type StagedUpload } from "./staged-uploads";

export interface ComposerDraft<Ref> {
  text: string;
  /** Picked mentions, each at its `@` in `text`. */
  picked: PickedMention[];
  staged: StagedUpload<Ref>[];
}

/** What one send carries: the trimmed body, its picks placed in it, the ready refs. */
export interface OutgoingDraft<Ref> {
  body: string;
  picked: PickedMention[];
  attachments: Ref[];
}

export function emptyDraft<Ref>(text = ""): ComposerDraft<Ref> {
  return { text, picked: [], staged: [] };
}

/** The owner edited the text: picks before the edit stay, after it shift, inside it drop. */
export function editText<Ref>(draft: ComposerDraft<Ref>, next: string): ComposerDraft<Ref> {
  if (next === draft.text) return draft;
  return { ...draft, text: next, picked: trackPickedMentions(draft.text, next, draft.picked) };
}

/** Change the staged list (an upload staged, landed, failed or removed). */
export function withStaged<Ref>(
  draft: ComposerDraft<Ref>,
  change: (staged: StagedUpload<Ref>[]) => StagedUpload<Ref>[],
): ComposerDraft<Ref> {
  return { ...draft, staged: change(draft.staged) };
}

/**
 * Replace the `@query` from the token's `@` up to the caret with the chosen
 * bot's `@Name `; the latest pick at this `@` replaces any earlier one
 * there. Answers the caret, after the trailing space.
 */
export function insertMention<Ref>(
  draft: ComposerDraft<Ref>,
  token: MentionToken,
  caret: number,
  chosen: { id: string; name: string },
): { draft: ComposerDraft<Ref>; caret: number } {
  const insertion = `@${chosen.name} `;
  const text = draft.text.slice(0, token.start) + insertion + draft.text.slice(caret);
  const picked = [
    ...trackPickedMentions(draft.text, text, draft.picked).filter(
      (pick) => pick.start !== token.start,
    ),
    { start: token.start, botId: chosen.id, name: chosen.name },
  ];
  return { draft: { ...draft, text, picked }, caret: token.start + insertion.length };
}

/** "+ → Mention a bot": type an `@` at the caret (after a space if mid-word), opening the picker. */
export function startMention<Ref>(
  draft: ComposerDraft<Ref>,
  at: number,
): { draft: ComposerDraft<Ref>; caret: number } {
  const before = draft.text.slice(0, at);
  const insertion = before && !/\s$/.test(before) ? " @" : "@";
  const next = editText(draft, before + insertion + draft.text.slice(at));
  return { draft: next, caret: at + insertion.length };
}

/** Typed text or a ready attachment: something a send would carry. */
export function hasContent<Ref>(draft: ComposerDraft<Ref>): boolean {
  return draft.text.trim().length > 0 || readyRefs(draft.staged).length > 0;
}

/** Something to send and no upload still running. */
export function canSend<Ref>(draft: ComposerDraft<Ref>): boolean {
  return hasContent(draft) && !isUploading(draft.staged);
}

/** The draft as sent: the text trimmed, the picks moved left by the trimmed indent. */
export function outgoing<Ref>(draft: ComposerDraft<Ref>): OutgoingDraft<Ref> {
  const indent = draft.text.length - draft.text.trimStart().length;
  return {
    body: draft.text.trim(),
    picked: draft.picked.map((pick) => ({ ...pick, start: pick.start - indent })),
    attachments: readyRefs(draft.staged),
  };
}

/**
 * Put a refused send back for another try, ahead of whatever was typed or
 * attached while it was in flight: the body, a blank line, then the new
 * text, whose picks move down behind the body. `restage` names (and, for
 * an image, previews) each sent attachment again.
 */
export function restoreRefused<Ref>(
  current: ComposerDraft<Ref>,
  sent: OutgoingDraft<Ref>,
  restage: (ref: Ref) => { name: string; previewUrl?: string },
): ComposerDraft<Ref> {
  const typed = current.text.trim() ? current.text : "";
  // Picks made meanwhile imply text, so without text there are none.
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
