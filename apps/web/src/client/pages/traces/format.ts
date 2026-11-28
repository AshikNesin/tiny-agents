const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function formatTime(at: number): string {
  return time.format(new Date(at));
}

export function dayLabel(at: number, now = Date.now()): string {
  const start = (value: number) => new Date(value).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.format(new Date(at));
}

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
