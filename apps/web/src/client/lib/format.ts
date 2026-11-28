const compactCount = new Intl.NumberFormat("en-US", { notation: "compact" });

export interface DurationFormat {
  precision?: "tenths" | "seconds";
}

export function formatDuration(ms: number, { precision = "tenths" }: DurationFormat = {}): string {
  const whole = Math.max(0, Math.round(ms));
  const seconds = Math.round(whole / 1000);
  const tenths = Math.round(whole / 100);
  if (precision === "seconds" && seconds < 60) return `${seconds}s`;
  if (precision === "tenths" && whole < 1000) return `${whole}ms`;
  if (precision === "tenths" && tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTokens(tokens: number): string {
  return compactCount.format(Math.max(0, Math.round(tokens)));
}

export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}
