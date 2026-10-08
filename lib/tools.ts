// Every change to the planner goes through these tools — both the AI and the website's buttons use them.
// Each tool validates its input on the server before touching the database. The AI can never run SQL.

import { z } from "zod";
import { db, newId, updateRow } from "./db";
import {
  DATE_RE, TIME_RE, WEEKDAYS, addDays, diffDays, fromMin, isValidDate, normTime, toMin, weekday,
} from "./dates";
import { expand, occursOn, parseList, seriesDays, toOccurrence, type EventRow } from "./recurrence";

export class ToolError extends Error {}
export type ToolContext = { today: string; now: string };

// ---------- shared input pieces ----------

const date = z.string().regex(DATE_RE, "use YYYY-MM-DD").refine(isValidDate, "not a real calendar date");
const time = z.string().regex(TIME_RE, "use 24-hour HH:MM, e.g. 17:30");
const id = z.string().min(1).max(64);
const title = z.string().trim().min(1).max(120);
const optText = (max: number) => z.string().max(max).nullable().optional();
const emoji = z.string().max(16).nullable().optional().describe("one emoji, e.g. ⚽");
const category = optText(40).describe("short category, e.g. School, Sport, Homework");
const notes = optText(500);
const priority = z.enum(["low", "medium", "high"]);
const minutes = z.number().int().min(5).max(720);
const daysOfWeek = z.array(z.number().int().min(0).max(6)).min(1).max(7)
  .describe("weekdays: 0=Sunday 1=Monday 2=Tuesday 3=Wednesday 4=Thursday 5=Friday 6=Saturday");
const SOURCES = ["event", "task", "study", "break", "meal", "routine", "travel", "free", "custom"] as const;

const blockShape = {
  title,
  startTime: time,
  endTime: time.nullable().optional().describe("leave empty ONLY for the final Sleep block"),
  emoji,
  category,
  source: z.enum(SOURCES).optional()
    .describe("event = from Schedule, task = To-Do work, study = revision for an assessment, break/meal/routine/travel/free/custom otherwise"),
  taskId: id.nullable().optional().describe("set when the block is time for a To-Do task"),
  assessmentId: id.nullable().optional().describe("set when the block is study time for an assessment (use source 'study')"),
  eventId: id.nullable().optional().describe("set when the block is a Schedule event"),
  notes,
};
const blockInput = z.object(blockShape);
type BlockInput = z.infer<typeof blockInput>;

const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
const t = (v: string) => normTime(v);

function checkTimes(start: string, end: string | null | undefined, label = "") {
  if (end && toMin(end) <= toMin(start)) {
    throw new ToolError(`${label}endTime (${end}) must be after startTime (${start})`);
  }
}

// ---------- rows and outputs ----------

type TaskRow = {
  id: string; title: string; dueDate: string | null; priority: string; estimatedMinutes: number | null;
  completed: number; category: string | null; notes: string | null;
};
type BlockRow = {
  id: string; dailyPlanId: string; title: string; startTime: string; endTime: string | null;
  category: string | null; emoji: string | null; source: string; notes: string | null;
  taskId: string | null; eventId: string | null;
  assessmentId: string | null; completed: number; countedMinutes: number;
};
type AssessmentRow = {
  id: string; subject: string; title: string; date: string; topics: string | null;
  totalStudyMinutes: number; completedStudyMinutes: number; priority: string; notes: string | null;
  createdAt: string; updatedAt: string;
};
type SettingsRow = {
  wakeTime: string; sleepTime: string; breakMinutes: number; includeMeals: number;
  includeTravel: number; travelMinutes: number;
};

const getEventRow = (eventId: string) => {
  const e = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as EventRow | undefined;
  if (!e) throw new ToolError(`No event with id ${eventId}. Use getEvents to look up ids.`);
  return e;
};
const getTaskRow = (taskId: string) => {
  const r = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!r) throw new ToolError(`No task with id ${taskId}. Use getTasks to look up ids.`);
  return r;
};
const getBlockRow = (blockId: string) => {
  const r = db.prepare("SELECT * FROM daily_plan_blocks WHERE id = ?").get(blockId) as BlockRow | undefined;
  if (!r) throw new ToolError(`No planner block with id ${blockId}. Use getDailyPlan to look up ids.`);
  return r;
};
const planIdFor = (d: string) =>
  (db.prepare("SELECT id FROM daily_plans WHERE date = ?").get(d) as { id: string } | undefined)?.id;

function ensurePlan(d: string) {
  const existing = planIdFor(d);
  if (existing) return existing;
  const pid = newId();
  db.prepare("INSERT INTO daily_plans (id, date) VALUES (?, ?)").run(pid, d);
  return pid;
}

export function readSettings() {
  const s = db.prepare("SELECT * FROM settings WHERE id = 1").get() as SettingsRow;
  return { ...s, includeMeals: !!s.includeMeals, includeTravel: !!s.includeTravel };
}

const eventOut = (e: EventRow) => ({
  id: e.id, title: e.title, startTime: e.startTime, endTime: e.endTime,
  ...(e.recurrence === "none"
    ? { date: e.date, repeats: "no" }
    : {
        repeats: e.recurrence,
        daysOfWeek: e.recurrence === "weekly" ? seriesDays(e).map((d) => WEEKDAYS[d]) : undefined,
        from: e.date, until: e.recurrenceEnd, cancelledDates: parseList(e.excludedDates),
      }),
  emoji: e.emoji, category: e.category, notes: e.notes,
});

function taskOut(r: TaskRow) {
  const planned = db.prepare(
    `SELECT p.date, b.startTime, b.endTime FROM daily_plan_blocks b JOIN daily_plans p ON p.id = b.dailyPlanId
     WHERE b.taskId = ? ORDER BY p.date, b.startTime`,
  ).all(r.id) as { date: string; startTime: string; endTime: string | null }[];
  return {
    id: r.id, title: r.title, dueDate: r.dueDate, priority: r.priority,
    estimatedMinutes: r.estimatedMinutes, completed: !!r.completed,
    category: r.category, notes: r.notes,
    plannedIn: planned.map((p) => ({ date: p.date, startTime: p.startTime, endTime: p.endTime })),
  };
}

