import { addDays, toMin, weekday } from "./dates";

export type EventRow = {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  recurrence: string; // none | daily | weekly
  recurrenceDays: string;
  recurrenceEnd: string | null;
  excludedDates: string;
  category: string | null;
  emoji: string | null;
  notes: string | null;
};

/** One concrete appearance of an event on a specific date. */
export type Occurrence = {
  eventId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  recurring: boolean;
  recurrence: string;
  daysOfWeek: number[];
  seriesStart: string;
  until: string | null;
  category: string | null;
  emoji: string | null;
  notes: string | null;
};

export const parseList = (s: string) => s.split(",").filter(Boolean);
export const parseDays = (s: string) =>
  parseList(s).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);

export function seriesDays(e: EventRow) {
  const days = parseDays(e.recurrenceDays);
  return days.length ? days : [weekday(e.date)];
}

export function occursOn(e: EventRow, date: string) {
  if (parseList(e.excludedDates).includes(date)) return false;
  if (e.recurrence === "none") return e.date === date;
  if (date < e.date) return false;
  if (e.recurrenceEnd && date > e.recurrenceEnd) return false;
  if (e.recurrence === "daily") return true;
  return seriesDays(e).includes(weekday(date));
}

export function toOccurrence(e: EventRow, date: string): Occurrence {
  return {
    eventId: e.id,
    title: e.title,
    date,
    startTime: e.startTime,
    endTime: e.endTime,
    recurring: e.recurrence !== "none",
    recurrence: e.recurrence,
    daysOfWeek: e.recurrence === "weekly" ? seriesDays(e) : [],
    seriesStart: e.date,
    until: e.recurrenceEnd,
    category: e.category,
    emoji: e.emoji,
    notes: e.notes,
  };
}

export function expand(events: EventRow[], start: string, end: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    for (const e of events) if (occursOn(e, d)) out.push(toOccurrence(e, d));
  }
  return out.sort((a, b) => (a.date === b.date ? toMin(a.startTime) - toMin(b.startTime) : a.date < b.date ? -1 : 1));
}
