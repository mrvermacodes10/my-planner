"use client";

import { useEffect, useState } from "react";
import { callTool, notifyChange, type Assessment } from "@/lib/client";
import { minutesLabel } from "@/lib/dates";
import { Button, ErrorNote, Field, Modal, inputCls } from "./ui";

/** `draft` is an existing assessment to edit, or { date } to create a new one on that date. */
export type AssessmentDraft = Assessment | { date: string };

const split = (min: number) => ({ h: String(Math.floor(min / 60)), m: String(min % 60) });
const join = (h: string, m: string) => (Number(h) || 0) * 60 + (Number(m) || 0);

export default function AssessmentEditor({ draft, onClose }: { draft: AssessmentDraft | null; onClose: () => void }) {
  const existing = draft && "id" in draft ? draft : null;
  const [f, setF] = useState({
    subject: "", title: "", date: "", priority: "medium", topics: "", notes: "",
    totalH: "3", totalM: "0", doneH: "0", doneM: "0",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setError(null);
    const total = split(existing?.totalStudyMinutes ?? 180);
    const done = split(existing?.completedStudyMinutes ?? 0);
    setF({
      subject: existing?.subject ?? "", title: existing?.title ?? "", date: draft.date,
      priority: existing?.priority ?? "medium", topics: existing?.topics ?? "", notes: existing?.notes ?? "",
      totalH: total.h, totalM: total.m, doneH: done.h, doneM: done.m,
    });
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const total = join(f.totalH, f.totalM);
  const done = Math.min(join(f.doneH, f.doneM), total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

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

  function save() {
    const fields = {
      subject: f.subject, title: f.title || "Test", date: f.date, priority: f.priority,
      topics: f.topics || null, notes: f.notes || null, totalStudyMinutes: total, completedStudyMinutes: done,
    };
    return act(() => existing
      ? callTool("updateAssessment", { assessmentId: existing.id, ...fields })
      : callTool("createAssessment", fields));
  }

  return (
    <Modal open={!!draft} onClose={onClose} title={existing ? "Edit assessment" : "New assessment"}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject"><input required autoFocus className={inputCls} value={f.subject} placeholder="Physics" onChange={(e) => set({ subject: e.target.value })} /></Field>
          <Field label="Assessment"><input className={inputCls} value={f.title} placeholder="Forces Test" onChange={(e) => set({ title: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" required className={inputCls} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Study needed">
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={100} className={inputCls} value={f.totalH} onChange={(e) => set({ totalH: e.target.value })} aria-label="Hours needed" />
              <span className="text-sm text-pencil">h</span>
              <input type="number" min={0} max={59} step={5} className={inputCls} value={f.totalM} onChange={(e) => set({ totalM: e.target.value })} aria-label="Minutes needed" />
              <span className="text-sm text-pencil">m</span>
            </div>
          </Field>
          <Field label="Studied so far">
            <div className="flex items-center gap-1.5">
              <input type="number" min={0} max={100} className={inputCls} value={f.doneH} onChange={(e) => set({ doneH: e.target.value })} aria-label="Hours studied" />
              <span className="text-sm text-pencil">h</span>
              <input type="number" min={0} max={59} step={5} className={inputCls} value={f.doneM} onChange={(e) => set({ doneM: e.target.value })} aria-label="Minutes studied" />
              <span className="text-sm text-pencil">m</span>
            </div>
          </Field>
        </div>
        <div>
          <div className="h-2 overflow-hidden rounded-full bg-paper">
            <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-pencil">
            {pct}% · {total - done > 0 ? `${minutesLabel(total - done)} left` : "nothing left to study"}
          </p>
        </div>
        <Field label="Topics to study">
          <textarea rows={2} className={inputCls} value={f.topics} placeholder="Newton's laws, momentum, friction" onChange={(e) => set({ topics: e.target.value })} />
        </Field>
        <Field label="Notes & resources (optional)">
          <textarea rows={2} className={inputCls} value={f.notes} placeholder="Textbook ch. 4, past paper 2023" onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex items-center gap-2 pt-1">
          {existing && <Button kind="danger" onClick={() => act(() => callTool("deleteAssessment", { assessmentId: existing.id }))}>Delete</Button>}
          <Button kind="quiet" className="ml-auto" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{existing ? "Save changes" : "Add assessment"}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function LogStudyDialog({ assessment, onClose }: { assessment: Assessment | null; onClose: () => void }) {
  const [minutes, setMinutes] = useState("30");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (assessment) { setMinutes("30"); setError(null); } }, [assessment]);

  async function log(m: number) {
    if (!assessment || !m) return;
    try {
      await callTool("logStudySession", { assessmentId: assessment.id, minutes: m });
      notifyChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open={!!assessment} onClose={onClose} title="Log study">
      {assessment && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); log(Number(minutes)); }}>
          <p className="text-[15px]">
            How long did you study for <span className="font-semibold">{assessment.subject} — {assessment.title}</span>?
          </p>
          <div className="flex flex-wrap gap-2">
            {[15, 30, 45, 60, 90].map((m) => (
              <button key={m} type="button" onClick={() => log(m)}
                className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium hover:border-ink">
                {minutesLabel(m)}
              </button>
            ))}
          </div>
          <Field label="Or enter minutes">
            <input type="number" min={1} max={600} className={inputCls} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
          <p className="text-sm text-pencil">{minutesLabel(assessment.remainingMinutes || 0)} left. Logged time never goes past the total.</p>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <Button kind="quiet" onClick={onClose}>Cancel</Button>
            <Button type="submit">Log time</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
