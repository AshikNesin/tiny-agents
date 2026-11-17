/** Number formats for the Code page (Shelley's own, so both read the same). */

/** "$0", "$0.0042", "$0.161", "$12.35". */
export function formatUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  if (v < 100) return `$${v.toFixed(2)}`;
  return `$${Math.round(v).toLocaleString()}`;
}

/** "12k", "2.5M". */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 999_500_000) return `${(tokens / 1e9).toFixed(1)}B`;
  if (tokens >= 999_500) return `${(tokens / 1e6).toFixed(1)}M`;
  if (tokens >= 1e3) return `${(tokens / 1e3).toFixed(0)}k`;
  return String(tokens);
}

/** "$1.40/M", "$0.079/M" — a band's unit price. */
export function formatUnitPrice(usdPerMtok: number): string {
  let s: string;
  if (Number.isInteger(usdPerMtok)) s = String(usdPerMtok);
  else if (usdPerMtok >= 0.1) s = usdPerMtok.toFixed(2);
  else s = usdPerMtok.toPrecision(2).replace(/\.?0+$/, "");
  return `$${s}/M`;
}

/** "850ms", "4.2s", "1m 12s", "2h 5m". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
