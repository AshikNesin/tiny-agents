import { gzipSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import {
  extract,
  htmlToText,
  paginate,
  parseDelimited,
} from "../../../../apps/web/src/server/api/uploads/uploads.extract";
import {
  docxToMarkdown,
  xlsxSheets,
} from "../../../../apps/web/src/server/api/uploads/uploads.office";
import { listTgz, listZip } from "../../../../apps/web/src/server/api/uploads/uploads.archive";
import {
  decodeText,
  sniffFile,
  SniffError,
} from "../../../../apps/web/src/server/api/uploads/uploads.sniff";
import { docx, odp, ods, odt, para, pdf, pptx, tar, xlsx } from "./fixtures";

const ready = async (input: Parameters<typeof extract>[0], mime?: string) => {
  const result = await extract(input, mime);
  if (result.status !== "ready") throw new Error(`not ready: ${result.error}`);
  return result;
};

describe("sniffFile", () => {
  it("names each family by its bytes", () => {
    expect(sniffFile(pdf(["hi"]), "pdf")).toEqual({ mime: "application/pdf", kind: "pdf" });
    expect(sniffFile(docx(para("x")), "docx").kind).toBe("docx");
    expect(sniffFile(xlsx(), "xlsx").kind).toBe("xlsx");
    expect(sniffFile(odt(), "odt").kind).toBe("odt");
    expect(sniffFile(strToU8("a,b\n1,2"), "csv")).toEqual({ mime: "text/csv", kind: "csv" });
    expect(sniffFile(strToU8("print('hi')"), "py")).toEqual({ mime: "text/plain", kind: "text" });
    expect(sniffFile(gzipSync("x"), "gz").kind).toBe("gz");
    expect(sniffFile(tar([{ name: "a.txt", data: "a" }]), "tar").kind).toBe("tar");
  });

  it("refuses executables under any name", () => {
    const pe = new Uint8Array(128);
    pe.set(strToU8("MZ"), 0);
    pe[0x3c] = 64;
    pe.set(strToU8("PE\0\0"), 64);
    expect(() => sniffFile(pe, "pdf")).toThrow(SniffError);
    expect(() => sniffFile(strToU8("\x7fELF..."), "txt")).toThrow("Executable");
  });

  it("refuses a PE whose e_lfanew reads as a negative offset", () => {
    const pe = new Uint8Array(0x80000100);
    pe.set(strToU8("MZ"), 0);
    const offset = 0x80000040;
    pe[0x3c] = offset & 0xff;
    pe[0x3d] = (offset >>> 8) & 0xff;
    pe[0x3e] = (offset >>> 16) & 0xff;
    pe[0x3f] = (offset >>> 24) & 0xff;
    pe.set(strToU8("PE\0\0"), offset);
    expect(() => sniffFile(pe, "pdf")).toThrow("Executable");
  });

  it("refuses bytes that disagree with the extension", () => {
    expect(() => sniffFile(strToU8("not a pdf"), "pdf")).toThrow(SniffError);
    expect(() => sniffFile(zipSync({ "a.txt": strToU8("a") }), "docx")).toThrow(SniffError);
    expect(() => sniffFile(new Uint8Array([0x41, 0x00, 0x42]), "csv")).toThrow(SniffError);
  });

  it("keeps text that merely starts with MZ", () => {
    expect(sniffFile(strToU8("MZ notes about the release"), "txt").kind).toBe("text");
  });

  it("decodes UTF-8, UTF-16 and legacy Windows-1252 text", () => {
    expect(decodeText(strToU8("héllo"))).toBe("héllo");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]))).toBe("hi");
  });
});

