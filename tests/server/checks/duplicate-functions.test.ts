import { describe, expect, it } from "vite-plus/test";
import { duplicateFunctions } from "../../../scripts/check-duplicate-functions";

const GUARD = `value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined`;

describe("duplicate functions gate", () => {
  it("reports a helper written in two files, as a function or as an arrow", () => {
    const files = new Map([
      [
        "packages/a/src/one.ts",
        `function record(value: unknown): Record<string, unknown> | undefined {\n  return ${GUARD};\n}\n`,
      ],
      [
        "packages/b/src/two.ts",
        `export const record = (value: unknown): Record<string, unknown> | undefined =>\n  ${GUARD};\n`,
      ],
    ]);
    expect(duplicateFunctions(files)).toEqual([
      [
        { file: "packages/a/src/one.ts", name: "record", line: 1 },
        { file: "packages/b/src/two.ts", name: "record", line: 1 },
      ],
    ]);
  });

  it("passes two functions that share a name and differ in what they do", () => {
    const files = new Map([
      [
        "packages/a/src/one.ts",
        "function clip(text: string, max: number): string {\n  return text.length > max ? `${text.slice(0, max)}…` : text;\n}\n",
      ],
      [
        "packages/b/src/two.ts",
        'function clip(text: string, max: number): string {\n  const flat = text.replace(/\\s+/g, " ").trim();\n  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;\n}\n',
      ],
    ]);
    expect(duplicateFunctions(files)).toEqual([]);
  });
});
