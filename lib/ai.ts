import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type FunctionCall, type Part } from "@google/genai";
import { addDays, longDate, time12, WEEKDAYS, weekday } from "./dates";
import { MUTATING_TOOLS, prune, runTool, snapshot, toolSchemas, type ToolContext } from "./tools";

export type ChatMessage = { role: "user" | "assistant"; content: string; actions?: string };
export type View = { page?: string; date?: string };

export class ChatError extends Error {}

// How much past conversation is sent with each message. Enough for "it"/"that" follow-ups, not the whole chat.
const HISTORY_MESSAGES = 10;
// Safety limit on Gemini requests for one message (normal requests use 1-3).
const MAX_REQUESTS_PER_MESSAGE = 8;

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
  createAssessment: "Assessments updated",
  updateAssessment: "Assessments updated",
  deleteAssessment: "Assessments updated",
  logStudySession: "Study time logged",
  completeStudyBlock: "Study time logged",
};

const RULES = `You run "My Planner", a student's planner with 4 pages: Schedule (fixed events), To-Do (tasks), Daily Planner (time blocks per date) and Assessments (tests with the study time each needs). You change things with tools — never just give advice.

REPLIES
- After making changes reply with ONE short sentence, e.g. "Done — added Maths Tuition every Monday, 3–4 pm." Never paste a plan or list of blocks; the page shows it. If tasks or study didn't fit into a plan, add one short sentence naming them.
- Put that sentence in the SAME response as your final saving tool call(s), so no extra round trip is needed. Leave it out if you still need a tool's result first.
- Questions ("what do I have tomorrow?", "how much physics is left?") → answer briefly from the data. Ask a question only when the request is truly ambiguous.
- Replies use 12-hour times. Tools use dates YYYY-MM-DD and 24-hour HH:MM.
- Be economical: the SNAPSHOT below often already has what you need; make independent tool calls together in one response.

UNDERSTANDING
- Turn words into dates with the calendar below. Tonight/this evening = today. A bare weekday = the next one on or after today; "next Friday" = the Friday of next week.
- Times without am/pm: student common sense. Sport, tuition, music, gym, friends "5-7" = 17:00-19:00; tuition "3 to 4" = 15:00-16:00; "school 7:30 to 3" = 07:30-15:00. 1-6 usually means pm.
- Repeating wording (every Tuesday, Tuesdays, weekly, Monday to Friday) → createRecurringEvent. One date ("tomorrow") → createEvent.
- "it", "that", "actually make it…" = the latest item discussed. Earlier assistant turns end with <actions> giving ids. Otherwise find ids in the snapshot or with get tools. Never invent ids. Match names loosely ("chemistry" = "Chemistry Homework"). Update instead of creating duplicates.
- Commitments or tasks mentioned inside a planning request: add any that are missing (events one-off unless repeating; tasks with the duration given), then plan.

SCHEDULE: for a recurring event, one date only → deleteEvent / updateEvent with occurrenceDate ("cancel football tomorrow", "move football tomorrow to 6-8"). Change the whole series only for every/always/from now on, or when correcting a series just created. Cancelled or moved events update their planner blocks automatically; replan only if asked.

TO-DO: "I finished X" → completeTask. Default priority medium; high if they call it urgent or important.

ASSESSMENTS (tests, exams, quizzes, mocks — anything to revise for; these are not To-Do tasks)
- "physics test next Thursday, need 3 hours" → createAssessment (title as given, else "Test"; totalStudyMinutes 180). "study biology for 2 hours before Monday" → a Biology assessment on Monday with 120 (or update the existing one). No time given → estimate (quiz 60, test 180, exam 300) and say so.
- Test moved → updateAssessment date, then move or delete any study sessions it reports on/after the new date. New total, priority or topics → updateAssessment.
- "I studied physics for 45 minutes" → logStudySession (it caps at the total); do not also tick a block. "I did my physics session" → completeStudyBlock.
- "Which should I focus on?" → weigh days left, remaining minutes and priority; name one or two with a reason. "Prioritise chemistry, it's tomorrow" → high priority, and give it more study in that day's plan if one exists.

PLANNING a day or part of a day
1. getPlanningContext(date) — or getWeekPlanningContext once for a week. The user's own constraints win.
2. Build the day chronologically from wake-up to sleep:
   - "Wake up 🌅" ~30 min (includes breakfast if meals are on). Every Schedule event as its own block (eventId, source event). Travel blocks of travelMinutes around away-from-home events if travel is on. If meals are on: lunch (after school on school days, often "Relax & Lunch 😌🍽️") and dinner ~18:30-19:30 placed around events. A 30-min break after school before any work.
   - Tasks: source task, taskId, title = task title (add "(part 2)" when split). Order: overdue, due today/tomorrow, high priority, the rest. Use estimatedMinutes (30 if unknown) minus time already planned.
   - Study: each assessment lists remainingMinutes, daysUntilTest and suggestedStudyMinutesThisDay — start from that. Spread study across the days before a test instead of cramming; closer or high-priority tests get more, later tests still get a short session if there's room. Never on or after the test day (a test today gets at most a short review). Blocks: source study, assessmentId, title "<Subject> — <Title>", notes naming a concrete topic.
   - Sessions 25-60 min with a breakMinutes break between consecutive work blocks. School days: about 2-3 h of work in total; weekends up to 4-5 h; at most ~2 h for one assessment in a day. Never fill every minute: leave at least 1 h of free time ("Free time 🎮", "Relax 😌"). If only a 30-60 min window is realistic, use just that.
   - End with "Relax 😌" ~30 min, then "Sleep 💤" at sleep time with no endTime. When planning today: nothing before the current time; keep finished blocks as they are.
   - If not everything fits, leave the least urgent out and write "Not scheduled: …" in the plan notes.
3. Save with createDailyPlan, or updateDailyPlan (full list) when a plan already exists. Never leave overlapping blocks.
- "Plan my evening": keep earlier blocks, rebuild from the stated time (or 17:00). "Plan my week (around my assessments)": getWeekPlanningContext once, then save every day in one response.
- Small edits ("move design after dinner", "give me a 30 minute break", "remove everything after 10pm", "push everything after football back 30 minutes", "make tonight less intense"): use the plan in the snapshot if it's for that date (else getDailyPlan), then make the smallest change: updateDailyPlanBlock / addDailyPlanBlock / deleteDailyPlanBlock / shiftDailyPlanBlocks, or updateDailyPlan when several blocks move. Fix any overlaps a tool reports.
- On the Daily Planner page, "the plan" / "this day" means the date being viewed.
- Combined requests ("football got cancelled tomorrow, so plan around my physics test"): do every part.`;

