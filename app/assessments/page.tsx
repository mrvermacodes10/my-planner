"use client";

import { useEffect, useState } from "react";
import AssessmentEditor, { LogStudyDialog, type AssessmentDraft } from "@/components/AssessmentEditor";
import MonthCalendar from "@/components/MonthCalendar";
import { askAI, callTool, tint, useChangeKey, type Assessment } from "@/lib/client";
import { daysAwayLabel, localToday, minutesLabel, monthStart, shortDate, time12 } from "@/lib/dates";

const PRIORITY_STYLE = {
  high: "bg-berry/12 text-berry",
  medium: "bg-ink/6 text-ink/70",
  low: "bg-transparent text-pencil border border-line",
};

/** How urgent a test feels, from days left and study still to do. */
function urgency(a: Assessment) {
  if (a.remainingMinutes === 0) return "done";
  if (a.daysUntil <= 2) return "urgent";
  if (a.daysUntil <= 6) return "soon";
  return "later";
}

function AssessmentCard({ a, onEdit, onLog }: { a: Assessment; onEdit: () => void; onLog: () => void }) {
  const u = urgency(a);
  const next = a.plannedSessions[0];
  const topics = (a.topics ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return (
    <article className="flex flex-col rounded-[24px] bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-ink" style={{ background: tint(a.subject) }}>{a.subject}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>
      </div>
      <button onClick={onEdit} className="mt-3 text-left">
        <h3 className="font-display text-xl font-bold leading-tight hover:underline">{a.title}</h3>
      </button>
      <p className={`mt-1 text-sm ${u === "urgent" ? "font-semibold text-berry" : "text-pencil"}`}>
        {shortDate(a.date)} · {a.daysUntil === 0 ? "Today" : a.daysUntil === 1 ? "Tomorrow" : daysAwayLabel(a.daysUntil)}
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold tabular-nums">{a.progress}%</span>
          <span className={u === "done" ? "font-medium text-ink" : "text-pencil"}>
            {u === "done" ? "All study done ✓" : `${minutesLabel(a.remainingMinutes)} remaining`}
          </span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={a.progress} aria-valuemin={0} aria-valuemax={100}
          aria-label={`${a.subject} study progress`}>
          <div className={`h-full rounded-full transition-all duration-500 ${u === "done" ? "bg-mint" : u === "urgent" ? "bg-berry" : "bg-ink"}`}
            style={{ width: `${a.progress}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-pencil">
          {minutesLabel(a.completedStudyMinutes)} of {minutesLabel(a.totalStudyMinutes)} studied
        </p>
      </div>

      {topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topics.map((tp) => <span key={tp} className="rounded-lg bg-paper px-2 py-0.5 text-xs text-ink/80">{tp}</span>)}
        </div>
      )}
      {a.notes && <p className="mt-3 line-clamp-2 text-sm text-pencil">{a.notes}</p>}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {next ? (
          <span className="rounded-md bg-hl/60 px-1.5 text-xs text-ink">
            Next session {shortDate(next.date)}, {time12(next.startTime)}
          </span>
        ) : a.remainingMinutes > 0 && a.daysUntil > 0 ? (
          <span className="text-xs text-pencil">No study planned yet</span>
        ) : null}
        <button onClick={onLog} disabled={a.remainingMinutes === 0}
          className="ml-auto rounded-full border border-line px-3.5 py-1.5 text-sm font-medium hover:border-ink disabled:opacity-40">
          + Log study
        </button>
      </div>
    </article>
  );
}

export default function AssessmentsPage() {
  const { key, fromAI } = useChangeKey();
  const [today, setToday] = useState("");
  const [month, setMonth] = useState("");
  const [items, setItems] = useState<Assessment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssessmentDraft | null>(null);
  const [logging, setLogging] = useState<Assessment | null>(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    const t = localToday();
    setToday(t);
    setMonth(monthStart(t));
  }, []);

  useEffect(() => {
    callTool<{ assessments: Assessment[] }>("getAssessments", { includePast: true })
      .then((r) => { setItems(r.assessments); setError(null); })
      .catch((e) => setError(e.message));
  }, [key]);

  if (!today) return null;
  const upcoming = items.filter((a) => a.date >= today);
  const past = items.filter((a) => a.date < today).reverse();
  const left = upcoming.reduce((s, a) => s + a.remainingMinutes, 0);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-pencil">
            {upcoming.length
              ? `${upcoming.length} coming up${left ? ` · ${minutesLabel(left)} of study left` : " · all study done"}`
              : "Nothing coming up"}
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Assessments</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {upcoming.some((a) => a.remainingMinutes > 0) && (
            <button onClick={() => askAI("Plan my week around my assessments.")}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-ink/5">
              ✦ Plan my week
            </button>
          )}
          <button onClick={() => setDraft({ date: today })}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85">Add assessment</button>
        </div>
      </div>

      {error && <p className="mt-6 rounded-xl bg-berry/10 px-4 py-3 text-sm text-berry">{error}</p>}

      <section key={fromAI ? key : "manual"} className={fromAI ? "settle" : ""}>
        {upcoming.length === 0 ? (
          <div className="mt-8 rounded-[28px] bg-card p-6 sm:p-8">
            <h2 className="font-display text-2xl font-bold">No assessments yet</h2>
            <p className="mt-1 text-pencil">
              Add one here, or tell the assistant something like “I have a physics test next Thursday and need 3 hours to study.”
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {upcoming.map((a) => (
              <AssessmentCard key={a.id} a={a} onEdit={() => setDraft(a)} onLog={() => setLogging(a)} />
            ))}
          </div>
        )}

        <div className="mt-6 rounded-[28px] bg-card p-3 sm:p-5">
          {month && (
            <MonthCalendar
              month={month}
              today={today}
              items={items}
              getDate={(a) => a.date}
              onMonthChange={setMonth}
              onDayClick={(d) => setDraft({ date: d })}
              emphasise={(_, dayItems) => (dayItems.length > 1 ? "ring-2 ring-berry/40" : "")}
              renderItem={(a) => {
                const u = a.date < today ? "past" : urgency(a);
                return (
                  <button onClick={() => setDraft(a)} title={`${a.subject} — ${a.title}`}
                    className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-ink ${
                      u === "urgent" ? "ring-1 ring-berry" : ""} ${u === "past" ? "opacity-50" : ""}`}
                    style={{ background: tint(a.subject) }}>
                    <span className="font-semibold">{a.subject}</span>
                    <span className="hidden sm:inline"> · {a.title}</span>
                  </button>
                );
              }}
            />
          )}
          <p className="mt-3 px-1 text-sm text-pencil">Click a day to add an assessment. Outlined days have more than one.</p>
        </div>
      </section>

      {past.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowPast(!showPast)} className="px-2 text-sm font-medium text-pencil hover:text-ink" aria-expanded={showPast}>
            {showPast ? "Hide" : "Show"} past assessments ({past.length})
          </button>
          {showPast && (
            <ul className="mt-2 rounded-[28px] bg-card/60 px-2 py-2 sm:px-3">
              {past.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setDraft(a)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-paper/70">
                    <span className="w-24 shrink-0 text-sm text-pencil">{shortDate(a.date)}</span>
                    <span className="flex-1 font-medium">{a.subject} — {a.title}</span>
                    <span className="text-sm tabular-nums text-pencil">{a.progress}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AssessmentEditor draft={draft} onClose={() => setDraft(null)} />
      <LogStudyDialog assessment={logging} onClose={() => setLogging(null)} />
    </div>
  );
}
