export const FIXED_NOW = "2026-11-06T06:30:00.000Z";

export function futureIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
