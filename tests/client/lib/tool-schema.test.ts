import { describe, expect, it } from "vite-plus/test";
import {
  buildArgs,
  exampleArgs,
  hasOpenShape,
  initialValues,
  parseArgsJson,
  schemaFields,
  typeLabel,
  valuesFromArgs,
} from "@/components/connections/tool-schema";

const schema = {
  type: "object",
  properties: {
    limit: { type: "integer", description: "Max rows", default: 10 },
    query: { type: "string" },
    mode: { type: "string", enum: ["fast", "deep"] },
    tags: { type: "array", items: { type: "string" } },
    verbose: { type: ["boolean", "null"] },
  },
  required: ["query", "mode"],
};

describe("tool schema", () => {
  it("lists required fields first with readable types and kinds", () => {
    const fields = schemaFields(schema);
    expect(fields.map((f) => [f.name, f.type, f.kind, f.required])).toEqual([
      ["query", "string", "string", true],
      ["mode", '"fast" | "deep"', "enum", true],
      ["limit", "integer", "integer", false],
      ["tags", "string[]", "json", false],
      ["verbose", "boolean", "boolean", false],
    ]);
    expect(fields[2]).toMatchObject({ description: "Max rows", defaultValue: 10 });
    expect(typeLabel({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
  });

  it("builds arguments from form values, skipping empty optionals", () => {
    const fields = schemaFields(schema);
    expect(initialValues(fields)).toMatchObject({ limit: "10", query: "" });
    expect(buildArgs(fields, { query: "", mode: "", limit: "x" })).toEqual({
      ok: false,
      errors: { query: "Required", mode: "Required", limit: "Enter a whole number" },
    });
    expect(
      buildArgs(fields, { query: " ", mode: "deep", limit: "5", tags: '["a"]', verbose: "" }),
    ).toEqual({ ok: true, args: { query: " ", mode: "deep", limit: 5, tags: ["a"] } });
    expect(buildArgs(fields, { query: "q", mode: "fast", tags: "[" })).toEqual({
      ok: false,
      errors: { tags: "Enter valid JSON" },
    });
  });

  it("round-trips between the form and the JSON editor", () => {
    const fields = schemaFields(schema);
    expect(exampleArgs(fields)).toEqual({ query: "", mode: "fast", limit: 10 });
    expect(valuesFromArgs(fields, { query: "q", verbose: true, tags: ["a"] })).toMatchObject({
      query: "q",
      verbose: "true",
      tags: '[\n  "a"\n]',
      mode: "",
    });
    expect(parseArgsJson("")).toEqual({ ok: true, args: {} });
    expect(parseArgsJson("[1]")).toEqual({ ok: false, error: "Arguments must be a JSON object" });
    expect(parseArgsJson("{")).toMatchObject({ ok: false });
  });

  it("tells fixed schemas from open ones", () => {
    expect(hasOpenShape(schema)).toBe(false);
    expect(hasOpenShape({ type: "object" })).toBe(true);
    expect(hasOpenShape({ type: "object", properties: {}, additionalProperties: false })).toBe(
      false,
    );
  });
});