describe("extract", () => {
  it("pages plain text and outlines Markdown", async () => {
    const md = `# Intro\n${"word ".repeat(5000)}\n## Details\nmore`;
    const result = await ready({ bytes: strToU8(md), kind: "text", name: "notes.md" });
    expect(result.content.outline).toEqual(["Intro", "Details"]);
    expect(result.content.pages.length).toBeGreaterThan(1);
    expect(result.content.pages.every((page) => page.text.length <= 16_000)).toBe(true);
    expect(result.meta).toMatchObject({ format: "text", lines: 4 });
  });

  it("checks JSON and YAML and pretty-prints JSON", async () => {
    const json = await ready({ bytes: strToU8('{"a":[1,2]}'), kind: "json", name: "a.json" });
    expect(json.meta.valid).toBe(true);
    expect(json.content.pages[0].text).toContain('"a": [\n');
    const bad = await ready({ bytes: strToU8("{oops"), kind: "json", name: "b.json" });
    expect(bad.meta.valid).toBe(false);
    const yaml = await ready({ bytes: strToU8("a: [1, 2"), kind: "yaml", name: "c.yaml" });
    expect(yaml.meta.valid).toBe(false);
  });

  it("reads HTML as text, never running or keeping scripts", () => {
    const { text, title } = htmlToText(
      `<html><head><title>Doc</title><style>p{}</style></head><body><h1>Hi</h1><p>A &amp; B</p><script>alert(1)</script></body></html>`,
    );
    expect(title).toBe("Doc");
    expect(text).toContain("# Hi");
    expect(text).toContain("A & B");
    expect(text).not.toContain("alert");
  });

  it("parses CSV with quotes into a sheet", async () => {
    expect(parseDelimited('a,"b,c"\n"say ""hi""",2\n', ",", 100).rows).toEqual([
      ["a", "b,c"],
      ['say "hi"', "2"],
    ]);
    const result = await ready({
      bytes: strToU8("name,total\nAna,3\n"),
      kind: "csv",
      name: "sales.csv",
    });
    expect(result.content.sheets?.[0]).toMatchObject({
      name: "sales",
      totalRows: 2,
      totalColumns: 2,
    });
  });

  it("extracts PDF pages, outline-free, with metadata", async () => {
    const result = await ready({
      bytes: pdf(["Definitions apply", "Termination after notice"], { title: "Contract" }),
      kind: "pdf",
      name: "contract.pdf",
    });
    expect(result.content.pages).toEqual([
      { label: "page 1", text: "Definitions apply" },
      { label: "page 2", text: "Termination after notice" },
    ]);
    expect(result.meta).toMatchObject({ format: "pdf", pages: 2, title: "Contract" });
  });

  it("fails cleanly on a damaged PDF", async () => {
    const result = await extract({
      bytes: strToU8("%PDF-1.4 garbage"),
      kind: "pdf",
      name: "x.pdf",
    });
    expect(result).toEqual({
      status: "failed",
      error: expect.stringContaining("could not be read"),
    });
  });

  it("turns DOCX into Markdown with headings, lists and tables", async () => {
    const body =
      para("Termination", "Heading1") +
      para("Either party may end it &amp; leave.") +
      para("Thirty days notice", undefined, true) +
      `<w:tbl><w:tr><w:tc>${para("Party")}</w:tc><w:tc>${para("Days")}</w:tc></w:tr><w:tr><w:tc>${para("Ana")}</w:tc><w:tc>${para("30")}</w:tc></w:tr></w:tbl>`;
    const result = await ready({ bytes: docx(body), kind: "docx", name: "spec.docx" });
    expect(result.content.outline).toEqual(["Termination"]);
    expect(result.content.pages[0].text).toBe(
      "# Termination\n\nEither party may end it & leave.\n\n- Thirty days notice\n\n| Party | Days |\n| --- | --- |\n| Ana | 30 |",
    );
  });

  it("reads XLSX sheets: shared strings, cached formula values, hidden sheets", async () => {
    const result = await ready({ bytes: xlsx(), kind: "xlsx", name: "sales.xlsx" });
    const [sales, secret] = result.content.sheets!;
    expect(sales).toMatchObject({ name: "Sales", totalRows: 3, totalColumns: 4 });
    expect(sales.rows).toEqual([
      ["Region", "Revenue"],
      ["North", "1200"],
      ["South", "3", "", "note"],
    ]);
    expect(secret).toMatchObject({ name: "Secret", hidden: true, rows: [["TRUE"]] });
    expect(result.meta.sheets).toBe(2);
  });

  it("reads PPTX slides in presentation order with speaker notes", async () => {
    const result = await ready({ bytes: pptx(), kind: "pptx", name: "deck.pptx" });
    expect(result.content.pages).toEqual([
      { label: "slide 1", text: "Intro" },
      { label: "slide 2", text: "Roadmap\nShip Q3\n\nNotes: Mention the budget" },
    ]);
    expect(result.content.outline).toEqual(["1. Intro", "2. Roadmap"]);
  });

  it("reads ODT, ODS (without expanding repeated empties) and ODP", async () => {
    const text = await ready({ bytes: odt(), kind: "odt", name: "a.odt" });
    expect(text.content.pages[0].text).toBe("## Scope\n\nWe build it.\n\n- First");
    const sheet = await ready({ bytes: ods(), kind: "ods", name: "a.ods" });
    expect(sheet.content.sheets![0].rows).toEqual([["Name", "Count"], [], [], ["Ana", "7"]]);
    const slides = await ready({ bytes: odp(), kind: "odp", name: "a.odp" });
    expect(slides.content.pages[0].text).toBe("Welcome\n\nNotes: Smile");
  });

  it("lists zips without inflating them and flags bombs and traversal", async () => {
    const archive = zipSync({
      "docs/readme.md": strToU8("hello"),
      "../escape.sh": strToU8("x"),
      "zeros.bin": new Uint8Array(5 * 1024 * 1024),
      "inner.zip": zipSync({ "a.txt": strToU8("a") }),
    });
    const result = await ready({ bytes: archive, kind: "zip", name: "p.zip" });
    const byPath = new Map(result.content.entries!.map((entry) => [entry.path, entry]));
    expect(byPath.get("docs/readme.md")).toMatchObject({ size: 5 });
    expect(byPath.get("docs/readme.md")?.flag).toBeUndefined();
    expect(byPath.get("../escape.sh")?.flag).toContain("escapes the archive");
    expect(byPath.get("zeros.bin")?.flag).toContain("compression ratio");
    expect(byPath.get("inner.zip")?.flag).toContain("nested archive");

    const capped = listZip(archive, { maxEntries: 2, maxTotalBytes: 1024, maxRatio: 100 });
    expect(capped.entries).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    expect(capped.suspicious).toContain("uncompressed");
  });

  it("lists tar and tgz archives, long names included", async () => {
    const long = `${"deep/".repeat(30)}file.txt`;
    const archive = tar([
      { name: "a.txt", data: "alpha" },
      { name: long, data: "beta" },
    ]);
    const plain = await ready({ bytes: archive, kind: "tar", name: "a.tar" });
    expect(plain.content.entries).toEqual([
      { path: "a.txt", size: 5 },
      { path: long, size: 4 },
    ]);
    const gz = await ready({ bytes: gzipSync(archive), kind: "tgz", name: "a.tgz" });
    expect(gz.content.entries?.map((e) => e.path)).toEqual(["a.txt", long]);
  });

  it("stops a tgz that expands past the cap", async () => {
    const big = tar([
      { name: "one.bin", data: "x".repeat(2 * 1024 * 1024) },
      { name: "two.bin", data: "y".repeat(2 * 1024 * 1024) },
    ]);
    const listing = await listTgz(gzipSync(big), {
      maxEntries: 100,
      maxTotalBytes: 1024 * 1024,
      maxRatio: 100,
    });
    expect(listing.entries.map((e) => e.path)).toEqual(["one.bin"]);
    expect(listing).toMatchObject({ truncated: true, suspicious: expect.stringContaining("MB") });
  });

  it("names a single gzip file from its header", async () => {
    const result = await ready({ bytes: gzipSync("hello world"), kind: "gz", name: "log.txt.gz" });
    expect(result.content.entries).toEqual([
      { path: "log.txt", size: 11, compressedSize: expect.any(Number) },
    ]);
  });

  it("settles types it can't read", async () => {
    expect(
      await extract({ bytes: new Uint8Array(), kind: "unsupported", name: "a.mp3" }, "audio/mpeg"),
    ).toEqual({ status: "unsupported", error: "Audio and video can't be read here yet" });
  });

  it("paginates on line boundaries and cuts giant lines", () => {
    const { pages } = paginate(`${"a".repeat(40_000)}\nshort`, 16_000);
    expect(pages.every((page) => page.text.length <= 16_000)).toBe(true);
    expect(pages.at(-1)?.text.endsWith("short")).toBe(true);
  });

  it("reads an honest document within the part budget", () => {
    const limits = {
      maxSheets: 20,
      maxCells: 200_000,
      maxPartBytes: 1024 * 1024,
      maxTotalPartBytes: 128 * 1024 * 1024,
    };
    const { markdown } = docxToMarkdown(docx(para("hello")), limits);
    expect(markdown).toBe("hello");
  });

  it("rejects a zip that lies about its uncompressed size", () => {
    const limits = {
      maxSheets: 20,
      maxCells: 200_000,
      maxPartBytes: 256 * 1024,
      maxTotalPartBytes: 128 * 1024 * 1024,
    };
    const honest = zipSync({ "word/document.xml": strToU8(`${"a".repeat(1024 * 1024)}END`) });
    const view = new DataView(honest.buffer, honest.byteOffset, honest.byteLength);
    let central = -1;
    for (let i = 0; i < honest.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) central = i;
    expect(central).toBeGreaterThan(0);
    const lying = new Uint8Array(honest);
    const patched = new DataView(lying.buffer);
    patched.setUint32(22, 1, true);
    patched.setUint32(central + 24, 1, true);
    expect(() => docxToMarkdown(lying, limits)).toThrow(/past the reading limit/i);
  });

  it("caps the total inflated bytes across every part of one workbook", () => {
    const limits = {
      maxSheets: 20,
      maxCells: 200_000,
      maxPartBytes: 512 * 1024,
      maxTotalPartBytes: 700 * 1024,
    };
    const sheet = `<worksheet><sheetData><row><c><v>${"9".repeat(256 * 1024)}</v></c></row></sheetData></worksheet>`;
    const book = zipSync({
      "xl/workbook.xml": strToU8("<workbook/>"),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
      "xl/worksheets/sheet2.xml": strToU8(sheet),
      "xl/worksheets/sheet3.xml": strToU8(sheet),
    });
    expect(() => xlsxSheets(book, limits)).toThrow(/past the reading limit/i);
  });

  it("stops a highly compressible part at the observed byte cap", () => {
    const limits = {
      maxSheets: 20,
      maxCells: 200_000,
      maxPartBytes: 256 * 1024,
      maxTotalPartBytes: 128 * 1024 * 1024,
    };
    const bomb = zipSync({ "word/document.xml": strToU8(`${"B".repeat(8 * 1024 * 1024)}END`) });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => docxToMarkdown(bomb, limits)).toThrow(/past the reading limit/i);
  });
});