function planOut(d: string) {
  const plan = db.prepare("SELECT * FROM daily_plans WHERE date = ?").get(d) as
    | { id: string; notes: string | null } | undefined;
  if (!plan) return { date: d, exists: false, notes: null, blocks: [] };
  const blocks = db.prepare(
    `SELECT b.*, t.completed AS taskCompleted, a.subject AS assessmentSubject, a.title AS assessmentTitle
     FROM daily_plan_blocks b LEFT JOIN tasks t ON t.id = b.taskId LEFT JOIN assessments a ON a.id = b.assessmentId
     WHERE b.dailyPlanId = ?`,
  ).all(plan.id) as (BlockRow & { taskCompleted: number | null; assessmentSubject: string | null; assessmentTitle: string | null })[];
  blocks.sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  return {
    date: d,
    exists: true,
    notes: plan.notes,
    blocks: blocks.map((b) => ({
      id: b.id, title: b.title, startTime: b.startTime, endTime: b.endTime, emoji: b.emoji,
      category: b.category, source: b.source, notes: b.notes, taskId: b.taskId, eventId: b.eventId,
      taskCompleted: b.taskId ? !!b.taskCompleted : undefined,
      assessmentId: b.assessmentId,
      assessment: b.assessmentId ? `${b.assessmentSubject} — ${b.assessmentTitle}` : undefined,
      studyDone: b.assessmentId ? !!b.completed : undefined,
    })),
  };
}

function findOverlaps(blocks: { title: string; startTime: string; endTime?: string | null }[]) {
  const sorted = [...blocks].sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const problems: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const prevEnd = prev.endTime ? toMin(prev.endTime) : toMin(prev.startTime) + 1;
    if (toMin(sorted[i].startTime) < prevEnd) {
      problems.push(`"${prev.title}" (${prev.startTime}-${prev.endTime ?? "?"}) overlaps "${sorted[i].title}" (${sorted[i].startTime})`);
    }
  }
  return problems;
}

function checkRefs(blocks: BlockInput[]) {
  for (const b of blocks) {
    if (b.taskId && !db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(b.taskId)) {
      throw new ToolError(`Block "${b.title}" has unknown taskId ${b.taskId}`);
    }
    if (b.eventId && !db.prepare("SELECT 1 FROM events WHERE id = ?").get(b.eventId)) {
      throw new ToolError(`Block "${b.title}" has unknown eventId ${b.eventId}`);
    }
    if (b.assessmentId && !db.prepare("SELECT 1 FROM assessments WHERE id = ?").get(b.assessmentId)) {
      throw new ToolError(`Block "${b.title}" has unknown assessmentId ${b.assessmentId}. Use getAssessments to look up ids.`);
    }
  }
}

const insertBlock = db.prepare(
  `INSERT INTO daily_plan_blocks (id, dailyPlanId, title, startTime, endTime, category, emoji, source, notes, taskId, eventId,
     assessmentId, completed, countedMinutes)
   VALUES (@id, @dailyPlanId, @title, @startTime, @endTime, @category, @emoji, @source, @notes, @taskId, @eventId,
     @assessmentId, @completed, @countedMinutes)`,
);

function blockRow(planId: string, b: BlockInput) {
  return {
    id: newId(), dailyPlanId: planId, title: b.title.trim(), startTime: t(b.startTime),
    endTime: b.endTime ? t(b.endTime) : null, category: clean(b.category) ?? null, emoji: clean(b.emoji) ?? null,
    source: b.source ?? (b.taskId ? "task" : b.eventId ? "event" : b.assessmentId ? "study" : "custom"),
    notes: clean(b.notes) ?? null,
    taskId: b.taskId || null, eventId: b.eventId || null, assessmentId: b.assessmentId || null,
    completed: 0, countedMinutes: 0,
  };
}

/** Replace a whole day's plan. Rejects overlapping blocks so plans always stay clean. */
function writePlan(d: string, blocks: BlockInput[], planNotes: string | null | undefined) {
  blocks.forEach((b, i) => checkTimes(t(b.startTime), b.endTime && t(b.endTime), `Block ${i + 1} "${b.title}": `));
  const overlaps = findOverlaps(blocks.map((b) => ({ ...b, startTime: t(b.startTime), endTime: b.endTime && t(b.endTime) })));
  if (overlaps.length) throw new ToolError(`Blocks overlap — fix and try again: ${overlaps.join("; ")}`);
  checkRefs(blocks);
  db.transaction(() => {
    const pid = ensurePlan(d);
    // Study blocks that were already ticked off keep their "done" state if the same block is in the new plan,
    // so their minutes are never counted twice. Credit for done blocks that disappear is kept (the study happened).
    const done = db.prepare("SELECT * FROM daily_plan_blocks WHERE dailyPlanId = ? AND completed = 1").all(pid) as BlockRow[];
    db.prepare("DELETE FROM daily_plan_blocks WHERE dailyPlanId = ?").run(pid);
    if (planNotes !== undefined) updateRow("daily_plans", pid, { notes: clean(planNotes) });
    for (const b of blocks) {
      const row = blockRow(pid, b);
      const i = done.findIndex((x) => x.assessmentId && x.assessmentId === row.assessmentId
        && x.startTime === row.startTime && x.endTime === row.endTime);
      if (i >= 0) {
        row.completed = 1;
        row.countedMinutes = done[i].countedMinutes;
        done.splice(i, 1);
      }
      insertBlock.run(row);
    }
  })();
}

/** Keep planner blocks that came from an event in line with the event (time, title, cancellations). */
function syncEventBlocks(eventId: string) {
  const e = db.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as EventRow | undefined;
  if (!e) return { removedFrom: [] as string[] };
  const rows = db.prepare(
    `SELECT b.*, p.date FROM daily_plan_blocks b JOIN daily_plans p ON p.id = b.dailyPlanId WHERE b.eventId = ?`,
  ).all(eventId) as (BlockRow & { date: string })[];
  const removedFrom: string[] = [];
  for (const b of rows) {
    if (!occursOn(e, b.date)) {
      db.prepare("DELETE FROM daily_plan_blocks WHERE id = ?").run(b.id);
      removedFrom.push(b.date);
    } else {
      updateRow("daily_plan_blocks", b.id, { startTime: e.startTime, endTime: e.endTime, title: e.title, emoji: e.emoji });
    }
  }
  return { removedFrom };
}

