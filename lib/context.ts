import { DATE_RE, TIME_RE, isValidDate, normTime } from "./dates";
import type { ToolContext } from "./tools";

/** The browser tells us its local date and time, so "today" and "tonight" match where you are. */
export function readContext(raw: unknown): ToolContext {
  const r = (raw ?? {}) as { today?: unknown; now?: unknown };
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = typeof r.today === "string" && DATE_RE.test(r.today) && isValidDate(r.today)
    ? r.today
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = typeof r.now === "string" && TIME_RE.test(r.now) ? normTime(r.now) : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { today, now };
}
