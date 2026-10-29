/**
 * Office and OpenDocument readers (issue #58): DOCX, XLSX, PPTX, ODT, ODS
 * and ODP are zips of XML parts. Only the parts that carry text are
 * inflated, each under a declared-size cap; nothing is evaluated (formulas
 * keep their cached values, macros and embedded objects are ignored).
 */
import { unzipSync } from "fflate";
import type { AttachmentSheet } from "@tiny-agents/agent";
import { local, xmlEvents } from "./uploads.xml";

export interface OfficeLimits {
  maxSheets: number;
  maxCells: number;
  /** Largest declared size of one XML part. */
  maxPartBytes: number;
}

export interface DocumentText {
  markdown: string;
  outline: string[];
}

export interface Slide {
  title: string;
  text: string;
  notes: string;
}

/** Inflate the named parts (others are never decompressed). */
export function readParts(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
  maxPartBytes: number,
): Map<string, string> {
  const files = unzipSync(bytes, {
    filter: (file) => wanted(file.name) && file.originalSize <= maxPartBytes,
  });
  const decoder = new TextDecoder();
  return new Map(Object.entries(files).map(([name, data]) => [name, decoder.decode(data)]));
}

/** Relationship id → part path, resolved against the part's folder. */
function relationships(xml: string | undefined, base: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  for (const event of xmlEvents(xml)) {
    if (event.type !== "open" || local(event.name) !== "Relationship") continue;
    const { Id, Target, TargetMode } = event.attrs;
    if (!Id || !Target || TargetMode === "External") continue;
    map.set(Id, resolvePart(base, Target));
  }
  return map;
}

function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base ? base.split("/") : [];
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

const mdCell = (text: string) =>
  text
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();

function markdownTable(rows: string[][]): string {
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_, i) => mdCell(row[i] ?? ""));
  const [header = [], ...body] = rows;
  return [
    `| ${pad(header).join(" | ")} |`,
    `|${" --- |".repeat(width)}`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ].join("\n");
}

// ── DOCX ────────────────────────────────────────────────────────────────

/** word/document.xml → Markdown with headings, lists and tables. */
export function docxToMarkdown(bytes: Uint8Array, limits: OfficeLimits): DocumentText {
  const parts = readParts(bytes, (name) => name === "word/document.xml", limits.maxPartBytes);
  const xml = parts.get("word/document.xml");
  if (!xml) throw new Error("The document body is missing or too large.");
  const blocks: string[] = [];
  const outline: string[] = [];
  let paragraph: { text: string; style: string; list: boolean } | undefined;
  let inText = false;
  // Tables nest: a stack of [rows, current row, current cell].
  const tables: { rows: string[][]; row: string[]; cell: string[] }[] = [];

  const emit = (line: string) => {
    const table = tables.at(-1);
    if (table) table.cell.push(line);
    else blocks.push(line);
  };

  for (const event of xmlEvents(xml)) {
    const name = event.type === "text" ? "" : local(event.name);
    if (event.type === "open") {
      if (name === "p") paragraph = { text: "", style: "", list: false };
      else if (name === "pStyle" && paragraph) paragraph.style = event.attrs["w:val"] ?? "";
      else if (name === "numPr" && paragraph) paragraph.list = true;
      else if (name === "t") inText = true;
      else if (name === "tab" && paragraph) paragraph.text += "\t";
      else if ((name === "br" || name === "cr") && paragraph) paragraph.text += "\n";
      else if (name === "tbl") tables.push({ rows: [], row: [], cell: [] });
      else if (name === "tr" && tables.length) tables.at(-1)!.row = [];
      else if (name === "tc" && tables.length) tables.at(-1)!.cell = [];
    } else if (event.type === "close") {
      if (name === "t") inText = false;
      else if (name === "p" && paragraph) {
        const text = paragraph.text.trim();
        const heading = /^(?:heading\s*(\d)|title)$/i.exec(paragraph.style);
        if (text && heading) {
          const level = heading[1] ? Math.min(6, Number(heading[1])) : 1;
          outline.push(text);
          emit(tables.length ? text : `${"#".repeat(level)} ${text}`);
        } else if (text) {
          emit(paragraph.list && !tables.length ? `- ${text}` : text);
        }
        paragraph = undefined;
      } else if (name === "tc" && tables.length) {
        const table = tables.at(-1)!;
        table.row.push(table.cell.join(" "));
      } else if (name === "tr" && tables.length) {
        const table = tables.at(-1)!;
        table.rows.push(table.row);
      } else if (name === "tbl" && tables.length) {
        const table = tables.pop()!;
        const rendered = markdownTable(table.rows);
        if (tables.length) tables.at(-1)!.cell.push(table.rows.map((r) => r.join(" ")).join(" "));
        else blocks.push(rendered);
      }
    } else if (inText && paragraph) {
      paragraph.text += event.text;
    }
  }
  return { markdown: blocks.join("\n\n"), outline };
}

