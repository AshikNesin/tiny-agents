import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

dayjs.extend(relativeTime);

type DateInput = Date | string | number;

function toDayjs(date: DateInput): dayjs.Dayjs {
  return dayjs(date);
}

export function formatDate(date: DateInput): string {
  return toDayjs(date).format("YYYY-MM-DD");
}

export function formatDisplayDate(date: DateInput): string {
  return toDayjs(date).format("MMM D, YYYY");
}

export function formatLocaleDateTime(date: DateInput): string {
  return toDayjs(date).format("M/D/YYYY, h:mm:ss A");
}

export function formatRelativeTime(date: DateInput): string {
  return toDayjs(date).fromNow();
}

export function startOfDay(date: DateInput): Date {
  return toDayjs(date).startOf("day").toDate();
}

export function endOfDay(date: DateInput): Date {
  return toDayjs(date).endOf("day").toDate();
}

export function startOfMonth(date: DateInput): Date {
  return toDayjs(date).startOf("month").toDate();
}

export function subtractDays(date: DateInput, days: number): Date {
  return toDayjs(date).subtract(days, "day").toDate();
}

export function formatDuration(start: DateInput, end: DateInput): string {
  const duration = toDayjs(end).diff(toDayjs(start), "second", true);
  return `${duration.toFixed(2)}s`;
}