function buildSystem(view: View, ctx: ToolContext) {
  const page = view.page?.replace("/", "") || "planner";
  const viewDate = page === "planner" && view.date ? view.date : undefined;
  const snap = snapshot(ctx, viewDate);
  const cal: string[] = [];
  for (let i = -1; i <= 13; i++) {
    const d = addDays(ctx.today, i);
    const tag = i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : i === -1 ? " (yesterday)" : "";
    cal.push(`${WEEKDAYS[weekday(d)].slice(0, 3)} ${d}${tag}`);
  }
  const s = snap.settings;
  const lines = (arr: string[], none = "(none)") => (arr.length ? arr.join("\n") : none);

  const events = lines(snap.events.map((o) =>
    `- ${o.date} ${o.startTime}-${o.endTime} ${o.title} [eventId ${o.eventId}${o.recurring ? ", repeats" : ""}]`));
  const tasks = lines(snap.tasks.map((tk) =>
    `- ${tk.title} [taskId ${tk.id}] due ${tk.dueDate ?? "—"}, ${tk.priority}, ${tk.estimatedMinutes ?? "?"} min`))
    + (snap.moreTasks ? `\n(+${snap.moreTasks} more — use getTasks)` : "");
  const assessments = lines(snap.assessments.map((a) =>
    `- ${a.subject} — ${a.title} [assessmentId ${a.id}] on ${a.date}, ${a.priority}, ${a.remaining} of ${a.totalStudyMinutes} min left`))
    + (snap.moreAssessments ? `\n(+${snap.moreAssessments} more — use getAssessments)` : "");
  const plan = snap.viewedPlan?.exists
    ? `\nPLAN BEING VIEWED (${snap.viewedPlan.date})\n` + snap.viewedPlan.blocks.map((b) =>
        `- ${b.startTime}${b.endTime ? "-" + b.endTime : ""} ${b.title} [blockId ${b.id}${b.taskId ? ", task" : ""}${b.eventId ? ", event" : ""}${b.assessmentId ? ", study" : ""}]`).join("\n")
    : "";

  return `${RULES}

NOW: ${longDate(ctx.today)} (${ctx.today}), ${time12(ctx.now)} (${ctx.now}). User is on the ${page} page${viewDate ? ` viewing ${viewDate}` : ""}.
CALENDAR: ${cal.join(" · ")}
SETTINGS: wake ${s.wakeTime}, sleep ${s.sleepTime}, breaks ${s.breakMinutes} min, meals ${s.includeMeals ? "on" : "off"}, travel ${s.includeTravel ? `on (${s.travelMinutes} min)` : "off"}

SNAPSHOT (partial — use tools for anything else)
Events today & tomorrow:
${events}
Nearest open tasks:
${tasks}
Upcoming assessments:
${assessments}${plan}`;
}