// ── XLSX ────────────────────────────────────────────────────────────────

const columnIndex = (ref: string) => {
  let index = 0;
  for (const char of ref.replace(/\d+$/, "").toUpperCase())
    index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
};

export function xlsxSheets(bytes: Uint8Array, limits: OfficeLimits): AttachmentSheet[] {
  const parts = readParts(
    bytes,
    (name) =>
      name === "xl/workbook.xml" ||
      name === "xl/_rels/workbook.xml.rels" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
    limits.maxPartBytes,
  );
  const workbook = parts.get("xl/workbook.xml");
  if (!workbook) throw new Error("The workbook is missing or too large.");
  const rels = relationships(parts.get("xl/_rels/workbook.xml.rels"), "xl");

  const shared: string[] = [];
  const sharedXml = parts.get("xl/sharedStrings.xml");
  if (sharedXml) {
    let current: string | undefined;
    let inText = false;
    let phonetic = false;
    for (const event of xmlEvents(sharedXml)) {
      if (event.type === "open") {
        const name = local(event.name);
        if (name === "si") current = "";
        else if (name === "t") inText = true;
        else if (name === "rPh") phonetic = true;
      } else if (event.type === "close") {
        const name = local(event.name);
        if (name === "si") {
          shared.push(current ?? "");
          current = undefined;
        } else if (name === "t") inText = false;
        else if (name === "rPh") phonetic = false;
      } else if (inText && !phonetic && current !== undefined) {
        current += event.text;
      }
    }
  }

  const sheets: AttachmentSheet[] = [];
  let cells = 0;
  for (const event of xmlEvents(workbook)) {
    if (event.type !== "open" || local(event.name) !== "sheet") continue;
    if (sheets.length >= limits.maxSheets) break;
    const target = rels.get(event.attrs["r:id"] ?? "");
    const xml = target ? parts.get(target) : undefined;
    const sheet: AttachmentSheet = {
      name: event.attrs.name ?? `Sheet${sheets.length + 1}`,
      ...(event.attrs.state && event.attrs.state !== "visible" ? { hidden: true } : {}),
      rows: [],
      totalRows: 0,
      totalColumns: 0,
    };
    sheets.push(sheet);
    if (!xml) continue;
    let row: string[] | undefined;
    let rowIndex = 0;
    let cellRef = "";
    let cellType = "";
    let value: string | undefined;
    let inValue = false;
    let inInline = false;
    for (const e of xmlEvents(xml)) {
      if (e.type === "open") {
        const name = local(e.name);
        if (name === "row") {
          const r = Number(e.attrs.r);
          rowIndex = Number.isFinite(r) && r > 0 ? r : rowIndex + 1;
          row = [];
        } else if (name === "c") {
          cellRef = e.attrs.r ?? "";
          cellType = e.attrs.t ?? "";
          value = undefined;
        } else if (name === "v") inValue = true;
        else if (name === "is") inInline = true;
        else if (name === "t" && inInline) inValue = true;
      } else if (e.type === "close") {
        const name = local(e.name);
        if (name === "v" || (name === "t" && inInline)) inValue = false;
        else if (name === "is") inInline = false;
        else if (name === "c" && row) {
          if (value === undefined) continue;
          const text =
            cellType === "s"
              ? (shared[Number(value)] ?? "")
              : cellType === "b"
                ? value === "1"
                  ? "TRUE"
                  : "FALSE"
                : value;
          const column = cellRef ? columnIndex(cellRef) : row.length;
          if (column < 0 || column > 16_383) continue;
          sheet.totalColumns = Math.max(sheet.totalColumns, column + 1);
          if (cells >= limits.maxCells) {
            sheet.truncated = true;
            continue;
          }
          while (row.length < column) row.push("");
          row[column] = text;
          cells += 1;
        } else if (name === "row" && row) {
          sheet.totalRows = Math.max(sheet.totalRows, rowIndex);
          // A far-away row would pad millions of empty ones.
          if (rowIndex > limits.maxCells) sheet.truncated = true;
          if (!sheet.truncated && row.length > 0) {
            while (sheet.rows.length < rowIndex - 1) sheet.rows.push([]);
            sheet.rows[rowIndex - 1] = row;
          }
          row = undefined;
        }
      } else if (inValue) {
        value = (value ?? "") + e.text;
      }
    }
  }
  return sheets;
}

// ── PPTX ────────────────────────────────────────────────────────────────

