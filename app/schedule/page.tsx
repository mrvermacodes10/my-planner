"use client";

import { useEffect, useMemo, useState } from "react";
import EventEditor, { type EventDraft } from "@/components/EventEditor";
import { callTool, tint, useChangeKey, type Occurrence } from "@/lib/client";
import { MONTHS, WEEKDAYS, addDays, compactRange, fromMin, localToday, mondayOf, time12, toMin } from "@/lib/dates";

const HOUR = 52; // pixels per hour

type Placed = Occurrence & { lane: number; lanes: number };

/** Put overlapping events side by side. */
function layout(items: Occurrence[]): Placed[] {
  const sorted = [...items].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const e of sorted) {
    if (toMin(e.startTime) >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    cluster.forEach((c) => (laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? 0, toMin(c.endTime))));
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane] > toMin(e.startTime)) lane++;
    cluster.push({ ...e, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, toMin(e.endTime));
  }
  if (cluster.length) flush();
  return out;
}

export default function SchedulePage() {
  const { key, fromAI } = useChangeKey();
  const [today, setToday] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [items, setItems] = useState<Occurrence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  useEffect(() => {
    const t = localToday();
    setToday(t);
    setWeekStart(mondayOf(t));
  }, []);

  useEffect(() => {
    if (!weekStart) return;
    callTool<{ occurrences: Occurrence[] }>("getEvents", { startDate: weekStart, endDate: addDays(weekStart, 6) })
      .then((r) => { setItems(r.occurrences); setError(null); })
      .catch((e) => setError(e.message));
  }, [weekStart, key]);

  const days = useMemo(() => (weekStart ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : []), [weekStart]);
  const firstHour = Math.min(7, ...items.map((e) => Math.floor(toMin(e.startTime) / 60)));
  const lastHour = Math.max(22, ...items.map((e) => Math.ceil(toMin(e.endTime) / 60)));
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

  if (!weekStart) return null;
  const [, m, d] = weekStart.split("-").map(Number);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-pencil">Week of</p>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{MONTHS[m - 1]} {d}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-full bg-white p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5" aria-label="Previous week">←</button>
            <button onClick={() => setWeekStart(mondayOf(localToday()))} className="rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink/5">This week</button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5" aria-label="Next week">→</button>
          </div>
          <button onClick={() => setDraft({ date: today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart, startTime: "17:00", endTime: "18:00" })}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85">Add event</button>
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl bg-berry/10 px-4 py-3 text-sm text-berry">{error}</p>}

      <div key={fromAI ? key : "manual"} className={`mt-8 overflow-x-auto rounded-[28px] bg-card p-3 sm:p-4 ${fromAI ? "settle" : ""}`}>
        <div className="grid min-w-[720px] grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
          <div />
          {days.map((day) => {
            const isToday = day === today;
            return (
              <div key={day} className="pb-3 text-center">
                <div className="text-xs text-pencil">{WEEKDAYS[new Date(day + "T00:00:00Z").getUTCDay()].slice(0, 3)}</div>
                <div className={`mx-auto mt-0.5 grid h-8 w-8 place-items-center rounded-full font-display text-base font-bold ${isToday ? "bg-hl" : ""}`}>
                  {Number(day.slice(8))}
                </div>
              </div>
            );
          })}

          <div className="relative" style={{ height: hours.length * HOUR }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-pencil" style={{ top: i * HOUR }}>
                {i === 0 ? "" : time12(fromMin(h * 60)).replace(":00", "")}
              </div>
            ))}
          </div>

          {days.map((day) => {
            const placed = layout(items.filter((e) => e.date === day));
            return (
              <div key={day}
                className={`relative border-l border-line/70 ${day === today ? "bg-hl/10" : ""}`}
                style={{
                  height: hours.length * HOUR,
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, var(--color-line) ${HOUR - 1}px, var(--color-line) ${HOUR}px)`,
                }}
                onClick={(ev) => {
                  if (ev.target !== ev.currentTarget) return;
                  const y = ev.nativeEvent.offsetY;
                  const start = Math.round((firstHour * 60 + (y / HOUR) * 60) / 30) * 30;
                  setDraft({ date: day, startTime: fromMin(Math.min(start, 22 * 60)), endTime: fromMin(Math.min(start + 60, 23 * 60 + 30)) });
                }}
              >
                {placed.map((e) => {
                  const top = ((toMin(e.startTime) - firstHour * 60) / 60) * HOUR;
                  const height = Math.max(22, ((toMin(e.endTime) - toMin(e.startTime)) / 60) * HOUR - 3);
                  return (
                    <button key={e.eventId + e.date} onClick={() => setDraft(e)}
                      className="absolute flex flex-col justify-start overflow-hidden rounded-xl px-2 py-1 text-left text-xs leading-tight text-ink ring-1 ring-black/5 hover:ring-ink/40"
                      style={{
                        top: top + 1, height,
                        left: `calc(${(e.lane / e.lanes) * 100}% + 3px)`,
                        width: `calc(${100 / e.lanes}% - 6px)`,
                        background: tint(e.category || e.title),
                      }}>
                      <span className="block truncate font-semibold">{e.emoji} {e.title}</span>
                      {height > 34 && (
                        <span className="block truncate text-ink/70">
                          {compactRange(e.startTime, e.endTime)}{e.recurring ? " ↻" : ""}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-3 text-sm text-pencil">Click an empty spot to add an event. ↻ means it repeats.</p>

      <EventEditor draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
