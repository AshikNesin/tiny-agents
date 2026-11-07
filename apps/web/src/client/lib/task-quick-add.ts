/**
 * Quick-add shorthand for tasks (issue #97): "Call mom tomorrow 5pm !high"
 * becomes the title "Call mom", due tomorrow at 17:00, high priority. Only a
 * few unambiguous words are read, and only as whole words, so a title like
 * "Plan Monday meeting notes" keeps its words unless they parse as a date.
 */
type QuickPriority = "low" | "medium" | "high";

export interface QuickTask {
  title: string;
  /** Local due instant, when a day or time was given. */
  due?: Date;
  priority?: QuickPriority;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const PRIORITIES: Record<string, QuickPriority> = {
  "!high": "high",
  "!h": "high",
  "!medium": "medium",
  "!m": "medium",
  "!low": "low",
  "!l": "low",
};

/** "5pm", "5:30pm", "17:00", optionally after "at"; returns [hours, minutes]. */
function parseTime(token: string): [number, number] | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(token);
  if (!m) return undefined;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (!meridiem && !m[2]) return undefined; // a bare number is part of the title
  if (minutes > 59) return undefined;
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  } else if (hours > 23) {
    return undefined;
  }
  return [hours, minutes];
}

export function parseQuickTask(input: string, now = new Date()): QuickTask {
  const words = input.trim().split(/\s+/);
  const kept: string[] = [];
  let priority: QuickPriority | undefined;
  let day: Date | undefined;
  let time: [number, number] | undefined;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase();
    if (PRIORITIES[lower]) {
      priority = PRIORITIES[lower];
      continue;
    }
    if (!day && (lower === "today" || lower === "tonight")) {
      day = new Date(now);
      if (lower === "tonight" && !time) time = [20, 0];
      continue;
    }
    if (!day && lower === "tomorrow") {
      day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      continue;
    }
    const weekday = WEEKDAYS.findIndex((name) => name === lower || name.slice(0, 3) === lower);
    if (!day && weekday !== -1) {
      const ahead = (weekday - now.getDay() + 7) % 7 || 7;
      day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead);
      continue;
    }
    const next = words[i + 1];
    if (!time && lower === "at" && next && parseTime(next)) {
      time = parseTime(next);
      i += 1;
      continue;
    }
    if (!time && parseTime(word)) {
      time = parseTime(word);
      continue;
    }
    kept.push(word);
  }

  const title = kept.join(" ");
  // Nothing left for a title: the shorthand was the title after all.
  if (!title) return { title: input.trim() };
  if (!day && !time) return { title, ...(priority ? { priority } : {}) };

  const base = day ?? new Date(now);
  const [hours, minutes] = time ?? [23, 59];
  let due = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes);
  // A time alone that has already passed today means tomorrow.
  if (!day && due.getTime() <= now.getTime()) {
    due = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1, hours, minutes);
  }
  return { title, due, ...(priority ? { priority } : {}) };
}