function planBlocksForEventOn(eventId: string, d: string) {
  return db.prepare(
    `SELECT b.id FROM daily_plan_blocks b JOIN daily_plans p ON p.id = b.dailyPlanId WHERE b.eventId = ? AND p.date = ?`,
  ).all(eventId, d) as { id: string }[];
}

// ---------- assessments ----------

const getAssessmentRow = (assessmentId: string) => {
  const a = db.prepare("SELECT * FROM assessments WHERE id = ?").get(assessmentId) as AssessmentRow | undefined;
  if (!a) throw new ToolError(`No assessment with id ${assessmentId}. Use getAssessments to look up ids.`);
  return a;
};

const blockMinutes = (b: { startTime: string; endTime: string | null }) =>
  b.endTime ? Math.max(0, toMin(b.endTime) - toMin(b.startTime)) : 0;

/** Add (or remove, if negative) study minutes, never going below 0 or above the required total. Returns the change applied. */
function creditStudy(assessmentId: string, minutes: number) {
  const a = getAssessmentRow(assessmentId);
  const next = Math.min(a.totalStudyMinutes, Math.max(0, a.completedStudyMinutes + minutes));
  updateRow("assessments", a.id, { completedStudyMinutes: next, updatedAt: new Date().toISOString() });
  return next - a.completedStudyMinutes;
}

/** Tick or untick a study block. Its minutes are counted once; unticking takes back exactly what was counted. */
function setStudyBlockDone(blockId: string, done: boolean) {
  const b = getBlockRow(blockId);
  if (!b.assessmentId) throw new ToolError(`"${b.title}" isn't linked to an assessment. Use completeTask for To-Do blocks.`);
  if (done && !b.completed) {
    const applied = creditStudy(b.assessmentId, blockMinutes(b));
    updateRow("daily_plan_blocks", b.id, { completed: 1, countedMinutes: applied });
  } else if (!done && b.completed) {
    creditStudy(b.assessmentId, -b.countedMinutes);
    updateRow("daily_plan_blocks", b.id, { completed: 0, countedMinutes: 0 });
  }
  return b.assessmentId;
}

type StudyBlock = { id: string; date: string; startTime: string; endTime: string | null; completed: number };
function studyBlocksFor(assessmentId: string) {
  return db.prepare(
    `SELECT b.id, p.date, b.startTime, b.endTime, b.completed FROM daily_plan_blocks b
     JOIN daily_plans p ON p.id = b.dailyPlanId WHERE b.assessmentId = ? ORDER BY p.date, b.startTime`,
  ).all(assessmentId) as StudyBlock[];
}

export function assessmentOut(a: AssessmentRow, today: string) {
  const remaining = Math.max(0, a.totalStudyMinutes - a.completedStudyMinutes);
  const upcoming = studyBlocksFor(a.id).filter((b) => b.date >= today && !b.completed && b.date < a.date);
  const plannedMinutes = upcoming.reduce((sum, b) => sum + blockMinutes(b), 0);
  return {
    id: a.id,
    subject: a.subject,
    title: a.title,
    date: a.date,
    weekday: WEEKDAYS[weekday(a.date)],
    daysUntil: diffDays(today, a.date),
    topics: a.topics,
    totalStudyMinutes: a.totalStudyMinutes,
    completedStudyMinutes: a.completedStudyMinutes,
    remainingMinutes: remaining,
    progress: a.totalStudyMinutes > 0 ? Math.round((a.completedStudyMinutes / a.totalStudyMinutes) * 100) : 0,
    priority: a.priority,
    notes: a.notes,
    plannedSessions: upcoming.map((b) => ({ blockId: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime })),
    plannedMinutes,
    unplannedMinutes: Math.max(0, remaining - plannedMinutes),
  };
}

/**
 * Study guidance for one day: how much of each upcoming assessment still needs a slot, spread evenly over the
 * days that are left (closer and higher-priority tests get more). The AI uses this as a starting point.
 */
function studyNeedsFor(day: string, ctx: ToolContext) {
  const rows = db.prepare("SELECT * FROM assessments WHERE date >= ? ORDER BY date").all(day) as AssessmentRow[];
  return rows.map((a) => {
    const out = assessmentOut(a, ctx.today);
    const daysLeft = diffDays(day, a.date); // study days available from `day`, not counting the test day itself
    const blocks = studyBlocksFor(a.id).filter((b) => !b.completed && b.date >= ctx.today && b.date < a.date);
    const plannedThisDay = blocks.filter((b) => b.date === day).reduce((s2, b) => s2 + blockMinutes(b), 0);
    const plannedOtherDays = blocks.filter((b) => b.date !== day).reduce((s2, b) => s2 + blockMinutes(b), 0);
    const stillToPlace = Math.max(0, out.remainingMinutes - plannedOtherDays);
    const weight = a.priority === "high" ? 1.25 : a.priority === "low" ? 0.8 : 1;
    let suggested = 0;
    if (daysLeft >= 1 && stillToPlace > 0) {
      suggested = Math.ceil(((stillToPlace / daysLeft) * weight) / 15) * 15;
      suggested = Math.min(stillToPlace, Math.max(30, suggested), daysLeft === 1 ? 150 : 120);
    }
    return {
      assessmentId: a.id, subject: a.subject, title: a.title, date: a.date, daysUntilTest: daysLeft,
      priority: a.priority, topics: a.topics, remainingMinutes: out.remainingMinutes,
      plannedOnThisDay: plannedThisDay, plannedOnOtherDays: plannedOtherDays,
      suggestedStudyMinutesThisDay: suggested,
      note: daysLeft === 0 ? "Test is on this day: at most a short review before it." : undefined,
    };
  }).filter((x) => x.remainingMinutes > 0 || x.daysUntilTest === 0);
}

