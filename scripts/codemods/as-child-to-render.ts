#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { parseSync } from "oxc-parser";

type Span = { start: number; end: number };
type Attr = Span & { type: string; name?: Span & { type: string; name?: string }; value?: unknown };
type Opening = Span & { name: Span; attributes: Attr[]; selfClosing: boolean };
type Jsx = Span & {
  type: "JSXElement";
  openingElement: Opening;
  closingElement: (Span & { type: string }) | null;
  children: (Span & { type: string; value?: string })[];
};
type Edit = Span & { text: string };

const isJsx = (node: unknown): node is Jsx =>
  typeof node === "object" && node !== null && (node as { type?: string }).type === "JSXElement";

function walk(node: unknown, visit: (n: Jsx) => boolean) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  if (isJsx(node) && visit(node)) return;
  for (const value of Object.values(node)) {
    if (typeof value === "object") walk(value, visit);
  }
}

function rewriteAsChild(source: string, tags: Set<string>, file: string) {
  const { program } = parseSync(file, source);
  const text = (span: Span) => source.slice(span.start, span.end);
  const lineOf = (pos: number) => source.slice(0, pos).split("\n").length;
  const edits: Edit[] = [];
  const skipped: string[] = [];

  walk(program, (node) => {
    const opening = node.openingElement;
    const name = text(opening.name);
    if (!tags.has(name)) return false;
    const attr = opening.attributes.find(
      (a) => a.type === "JSXAttribute" && a.name?.name === "asChild",
    );
    if (!attr) return false;
    const where = `${file}:${lineOf(node.start)} <${name}>`;
    if (attr.value) {
      skipped.push(`${where} has a conditional asChild`);
      return false;
    }
    const kids = node.children.filter(
      (c) => !(c.type === "JSXText" && (c.value ?? "").trim() === ""),
    );
    const child = kids[0];
    if (kids.length !== 1 || !isJsx(child)) {
      skipped.push(`${where} does not wrap exactly one element`);
      return false;
    }
    const rest = opening.attributes.filter((a) => a !== attr).map(text);
    const childOpening = child.openingElement;
    const renderEl = `<${[text(childOpening.name), ...childOpening.attributes.map(text)].join(" ")} />`;
    const head = [name, ...rest, `render={${renderEl}}`].join(" ");
    const replacement =
      child.closingElement && !childOpening.selfClosing
        ? `<${head}>${source.slice(childOpening.end, child.closingElement.start)}</${name}>`
        : `<${head} />`;
    edits.push({ start: node.start, end: node.end, text: replacement });
    return true;
  });

  let out = source;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { source: out, count: edits.length, skipped };
}

const tagsArg = process.argv.find((a) => a.startsWith("--tags="));
if (!tagsArg) {
  console.error("usage: tsx scripts/codemods/as-child-to-render.ts --tags=Button,Badge [files…]");
  process.exit(1);
}
const tags = new Set(tagsArg.slice("--tags=".length).split(",").filter(Boolean));
const fileArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = fileArgs.length
  ? fileArgs
  : execFileSync("git", ["ls-files", "--", "apps/*.tsx", "packages/*.tsx", "tests/*.tsx"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

let total = 0;
const allSkipped: string[] = [];
for (const file of files) {
  let source = readFileSync(file, "utf8");
  let fileCount = 0;
  for (;;) {
    const result = rewriteAsChild(source, tags, file);
    if (result.count === 0) {
      allSkipped.push(...result.skipped);
      break;
    }
    source = result.source;
    fileCount += result.count;
  }
  if (fileCount > 0) {
    writeFileSync(file, source);
    total += fileCount;
  }
}
console.log(`as-child-to-render: rewrote ${total} element(s)`);
for (const line of allSkipped) console.log(`  skipped ${line}`);
