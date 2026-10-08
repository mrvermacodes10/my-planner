"use client";

import { useEffect, useState } from "react";
import TaskEditor from "@/components/TaskEditor";
import { inputCls } from "@/components/ui";
import { callTool, notifyChange, useChangeKey, type Task } from "@/lib/client";
import { WEEKDAYS, diffDays, localToday, minutesLabel, shortDate, time12, weekday } from "@/lib/dates";

function dueLabel(due: string | null, today: string) {
  if (!due) return null;
  const d = diffDays(today, due);
  if (d < 0) return { text: d === -1 ? "Overdue (yesterday)" : `Overdue (${shortDate(due)})`, urgent: true };
  if (d === 0) return { text: "Due today", urgent: true };
  if (d === 1) return { text: "Due tomorrow", urgent: false };
  if (d < 7) return { text: `Due ${WEEKDAYS[weekday(due)]}`, urgent: false };
  return { text: `Due ${shortDate(due)}`, urgent: false };
}

const PRIORITY_STYLE = {
  high: "bg-berry/12 text-berry",
  medium: "bg-ink/6 text-ink/70",
  low: "bg-transparent text-pencil border border-line",
};

export default function TodoPage() {
  const { key, fromAI } = useChangeKey();
  const [today, setToday] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [n, setN] = useState({ title: "", dueDate: "", minutes: "", priority: "medium" });

  useEffect(() => setToday(localToday()), []);
  useEffect(() => {
    callTool<{ tasks: Task[] }>("getTasks", { includeCompleted: true })
      .then((r) => { setTasks(r.tasks); setError(null); })
      .catch((e) => setError(e.message));
  }, [key]);

  async function add() {
    if (!n.title.trim()) return;
    try {
      await callTool("createTask", {
        title: n.title, dueDate: n.dueDate || null, priority: n.priority,
        estimatedMinutes: n.minutes ? Number(n.minutes) : null,
      });
      setN({ title: "", dueDate: "", minutes: "", priority: "medium" });
      notifyChange();
    } catch (e) { setError((e as Error).message); }
  }

  async function toggle(t: Task) {
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, completed: !x.completed } : x)));
    try {
      await callTool("completeTask", { taskId: t.id, completed: !t.completed });
      notifyChange();
    } catch (e) { setError((e as Error).message); }
  }

  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const totalMinutes = open.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);

  const row = (t: Task) => {
    const due = today ? dueLabel(t.dueDate, today) : null;
    const next = t.plannedIn.find((p) => p.date >= today);
    return (
      <li key={t.id} className="group flex items-start gap-3 rounded-2xl px-3 py-3 hover:bg-paper/70">
        <button onClick={() => toggle(t)} aria-label={t.completed ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 transition-colors ${
            t.completed ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}>
          {t.completed && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>}
        </button>
        <button onClick={() => setEditing(t)} className="min-w-0 flex-1 text-left">
          <span className={`text-[17px] font-medium ${t.completed ? "text-pencil line-through" : ""}`}>{t.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-pencil">
            {t.estimatedMinutes && <span>{minutesLabel(t.estimatedMinutes)}</span>}
            {due && <span className={due.urgent && !t.completed ? "font-medium text-berry" : ""}>{due.text}</span>}
            {t.category && <span>{t.category}</span>}
            {next && !t.completed && <span className="rounded-md bg-hl/60 px-1.5 text-ink">Planned {shortDate(next.date)}, {time12(next.startTime)}</span>}
          </span>
        </button>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
      </li>
    );
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-pencil">
            {open.length ? `${open.length} to do${totalMinutes ? `, about ${minutesLabel(totalMinutes)}` : ""}` : "All clear"}
          </p>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">To-Do</h1>
        </div>
      </div>

      <form className="mt-8 grid grid-cols-2 gap-2 rounded-[28px] bg-card p-3 sm:grid-cols-[1fr_9.5rem_6rem_7.5rem_auto]"
        onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className={`${inputCls} col-span-2 sm:col-span-1`} placeholder="Add a task, e.g. Chemistry homework" value={n.title}
          onChange={(e) => setN({ ...n, title: e.target.value })} aria-label="Task name" />
        <input type="date" className={inputCls} value={n.dueDate} onChange={(e) => setN({ ...n, dueDate: e.target.value })} aria-label="Due date" />
        <input type="number" min={5} step={5} className={inputCls} placeholder="Min" value={n.minutes}
          onChange={(e) => setN({ ...n, minutes: e.target.value })} aria-label="Estimated minutes" />
        <select className={inputCls} value={n.priority} onChange={(e) => setN({ ...n, priority: e.target.value })} aria-label="Priority">
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <button type="submit" className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/85">Add</button>
      </form>

      {error && <p className="mt-4 rounded-xl bg-berry/10 px-4 py-3 text-sm text-berry">{error}</p>}

      <section key={fromAI ? key : "manual"} className={`mt-4 rounded-[28px] bg-card px-2 py-2 sm:px-3 ${fromAI ? "settle" : ""}`}>
        {open.length === 0 ? (
          <p className="px-4 py-8 text-center text-pencil">Nothing on your list. Add a task above or tell the assistant what you need to do.</p>
        ) : (
          <ul>{open.map(row)}</ul>
        )}
      </section>

      {done.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowDone(!showDone)} className="px-2 text-sm font-medium text-pencil hover:text-ink" aria-expanded={showDone}>
            {showDone ? "Hide" : "Show"} completed ({done.length})
          </button>
          {showDone && <ul className="mt-2 rounded-[28px] bg-card/60 px-2 py-2 sm:px-3">{done.map(row)}</ul>}
        </div>
      )}

      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