/** One day's fixed events, free gaps and existing plan (shared by the day and week planning tools). */
function dayInfo(day: string, ctx: ToolContext) {
  const s = readSettings();
  const events = expand(db.prepare("SELECT * FROM events").all() as EventRow[], day, day);
  const wake = toMin(s.wakeTime);
  const sleep = toMin(s.sleepTime);
  let cursor = wake;
  if (day === ctx.today) cursor = Math.max(wake, Math.ceil(toMin(ctx.now) / 15) * 15);
  const gaps: string[] = [];
  for (const o of events) {
    const st = toMin(o.startTime);
    const en = toMin(o.endTime);
    if (Math.min(st, sleep) - cursor >= 10) gaps.push(`${fromMin(cursor)}-${fromMin(Math.min(st, sleep))}`);
    cursor = Math.max(cursor, en);
  }
  if (sleep - cursor >= 10) gaps.push(`${fromMin(cursor)}-${fromMin(sleep)}`);
  return {
    date: day,
    weekday: WEEKDAYS[weekday(day)],
    isToday: day === ctx.today,
    currentTime: day === ctx.today ? ctx.now : undefined,
    scheduleEvents: events.map((o) => ({
      eventId: o.eventId, title: o.title, startTime: o.startTime, endTime: o.endTime, emoji: o.emoji, category: o.category,
    })),
    freeGapsBetweenEvents: gaps,
    existingPlan: planOut(day),
  };
}

function openTasksFor(day: string, ctx: ToolContext) {
  const rows = db.prepare(
    "SELECT * FROM tasks WHERE completed = 0 ORDER BY dueDate IS NULL, dueDate, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END LIMIT 15",
  ).all() as TaskRow[];
  return rows.map(taskOut).map((tk) => ({
    ...tk,
    daysUntilDue: tk.dueDate ? diffDays(day, tk.dueDate) : null,
    minutesAlreadyPlannedOtherDays: tk.plannedIn
      .filter((p) => p.date !== day && p.date >= ctx.today && p.endTime)
      .reduce((sum, p) => sum + toMin(p.endTime!) - toMin(p.startTime), 0),
  }));
}

// ---------- tool registry ----------

type ToolDef = {
  name: string;
  description: string;
  schema: z.ZodType;
  mutates: boolean;
  run: (input: unknown, ctx: ToolContext) => unknown;
};
const defs: ToolDef[] = [];
function def<S extends z.ZodType>(
  name: string, mutates: boolean, description: string, schema: S,
  run: (input: z.infer<S>, ctx: ToolContext) => unknown,
) {
  defs.push({ name, mutates, description, schema, run: run as ToolDef["run"] });
}

// ----- Schedule -----

def("getEvents", false,
  "List Schedule events between two dates (inclusive). Recurring events are expanded into each date they happen. Use this to find event ids.",
  z.object({ startDate: date, endDate: date }),
  ({ startDate, endDate }) => {
    if (endDate < startDate) throw new ToolError("endDate is before startDate");
    if (diffDays(startDate, endDate) > 92) throw new ToolError("Ask for at most 92 days at a time");
    const events = db.prepare("SELECT * FROM events").all() as EventRow[];
    return { occurrences: expand(events, startDate, endDate) };
  });

def("createEvent", true,
  "Create a ONE-OFF Schedule event on a single date. For anything that repeats, use createRecurringEvent.",
  z.object({ title, date, startTime: time, endTime: time, emoji, category, notes }),
  (i) => {
    checkTimes(t(i.startTime), t(i.endTime));
    const eid = newId();
    db.prepare(
      `INSERT INTO events (id, title, date, startTime, endTime, recurrence, category, emoji, notes)
       VALUES (?, ?, ?, ?, ?, 'none', ?, ?, ?)`,
    ).run(eid, i.title, i.date, t(i.startTime), t(i.endTime), clean(i.category) ?? null, clean(i.emoji) ?? null, clean(i.notes) ?? null);
    return { created: eventOut(getEventRow(eid)) };
  });

