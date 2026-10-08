"use client";

import { useEffect, useState } from "react";
import { callTool, notifyChange, type Settings } from "@/lib/client";
import { Button, ErrorNote, Field, Modal, inputCls } from "./ui";

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) callTool<Settings>("getSettings").then(setS).catch((e) => setError(e.message));
  }, [open]);

  async function save() {
    if (!s) return;
    try {
      await callTool("updateSettings", s);
      notifyChange();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Your day">
      {s && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Wake up"><input type="time" className={inputCls} value={s.wakeTime} onChange={(e) => setS({ ...s, wakeTime: e.target.value })} /></Field>
            <Field label="Sleep"><input type="time" className={inputCls} value={s.sleepTime} onChange={(e) => setS({ ...s, sleepTime: e.target.value })} /></Field>
          </div>
          <Field label="Break length between study sessions (minutes)">
            <input type="number" min={0} max={120} className={inputCls} value={s.breakMinutes}
              onChange={(e) => setS({ ...s, breakMinutes: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <span className="text-[15px]">Plan meals</span>
            <input type="checkbox" className="h-5 w-5 accent-ink" checked={s.includeMeals} onChange={(e) => setS({ ...s, includeMeals: e.target.checked })} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
            <span className="text-[15px]">Plan travel time</span>
            <input type="checkbox" className="h-5 w-5 accent-ink" checked={s.includeTravel} onChange={(e) => setS({ ...s, includeTravel: e.target.checked })} />
          </label>
          {s.includeTravel && (
            <Field label="Usual travel time (minutes)">
              <input type="number" min={0} max={180} className={inputCls} value={s.travelMinutes}
                onChange={(e) => setS({ ...s, travelMinutes: Number(e.target.value) })} />
            </Field>
          )}
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button kind="quiet" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save settings</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
