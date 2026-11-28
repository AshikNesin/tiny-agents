import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
import { load as loadYaml } from "js-yaml";
import type { AttachmentContent } from "@tiny-agents/agent";
import { logger } from "@groot/core/logger";
import { listGzip, listTar, listTgz, listZip, type ArchiveListing } from "./uploads.archive";
import {
  docxToMarkdown,
  odpSlides,
  odsSheets,
  odtToMarkdown,
  pptxSlides,
  xlsxSheets,
  type Slide,
} from "./uploads.office";
import { decodeText, type ExtractKind } from "./uploads.text";
import type { UploadMeta } from "../../../shared/api/uploads";

const EXTRACT_LIMITS = {
  maxChars: 2_000_000,
  maxPdfPages: 500,
  maxSheets: 20,
  maxCells: 200_000,
  maxPartBytes: 64 * 1024 * 1024,
  maxTotalPartBytes: 128 * 1024 * 1024,
  maxEntries: 10_000,
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxRatio: 100,
  pageChars: 16_000,
};

type ExtractMeta = UploadMeta;

export type ExtractResult =
  | { status: "ready"; content: AttachmentContent; meta: ExtractMeta }
  | { status: "failed" | "unsupported"; error: string };

export interface ExtractInput {
  bytes: Uint8Array;
  kind: ExtractKind;
  name: string;
}

export function paginate(text: string, pageChars = EXTRACT_LIMITS.pageChars) {
  const lines = text.split("\n");
  const pages: { label: string; text: string }[] = [];
  let start = 0;
  let buffer: string[] = [];
  let size = 0;
  const flush = (end: number) => {
    if (buffer.length === 0) return;
    pages.push({ label: `lines ${start + 1}–${end}`, text: buffer.join("\n") });
    buffer = [];
    size = 0;
    start = end;
  };
  lines.forEach((line, index) => {
    for (let offset = 0; offset < Math.max(line.length, 1); offset += pageChars) {
      const piece = line.slice(offset, offset + pageChars);
      if (size + piece.length > pageChars && buffer.length > 0) flush(index);
      buffer.push(piece);
      size += piece.length + 1;
    }
  });
  flush(lines.length);
  return { pages: pages.length ? pages : [{ label: "lines 1–1", text: "" }], lines: lines.length };
}

function capText(text: string): { text: string; truncated: boolean } {
  return text.length > EXTRACT_LIMITS.maxChars
    ? { text: text.slice(0, EXTRACT_LIMITS.maxChars), truncated: true }
    : { text, truncated: false };
}

function textResult(
  raw: string,
  format: AttachmentContent["format"],
  extra: Partial<ExtractMeta> & { outline?: string[] } = {},
): ExtractResult {
  const { outline, ...meta } = extra;
  const { text, truncated } = capText(raw.replace(/\r\n?/g, "\n"));
  const { pages, lines } = paginate(text);
  return {
    status: "ready",
    content: { format, pages, ...(outline?.length ? { outline } : {}) },
    meta: {
      format,
      lines,
      chars: text.length,
      ...(pages.length > 1 ? { pages: pages.length } : {}),
      ...(truncated || meta.truncated ? { truncated: true } : {}),
      ...meta,
    },
  };
}

