/**
 * Attachments as a bot's model meets them: what a send's upload ids turn
 * into before it reaches the conversation. Images become inline blocks for a
 * vision model or notes for `see_image`; files become a reference line each
 * and, when small, their text inline, fenced as untrusted. The refs ride
 * the transcript entry so the chat can show what was attached.
 */
import { inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { fenceAttachment, UNTRUSTED_RULE, type AttachmentRef } from "@tiny-agents/agent";
import { db, uploads, type Upload } from "../../db";
import { loadContent } from "./uploads.extraction";
import { modelImage } from "./uploads.service";
import { summarize } from "./uploads.store";

/** One send's resolved content: blocks for the model, refs for the entry. */
export interface ResolvedSend {
  text: string;
  images?: { data: string; mimeType: string }[];
  attachments?: AttachmentRef[];
}

/** Inline a file's text when it is at most this long (≈8k tokens)… */
const INLINE_FILE_CHARS = 32_000;
/** …and while the send's inlined text stays under this (≈24k tokens). */
const INLINE_SEND_CHARS = 96_000;
/** How long a send waits for extractions still running (small files finish first). */
const EXTRACT_WAIT_MS = 5_000;

type UploadRow = Upload;

/** Re-read rows still extracting until they settle or the wait runs out. */
async function settledRows(rows: UploadRow[], waitMs: number): Promise<UploadRow[]> {
  const deadline = Date.now() + waitMs;
  let current = rows;
  while (current.some((row) => row.kind === "file" && row.extractStatus === "pending")) {
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const fresh = await db
      .select()
      .from(uploads)
      .where(
        inArray(
          uploads.id,
          current.map((r) => r.id),
        ),
      );
    const byId = new Map(fresh.map((row) => [row.id, row]));
    current = current.map((row) => byId.get(row.id) ?? row);
  }
  return current;
}

/**
 * One file as the model meets it (issue #58): a reference line with its id
 * and state, plus its whole text, fenced as untrusted, when it is small and
 * the send's budget allows; otherwise the outline only, for the tools.
 */
async function fileNote(row: UploadRow, budget: { left: number }): Promise<string> {
  const summary = summarize(row);
  const facts = [summary.mimeType, `${Math.max(1, Math.round(summary.size / 1024))} KB`];
  if (summary.pages) facts.push(`${summary.pages} page${summary.pages === 1 ? "" : "s"}`);
  if (summary.sheets) facts.push(`${summary.sheets} sheet${summary.sheets === 1 ? "" : "s"}`);
  if (summary.lines) facts.push(`${summary.lines} lines`);
  if (summary.entries) facts.push(`${summary.entries} entries`);
  const state =
    summary.status === "ready"
      ? "ready"
      : summary.status === "failed" || summary.status === "unsupported"
        ? `${summary.status}${summary.error ? ` (${summary.error})` : ""}`
        : "extracting";
  const line = `[file attached: ${row.name} (id ${row.id}), ${facts.join(", ")}, status: ${state}]`;
  if (summary.status !== "ready") return line;
  const content = await loadContent(row.id);
  if (!content) return line;
  if (content.entries) {
    const shown = content.entries.slice(0, 50).map((e) => (e.dir ? `${e.path}/` : e.path));
    const more =
      content.entries.length > shown.length
        ? `\n… ${content.entries.length - shown.length} more`
        : "";
    return `${line}\n${fenceAttachment(summary, shown.join("\n") + more)}`;
  }
  const text = content.pages.map((page) => page.text).join("\n");
  if (text.length <= INLINE_FILE_CHARS && text.length <= budget.left) {
    budget.left -= text.length;
    return `${line}\n${fenceAttachment(summary, text)}`;
  }
  const outline = content.outline?.slice(0, 12).join(" · ");
  return outline ? `${line}\n  Outline: ${outline.slice(0, 400)}` : line;
}

/**
 * Resolve a send's attachments (issue #17). Vision models get inline image
 * blocks; text-only models get a see_image note per image. Files get a
 * reference line each (issue #58) and, when small, their text inline, so
 * every model can work with what arrived. Files still extracting get up to
 * `waitMs` to finish. Throws 400 for a duplicate id and 404 for an unknown
 * one, before anything durable happens.
 */
export async function resolveAttachments(
  input: { text: string; attachments?: string[] },
  seesImages: boolean,
  { waitMs = EXTRACT_WAIT_MS }: { waitMs?: number } = {},
): Promise<ResolvedSend> {
  const ids = input.attachments ?? [];
  if (ids.length === 0) return { text: input.text };
  if (new Set(ids).size !== ids.length) throw Boom.badRequest("Duplicate attachment id");

  const found = await db.select().from(uploads).where(inArray(uploads.id, ids));
  const rows = await settledRows(found, waitMs);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.find((uploadId) => !byId.get(uploadId));
  if (missing) throw Boom.notFound(`Unknown attachment "${missing}"`);

  const attachments: AttachmentRef[] = ids.map((uploadId) => {
    const row = byId.get(uploadId)!;
    return {
      uploadId,
      kind: row.kind === "image" ? "image" : "file",
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
      ...(row.width !== null && row.height !== null
        ? { width: row.width, height: row.height }
        : {}),
      ...(row.kind === "file" ? { status: summarize(row).status } : {}),
    };
  });

  const images = attachments.filter((a) => a.kind === "image");
  const fileRows = ids.map((id) => byId.get(id)!).filter((row) => row.kind !== "image");
  const text = input.text.trim();

  const budget = { left: INLINE_SEND_CHARS };
  const fileLines: string[] = [];
  for (const row of fileRows) fileLines.push(await fileNote(row, budget));
  const fileNotes =
    fileLines.length > 0
      ? `${fileLines.join("\n")}\n(Read or search files with read_attachment / search_attachment and the id. ${UNTRUSTED_RULE})`
      : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

  // Vision path: inline image blocks, the refs ride the entry.
  if (images.length > 0 && seesImages) {
    const blocks: { data: string; mimeType: string }[] = [];
    for (const image of images) {
      const prepared = await modelImage(image.uploadId);
      if (prepared) blocks.push({ data: prepared.data, mimeType: prepared.mimeType });
    }
    if (blocks.length > 0) {
      return { text: join(text, fileNotes), images: blocks, attachments };
    }
    // Preparation failed for every image (swept storage): fall through to notes.
  }

  // Text-model path (or storage loss): describe images as text lines.
  const imageLines = images.map((image) => {
    const size = image.width && image.height ? `, ${image.width}x${image.height}` : "";
    return `[image attached: ${image.name}${size} (${image.uploadId})]`;
  });
  const imageNotes =
    imageLines.length > 0
      ? `${imageLines.join("\n")}${
          !seesImages
            ? "\n(The owner attached image(s); call see_image with an id above to view.)"
            : ""
        }`
      : "";
  return { text: join(text, imageNotes, fileNotes), attachments };
}
