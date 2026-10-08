import { ApiError, GoogleGenAI, type Content, type FunctionCall, type Part } from "@google/genai";
import { addDays, longDate, time12, WEEKDAYS, weekday } from "./dates";
import { MUTATING_TOOLS, runTool, snapshot, toolSchemas, type ToolContext } from "./tools";

export type ChatMessage = { role: "user" | "assistant"; content: string; actions?: string };
export type View = { page?: string; date?: string };

export class ChatError extends Error {}

const LABELS: Record<string, string> = {
  createEvent: "Schedule updated",
  createRecurringEvent: "Schedule updated",
  updateEvent: "Schedule updated",
  deleteEvent: "Schedule updated",
  createTask: "To-Do updated",
  updateTask: "To-Do updated",
  completeTask: "To-Do updated",
  deleteTask: "To-Do updated",
  createDailyPlan: "Daily Planner updated",
  updateDailyPlan: "Daily Planner updated",
  deleteDailyPlan: "Daily Planner updated",
  addDailyPlanBlock: "Daily Planner updated",
  updateDailyPlanBlock: "Daily Planner updated",
  deleteDailyPlanBlock: "Daily Planner updated",
  shiftDailyPlanBlocks: "Daily Planner updated",
  updateSettings: "Settings updated",
};

const RULES = `You are the engine inside "My Planner", a student's personal planning website with three pages: Schedule (fixed events), To-Do (tasks) and Daily Planner (a chronological list of time blocks for a date). You are not a chat advisor: you run the planner. Every request that implies a change must be carried out with your tools, which save to the database and update the website.

HOW TO REPLY
- After making changes, reply with ONE short sentence, e.g. "Done — added Maths Tuition every Monday, 3:00–4:00 pm." or "Done — I planned your Thursday."
- Never paste a plan, timetable or list of blocks into the chat. The user reads the plan on the Daily Planner page.
- If some tasks didn't fit in a plan, add a short second sentence naming them.
- Only for questions (e.g. "what do I have tomorrow?") answer from the data, briefly; a short list is fine there.
- Ask a short question only when you genuinely cannot tell what they mean (e.g. two different tasks match). Otherwise make sensible assumptions and act.
- Use 12-hour times in replies (3:30–4:30 pm). Tools always use 24-hour HH:MM.

UNDERSTANDING THE USER
- Use the calendar below to turn words into dates. "Tonight/this evening/later" = today. A bare weekday ("Friday", "due Friday") = the next one on or after today; "next Friday" = the Friday of next week.
- Times without am/pm: use common sense for a student. "5-7" for football, tuition, music, gym or friends = 17:00-19:00. "3 to 4" tuition = 15:00-16:00. "School 7:30 to 3" = 07:30-15:00. Numbers 1-6 usually mean pm; 7-11 mean am for school/morning things and pm for evening activities.
- Recurring wording ("every Tuesday", "Tuesdays", "weekly", "Monday to Friday", "each day") => createRecurringEvent. A specific date or "tomorrow" => createEvent.
- "it", "that", "actually make it..." refer to the most recent thing discussed. Earlier assistant turns end with an <actions> log of the tools that ran and the ids they touched; use those ids. Otherwise look ids up with getEvents/getTasks/getDailyPlan. Never invent ids.
- Match names loosely: "chemistry" matches "Chemistry Homework"; "design" matches a design task/block. If several match, prefer the one that is due soonest or appears on the relevant day.
- Before creating an event or task, check it doesn't already exist (see snapshot below); update instead of duplicating.
- When the user mentions fixed commitments or tasks inside a planning request ("tomorrow I have school until 3, football 5-7... I need 45 min of chemistry"), make sure they exist: add missing events to the Schedule (one-off unless they say it repeats) and missing tasks to the To-Do list (with the duration they gave), then plan.

SCHEDULE EDITS
- For a recurring event, "cancel football tomorrow" => deleteEvent with occurrenceDate. "Move football tomorrow to 6-8" => updateEvent with occurrenceDate. Change the whole series only when they say every/always/from now on, or when correcting a series you just created ("Actually make it 3:30 to 4:30" right after adding it).
- When an event is cancelled, moved or deleted, the system automatically removes or adjusts its block in Daily Plans. If they ask to replan ("...replan my day/evening"), then re-plan the affected part of that day using the freed time.

TO-DO
- "I finished X" / "done with X" => completeTask. Default priority medium; use high for tests, exams or things they call urgent/important.

DAILY PLANNING (when asked to plan or replan a day or part of a day)
1. Call getPlanningContext for the date. If the user gave extra constraints, those win.
2. Build a realistic, chronological day from wake-up to sleep, like a student's paper planner:
   - "Wake up 🌅" (routine) at wake time, about 30 min (includes breakfast if meals are on).
   - Every Schedule event that day as its own block with eventId set and source "event" (use the event's title and emoji).
   - If travel is on, add travel blocks of travelMinutes before/after events away from home (school, sport, tuition, gym) where there is room.
   - If meals are on: lunch (after school on school days, often combined: "Relax & Lunch 😌🍽️"), dinner around 18:30-19:30 placed around events (about 30 min).
   - Work sessions for tasks: source "task", taskId set, title = the task title (add "(part 2)" etc. when split), a fitting emoji. Sessions 25-60 min; split longer tasks. Put a break of breakMinutes ("Break ☕") between back-to-back work sessions, and a 30-min decompression break after school before any work.
   - Choose tasks by urgency: overdue, then due today/tomorrow, then high priority, then the rest. Skip completed tasks. Use estimatedMinutes (assume 30 if unknown) minus time already planned on other days.
   - Keep it humane: school days about 2-3 hours of focused work, weekends up to about 4-5. Do NOT fill every minute — leave at least an hour of unstructured free time ("Free time 🎮", "Relax 😌", or "Friends" if they have plans).
   - End with "Relax 😌" winding down for ~30 min before sleep, then a final "Sleep 💤" block at sleep time with no endTime.
   - Gaps between blocks are fine (they show as free time).
   - Planning today: do not put anything before the current time; keep blocks that have already finished exactly as they are.
   - If not everything fits, leave the lowest-priority/least-urgent tasks out, write "Not scheduled: …" in the plan notes, and mention them in one short sentence.
3. Save with createDailyPlan (whole day) or updateDailyPlan (full corrected list) — never leave overlapping blocks.
- "Plan my evening"/"replan tonight": keep the earlier part of the day, rebuild from the stated time (or 17:00) onward. If no plan exists yet, create the whole day.
- "Make sure I get enough study time before Friday": spread sessions across several days up to the deadline (plan or update each of those days).
- Small edits ("move design to after dinner", "give me a 30 minute break", "remove everything after 10pm", "push everything after football back 30 minutes", "make tonight less intense"): read the plan with getDailyPlan, then make the smallest correct change — updateDailyPlanBlock / addDailyPlanBlock / deleteDailyPlanBlock / shiftDailyPlanBlocks, or updateDailyPlan with the full corrected list when several blocks must move. If a tool reports overlaps, fix them before replying.
- If the user is looking at the Daily Planner, "the plan", "move design", "this day" refer to the date they are viewing unless they say otherwise.`;

