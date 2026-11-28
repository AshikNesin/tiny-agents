import { z } from "zod";

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());
}

export function parseJson<T>(what: string, text: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${what} does not fit its shape: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function parseEach<T>(
  values: readonly unknown[],
  schema: z.ZodType<T>,
  onInvalid: (value: unknown, problem: string) => void,
): T[] {
  const kept: T[] = [];
  for (const value of values) {
    const parsed = schema.safeParse(value);
    if (parsed.success) kept.push(parsed.data);
    else onInvalid(value, z.prettifyError(parsed.error));
  }
  return kept;
}