/** Gemini only needs names, types, enums and descriptions. The server still validates every limit and format. */
const DROP = new Set(["pattern", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "additionalProperties", "$schema", "default"]);
function compactSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchema);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  // "string or null" → just "string" (leaving a field out has the same effect)
  if (Array.isArray(obj.anyOf)) {
    const nonNull = (obj.anyOf as Record<string, unknown>[]).filter((x) => x.type !== "null");
    if (nonNull.length === 1) return compactSchema({ ...nonNull[0], ...(obj.description ? { description: obj.description } : {}) });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!DROP.has(k)) out[k] = compactSchema(v);
  // Self-explanatory fields repeated in many tools don't need their descriptions every time.
  if (out.properties && typeof out.properties === "object") {
    const props = out.properties as Record<string, Record<string, unknown>>;
    for (const key of ["emoji", "category", "notes", "title"]) if (props[key]) delete props[key].description;
  }
  return out;
}

let cachedDeclarations: { name: string; description: string; parametersJsonSchema: unknown }[] | null = null;
function declarations() {
  cachedDeclarations ??= toolSchemas().map((t) => ({
    name: t.name, description: t.description, parametersJsonSchema: compactSchema(t.input_schema),
  }));
  return cachedDeclarations;
}

/** Gemini wants alternating "user"/"model" turns that start with the user. Only recent turns are sent. */
function toContents(history: ChatMessage[]): Content[] {
  const recent = history.slice(-HISTORY_MESSAGES);
  const lastAssistantWithActions = recent.map((m) => m.role === "assistant" && !!m.actions).lastIndexOf(true);
  const out: { role: "user" | "model"; text: string }[] = [];
  recent.forEach((m, i) => {
    const role = m.role === "assistant" ? "model" : "user";
    // Only the most recent action log is needed to resolve "it"/"that"; older ones are dropped.
    const withActions = m.role === "assistant" && m.actions && i === lastAssistantWithActions;
    const text = (withActions ? `${m.content}\n<actions>\n${m.actions!.slice(0, 1200)}\n</actions>` : m.content).trim();
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.text += "\n\n" + text;
    else out.push({ role, text });
  });
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
}

