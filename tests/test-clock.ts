/**
 * The instant `Date` reports in every test: both setup files pin it with
 * `vi.setSystemTime` before each test, so a fixture date written against it
 * reads the same on any real day. Timers stay real.
 */
export const FIXED_NOW = "2026-11-06T06:30:00.000Z";

/** An ISO instant `days` after the test's now, for fixtures that must stay in the future. */
export function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
