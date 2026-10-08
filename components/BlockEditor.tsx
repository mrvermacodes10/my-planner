"use client";

import { useEffect, useState } from "react";
import { callTool, notifyChange, type Block } from "@/lib/client";
import { Button, ErrorNote, Field, Modal, inputCls } from "./ui";

export type BlockDraft = { date: string; block: Block | null; startTime?: string };

export default function BlockEditor({ draft, onClose }: { draft: BlockDraft | null; onClose: () => void }) {
  const b = draft?.block ?? null;
  const [f, setF] = useState({ title: "", emoji: "", date: "", startTime: "", endTime: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setError(null);
    const start = b?.startTime ?? draft.startTime ?? "16:00";
    const [h, m] = start.split(":").map(Number);
    const end = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    setF({
      title: b?.title ?? "", emoji: b?.emoji ?? "", date: draft.date, startTime: start,
      endTime: b ? b.endTime ?? "" : end, notes: b?.notes ?? "",
    });
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      notifyChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function save() {
    const fields = {
      title: f.title, emoji: f.emoji || null, startTime: f.startTime, endTime: f.endTime || null, notes: f.notes || null,
    };
    return act(() => b
      ? callTool("updateDailyPlanBlock", { blockId: b.id, ...fields, date: f.date !== draft!.date ? f.date : undefined })
      : callTool("addDailyPlanBlock", { date: f.date, ...fields, source: "custom" }));
  }

  return (
    <Modal open={!!draft} onClose={onClose} title={b ? "Edit block" : "Add a block"}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="grid grid-cols-[4.5rem_1fr] gap-3">
          <Field label="Emoji"><input className={`${inputCls} text-center`} value={f.emoji} maxLength={8} placeholder="📐" onChange={(e) => set({ emoji: e.target.value })} /></Field>
          <Field label="Activity"><input required autoFocus className={inputCls} value={f.title} placeholder="Design B3" onChange={(e) => set({ title: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date"><input type="date" required className={inputCls} value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="From"><input type="time" required className={inputCls} value={f.startTime} onChange={(e) => set({ startTime: e.target.value })} /></Field>
          <Field label="To"><input type="time" className={inputCls} value={f.endTime} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        {b?.taskId && <p className="text-sm text-pencil">This is time for a task on your To-Do list.</p>}
        {b?.eventId && <p className="text-sm text-pencil">This comes from your Schedule. Changing the event there updates it here.</p>}
        <ErrorNote message={error} />
        <div className="flex items-center gap-2 pt-1">
          {b && <Button kind="danger" onClick={() => act(() => callTool("deleteDailyPlanBlock", { blockId: b.id }))}>Delete</Button>}
          <Button kind="quiet" className="ml-auto" onClick={onClose}>Cancel</Button>
          <Button type="submit">{b ? "Save changes" : "Add block"}</Button>
        </div>
      </form>
    </Modal>
  );
}
