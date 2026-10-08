"use client";

import { useEffect, useState } from "react";
import { callTool, notifyChange, type Task } from "@/lib/client";
import { Button, ErrorNote, Field, Modal, inputCls } from "./ui";

export default function TaskEditor({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const [f, setF] = useState({ title: "", dueDate: "", estimatedMinutes: "", priority: "medium", category: "", notes: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;
    setError(null);
    setF({
      title: task.title, dueDate: task.dueDate ?? "", estimatedMinutes: task.estimatedMinutes ? String(task.estimatedMinutes) : "",
      priority: task.priority, category: task.category ?? "", notes: task.notes ?? "",
    });
  }, [task]);

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      notifyChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open={!!task} onClose={onClose} title="Edit task">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        act(() => callTool("updateTask", {
          taskId: task!.id, title: f.title, dueDate: f.dueDate || null,
          estimatedMinutes: f.estimatedMinutes ? Number(f.estimatedMinutes) : null,
          priority: f.priority, category: f.category || null, notes: f.notes || null,
        }));
      }}>
        <Field label="Task"><input required className={inputCls} value={f.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Due"><input type="date" className={inputCls} value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
          <Field label="Minutes"><input type="number" min={5} max={720} step={5} className={inputCls} value={f.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: e.target.value })} /></Field>
          <Field label="Priority">
            <select className={inputCls} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Subject"><input className={inputCls} value={f.category} placeholder="Chemistry" onChange={(e) => set({ category: e.target.value })} /></Field>
          <Field label="Notes"><input className={inputCls} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex items-center gap-2 pt-1">
          <Button kind="danger" onClick={() => act(() => callTool("deleteTask", { taskId: task!.id }))}>Delete</Button>
          <Button kind="quiet" className="ml-auto" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save changes</Button>
        </div>
      </form>
    </Modal>
  );
}
