import { parseJson } from "@tiny-agents/std";
import { z } from "zod";
type Schema = Record<string, unknown>;

type FieldKind = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export interface SchemaField {
  name: string;
  type: string;
  kind: FieldKind;
  required: boolean;
  description?: string;
  options?: string[];
  defaultValue?: unknown;
}

export type FieldValues = Record<string, string>;

function isSchema(value: unknown): value is Schema {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function variants(schema: Schema): Schema[] {
  const union = (schema.anyOf ?? schema.oneOf) as unknown;
  if (Array.isArray(union)) {
    return union.filter(isSchema).filter((branch) => branch.type !== "null");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .filter((type): type is string => typeof type === "string" && type !== "null")
      .map((type) => ({ ...schema, type }));
  }
  return [schema];
}

export function typeLabel(schema: unknown): string {
  if (!isSchema(schema)) return "any";
  if (Array.isArray(schema.enum)) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if ("const" in schema) return JSON.stringify(schema.const);
  const branches = variants(schema);
  if (branches.length !== 1) return branches.map(typeLabel).join(" | ") || "any";
  const [only] = branches;
  if (only !== schema) return typeLabel(only);
  if (schema.type === "array") return `${typeLabel(schema.items)}[]`;
  return typeof schema.type === "string" ? schema.type : "any";
}

function kindOf(schema: Schema): Pick<SchemaField, "kind" | "options"> {
  const branches = variants(schema);
  if (branches.length !== 1) return { kind: "json" };
  const [only] = branches;
  if (Array.isArray(only.enum) && only.enum.every((v) => typeof v === "string")) {
    return { kind: "enum", options: only.enum as string[] };
  }
  switch (only.type) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return { kind: only.type };
    default:
      return { kind: "json" };
  }
}

export function schemaFields(schema: unknown): SchemaField[] {
  if (!isSchema(schema) || !isSchema(schema.properties)) return [];
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((n) => typeof n === "string") : [],
  );
  const fields = Object.entries(schema.properties).map(([name, raw]): SchemaField => {
    const property = isSchema(raw) ? raw : {};
    return {
      name,
      type: typeLabel(property),
      ...kindOf(property),
      required: required.has(name),
      ...(typeof property.description === "string" ? { description: property.description } : {}),
      ...("default" in property ? { defaultValue: property.default } : {}),
    };
  });
  return [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)];
}

export function hasOpenShape(schema: unknown): boolean {
  if (!isSchema(schema)) return true;
  const fixed = isSchema(schema.properties) && Object.keys(schema.properties).length > 0;
  return !fixed && schema.additionalProperties !== false;
}

export function initialValues(fields: SchemaField[]): FieldValues {
  return valuesFromArgs(
    fields,
    Object.fromEntries(fields.map((field) => [field.name, field.defaultValue])),
  );
}

export function exampleArgs(fields: SchemaField[]): Record<string, unknown> {
  const example: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.required && field.defaultValue === undefined) continue;
    if (field.defaultValue !== undefined) example[field.name] = field.defaultValue;
    else if (field.kind === "number" || field.kind === "integer") example[field.name] = 0;
    else if (field.kind === "boolean") example[field.name] = false;
    else if (field.kind === "enum") example[field.name] = field.options?.[0] ?? "";
    else if (field.kind === "json") example[field.name] = field.type.endsWith("[]") ? [] : {};
    else example[field.name] = "";
  }
  return example;
}

export type BuildResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

export function buildArgs(fields: SchemaField[], values: FieldValues): BuildResult {
  const args: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const raw = values[field.name] ?? "";
    if (field.kind === "string" ? raw === "" : raw.trim() === "") {
      if (field.required) errors[field.name] = "Required";
      continue;
    }
    switch (field.kind) {
      case "number":
      case "integer": {
        const number = Number(raw);
        if (!Number.isFinite(number) || (field.kind === "integer" && !Number.isInteger(number))) {
          errors[field.name] = field.kind === "integer" ? "Enter a whole number" : "Enter a number";
        } else args[field.name] = number;
        break;
      }
      case "boolean":
        args[field.name] = raw === "true";
        break;
      case "json":
        try {
          args[field.name] = parseJson("A JSON argument", raw, z.unknown());
        } catch {
          errors[field.name] = "Enter valid JSON";
        }
        break;
      default:
        args[field.name] = raw;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, args };
}

export function valuesFromArgs(fields: SchemaField[], args: Record<string, unknown>): FieldValues {
  return Object.fromEntries(
    fields.map((field) => {
      const value = args[field.name];
      if (value === undefined || value === null) return [field.name, ""];
      if (field.kind === "json") return [field.name, JSON.stringify(value, null, 2)];
      return [field.name, typeof value === "string" ? value : JSON.stringify(value)];
    }),
  );
}

export function parseArgsJson(
  text: string,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: true, args: {} };
  try {
    const value = parseJson("The arguments", text, z.unknown());
    if (!isSchema(value)) return { ok: false, error: "Arguments must be a JSON object" };
    return { ok: true, args: value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}
