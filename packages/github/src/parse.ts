import { parseEach } from "@tiny-agents/std";
import { z } from "zod";

export type ReportInvalid = (what: string, problem: string) => void;

export const each =
  (what: string, report: ReportInvalid) =>
  <T>(schema: z.ZodType<T>) =>
    z
      .array(z.unknown())
      .transform((values) => parseEach(values, schema, (_value, problem) => report(what, problem)));