function textOutline(text: string, name: string): string[] {
  if (/\.(md|markdown)$/i.test(name)) {
    return text
      .split("\n")
      .filter((line) => /^#{1,3}\s+\S/.test(line))
      .map((line) => line.replace(/^#+\s+/, "").trim())
      .slice(0, 100);
  }
  return [];
}

export function parseDelimited(text: string, delimiter: string, maxCells: number) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let cells = 0;
  let truncated = false;
  let totalRows = 0;
  let totalColumns = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    totalRows += 1;
    totalColumns = Math.max(totalColumns, row.length);
    if (cells + row.length > maxCells) truncated = true;
    if (!truncated) {
      rows.push(row);
      cells += row.length;
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") endRow();
    else if (char !== "\r") field += char;
  }
  if (field !== "" || row.length > 0) endRow();
  return { rows, truncated, totalRows, totalColumns };
}

const BLOCK =
  /<\/?(?:p|div|br|li|tr|h[1-6]|section|article|header|footer|table|ul|ol|pre|blockquote)\b[^>]*>/gi;

export function htmlToText(html: string): { text: string; title?: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, ref: string) => {
      const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      if (ref[0] !== "#") return named[ref.toLowerCase()] ?? m;
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, ...(title ? { title } : {}) };
}

interface OutlineNode {
  title: string;
  items?: OutlineNode[];
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (error) {
    const name = (error as { name?: string }).name ?? "";
    if (name === "PasswordException") {
      return { status: "failed", error: "The PDF is password-protected." };
    }
    return { status: "failed", error: "The PDF could not be read (damaged or unsupported)." };
  }
  try {
    const total = pdf.numPages;
    const count = Math.min(total, EXTRACT_LIMITS.maxPdfPages);
    const pages: { label: string; text: string }[] = [];
    let chars = 0;
    let imagePages = 0;
    let truncated = total > count;
    for (let index = 1; index <= count; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
        if (typeof item.str !== "string") continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      text = text.replace(/[ \t]+\n/g, "\n").trim();
      if (text.replace(/\s/g, "").length < 3) imagePages += 1;
      if (chars + text.length > EXTRACT_LIMITS.maxChars) {
        truncated = true;
        break;
      }
      chars += text.length;
      pages.push({ label: `page ${index}`, text });
      page.cleanup();
    }
    const outline: string[] = [];
    try {
      const walk = (nodes: OutlineNode[] | null | undefined, depth: number) => {
        for (const node of nodes ?? []) {
          if (outline.length >= 200) return;
          if (node.title?.trim()) outline.push(node.title.trim());
          if (depth < 1) walk(node.items, depth + 1);
        }
      };
      walk((await pdf.getOutline()) as OutlineNode[] | null, 0);
    } catch (error) {
      logUnreadPdfPart(error, "outline");
    }
    let title: string | undefined;
    let author: string | undefined;
    try {
      const { info } = (await pdf.getMetadata()) as {
        info?: { Title?: unknown; Author?: unknown };
      };
      if (typeof info?.Title === "string" && info.Title.trim())
        title = info.Title.trim().slice(0, 300);
      if (typeof info?.Author === "string" && info.Author.trim())
        author = info.Author.trim().slice(0, 200);
    } catch (error) {
      logUnreadPdfPart(error, "metadata");
    }
    return {
      status: "ready",
      content: { format: "pdf", pages, ...(outline.length ? { outline } : {}) },
      meta: {
        format: "pdf",
        pages: total,
        chars,
        ...(truncated ? { truncated: true } : {}),
        ...(imagePages ? { imagePages } : {}),
        ...(title ? { title } : {}),
        ...(author ? { author } : {}),
      },
    };
  } finally {
    await pdf.cleanup().catch((error: unknown) => logUnreadPdfPart(error, "cleanup"));
  }
}

function logUnreadPdfPart(error: unknown, part: "outline" | "metadata" | "cleanup"): void {
  logger.debug({ error, part }, "Uploads: a PDF's text was extracted without this part");
}

function slidesResult(slides: Slide[]): ExtractResult {
  let chars = 0;
  let truncated = false;
  const pages: { label: string; text: string }[] = [];
  slides.forEach((slide, index) => {
    const text = slide.notes ? `${slide.text}\n\nNotes: ${slide.notes}` : slide.text;
    if (chars + text.length > EXTRACT_LIMITS.maxChars) {
      truncated = true;
      return;
    }
    chars += text.length;
    pages.push({ label: `slide ${index + 1}`, text });
  });
  const outline = slides.map((slide, index) => `${index + 1}. ${slide.title || "(untitled)"}`);
  return {
    status: "ready",
    content: { format: "slides", pages, outline },
    meta: {
      format: "slides",
      pages: slides.length,
      chars,
      ...(truncated ? { truncated: true } : {}),
    },
  };
}

function sheetsResult(sheets: NonNullable<AttachmentContent["sheets"]>): ExtractResult {
  const pages: { label: string; text: string }[] = [];
  let chars = 0;
  for (const sheet of sheets) {
    for (let from = 0; from < sheet.rows.length; from += 500) {
      const text = sheet.rows
        .slice(from, from + 500)
        .map((row) => row.join("\t"))
        .join("\n");
      chars += text.length;
      pages.push({
        label: `sheet "${sheet.name}" rows ${from + 1}–${Math.min(from + 500, sheet.rows.length)}`,
        text,
      });
    }
  }
  return {
    status: "ready",
    content: {
      format: "spreadsheet",
      pages,
      sheets,
      outline: sheets.map(
        (s) => `${s.name}${s.hidden ? " (hidden)" : ""}: ${s.totalRows}×${s.totalColumns}`,
      ),
    },
    meta: {
      format: "spreadsheet",
      sheets: sheets.length,
      chars,
      ...(sheets.some((s) => s.truncated) ? { truncated: true } : {}),
    },
  };
}

function listingResult(listing: ArchiveListing): ExtractResult {
  return {
    status: "ready",
    content: { format: "archive", pages: [], entries: listing.entries },
    meta: {
      format: "archive",
      entries: listing.entries.length,
      chars: 0,
      ...(listing.truncated ? { truncated: true } : {}),
      ...(listing.suspicious ? { suspicious: listing.suspicious } : {}),
    },
  };
}

const office = {
  maxSheets: EXTRACT_LIMITS.maxSheets,
  maxCells: EXTRACT_LIMITS.maxCells,
  maxPartBytes: EXTRACT_LIMITS.maxPartBytes,
  maxTotalPartBytes: EXTRACT_LIMITS.maxTotalPartBytes,
};
const archive = {
  maxEntries: EXTRACT_LIMITS.maxEntries,
  maxTotalBytes: EXTRACT_LIMITS.maxArchiveBytes,
  maxRatio: EXTRACT_LIMITS.maxRatio,
};

const UNSUPPORTED: Record<string, string> = {
  "application/msword": "Legacy .doc files can't be read here",
  "application/vnd.ms-excel": "Legacy .xls files can't be read here",
  "application/vnd.ms-powerpoint": "Legacy .ppt files can't be read here",
};

export async function extract(input: ExtractInput, mime = ""): Promise<ExtractResult> {
  try {
    switch (input.kind) {
      case "text": {
        const text = decodeText(input.bytes);
        return textResult(text, "text", { outline: textOutline(text, input.name) });
      }
      case "json": {
        const text = decodeText(input.bytes);
        try {
          const parsed = parseJson("An uploaded JSON file", text, z.unknown());
          return textResult(
            text.length < 1_000_000 ? JSON.stringify(parsed, null, 2) : text,
            "text",
            { valid: true },
          );
        } catch {
          return textResult(text, "text", { valid: false });
        }
      }
      case "yaml": {
        const text = decodeText(input.bytes);
        let valid = true;
        try {
          loadYaml(text, { json: true });
        } catch {
          valid = false;
        }
        return textResult(text, "text", { valid });
      }
      case "html": {
        const { text, title } = htmlToText(decodeText(input.bytes));
        return textResult(text, "text", title ? { title } : {});
      }
      case "csv": {
        const text = decodeText(input.bytes);
        const delimiter = /\.tsv$/i.test(input.name) ? "\t" : ",";
        const parsed = parseDelimited(text, delimiter, EXTRACT_LIMITS.maxCells);
        const result = sheetsResult([
          {
            name: input.name.replace(/\.[^.]+$/, "") || "Sheet1",
            rows: parsed.rows,
            totalRows: parsed.totalRows,
            totalColumns: parsed.totalColumns,
            ...(parsed.truncated ? { truncated: true } : {}),
          },
        ]);
        return result;
      }
      case "pdf":
        return await extractPdf(input.bytes);
      case "docx": {
        const { markdown, outline } = docxToMarkdown(input.bytes, office);
        return textResult(markdown, "document", { outline });
      }
      case "odt": {
        const { markdown, outline } = odtToMarkdown(input.bytes, office);
        return textResult(markdown, "document", { outline });
      }
      case "xlsx":
        return sheetsResult(xlsxSheets(input.bytes, office));
      case "ods":
        return sheetsResult(odsSheets(input.bytes, office));
      case "pptx":
        return slidesResult(pptxSlides(input.bytes, office));
      case "odp":
        return slidesResult(odpSlides(input.bytes, office));
      case "zip":
        return listingResult(listZip(input.bytes, archive));
      case "tar":
        return listingResult(listTar(input.bytes, archive));
      case "tgz":
        return listingResult(await listTgz(input.bytes, archive));
      case "gz":
        return /\.tar\.gz$/i.test(input.name)
          ? listingResult(await listTgz(input.bytes, archive))
          : listingResult(listGzip(input.bytes, input.name));
      default:
        return {
          status: "unsupported",
          error:
            UNSUPPORTED[mime] ??
            (mime.startsWith("audio/") || mime.startsWith("video/")
              ? "Audio and video can't be read here yet"
              : "This type can't be read here"),
        };
    }
  } catch (error) {
    return {
      status: "failed",
      error:
        `Could not read the file: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          300,
        ),
    };
  }
}
