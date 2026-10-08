"use client";

import { useEffect, useState } from "react";
import { localNowTime, localToday } from "./dates";

export const clientCtx = () => ({ today: localToday(), now: localNowTime() });

/** Call one of the planner tools on the server (the same tools the AI uses). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callTool<T = any>(name: string, input: object = {}): Promise<T> {
  const res = await fetch(`/api/tools/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, ctx: clientCtx() }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: "The server didn't respond. Is it still running?" }));
  if (!json.ok) throw new Error(json.error);
  return json.result as T;
}

const CHANGED = "planner:changed";
let channel: BroadcastChannel | null = null;
function getChannel() {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return null;
  channel ??= new BroadcastChannel("my-planner");
  return channel;
}

/** Tell every page (and other open tabs) that data changed so they reload it. */
export function notifyChange(source: "ai" | "manual" = "manual") {
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: source }));
  getChannel()?.postMessage(source);
}

/** A number that goes up whenever planner data changes. Pages refetch when it changes. */
export function useChangeKey() {
  const [state, setState] = useState({ key: 0, fromAI: false });
  useEffect(() => {
    const bump = (src: unknown) => setState((s) => ({ key: s.key + 1, fromAI: src === "ai" }));
    const onEvent = (e: Event) => bump((e as CustomEvent).detail);
    const onMessage = (e: MessageEvent) => bump(e.data);
    const onFocus = () => bump("focus");
    window.addEventListener(CHANGED, onEvent);
    window.addEventListener("focus", onFocus);
    const ch = getChannel();
    ch?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(CHANGED, onEvent);
      window.removeEventListener("focus", onFocus);
      ch?.removeEventListener("message", onMessage);
    };
  }, []);
  return state;
}

/** Send a sentence to the AI panel from anywhere (e.g. the "Plan this day" button). */
export function askAI(text: string) {
  window.dispatchEvent(new CustomEvent("planner:ask", { detail: text }));
}

const TINTS = ["#cbe8d9", "#e4def6", "#f8dfc4", "#d3e4f5", "#f4d3de", "#e3eac2", "#d8ece9"];
/** A soft, stable colour for a category or title. */
export function tint(key: string | null | undefined) {
  const s = (key || "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export type Occurrence = {
  eventId: string; title: string; date: string; startTime: string; endTime: string; recurring: boolean;
  recurrence: string; daysOfWeek: number[]; seriesStart: string; until: string | null;
  category: string | null; emoji: string | null; notes: string | null;
};
export type Task = {
  id: string; title: string; dueDate: string | null; priority: "low" | "medium" | "high";
  estimatedMinutes: number | null; completed: boolean; category: string | null; notes: string | null;
  plannedIn: { date: string; startTime: string; endTime: string | null }[];
};
export type Block = {
  id: string; title: string; startTime: string; endTime: string | null; emoji: string | null;
  category: string | null; source: string; notes: string | null; taskId: string | null; eventId: string | null;
  taskCompleted?: boolean;
};
export type Plan = { date: string; exists: boolean; notes: string | null; blocks: Block[] };
export type Settings = {
  wakeTime: string; sleepTime: string; breakMinutes: number; includeMeals: boolean;
  includeTravel: boolean; travelMinutes: number;
};
