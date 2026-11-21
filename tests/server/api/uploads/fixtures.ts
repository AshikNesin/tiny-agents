import { strToU8, zipSync, type Zippable } from "fflate";

export function pdf(pages: string[], info?: { title?: string }): Uint8Array {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  if (info?.title) objects.push(`<< /Title (${info.title}) >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  const infoRef = info?.title ? ` /Info ${objects.length} 0 R` : "";
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const zip = (files: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])) as Zippable);

export function docx(body: string): Uint8Array {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
  });
}

export const para = (text: string, style?: string, list = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${list ? "<w:numPr/>" : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export function xlsx(): Uint8Array {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><t>Region</t></si><si><t>Revenue</t></si><si><r><t>No</t></r><r><t>rth</t></r></si><si><t>South</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1200</v></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><f>SUM(1,2)</f><v>3</v></c><c r="D3" t="inlineStr"><is><t>note</t></is></c></row>
</sheetData></worksheet>`,
    "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c></row></sheetData></worksheet>`,
  });
}

export function pptx(): Uint8Array {
  return zip({
    "[Content_Types].xml": "<Types/>",
    "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Roadmap</a:t></a:r></a:p><a:p><a:r><a:t>Ship Q3</a:t></a:r></a:p></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Intro</a:t></a:r></a:p></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    "ppt/notesSlides/notesSlide1.xml": `<p:notes xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Mention the budget</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>`,
  });
}

const odf = (mimetype: string, body: string) =>
  zip({
    mimetype,
    "content.xml": `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:text="t" xmlns:table="ta" xmlns:draw="d" xmlns:presentation="p"><office:body>${body}</office:body></office:document-content>`,
  });

export const odt = () =>
  odf(
    "application/vnd.oasis.opendocument.text",
    `<office:text><text:h text:outline-level="2">Scope</text:h><text:p>We build<text:s/>it.</text:p><text:list><text:list-item><text:p>First</text:p></text:list-item></text:list></office:text>`,
  );

export const ods = () =>
  odf(
    "application/vnd.oasis.opendocument.spreadsheet",
    `<office:spreadsheet><table:table table:name="Q3"><table:table-row><table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Count</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="2"><table:table-cell table:number-columns-repeated="2"/></table:table-row><table:table-row><table:table-cell><text:p>Ana</text:p></table:table-cell><table:table-cell office:value="7"><text:p>7</text:p></table:table-cell><table:table-cell table:number-columns-repeated="16000"/></table:table-row><table:table-row table:number-rows-repeated="1048570"><table:table-cell table:number-columns-repeated="1024"/></table:table-row></table:table></office:spreadsheet>`,
  );

export const odp = () =>
  odf(
    "application/vnd.oasis.opendocument.presentation",
    `<office:presentation><draw:page draw:name="p1"><draw:frame><draw:text-box><text:p>Welcome</text:p></draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>Smile</text:p></draw:text-box></draw:frame></presentation:notes></draw:page></office:presentation>`,
  );

export function tar(files: { name: string; data: string }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number, type: string) => {
    const block = new Uint8Array(512);
    block.set(strToU8(name.slice(0, 100)), 0);
    block.set(strToU8("0000644\0"), 100);
    block.set(strToU8(size.toString(8).padStart(11, "0") + "\0"), 124);
    block[156] = type.charCodeAt(0);
    block.set(strToU8("ustar\u000000"), 257);
    return block;
  };
  const pad = (data: Uint8Array) => {
    const out = new Uint8Array(Math.ceil(data.length / 512) * 512);
    out.set(data);
    return out;
  };
  for (const file of files) {
    const data = strToU8(file.data);
    if (file.name.length > 100) {
      const long = strToU8(`${file.name}\0`);
      blocks.push(header("././@LongLink", long.length, "L"), pad(long));
    }
    blocks.push(header(file.name, data.length, "0"), pad(data));
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}