function paragraphs(xml: string): string[] {
  const lines: string[] = [];
  let line: string | undefined;
  let inText = false;
  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      const name = local(event.name);
      if (name === "p") line = "";
      else if (name === "t") inText = true;
      else if (name === "br" && line !== undefined) line += "\n";
    } else if (event.type === "close") {
      const name = local(event.name);
      if (name === "t") inText = false;
      else if (name === "p" && line !== undefined) {
        if (line.trim()) lines.push(line.trim());
        line = undefined;
      }
    } else if (inText && line !== undefined) {
      line += event.text;
    }
  }
  return lines;
}

export function pptxSlides(bytes: Uint8Array, limits: OfficeLimits): Slide[] {
  const parts = readParts(
    bytes,
    (name) =>
      name === "ppt/presentation.xml" ||
      name === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/slides\/(_rels\/)?[^/]+\.xml(\.rels)?$/.test(name) ||
      /^ppt\/notesSlides\/[^/]+\.xml$/.test(name),
    limits.maxPartBytes,
  );
  const presentation = parts.get("ppt/presentation.xml");
  if (!presentation) throw new Error("The presentation is missing or too large.");
  const rels = relationships(parts.get("ppt/_rels/presentation.xml.rels"), "ppt");
  const slides: Slide[] = [];
  for (const event of xmlEvents(presentation)) {
    if (event.type !== "open" || local(event.name) !== "sldId") continue;
    const path = rels.get(event.attrs["r:id"] ?? "");
    const xml = path ? parts.get(path) : undefined;
    if (!path || !xml) continue;
    const lines = paragraphs(xml);
    const file = path.slice(path.lastIndexOf("/") + 1);
    const slideRels = relationships(parts.get(`ppt/slides/_rels/${file}.rels`), "ppt/slides");
    const notesPath = [...slideRels.values()].find((target) => target.includes("notesSlides/"));
    const notesXml = notesPath ? parts.get(notesPath) : undefined;
    // Notes slides repeat the slide number placeholder; drop bare numbers.
    const notes = notesXml ? paragraphs(notesXml).filter((line) => !/^\d+$/.test(line)) : [];
    slides.push({ title: lines[0] ?? "", text: lines.join("\n"), notes: notes.join("\n") });
  }
  return slides;
}

// ── OpenDocument ────────────────────────────────────────────────────────

function odfContent(bytes: Uint8Array, limits: OfficeLimits): string {
  const content = readParts(bytes, (name) => name === "content.xml", limits.maxPartBytes).get(
    "content.xml",
  );
  if (!content) throw new Error("The document content is missing or too large.");
  return content;
}

/** ODT → Markdown (headings, list items, tables). */
export function odtToMarkdown(bytes: Uint8Array, limits: OfficeLimits): DocumentText {
  const xml = odfContent(bytes, limits);
  const blocks: string[] = [];
  const outline: string[] = [];
  let block: { text: string; heading?: number; list: boolean } | undefined;
  let listDepth = 0;
  const tables: { rows: string[][]; row: string[]; cell: string[] }[] = [];
  const emit = (line: string) => {
    const table = tables.at(-1);
    if (table) table.cell.push(line);
    else blocks.push(line);
  };
  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      const name = event.name;
      if (name === "text:list-item") listDepth += 1;
      else if (name === "text:h") {
        block = { text: "", heading: Number(event.attrs["text:outline-level"]) || 1, list: false };
      } else if (name === "text:p") block = { text: "", list: listDepth > 0 };
      else if (name === "text:s" && block)
        block.text += " ".repeat(Math.min(Number(event.attrs["text:c"]) || 1, 50));
      else if (name === "text:tab" && block) block.text += "\t";
      else if (name === "text:line-break" && block) block.text += "\n";
      else if (name === "table:table") tables.push({ rows: [], row: [], cell: [] });
      else if (name === "table:table-row" && tables.length) tables.at(-1)!.row = [];
      else if (name === "table:table-cell" && tables.length) tables.at(-1)!.cell = [];
    } else if (event.type === "close") {
      const name = event.name;
      if (name === "text:list-item") listDepth = Math.max(0, listDepth - 1);
      else if ((name === "text:p" || name === "text:h") && block) {
        const text = block.text.trim();
        if (text && block.heading) {
          outline.push(text);
          emit(tables.length ? text : `${"#".repeat(Math.min(6, block.heading))} ${text}`);
        } else if (text) emit(block.list && !tables.length ? `- ${text}` : text);
        block = undefined;
      } else if (name === "table:table-cell" && tables.length) {
        const table = tables.at(-1)!;
        table.row.push(table.cell.join(" "));
      } else if (name === "table:table-row" && tables.length) {
        const table = tables.at(-1)!;
        if (table.row.some(Boolean)) table.rows.push(table.row);
      } else if (name === "table:table" && tables.length) {
        const table = tables.pop()!;
        if (tables.length) tables.at(-1)!.cell.push(table.rows.map((r) => r.join(" ")).join(" "));
        else if (table.rows.length) blocks.push(markdownTable(table.rows));
      }
    } else if (block) {
      block.text += event.text;
    }
  }
  return { markdown: blocks.join("\n\n"), outline };
}

