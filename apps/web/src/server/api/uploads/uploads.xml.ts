/**
 * A minimal, non-validating XML tokenizer for reading OOXML and ODF parts
 * (issue #58). It never resolves DTDs or external entities: DOCTYPEs are
 * skipped and only the five predefined entities and numeric references are
 * decoded, so a hostile document can't expand or reach out.
 */

export type XmlEvent =
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string }
  | { type: "text"; text: string };

const TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED[ref.toLowerCase()] ?? match;
  });
}

export function* xmlEvents(xml: string): Generator<XmlEvent> {
  // A fresh regex per walk: readers nest walks (a sheet inside its workbook).
  const token = new RegExp(TOKEN.source, "g");
  const attrPattern = new RegExp(ATTR.source, "g");
  for (let match = token.exec(xml); match; match = token.exec(xml)) {
    const [, cdata, slash, name, rawAttrs, selfClose, text] = match;
    if (cdata !== undefined) {
      yield { type: "text", text: cdata };
    } else if (name !== undefined) {
      if (slash) {
        yield { type: "close", name };
        continue;
      }
      const attrs: Record<string, string> = {};
      if (rawAttrs) {
        attrPattern.lastIndex = 0;
        for (let attr = attrPattern.exec(rawAttrs); attr; attr = attrPattern.exec(rawAttrs)) {
          attrs[attr[1]] = decodeEntities(attr[2] ?? attr[3] ?? "");
        }
      }
      yield { type: "open", name, attrs, selfClosing: selfClose === "/" };
      if (selfClose === "/") yield { type: "close", name };
    } else if (text !== undefined) {
      yield { type: "text", text: decodeEntities(text) };
    }
  }
}

/** The local part of a qualified name: `w:t` → `t`. */
export const local = (name: string) => name.slice(name.indexOf(":") + 1);