function buildSystem(view: View, ctx: ToolContext) {
  const snap = snapshot(ctx);
  const cal: string[] = [];
  for (let i = -7; i <= 21; i++) {
    const d = addDays(ctx.today, i);
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : i === -1 ? " (yesterday)" : "";
    cal.push(`${WEEKDAYS[weekday(d)]} ${d}${tag}`);
  }
  const page = view.page?.replace("/", "") || "planner";
  const viewing = page === "planner" && view.date ? ` viewing ${longDate(view.date)} (${view.date})` : "";
  const s = snap.settings;

  const events = snap.upcomingEvents.length
    ? snap.upcomingEvents
        .map((o) => `- ${o.date} ${o.startTime}-${o.endTime} ${o.title}${o.emoji ? " " + o.emoji : ""} [eventId ${o.eventId}${o.recurring ? `, repeats ${o.recurrence}` : ""}]`)
        .join("\n")
    : "(none)";
  const tasks = snap.openTasks.length
    ? snap.openTasks
        .map((tk) => `- ${tk.title} [taskId ${tk.id}] due ${tk.dueDate ?? "—"}, ${tk.priority}, ${tk.estimatedMinutes ?? "?"} min`)
        .join("\n")
    : "(none)";

  return `${RULES}

NOW
Today is ${longDate(ctx.today)} (${ctx.today}). Current time: ${ctx.now} (${time12(ctx.now)}).
The user is on the ${page} page${viewing}.

CALENDAR
${cal.join("\n")}

SETTINGS
Wake ${s.wakeTime}, sleep ${s.sleepTime}, breaks ${s.breakMinutes} min, meals ${s.includeMeals ? "on" : "off"}, travel ${s.includeTravel ? `on (${s.travelMinutes} min)` : "off"}.

SNAPSHOT — schedule for the next 8 days
${events}

SNAPSHOT — open To-Do tasks
${tasks}

Dates that already have a Daily Plan: ${snap.plannedDates.join(", ") || "none"}`;
}