const MAX_REPEAT = 1_000;

export function odsSheets(bytes: Uint8Array, limits: OfficeLimits): AttachmentSheet[] {
  const xml = odfContent(bytes, limits);
  const sheets: AttachmentSheet[] = [];
  let sheet: AttachmentSheet | undefined;
  let row: string[] | undefined;
  let rowRepeat = 1;
  let pendingEmptyRows = 0;
  let cellRepeat = 1;
  let cellValue: string | undefined;
  let cellText: string[] = [];
  let inParagraph = false;
  let cells = 0;
  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      const name = event.name;
      if (name === "table:table") {
        if (sheets.length >= limits.maxSheets) {
          sheet = undefined;
          continue;
        }
        sheet = {
          name: event.attrs["table:name"] ?? `Sheet${sheets.length + 1}`,
          rows: [],
          totalRows: 0,
          totalColumns: 0,
        };
        sheets.push(sheet);
        pendingEmptyRows = 0;
      } else if (name === "table:table-row" && sheet) {
        row = [];
        rowRepeat = Math.max(1, Number(event.attrs["table:number-rows-repeated"]) || 1);
      } else if ((name === "table:table-cell" || name === "table:covered-table-cell") && row) {
        cellRepeat = Math.max(1, Number(event.attrs["table:number-columns-repeated"]) || 1);
        cellValue =
          event.attrs["office:value"] ??
          event.attrs["office:date-value"] ??
          event.attrs["office:time-value"] ??
          event.attrs["office:boolean-value"] ??
          event.attrs["office:string-value"];
        cellText = [];
      } else if (name === "text:p") {
        inParagraph = true;
        cellText.push("");
      }
    } else if (event.type === "close") {
      const name = event.name;
      if (name === "text:p") inParagraph = false;
      else if (
        (name === "table:table-cell" || name === "table:covered-table-cell") &&
        row &&
        sheet
      ) {
        const text = cellText.join("\n").trim() || cellValue || "";
        const repeat = Math.min(cellRepeat, MAX_REPEAT);
        for (let i = 0; i < repeat && row.length < 16_384; i++) row.push(text);
      } else if (name === "table:table-row" && row && sheet) {
        while (row.length && !row.at(-1)) row.pop();
        if (row.length === 0) {
          pendingEmptyRows += rowRepeat;
        } else {
          const repeat = Math.min(rowRepeat, MAX_REPEAT);
          for (let r = 0; r < repeat; r++) {
            if (cells + row.length > limits.maxCells) {
              sheet.truncated = true;
              break;
            }
            const gap = Math.min(pendingEmptyRows, MAX_REPEAT);
            for (let g = 0; g < gap; g++) sheet.rows.push([]);
            sheet.totalRows += pendingEmptyRows;
            pendingEmptyRows = 0;
            sheet.rows.push([...row]);
            sheet.totalRows += 1;
            cells += row.length;
            sheet.totalColumns = Math.max(sheet.totalColumns, row.length);
          }
        }
        row = undefined;
      } else if (name === "table:table") sheet = undefined;
    } else if (inParagraph && row) {
      cellText[cellText.length - 1] += event.text;
    }
  }
  return sheets;
}

/** ODP pages: their text and speaker notes. */
export function odpSlides(bytes: Uint8Array, limits: OfficeLimits): Slide[] {
  const xml = odfContent(bytes, limits);
  const slides: Slide[] = [];
  let slide: { lines: string[]; notes: string[] } | undefined;
  let inNotes = false;
  let line: string | undefined;
  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      if (event.name === "draw:page") slide = { lines: [], notes: [] };
      else if (event.name === "presentation:notes") inNotes = true;
      else if (event.name === "text:p" || event.name === "text:h") line = "";
      else if (event.name === "text:line-break" && line !== undefined) line += "\n";
      else if (event.name === "text:s" && line !== undefined) line += " ";
    } else if (event.type === "close") {
      if (event.name === "draw:page" && slide) {
        slides.push({
          title: slide.lines[0] ?? "",
          text: slide.lines.join("\n"),
          notes: slide.notes.join("\n"),
        });
        slide = undefined;
      } else if (event.name === "presentation:notes") inNotes = false;
      else if ((event.name === "text:p" || event.name === "text:h") && line !== undefined) {
        if (slide && line.trim()) (inNotes ? slide.notes : slide.lines).push(line.trim());
        line = undefined;
      }
    } else if (line !== undefined) {
      line += event.text;
    }
  }
  return slides;
}