/** A short record of what a tool did (with ids), kept so follow-ups like "make it 5:30" work. */
function actionLine(name: string, args: Record<string, unknown>, result: unknown) {
  const r = (result ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const item = r.created ?? r.updated ?? r.replacement;
  const label = String(item?.title ?? args.title ?? args.subject ?? "");
  const idPart = item?.id ? ` id=${item.id}` : "";
  const extra = ["eventId", "taskId", "assessmentId", "blockId", "date", "occurrenceDate"]
    .filter((k) => args[k] !== undefined).map((k) => `${k}=${String(args[k])}`).join(" ");
  return `${name}${label ? ` "${label}"` : ""}${idPart}${extra ? " " + extra : ""}`;
}

/** Tool results that the model should see before replying (warnings it may need to act on). */
function needsFollowUp(result: unknown) {
  const r = (result ?? {}) as Record<string, unknown>;
  return !!(r.overlaps || r.note || r.studySessionsOnOrAfterNewDate || r.cappedAtTotal);
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Seconds Google asks us to wait, if it says (RetryInfo in the error details). */
function retryAfterSeconds(err: ApiError) {
  const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(err.message) ?? /retry in (\d+(?:\.\d+)?)s/i.exec(err.message);
  return m ? Math.ceil(Number(m[1])) : null;
}

export class QuotaError extends ChatError {
  constructor(public seconds: number | null, public daily: boolean) {
    super(daily
      ? "Gemini's free daily limit has been used up. It resets at midnight Pacific time — or switch GEMINI_MODEL to another free model."
      : `Gemini's free per-minute limit was reached. Try again in ${seconds ? `about ${seconds} seconds` : "a minute"}.`);
  }
}

/**
 * One Gemini request. Quota errors (429) are NOT retried — retrying spends more of the same quota.
 * A temporary server error (500/503) is retried once after a short pause.
 */
async function generate(ai: GoogleGenAI, params: Parameters<GoogleGenAI["models"]["generateContent"]>[0]) {
  try {
    return await ai.models.generateContent(params);
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      throw new QuotaError(retryAfterSeconds(err), /per ?day|PerDay|daily/i.test(err.message));
    }
    if (err instanceof ApiError && (err.status === 500 || err.status === 503)) {
      await sleep(1500);
      return await ai.models.generateContent(params);
    }
    throw err;
  }
}

function thinkingConfig(model: string) {
  const level = (process.env.GEMINI_THINKING_LEVEL || "low").toUpperCase();
  // Gemini 2.x models use a token budget instead of a level.
  if (/^gemini-2/.test(model)) return { thinkingBudget: level === "MINIMAL" ? 0 : level === "LOW" ? 512 : -1 };
  const map: Record<string, ThinkingLevel> = {
    MINIMAL: ThinkingLevel.MINIMAL, LOW: ThinkingLevel.LOW, MEDIUM: ThinkingLevel.MEDIUM, HIGH: ThinkingLevel.HIGH,
  };
  return { thinkingLevel: map[level] ?? ThinkingLevel.LOW };
}

export async function runChat(history: ChatMessage[], view: View, ctx: ToolContext) {
  if (!process.env.GEMINI_API_KEY) {
    throw new ChatError("The AI isn't connected yet. Add your GEMINI_API_KEY to the .env file, then restart the website.");
  }
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
  });
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const config = {
    systemInstruction: buildSystem(view, ctx),
    tools: [{ functionDeclarations: declarations() }],
    thinkingConfig: thinkingConfig(model),
  };
  const contents = toContents(history);
  if (!contents.length) throw new ChatError("Type a message first.");

  const log: string[] = [];
  const changes = new Set<string>();
  const usage = { requests: 0, input: 0, output: 0, thinking: 0 };
  const finish = (reply: string) => {
    console.log(`[gemini] ${model}: ${usage.requests} request(s), ${usage.input} input + ${usage.output} output + ${usage.thinking} thinking tokens`);
    return { reply, actions: log.join("\n"), changes: [...changes] };
  };

  for (let step = 0; step < MAX_REQUESTS_PER_MESSAGE; step++) {
    const res = await generate(ai, { model, contents, config });
    usage.requests++;
    usage.input += res.usageMetadata?.promptTokenCount ?? 0;
    usage.output += res.usageMetadata?.candidatesTokenCount ?? 0;
    usage.thinking += res.usageMetadata?.thoughtsTokenCount ?? 0;

    const modelContent = res.candidates?.[0]?.content;
    // Send the model's turn back exactly as received (it carries Gemini's "thought signatures").
    if (modelContent) contents.push({ role: "model", parts: modelContent.parts ?? [] });
    const text = (modelContent?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("\n").trim();

    const calls: FunctionCall[] = res.functionCalls ?? [];
    if (calls.length === 0) return finish(text || "Done.");

    const parts: Part[] = [];
    let allSavedCleanly = true;
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      const r = runTool(name, args, ctx);
      const mutating = MUTATING_TOOLS.has(name);
      if (!r.ok || !mutating || needsFollowUp(r.ok ? r.result : null)) allSavedCleanly = false;
      if (r.ok && mutating) {
        changes.add(LABELS[name] ?? "Planner updated");
        log.push(actionLine(name, args, r.result));
      }
      parts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: r.ok ? { result: prune(r.result) } : { error: r.error },
        },
      });
    }
    // The model already wrote its confirmation alongside saving calls that all succeeded: no need to ask it again.
    if (text && allSavedCleanly) return finish(text);
    contents.push({ role: "user", parts });
  }

  return finish(changes.size
    ? "I made some changes but this took more steps than expected — have a look and tell me what's still missing."
    : "Sorry, I couldn't finish that. Could you say it a bit more simply?");
}
