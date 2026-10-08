"use client";

import { useEffect, useState } from "react";
import { callTool, notifyChange, type Occurrence } from "@/lib/client";
import { WEEKDAYS, weekday } from "@/lib/dates";
import { Button, ErrorNote, Field, Modal, inputCls } from "./ui";

export type EventDraft = { date: string; startTime: string; endTime: string } | Occurrence;

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function EventEditor({ draft, onClose }: { draft: EventDraft | null; onClose: () => void }) {
  const existing = draft && "eventId" in draft ? draft : null;
  const [f, setF] = useState({
    title: "", emoji: "", category: "", date: "", startTime: "", endTime: "", notes: "",
    frequency: "none", days: [] as number[], until: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setError(null);
    setF({
      title: existing?.title ?? "",
      emoji: existing?.emoji ?? "",
      category: existing?.category ?? "",
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      notes: existing?.notes ?? "",
      frequency: existing?.recurrence ?? "none",
      days: existing?.daysOfWeek.length ? existing.daysOfWeek : [weekday(draft.date)],
      until: existing?.until ?? "",
    });
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const recurringExisting = !!existing?.recurring;

  async function act(fn: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await fn();
      notifyChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const common = () => ({
    title: f.title, emoji: f.emoji || null, category: f.category || null, notes: f.notes || null,
    startTime: f.startTime, endTime: f.endTime,
  });

  function saveNew() {
    return act(() => f.frequency === "none"
      ? callTool("createEvent", { ...common(), date: f.date })
      : callTool("createRecurringEvent", {
          ...common(), frequency: f.frequency, startDate: f.date,
          daysOfWeek: f.frequency === "weekly" ? f.days : undefined, endDate: f.until || null,
        }));
  }
  function saveAll() {
    return act(() => callTool("updateEvent", {
      eventId: existing!.eventId, ...common(),
      ...(recurringExisting ? {} : { date: f.date }),
      frequency: f.frequency,
      daysOfWeek: f.frequency === "weekly" ? f.days : undefined,
      endDate: f.frequency === "none" ? undefined : f.until || null,
    }));
  }
  function saveThisDay() {
    return act(() => callTool("updateEvent", {
      eventId: existing!.eventId, occurrenceDate: existing!.date, date: f.date, ...common(),
    }));
  }

  return (
    <Modal open={!!draft} onClose={onClose} title={existing ? "Edit event" : "New event"}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (existing) saveAll(); else saveNew(); }}>
        <div className="grid grid-cols-[4.5rem_1fr] gap-3">
          <Field label="Emoji"><input className={`${inputCls} text-center`} value={f.emoji} maxLength={8} placeholder="⚽" onChange={(e) => set({ emoji: e.target.value })} /></Field>
          <Field label="Name"><input required autoFocus className={inputCls} value={f.title} placeholder="Football" onChange={(e) => set({ title: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" required className={inputCls} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Starts"><input type="time" required className={inputCls} value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
          <Field label="Ends"><input type="time" required className={inputCls} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        </div>
        <Field label="Repeats">
          <select className={inputCls} value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            <option value="none">Doesn't repeat</option>
            <option value="weekly">Weekly</option>
            <option value="daily">Every day</option>
          </select>
        </Field>
        {f.frequency === "weekly" && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeat on">
            {DAY_ORDER.map((d) => {
              const on = f.days.includes(d);
              return (
                <button type="button" key={d} aria-pressed={on}
                  onClick={() => set({ days: on ? f.days.filter((x) => x !== d) : [...f.days, d] })}
                  className={`h-9 w-11 rounded-full text-sm font-medium ${on ? "bg-ink text-white" : "border border-line text-pencil"}`}>
                  {WEEKDAYS[d].slice(0, 3)}
                </button>
              );
            })}
          </div>
        )}
        {f.frequency !== "none" && (
          <Field label="Repeat until (optional)"><input type="date" className={inputCls} value={f.until} onChange={(e) => set({ until: e.target.value })} /></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category"><input className={inputCls} value={f.category} placeholder="Sport" onChange={(e) => set({ category: e.target.value })} /></Field>
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>

        <ErrorNote message={error} />

        {!existing && (
          <div className="flex justify-end gap-2 pt-1">
            <Button kind="quiet" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>Add event</Button>
          </div>
        )}
        {existing && !recurringExisting && (
          <div className="flex items-center gap-2 pt-1">
            <Button kind="danger" onClick={() => act(() => callTool("deleteEvent", { eventId: existing.eventId }))}>Delete</Button>
            <Button kind="quiet" className="ml-auto" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>Save changes</Button>
          </div>
        )}
        {existing && recurringExisting && (
          <div className="space-y-2 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <Button kind="quiet" disabled={saving} onClick={saveThisDay}>Save for this day</Button>
              <Button disabled={saving} onClick={saveAll}>Save for all</Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button kind="danger" onClick={() => act(() => callTool("deleteEvent", { eventId: existing.eventId, occurrenceDate: existing.date }))}>Cancel this day</Button>
              <Button kind="danger" onClick={() => act(() => callTool("deleteEvent", { eventId: existing.eventId }))}>Delete all</Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
