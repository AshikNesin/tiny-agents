/** How Traces writes numbers: compact tokens, dollars, durations, day labels. */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 950, 12.3K, 4.1M. */
export function formatTokens(value: number): string {
  return compact.format(Math.round(value));
}

/** $0.00, $0.0042, $1.23. Small amounts keep two significant digits. */
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toPrecision(2)}`;
  return `$${usd.toFixed(2)}`;
}

/** 850 ms, 3.2 s, 2m 05s. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1_000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function formatTime(at: number): string {
  return time.format(new Date(at));
}

/** "Today", "Yesterday", or "Mon, 16 Nov". */
export function dayLabel(at: number, now = Date.now()): string {
  const start = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.format(new Date(at));
}

/** Items grouped under their day label, in the order given. */
export function byDay<T>(items: readonly T[], at: (item: T) => number): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const item of items) {
    const label = dayLabel(at(item));
    const last = groups.at(-1);
    if (last && last[0] === label) last[1].push(item);
    else groups.push([label, [item]]);
  }
  return groups;
}