def("createRecurringEvent", true,
  "Create a repeating Schedule event, e.g. every Monday, Tuesdays and Thursdays, Monday to Friday, or every day.",
  z.object({
    title,
    frequency: z.enum(["weekly", "daily"]),
    daysOfWeek: daysOfWeek.optional().describe("weekly only. 0=Sunday 1=Monday ... 6=Saturday. Monday to Friday = [1,2,3,4,5]"),
    startDate: date.describe("first date the series may happen; today's date is fine"),
    endDate: date.nullable().optional().describe("last date of the series; leave empty to repeat forever"),
    startTime: time, endTime: time, emoji, category, notes,
  }),
  (i) => {
    checkTimes(t(i.startTime), t(i.endTime));
    if (i.endDate && i.endDate < i.startDate) throw new ToolError("endDate is before startDate");
    const days = i.frequency === "weekly" ? [...new Set(i.daysOfWeek ?? [weekday(i.startDate)])].sort() : [];
    const eid = newId();
    db.prepare(
      `INSERT INTO events (id, title, date, startTime, endTime, recurrence, recurrenceDays, recurrenceEnd, category, emoji, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(eid, i.title, i.startDate, t(i.startTime), t(i.endTime), i.frequency, days.join(","), i.endDate ?? null,
      clean(i.category) ?? null, clean(i.emoji) ?? null, clean(i.notes) ?? null);
    const e = getEventRow(eid);
    return { created: eventOut(e), nextDates: expand([e], i.startDate, addDays(i.startDate, 21)).slice(0, 3).map((o) => o.date) };
  });

def("updateEvent", true,
  "Change a Schedule event. For a RECURRING event pass occurrenceDate to change only that one date (e.g. 'move football tomorrow to 6-8'); omit occurrenceDate to change every occurrence. Matching Daily Planner blocks update automatically.",
  z.object({
    eventId: id,
    occurrenceDate: date.optional().describe("recurring events only: change just this date's occurrence"),
    title: title.optional(),
    date: date.optional().describe("one-off: new date. With occurrenceDate: the date to move that occurrence to. Series: new first date"),
    startTime: time.optional(), endTime: time.optional(),
    frequency: z.enum(["none", "weekly", "daily"]).optional().describe("change whether the event repeats"),
    daysOfWeek: daysOfWeek.optional(),
    endDate: date.nullable().optional().describe("series: last date (null = forever)"),
    emoji, category, notes,
  }),
  (i) => {
    const e = getEventRow(i.eventId);
    const start = t(i.startTime ?? e.startTime);
    const end = t(i.endTime ?? e.endTime);
    checkTimes(start, end);

    // Change just one date of a series: cancel that date and create a one-off replacement.
    if (i.occurrenceDate && e.recurrence !== "none") {
      if (!occursOn(e, i.occurrenceDate)) throw new ToolError(`"${e.title}" does not happen on ${i.occurrenceDate}`);
      const oneId = newId();
      db.transaction(() => {
        updateRow("events", e.id, { excludedDates: [...parseList(e.excludedDates), i.occurrenceDate].join(",") });
        db.prepare(
          `INSERT INTO events (id, title, date, startTime, endTime, recurrence, category, emoji, notes)
           VALUES (?, ?, ?, ?, ?, 'none', ?, ?, ?)`,
        ).run(oneId, i.title ?? e.title, i.date ?? i.occurrenceDate, start, end,
          i.category !== undefined ? clean(i.category) : e.category,
          i.emoji !== undefined ? clean(i.emoji) : e.emoji,
          i.notes !== undefined ? clean(i.notes) : e.notes);
        for (const b of planBlocksForEventOn(e.id, i.occurrenceDate!)) updateRow("daily_plan_blocks", b.id, { eventId: oneId });
      })();
      const sync = syncEventBlocks(oneId);
      return {
        changedOnlyDate: i.occurrenceDate,
        replacement: eventOut(getEventRow(oneId)),
        plannerBlocksRemovedFrom: sync.removedFrom,
        note: "Other dates of the series are unchanged.",
      };
    }

    const fields: Record<string, unknown> = {
      title: i.title, date: i.date, startTime: start, endTime: end,
      category: clean(i.category), emoji: clean(i.emoji), notes: clean(i.notes),
    };
    if (i.frequency) fields.recurrence = i.frequency;
    const freq = i.frequency ?? e.recurrence;
    if (freq === "weekly" && (i.daysOfWeek || i.frequency === "weekly")) {
      const d = i.daysOfWeek ?? (e.recurrence === "weekly" ? seriesDays(e) : [weekday(i.date ?? e.date)]);
      fields.recurrenceDays = [...new Set(d)].sort().join(",");
    }
    if (freq !== "weekly" && i.frequency) fields.recurrenceDays = "";
    if (i.endDate !== undefined) fields.recurrenceEnd = i.endDate;
    updateRow("events", e.id, fields);
    const sync = syncEventBlocks(e.id);
    return { updated: eventOut(getEventRow(e.id)), plannerBlocksRemovedFrom: sync.removedFrom };
  });

def("deleteEvent", true,
  "Delete or cancel a Schedule event. For a RECURRING event pass occurrenceDate to cancel only that date (e.g. 'cancel football tomorrow'); omit it to delete the whole series. Matching Daily Planner blocks are removed automatically.",
  z.object({ eventId: id, occurrenceDate: date.optional().describe("recurring events only: cancel just this date") }),
  (i) => {
    const e = getEventRow(i.eventId);
    if (i.occurrenceDate && e.recurrence !== "none") {
      if (!occursOn(e, i.occurrenceDate)) throw new ToolError(`"${e.title}" does not happen on ${i.occurrenceDate}`);
      updateRow("events", e.id, { excludedDates: [...parseList(e.excludedDates), i.occurrenceDate].join(",") });
      const sync = syncEventBlocks(e.id);
      return {
        cancelled: `${e.title} on ${i.occurrenceDate} (${e.startTime}-${e.endTime})`,
        freedTime: `${e.startTime}-${e.endTime} on ${i.occurrenceDate}`,
        plannerBlocksRemovedFrom: sync.removedFrom,
      };
    }
    const dates = db.prepare(
      `SELECT DISTINCT p.date FROM daily_plan_blocks b JOIN daily_plans p ON p.id = b.dailyPlanId WHERE b.eventId = ?`,
    ).all(e.id) as { date: string }[];
    db.prepare("DELETE FROM events WHERE id = ?").run(e.id);
    return { deleted: eventOut(e), plannerBlocksRemovedFrom: dates.map((r) => r.date) };
  });

// ----- To-Do -----

def("getTasks", false,
  "List To-Do tasks (open ones by default), including where each is already placed in Daily Plans.",
  z.object({ includeCompleted: z.boolean().optional() }),
  (i) => {
    const rows = db.prepare(
      `SELECT * FROM tasks ${i.includeCompleted ? "" : "WHERE completed = 0"}
       ORDER BY completed, dueDate IS NULL, dueDate, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`,
    ).all() as TaskRow[];
    return { tasks: rows.map(taskOut) };
  });

def("createTask", true,
  "Add a task to the To-Do list.",
  z.object({
    title, dueDate: date.nullable().optional(), priority: priority.optional(),
    estimatedMinutes: minutes.nullable().optional(), category, notes,
  }),
  (i) => {
    const tid = newId();
    db.prepare(
      `INSERT INTO tasks (id, title, dueDate, priority, estimatedMinutes, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(tid, i.title, i.dueDate ?? null, i.priority ?? "medium", i.estimatedMinutes ?? null,
      clean(i.category) ?? null, clean(i.notes) ?? null);
    return { created: taskOut(getTaskRow(tid)) };
  });

def("updateTask", true,
  "Change a To-Do task (name, due date, priority, duration, category, notes, completed).",
  z.object({
    taskId: id, title: title.optional(), dueDate: date.nullable().optional(), priority: priority.optional(),
    estimatedMinutes: minutes.nullable().optional(), completed: z.boolean().optional(), category, notes,
  }),
  (i) => {
    const r = getTaskRow(i.taskId);
    updateRow("tasks", r.id, {
      title: i.title, dueDate: i.dueDate, priority: i.priority, estimatedMinutes: i.estimatedMinutes,
      completed: i.completed, category: clean(i.category), notes: clean(i.notes),
    });
    if (i.title && i.title !== r.title) {
      db.prepare("UPDATE daily_plan_blocks SET title = ? WHERE taskId = ? AND title = ?").run(i.title, r.id, r.title);
    }
    return { updated: taskOut(getTaskRow(r.id)) };
  });

def("completeTask", true,
  "Mark a To-Do task as done (or not done with completed=false). Daily Planner blocks for it show as done too.",
  z.object({ taskId: id, completed: z.boolean().optional() }),
  (i) => {
    const r = getTaskRow(i.taskId);
    updateRow("tasks", r.id, { completed: i.completed ?? true });
    return { updated: taskOut(getTaskRow(r.id)) };
  });

def("deleteTask", true,
  "Delete a To-Do task. Its Daily Planner blocks are removed too.",
  z.object({ taskId: id }),
  (i) => {
    const r = getTaskRow(i.taskId);
    const out = taskOut(r);
    db.prepare("DELETE FROM tasks WHERE id = ?").run(r.id);
    return { deleted: out.title, plannerBlocksRemoved: out.plannedIn };
  });

// ----- Daily Planner -----

def("getDailyPlan", false,
  "Read the Daily Planner for one date (blocks with ids, times, linked task/event).",
  z.object({ date }),
  (i) => planOut(i.date));

def("getPlanningContext", false,
  "Everything needed to plan a day in one call: settings, that day's Schedule events, free gaps between events, the existing plan, open To-Do tasks and upcoming assessments with how much study each still needs (and a suggested amount for this day). Call this before creating or re-planning a day.",
  z.object({ date }),
  (i, ctx) => ({
    ...dayInfo(i.date, ctx),
    settings: readSettings(),
    openTasks: openTasksFor(i.date, ctx),
    assessments: studyNeedsFor(i.date, ctx),
  }));

def("getWeekPlanningContext", false,
  "Like getPlanningContext but for several days at once (up to 7). Use it for 'plan my week' or 'plan my week around my assessments', then save each day with createDailyPlan/updateDailyPlan.",
  z.object({ startDate: date, days: z.number().int().min(1).max(7).optional().describe("how many days, default 7") }),
  (i, ctx) => {
    const n = i.days ?? 7;
    const days = Array.from({ length: n }, (_, k) => addDays(i.startDate, k));
    return {
      settings: readSettings(),
      days: days.map((d) => dayInfo(d, ctx)),
      openTasks: openTasksFor(i.startDate, ctx),
      assessments: studyNeedsFor(i.startDate, ctx).map((x) => ({
        ...x,
        studyDaysInThisRange: days.filter((d) => d < x.date).length,
        suggestedStudyMinutesThisDay: undefined,
        suggestedMinutesPerStudyDay: x.daysUntilTest >= 1
          ? Math.min(120, Math.max(30, Math.ceil(Math.max(0, x.remainingMinutes - x.plannedOnOtherDays - x.plannedOnThisDay) / x.daysUntilTest / 15) * 15))
          : 0,
      })),
    };
  });

def("createDailyPlan", true,
  "Create (or completely replace) the Daily Planner for a date with a full chronological list of blocks. Blocks must not overlap.",
  z.object({
    date,
    blocks: z.array(blockInput).min(1).max(40),
    notes: optText(600).describe("short note shown under the plan, e.g. 'Not scheduled: Design B4 (due next week)'"),
  }),
  (i) => {
    writePlan(i.date, i.blocks, i.notes ?? null);
    return { saved: true, date: i.date, blockCount: i.blocks.length };
  });

def("updateDailyPlan", true,
  "Update a date's Daily Planner: replace all its blocks (pass the full corrected list) and/or change the plan note. Best for rearranging several blocks at once.",
  z.object({ date, blocks: z.array(blockInput).max(40).optional(), notes: optText(600) }),
  (i) => {
    if (i.blocks) writePlan(i.date, i.blocks, i.notes);
    else if (i.notes !== undefined) updateRow("daily_plans", ensurePlan(i.date), { notes: clean(i.notes) });
    return { saved: true, plan: planOut(i.date) };
  });

def("deleteDailyPlan", true,
  "Clear the whole Daily Planner for a date.",
  z.object({ date }),
  (i) => {
    const r = db.prepare("DELETE FROM daily_plans WHERE date = ?").run(i.date);
    return { cleared: r.changes > 0, date: i.date };
  });

def("addDailyPlanBlock", true,
  "Add one block to a date's Daily Planner (creates the plan if needed).",
  z.object({ date, ...blockShape }),
  (i) => {
    checkTimes(t(i.startTime), i.endTime && t(i.endTime));
    checkRefs([i]);
    const row = blockRow(ensurePlan(i.date), i);
    insertBlock.run(row);
    const overlaps = findOverlaps(planOut(i.date).blocks);
    return { added: row.id, overlaps: overlaps.length ? overlaps : undefined };
  });

def("updateDailyPlanBlock", true,
  "Change one Daily Planner block: title, times (to move it), emoji, notes, or move it to another date.",
  z.object({
    blockId: id, date: date.optional().describe("move the block to this date"),
    title: title.optional(), startTime: time.optional(), endTime: time.nullable().optional(),
    emoji, category, source: z.enum(SOURCES).optional(), taskId: id.nullable().optional(),
    assessmentId: id.nullable().optional().describe("link/unlink this block to an assessment's study time"),
    notes,
  }),
  (i) => {
    const b = getBlockRow(i.blockId);
    const start = t(i.startTime ?? b.startTime);
    const end = i.endTime === undefined ? b.endTime : i.endTime && t(i.endTime);
    checkTimes(start, end);
    if (i.taskId) checkRefs([{ title: b.title, startTime: start, taskId: i.taskId }]);
    if (i.assessmentId) checkRefs([{ title: b.title, startTime: start, assessmentId: i.assessmentId }]);
    const newAssessment = i.assessmentId === undefined ? b.assessmentId : i.assessmentId;
    db.transaction(() => {
      // A ticked-off study block: take back its old credit, then count the new length (never double-counts).
      if (b.completed && b.assessmentId) creditStudy(b.assessmentId, -b.countedMinutes);
      updateRow("daily_plan_blocks", b.id, {
        dailyPlanId: i.date ? ensurePlan(i.date) : undefined,
        title: i.title, startTime: start, endTime: end, emoji: clean(i.emoji), category: clean(i.category),
        source: i.source ?? (i.assessmentId ? "study" : undefined), taskId: i.taskId, assessmentId: i.assessmentId,
        notes: clean(i.notes),
      });
      if (b.completed) {
        const applied = newAssessment ? creditStudy(newAssessment, blockMinutes({ startTime: start, endTime: end })) : 0;
        updateRow("daily_plan_blocks", b.id, { completed: newAssessment ? 1 : 0, countedMinutes: applied });
      }
    })();
    const d = (db.prepare("SELECT date FROM daily_plans WHERE id = (SELECT dailyPlanId FROM daily_plan_blocks WHERE id = ?)")
      .get(b.id) as { date: string }).date;
    const overlaps = findOverlaps(planOut(d).blocks);
    return { updated: b.id, date: d, overlaps: overlaps.length ? overlaps : undefined };
  });

def("deleteDailyPlanBlock", true,
  "Remove one block from the Daily Planner.",
  z.object({ blockId: id }),
  (i) => {
    const b = getBlockRow(i.blockId);
    db.prepare("DELETE FROM daily_plan_blocks WHERE id = ?").run(b.id);
    return { deleted: b.title };
  });

def("shiftDailyPlanBlocks", true,
  "Move every block that starts at or after fromTime (and before untilTime, if given) later or earlier by a number of minutes. E.g. 'push everything after football back 30 minutes'.",
  z.object({
    date, fromTime: time, untilTime: time.optional(),
    minutes: z.number().int().min(-720).max(720).describe("positive = later, negative = earlier"),
  }),
  (i) => {
    const plan = planOut(i.date);
    const from = toMin(t(i.fromTime));
    const until = i.untilTime ? toMin(t(i.untilTime)) : Infinity;
    const moving = plan.blocks.filter((b) => toMin(b.startTime) >= from && toMin(b.startTime) < until);
    for (const b of moving) {
      const s = toMin(b.startTime) + i.minutes;
      const e = b.endTime ? toMin(b.endTime) + i.minutes : null;
      if (s < 0 || (e ?? s) > 23 * 60 + 59) throw new ToolError(`Shifting "${b.title}" would move it outside the day`);
    }
    db.transaction(() => {
      for (const b of moving) {
        updateRow("daily_plan_blocks", b.id, {
          startTime: fromMin(toMin(b.startTime) + i.minutes),
          endTime: b.endTime ? fromMin(toMin(b.endTime) + i.minutes) : null,
        });
      }
    })();
    const overlaps = findOverlaps(planOut(i.date).blocks);
    return { moved: moving.map((b) => b.title), overlaps: overlaps.length ? overlaps : undefined };
  });

// ----- Assessments -----

const studyMinutes = z.number().int().min(0).max(6000);

def("getAssessments", false,
  "List assessments (tests/exams) with date, days until, topics, total/completed/remaining study minutes, progress %, priority and planned study sessions. By default only upcoming ones (today onwards).",
  z.object({
    fromDate: date.optional().describe("default today"),
    toDate: date.optional(),
    includePast: z.boolean().optional(),
    subject: z.string().max(60).optional().describe("filter by subject, e.g. Physics (loose match)"),
  }),
  (i, ctx) => {
    let rows = db.prepare("SELECT * FROM assessments ORDER BY date, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END")
      .all() as AssessmentRow[];
    const from = i.includePast ? "0000-01-01" : i.fromDate ?? ctx.today;
    rows = rows.filter((a) => a.date >= from && (!i.toDate || a.date <= i.toDate));
    if (i.subject) {
      const q = i.subject.toLowerCase();
      rows = rows.filter((a) => a.subject.toLowerCase().includes(q) || a.title.toLowerCase().includes(q));
    }
    return { today: ctx.today, assessments: rows.map((a) => assessmentOut(a, ctx.today)) };
  });

def("getAssessment", false,
  "Full details of one assessment, including every study session planned or done for it.",
  z.object({ assessmentId: id }),
  (i, ctx) => {
    const a = getAssessmentRow(i.assessmentId);
    return { ...assessmentOut(a, ctx.today), allStudySessions: studyBlocksFor(a.id).map((b) => ({ ...b, completed: !!b.completed })) };
  });

def("createAssessment", true,
  "Add an upcoming assessment (test, exam, quiz, presentation...) with how much study it needs.",
  z.object({
    subject: z.string().trim().min(1).max(60).describe("e.g. Physics"),
    title: title.describe("e.g. Forces Test. If no name was given use something like 'Test'"),
    date: date.describe("the day of the assessment"),
    totalStudyMinutes: studyMinutes.describe("total study needed, e.g. 3 hours = 180"),
    completedStudyMinutes: studyMinutes.optional(),
    topics: optText(1000).describe("what to study, comma separated"),
    priority: priority.optional(),
    notes: optText(1000).describe("notes or resources"),
  }),
  (i, ctx) => {
    const aid = newId();
    const done = Math.min(i.completedStudyMinutes ?? 0, i.totalStudyMinutes);
    db.prepare(
      `INSERT INTO assessments (id, subject, title, date, topics, totalStudyMinutes, completedStudyMinutes, priority, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(aid, i.subject, i.title, i.date, clean(i.topics) ?? null, i.totalStudyMinutes, done, i.priority ?? "medium", clean(i.notes) ?? null);
    return { created: assessmentOut(getAssessmentRow(aid), ctx.today) };
  });

def("updateAssessment", true,
  "Change an assessment: subject, name, date (e.g. test moved), topics, total study needed, study done so far, priority or notes.",
  z.object({
    assessmentId: id,
    subject: z.string().trim().min(1).max(60).optional(),
    title: title.optional(),
    date: date.optional(),
    totalStudyMinutes: studyMinutes.optional(),
    completedStudyMinutes: studyMinutes.optional().describe("set the exact amount done; to ADD study use logStudySession"),
    topics: optText(1000),
    priority: priority.optional(),
    notes: optText(1000),
  }),
  (i, ctx) => {
    const a = getAssessmentRow(i.assessmentId);
    const total = i.totalStudyMinutes ?? a.totalStudyMinutes;
    const completed = Math.min(i.completedStudyMinutes ?? a.completedStudyMinutes, total);
    updateRow("assessments", a.id, {
      subject: i.subject, title: i.title, date: i.date, topics: clean(i.topics), priority: i.priority, notes: clean(i.notes),
      totalStudyMinutes: total, completedStudyMinutes: completed, updatedAt: new Date().toISOString(),
    });
    const out = assessmentOut(getAssessmentRow(a.id), ctx.today);
    const lateSessions = i.date
      ? studyBlocksFor(a.id).filter((b) => b.date >= i.date! && !b.completed && b.date >= ctx.today)
      : [];
    return {
      updated: out,
      studySessionsOnOrAfterNewDate: lateSessions.length ? lateSessions : undefined,
      note: lateSessions.length ? "These planned study sessions are now on/after the test — move or delete them." : undefined,
    };
  });

def("deleteAssessment", true,
  "Delete an assessment. Its future, not-yet-done study blocks are removed from the Daily Planner.",
  z.object({ assessmentId: id }),
  (i, ctx) => {
    const a = getAssessmentRow(i.assessmentId);
    const future = studyBlocksFor(a.id).filter((b) => b.date >= ctx.today && !b.completed);
    db.transaction(() => {
      for (const b of future) db.prepare("DELETE FROM daily_plan_blocks WHERE id = ?").run(b.id);
      db.prepare("DELETE FROM assessments WHERE id = ?").run(a.id);
    })();
    return { deleted: `${a.subject} — ${a.title}`, studyBlocksRemoved: future.length };
  });

def("logStudySession", true,
  "Record study the user has done for an assessment (e.g. 'I studied physics for 45 minutes'). Adds minutes to completed study, capped at the total required. Use a negative number to correct a mistake.",
  z.object({ assessmentId: id, minutes: z.number().int().min(-600).max(600).refine((m) => m !== 0, "minutes can't be 0") }),
  (i, ctx) => {
    const applied = creditStudy(i.assessmentId, i.minutes);
    const out = assessmentOut(getAssessmentRow(i.assessmentId), ctx.today);
    return {
      requestedMinutes: i.minutes, addedMinutes: applied, cappedAtTotal: applied < i.minutes,
      completedStudyMinutes: out.completedStudyMinutes, remainingMinutes: out.remainingMinutes, progress: out.progress,
    };
  });

def("completeStudyBlock", true,
  "Tick off (or untick) a Daily Planner study block linked to an assessment. Its length counts toward the assessment's completed study exactly once.",
  z.object({ blockId: id, done: z.boolean().optional().describe("default true") }),
  (i, ctx) => {
    const aid = setStudyBlockDone(i.blockId, i.done ?? true);
    const out = assessmentOut(getAssessmentRow(aid), ctx.today);
    return { assessment: `${out.subject} — ${out.title}`, completedStudyMinutes: out.completedStudyMinutes, remainingMinutes: out.remainingMinutes, progress: out.progress };
  });

// ----- Settings -----

def("getSettings", false, "Read the planner settings.", z.object({}), () => readSettings());

def("updateSettings", true,
  "Change planner settings: wake-up time, sleep time, default break length, whether to include meals and travel time.",
  z.object({
    wakeTime: time.optional(), sleepTime: time.optional(), breakMinutes: z.number().int().min(0).max(120).optional(),
    includeMeals: z.boolean().optional(), includeTravel: z.boolean().optional(),
    travelMinutes: z.number().int().min(0).max(180).optional(),
  }),
  (i) => {
    updateRow("settings", "1", {
      wakeTime: i.wakeTime && t(i.wakeTime), sleepTime: i.sleepTime && t(i.sleepTime), breakMinutes: i.breakMinutes,
      includeMeals: i.includeMeals, includeTravel: i.includeTravel, travelMinutes: i.travelMinutes,
    });
    return readSettings();
  });

// ---------- public API ----------

export type ToolResult = { ok: true; result: unknown; mutates: boolean } | { ok: false; error: string };

export function runTool(name: string, input: unknown, ctx: ToolContext): ToolResult {
  const tool = defs.find((d) => d.name === name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = tool.schema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input: " + parsed.error.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; "),
    };
  }
  try {
    return { ok: true, result: tool.run(parsed.data, ctx), mutates: tool.mutates };
  } catch (err) {
    if (err instanceof ToolError) return { ok: false, error: err.message };
    console.error(`Tool ${name} failed`, err);
    return { ok: false, error: "Something went wrong saving that change." };
  }
}

/** Tool definitions (name, description, JSON schema) for the AI model. */
export function toolSchemas() {
  return defs.map((d) => {
    const schema = z.toJSONSchema(d.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: d.name, description: d.description, input_schema: schema as { type: "object" } & Record<string, unknown> };
  });
}

export const MUTATING_TOOLS = new Set(defs.filter((d) => d.mutates).map((d) => d.name));

/**
 * A small "index" sent with each chat message so simple questions need no extra Gemini request.
 * Deliberately capped: today/tomorrow's events, the nearest tasks and assessments, and the plan being viewed.
 * Everything else is fetched with tools only when a request needs it.
 */
export function snapshot(ctx: ToolContext, viewDate?: string) {
  const events = db.prepare("SELECT * FROM events").all() as EventRow[];
  const tasks = db.prepare(
    "SELECT * FROM tasks WHERE completed = 0 ORDER BY dueDate IS NULL, dueDate, CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
  ).all() as TaskRow[];
  const assessments = db.prepare("SELECT * FROM assessments WHERE date >= ? ORDER BY date").all(ctx.today) as AssessmentRow[];
  return {
    settings: readSettings(),
    events: expand(events, ctx.today, addDays(ctx.today, 1)),
    tasks: tasks.slice(0, 8),
    moreTasks: Math.max(0, tasks.length - 8),
    assessments: assessments.slice(0, 5).map((a) => ({ ...a, remaining: Math.max(0, a.totalStudyMinutes - a.completedStudyMinutes) })),
    moreAssessments: Math.max(0, assessments.length - 5),
    viewedPlan: viewDate && isValidDate(viewDate) ? planOut(viewDate) : null,
  };
}

/** Make tool results smaller before they go back to the model: drop empty values. */
export function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue;
      out[k] = prune(v);
    }
    return out;
  }
  return value;
}

export { toOccurrence };
