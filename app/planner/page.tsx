"use client";

import { useEffect, useState } from "react";
import BlockEditor, { type BlockDraft } from "@/components/BlockEditor";
import { useView } from "@/components/ViewContext";
import { askAI, callTool, notifyChange, useChangeKey, type Block, type Occurrence, type Plan } from "@/lib/client";
import { addDays, diffDays, localNowTime, localToday, longDate, minutesLabel, time12, toMin } from "@/lib/dates";

function relativeLabel(date: string, today: string) {
  const d = diffDays(today, date);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  return d > 0 ? `In ${d} days` : `${-d} days ago`;
}

export default function PlannerPage() {
  const { plannerDate: date, setPlannerDate: setDate } = useView();
  const { key, fromAI } = useChangeKey();
  const [today, setToday] = useState("");
  const [now, setNow] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [events, setEvents] = useState<Occurrence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BlockDraft | null>(null);

  useEffect(() => {
    const tick = () => { setToday(localToday()); setNow(localNowTime()); };
    tick();
    if (!date) setDate(localToday());
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!date) return;
    let live = true;
    Promise.all([
      callTool<Plan>("getDailyPlan", { date }),
      callTool<{ occurrences: Occurrence[] }>("getEvents", { startDate: date, endDate: date }),
    ])
      .then(([p, e]) => { if (live) { setPlan(p); setEvents(e.occurrences); setError(null); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [date, key]);

  async function toggleTask(b: Block) {
    try {
      if (b.assessmentId) await callTool("completeStudyBlock", { blockId: b.id, done: !b.studyDone });
      else await callTool("completeTask", { taskId: b.taskId, completed: !b.taskCompleted });
      notifyChange();
    } catch (e) { setError((e as Error).message); }
  }
  async function remove(b: Block) {
    try {
      await callTool("deleteDailyPlanBlock", { blockId: b.id });
      notifyChange();
    } catch (e) { setError((e as Error).message); }
  }

  if (!date) return null;
  const isToday = date === today;
  const blocks = plan?.blocks ?? [];
  const nextStart = blocks.length ? blocks[blocks.length - 1].endTime ?? undefined : undefined;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-pencil">{today && relativeLabel(date, today)}</p>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{longDate(date)}</h1>
        </div>
        <div className="flex items-center gap-1 self-start rounded-full bg-white p-1 shadow-[inset_0_0_0_1px_var(--color-line)] sm:self-auto">
          <button onClick={() => setDate(addDays(date, -1))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5">← Previous Day</button>
          <button onClick={() => setDate(localToday())} disabled={isToday}
            className="rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink/5 disabled:text-pencil">Today</button>
          <button onClick={() => setDate(addDays(date, 1))} className="rounded-full px-3 py-1.5 text-sm hover:bg-ink/5">Next Day →</button>
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl bg-berry/10 px-4 py-3 text-sm text-berry">{error}</p>}

      {plan && !plan.exists && (
        <section className="mt-8 rounded-[28px] bg-card p-6 sm:p-8">
          <h2 className="font-display text-2xl font-bold">Nothing planned yet</h2>
          <p className="mt-1 text-pencil">
            The assistant can fit your To-Do list around {events.length ? "what's already on" : ""} this day, with breaks and free time.
          </p>
          {events.length > 0 && (
            <ul className="mt-5 space-y-2">
              {events.map((e) => (
                <li key={e.eventId} className="flex gap-4 text-[15px]">
                  <span className="w-40 shrink-0 tabular-nums text-pencil">{time12(e.startTime)} – {time12(e.endTime)}</span>
                  <span>{e.title} {e.emoji}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={() => askAI(`Plan my day for ${longDate(date)} (${date}).`)}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white hover:bg-ink/85">
              ✦ Plan this day
            </button>
            <button onClick={() => setDraft({ date, block: null, startTime: "16:00" })}
              className="rounded-full border border-line px-5 py-2.5 text-sm font-medium hover:bg-ink/5">
              Add a block myself
            </button>
          </div>
        </section>
      )}

      {plan?.exists && (
        <section key={fromAI ? key : "manual"} className={`mt-8 rounded-[28px] bg-card px-2 py-3 sm:px-4 sm:py-4 ${fromAI ? "settle" : ""}`}>
          <ol>
            {blocks.map((b, i) => {
              const prev = blocks[i - 1];
              const gap = prev?.endTime ? toMin(b.startTime) - toMin(prev.endTime) : 0;
              const current = isToday && now >= b.startTime && (b.endTime ? now < b.endTime : false);
              const done = b.assessmentId ? !!b.studyDone : !!b.taskId && !!b.taskCompleted;
              const checkable = !!b.taskId || !!b.assessmentId;
              return (
                <li key={b.id}>
                  {gap >= 15 && (
                    <div className="flex items-center gap-3 px-3 py-1 text-xs text-pencil" aria-label={`${minutesLabel(gap)} free`}>
                      <span className="h-px flex-1 border-t border-dashed border-line" />
                      {minutesLabel(gap)} free
                      <span className="h-px flex-1 border-t border-dashed border-line" />
                    </div>
                  )}
                  <div className={`group relative grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-2xl px-3 py-3 transition-colors hover:bg-paper/70 sm:grid-cols-[11rem_1fr_auto] ${
                    current ? "bg-paper" : ""}`}>
                    {current && <span className="absolute -left-1 top-3 bottom-3 w-1 rounded-full bg-ink" aria-hidden />}
                    <div className="row-span-2 tabular-nums text-[15px] text-pencil sm:row-span-1">
                      <span className="block sm:inline">{time12(b.startTime)}</span>
                      {b.endTime && <span className="block sm:inline"><span className="hidden sm:inline"> – </span>{time12(b.endTime)}</span>}
                    </div>
                    <button onClick={() => setDraft({ date, block: b })} className="min-w-0 text-left">
                      <span className={`text-[17px] font-medium leading-snug ${done ? "text-pencil line-through" : ""}`}>
                        <span className={done ? "" : b.assessmentId ? "marker marker-study" : b.source === "task" ? "marker" : ""}>{b.title}</span>
                        {b.emoji && <span className="ml-1.5">{b.emoji}</span>}
                      </span>
                      {(b.notes || current || b.eventId || b.assessment) && (
                        <span className="mt-0.5 block text-sm text-pencil">
                          {[current ? "Now" : b.eventId ? "From your schedule" : "", b.notes,
                            b.assessment && !b.title.includes(b.assessment.split(" — ")[1] ?? "\u0000") ? `For ${b.assessment}` : ""]
                            .filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </button>
                    <div className="row-span-2 flex items-center gap-1 sm:row-span-1">
                      {checkable && (
                        <button onClick={() => toggleTask(b)} aria-label={done ? `Mark ${b.title} not done` : `Mark ${b.title} done`}
                          className={`grid h-7 w-7 place-items-center rounded-full border-2 transition-colors ${
                            done ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}>
                          {done && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>}
                        </button>
                      )}
                      <button onClick={() => remove(b)} aria-label={`Delete ${b.title}`}
                        className="rounded-full p-1.5 text-pencil opacity-100 hover:bg-ink/5 hover:text-berry sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-3 pt-4 mt-2">
            <button onClick={() => setDraft({ date, block: null, startTime: nextStart })}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-ink/5">+ Add block</button>
            <button onClick={() => askAI(`Replan ${isToday ? "the rest of today" : longDate(date)} (${date}).`)}
              className="rounded-full px-4 py-2 text-sm font-medium text-pencil hover:bg-ink/5 hover:text-ink">✦ Replan with AI</button>
          </div>
          {plan.notes && <p className="mx-3 mt-4 rounded-2xl bg-paper px-4 py-3 text-sm text-pencil">{plan.notes}</p>}
        </section>
      )}

      <BlockEditor draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
