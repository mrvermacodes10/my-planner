"use client";

import type { ReactNode } from "react";
import { MONTHS, addDays, addMonths, mondayOf } from "@/lib/dates";

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * A reusable month grid (Monday first). It knows nothing about assessments: pass any items with a date and
 * say how to draw them, so other pages (or a week view later) can reuse it.
 */
export default function MonthCalendar<T>({
  month, today, items, getDate, renderItem, onMonthChange, onDayClick, emphasise,
}: {
  month: string; // first day of the month, YYYY-MM-01
  today: string;
  items: T[];
  getDate: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onMonthChange: (month: string) => void;
  onDayClick?: (date: string) => void;
  /** Extra classes for a day cell, e.g. to highlight busy days. */
  emphasise?: (date: string, dayItems: T[]) => string;
}) {
  const [y, m] = month.split("-").map(Number);
  const first = mondayOf(month);
  const last = addDays(addMonths(month, 1), -1);
  const days: string[] = [];
  for (let d = first; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);

  const byDate = new Map<string, T[]>();
  for (const it of items) {
    const d = getDate(it);
    byDate.set(d, [...(byDate.get(d) ?? []), it]);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold sm:text-2xl">{MONTHS[m - 1]} {y}</h2>
        <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <button onClick={() => onMonthChange(addMonths(month, -1))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5" aria-label="Previous month">←</button>
          <button onClick={() => onMonthChange(today.slice(0, 8) + "01")} className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink/5">This month</button>
          <button onClick={() => onMonthChange(addMonths(month, 1))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5" aria-label="Next month">→</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-pencil">
        {WEEK.map((w) => <div key={w} className="pb-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === month.slice(0, 7);
          const dayItems = byDate.get(d) ?? [];
          return (
            <div
              key={d}
              onClick={(e) => { if (e.target === e.currentTarget && onDayClick) onDayClick(d); }}
              className={`min-h-[4.5rem] rounded-xl p-1 text-left sm:min-h-[6rem] sm:p-1.5 ${
                inMonth ? "bg-paper/60" : "bg-transparent opacity-45"} ${onDayClick ? "cursor-pointer hover:bg-paper" : ""} ${
                emphasise?.(d, dayItems) ?? ""}`}
            >
              <div className="pointer-events-none flex items-center justify-between">
                <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                  d === today ? "bg-hl text-ink" : "text-ink/70"}`}>
                  {Number(d.slice(8))}
                </span>
                {dayItems.length > 1 && (
                  <span className="rounded-full bg-ink px-1.5 text-[10px] font-semibold leading-4 text-white">{dayItems.length}</span>
                )}
              </div>
              <div className="mt-1 space-y-1">{dayItems.map((it, i) => <div key={i}>{renderItem(it)}</div>)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
