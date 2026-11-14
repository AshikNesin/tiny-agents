import { appEnv } from "./env";

/**
 * A frozen clock for deterministic verify runs (docs/rewrite/PLAN.md, Phase
 * 0.6): `TINY_AGENTS_FIXED_NOW=<ISO instant>` freezes `Date` in the server,
 * the way the server tests freeze it (tests/test-clock.ts), so every page
 * shows the same dates on every run. Timers still run on real time.
 *
 * Honored only with `TINY_AGENTS_FAUX=1` (the scripted model): a server that
 * talks to real models or real people never runs on a frozen clock. Returns
 * the frozen instant when it applied.
 */
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
