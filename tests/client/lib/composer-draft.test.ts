import { describe, expect, it } from "vite-plus/test";
import {
  canSend,
  editText,
  emptyDraft,
  hasContent,
  insertMention,
  outgoing,
  restoreRefused,
  startMention,
  type ComposerDraft,
} from "@/lib/composer-draft";
import { activeMentionToken, resolveMentions, type PickedMention } from "@/lib/mentions";
import type { StagedUpload } from "@/lib/staged-uploads";

type Ref = { id: string; name: string };

const ada1 = { id: "ada-1", name: "Ada" };
const ada2 = { id: "ada-2", name: "Ada" };
const bob = { id: "bob", name: "Bob" };

function draft(text: string, picked: PickedMention[] = [], staged: StagedUpload<Ref>[] = []) {
  return { text, picked, staged } satisfies ComposerDraft<Ref>;
}

function done(id: string): StagedUpload<Ref> {
  return { key: `k-${id}`, name: `${id}.txt`, status: "done", ref: { id, name: `${id}.txt` } };
}

function pickedText(d: ComposerDraft<Ref>): string[] {
  return d.picked.map((pick) => d.text.slice(pick.start, pick.start + 1 + pick.name.length));
}

describe("editing and mentions", () => {
  it("keeps picks in step with an edit: before stays, after shifts, inside drops", () => {
    const start = draft("@Ada and @Bob", [
      { start: 0, botId: "ada-2", name: "Ada" },
      { start: 9, botId: "bob", name: "Bob" },
    ]);
    const edited = editText(start, "@Ada, hi and @Bob");
    expect(edited.picked).toEqual([
      { start: 0, botId: "ada-2", name: "Ada" },
      { start: 13, botId: "bob", name: "Bob" },
    ]);
    expect(editText(edited, "@Ad, hi and @Bob").picked.map((pick) => pick.botId)).toEqual(["bob"]);
  });

  it("inserts the chosen bot over the query, records the pick and puts the caret after the space", () => {
    const text = "hi @ad";
    const token = activeMentionToken(text, text.length)!;
    const { draft: next, caret } = insertMention(draft(text), token, text.length, ada2);
    expect(next.text).toBe("hi @Ada ");
    expect(caret).toBe(8);
    expect(next.picked).toEqual([{ start: 3, botId: "ada-2", name: "Ada" }]);
    const again = activeMentionToken(next.text, 7)!;
    const repicked = insertMention(next, again, 7, ada1).draft;
    expect(repicked.picked).toEqual([{ start: 3, botId: "ada-1", name: "Ada" }]);
  });

  it("types an @ at the caret for the menu, after a space when mid-word, shifting later picks", () => {
    const start = draft("hi there @Bob", [{ start: 9, botId: "bob", name: "Bob" }]);
    const midWord = startMention(start, 2);
    expect(midWord.draft.text).toBe("hi @ there @Bob");
    expect(midWord.caret).toBe(4);
    expect(pickedText(midWord.draft)).toEqual(["@Bob"]);
    const afterSpace = startMention(start, 3);
    expect(afterSpace.draft.text).toBe("hi @there @Bob");
    expect(afterSpace.caret).toBe(4);
    expect(startMention(draft(""), 0)).toEqual({ draft: draft("@"), caret: 1 });
  });
});

describe("sending", () => {
  it("trims the body and moves picks left by the trimmed indent", () => {
    const text = "  \n ping @Ada please  ";
    const sent = outgoing(draft(text, [{ start: 9, botId: "ada-2", name: "Ada" }]));
    expect(sent.body).toBe("ping @Ada please");
    expect(sent.picked).toEqual([{ start: 5, botId: "ada-2", name: "Ada" }]);
    expect(resolveMentions(sent.body, [ada1, ada2], "host", sent.picked).ids).toEqual(["ada-2"]);
  });

  it("carries only uploaded attachments", () => {
    const uploading: StagedUpload<Ref> = { key: "u", name: "u.txt", status: "uploading" };
    const failed: StagedUpload<Ref> = { key: "e", name: "e.txt", status: "error" };
    expect(outgoing(draft("x", [], [done("a"), failed, done("b")])).attachments).toEqual([
      { id: "a", name: "a.txt" },
      { id: "b", name: "b.txt" },
    ]);
    expect(canSend(draft("x", [], [done("a"), uploading]))).toBe(false);
  });

  it("can send typed text or a ready attachment, never only whitespace", () => {
    expect(canSend(draft("  \n"))).toBe(false);
    expect(hasContent(draft("  \n"))).toBe(false);
    expect(canSend(draft("hi"))).toBe(true);
    expect(canSend(draft("", [], [done("a")]))).toBe(true);
    expect(canSend(draft("", [], [{ key: "e", name: "e", status: "error" }]))).toBe(false);
  });
});

describe("restoring a refused send", () => {
  const restage = (ref: Ref) => ({ name: ref.name, previewUrl: `/preview/${ref.id}` });

  it("puts the body back ahead of text typed meanwhile, both sets of picks pointing at their names", () => {
    const sent = outgoing(
      draft("  ping @Ada", [{ start: 7, botId: "ada-2", name: "Ada" }], [done("a")]),
    );
    const typedMeanwhile = draft(
      "and @Bob too",
      [{ start: 4, botId: "bob", name: "Bob" }],
      [done("b")],
    );
    const restored = restoreRefused(typedMeanwhile, sent, restage);
    expect(restored.text).toBe("ping @Ada\n\nand @Bob too");
    expect(restored.picked.map((pick) => pick.botId)).toEqual(["ada-2", "bob"]);
    expect(pickedText(restored)).toEqual(["@Ada", "@Bob"]);
    expect(restored.staged.map((item) => [item.name, item.status, item.previewUrl])).toEqual([
      ["a.txt", "done", "/preview/a"],
      ["b.txt", "done", undefined],
    ]);
    expect(restored.staged[0]!.key).not.toBe("k-a");
    const again = outgoing(restored);
    expect(resolveMentions(again.body, [ada1, ada2, bob], "host", again.picked).ids).toEqual([
      "ada-2",
      "bob",
    ]);
  });

  it("restores the body alone when nothing (or only whitespace) was typed meanwhile", () => {
    const sent = outgoing(draft("ping @Ada", [{ start: 5, botId: "ada-2", name: "Ada" }]));
    expect(restoreRefused(emptyDraft<Ref>(), sent, restage)).toEqual(
      draft("ping @Ada", [{ start: 5, botId: "ada-2", name: "Ada" }]),
    );
    expect(restoreRefused(draft(" \n "), sent, restage).text).toBe("ping @Ada");
  });

  it("leaves text typed meanwhile in place when the refused send had no text", () => {
    const sent = outgoing(draft("", [], [done("a")]));
    const restored = restoreRefused(
      draft("@Bob hi", [{ start: 0, botId: "bob", name: "Bob" }]),
      sent,
      restage,
    );
    expect(restored.text).toBe("@Bob hi");
    expect(pickedText(restored)).toEqual(["@Bob"]);
    expect(restored.staged.map((item) => item.name)).toEqual(["a.txt"]);
  });
});
