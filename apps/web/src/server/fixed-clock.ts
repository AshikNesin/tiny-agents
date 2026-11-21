import { appEnv } from "./env";

export function installFixedClock(source: Record<string, string | undefined>): string | undefined {
  const vars = appEnv(source);
  const iso = vars.TINY_AGENTS_FIXED_NOW;
  if (!iso || vars.TINY_AGENTS_FAUX !== "1") return undefined;
  const fixed = Date.parse(iso);
  if (Number.isNaN(fixed)) throw new Error(`TINY_AGENTS_FIXED_NOW is not a date: ${iso}`);
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static override now(): number {
      return fixed;
    }
  }
  globalThis.Date = FixedDate as DateConstructor;
  return new RealDate(fixed).toISOString();
}