/** Gemini wants alternating "user"/"model" turns that start with the user. */
function toContents(history: ChatMessage[]): Content[] {
  const out: { role: "user" | "model"; text: string }[] = [];
  for (const m of history.slice(-24)) {
    const role = m.role === "assistant" ? "model" : "user";
    const text = (m.role === "assistant" && m.actions ? `${m.content}\n<actions>\n${m.actions}\n</actions>` : m.content).trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += "\n\n" + text;
    else out.push({ role, text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
}

function brief(result: unknown) {
  const s = JSON.stringify(result);
  return s.length > 220 ? s.slice(0, 220) + "…" : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The free tier allows only a few requests per minute, so wait and retry when Google says "slow down". */
async function generateWithRetry(ai: GoogleGenAI, params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) {
  const waits = [4000, 10000, 20000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      if ((status === 429 || status === 500 || status === 503) && attempt < waits.length) {
        await sleep(waits[attempt]);
        continue;
      }
      throw err;
    }
  }
}

export async function runChat(history: ChatMessage[], view: View, ctx: ToolContext) {
  if (!process.env.GEMINI_API_KEY) {
    throw new ChatError("The AI isn't connected yet. Add your GEMINI_API_KEY to the .env file, then restart the website.");
  }
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
  });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const functionDeclarations = toolSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.input_schema,
  }));
  const config = { systemInstruction: buildSystem(view, ctx), tools: [{ functionDeclarations }] };
  const contents = toContents(history);
  if (!contents.length) throw new ChatError("Type a message first.");

  const log: string[] = [];
  const changes = new Set<string>();

  for (let step = 0; step < 20; step++) {
    const res = await generateWithRetry(ai, { model, contents, config });
    const modelContent = res.candidates?.[0]?.content;
    // Send the model's turn back exactly as received (it carries Gemini's "thought signatures").
    if (modelContent) contents.push({ role: "model", parts: modelContent.parts ?? [] });

    const calls: FunctionCall[] = res.functionCalls ?? [];
    if (calls.length === 0) {
      const reply = (modelContent?.parts ?? [])
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join("\n")
        .trim();
      return { reply: reply || "Done.", actions: log.join("\n"), changes: [...changes] };
    }

    const parts: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const r = runTool(name, call.args ?? {}, ctx);
      if (r.ok && MUTATING_TOOLS.has(name)) {
        changes.add(LABELS[name] ?? "Planner updated");
        log.push(`${name} ${brief(call.args)} -> ${brief(r.result)}`);
      }
      parts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: r.ok ? { result: r.result } : { error: r.error },
        },
      });
    }
    contents.push({ role: "user", parts });
  }

  return {
    reply: "I made some changes but this took more steps than expected — have a look and tell me what's still missing.",
    actions: log.join("\n"),
    changes: [...changes],
  };
}
