import { inArray } from "drizzle-orm";
import { Boom } from "@groot/core/errors";
import { fenceAttachment, UNTRUSTED_RULE, type AttachmentRef } from "@tiny-agents/agent";
import { db, uploads, type Upload } from "../../db";
import { loadContent, waitUntilSettled } from "./uploads.extraction";
import { modelImage, summarize } from "./uploads.store";

export interface ResolvedSend {
  text: string;
  images?: { data: string; mimeType: string }[];
  attachments?: AttachmentRef[];
}

const INLINE_FILE_CHARS = 32_000;
const INLINE_SEND_CHARS = 96_000;
const EXTRACT_WAIT_MS = 5_000;

type UploadRow = Upload;

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

export async function resolveAttachments(
  input: { text: string; attachments?: string[] },
  seesImages: boolean,
  { waitMs = EXTRACT_WAIT_MS }: { waitMs?: number } = {},
): Promise<ResolvedSend> {
  const ids = input.attachments ?? [];
  if (ids.length === 0) return { text: input.text };
  if (new Set(ids).size !== ids.length) throw Boom.badRequest("Duplicate attachment id");

  const found = await db.select().from(uploads).where(inArray(uploads.id, ids));
  const rows = await waitUntilSettled(found, waitMs);
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

  if (images.length > 0 && seesImages) {
    const blocks: { data: string; mimeType: string }[] = [];
    for (const image of images) {
      const prepared = await modelImage(image.uploadId);
      if (prepared) blocks.push({ data: prepared.data, mimeType: prepared.mimeType });
    }
    if (blocks.length > 0) {
      return { text: join(text, fileNotes), images: blocks, attachments };
    }
  }

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
