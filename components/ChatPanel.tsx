"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { clientCtx, notifyChange } from "@/lib/client";
import { useView } from "./ViewContext";

type Msg = { role: "user" | "assistant"; content: string; actions?: string; changes?: string[]; error?: boolean };

const STORAGE_KEY = "my-planner-chat";
const SUGGESTIONS = [
  "Plan tomorrow",
  "Add football every Tuesday 5-7",
  "Add chemistry homework due Friday, 45 minutes",
  "What do I have tomorrow?",
];

export default function ChatPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const pathname = usePathname();
  const { plannerDate } = useView();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<Msg[]>([]);
  msgsRef.current = msgs;

  // Remember the conversation between visits so "it" and "that" keep working.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMsgs(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-40))); } catch {}
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgsRef.current, { role: "user", content }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => !m.error).slice(-30).map(({ role, content, actions }) => ({ role, content, actions })),
          view: { page: pathname, date: plannerDate || undefined },
          ctx: clientCtx(),
        }),
      });
      const data = await res.json().catch(() => ({ error: "The server didn't respond. Is it still running?" }));
      if (!res.ok || data.error) {
        setMsgs((m) => [...m, { role: "assistant", content: data.error ?? "Something went wrong.", error: true }]);
      } else {
        setMsgs((m) => [...m, { role: "assistant", content: data.reply, actions: data.actions, changes: data.changes }]);
        if (data.changes?.length) notifyChange("ai");
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Couldn't reach the server. Check that it's running and try again.", error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, pathname, plannerDate]);

  // Buttons elsewhere (like "Plan this day") can send a message here.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const onAsk = (e: Event) => { onOpen(); sendRef.current((e as CustomEvent<string>).detail); };
    window.addEventListener("planner:ask", onAsk);
    return () => window.removeEventListener("planner:ask", onAsk);
  }, [onOpen]);

  return (
    <aside
      aria-label="Planner assistant"
      className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-[#f6f4fb] transition-transform duration-300 sm:w-[400px] lg:translate-x-0 ${
        open ? "translate-x-0 shadow-2xl lg:shadow-none" : "translate-x-full"}`}
    >
      <div className="flex items-center gap-3 border-b border-line/70 px-5 py-4">
        <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-lilac text-sm">✦</span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold leading-tight">JARVIS</h2>
        </div>
        <div className="ml-auto flex items-center gap-1">
          {msgs.length > 0 && (
            <button onClick={() => setMsgs([])} className="rounded-full px-2.5 py-1 text-xs text-pencil hover:bg-ink/5 hover:text-ink">
              Clear chat
            </button>
          )}
          <button onClick={onClose} aria-label="Close assistant" className="rounded-full p-1.5 text-pencil hover:bg-ink/5 lg:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {msgs.length === 0 && (
          <div className="pt-6">
            <p className="font-display text-2xl font-bold leading-snug">What's going on today?</p>
            <p className="mt-2 text-sm leading-relaxed text-pencil">
              Write it the way you'd say it. I can add events, track homework and plan your day around everything.
            </p>
            <div className="mt-6 flex flex-col items-start gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="rounded-2xl border border-line bg-white px-3.5 py-2 text-left text-sm hover:border-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`pop flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed ${
              m.role === "user" ? "rounded-br-md bg-ink text-white"
                : m.error ? "rounded-bl-md bg-berry/10 text-berry" : "rounded-bl-md bg-white text-ink shadow-[0_0_0_1px_var(--color-line)]"}`}>
              {m.content}
            </div>
            {m.changes && m.changes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.changes.map((c) => (
                  <span key={c} className="rounded-full bg-mint px-2 py-0.5 text-xs text-ink/80">✓ {c}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-[0_0_0_1px_var(--color-line)] w-fit" aria-label="Working">
            <span className="dot h-1.5 w-1.5 rounded-full bg-ink" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-ink" />
            <span className="dot h-1.5 w-1.5 rounded-full bg-ink" />
          </div>
        )}
      </div>

      <form className="border-t border-line/70 p-4" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex items-end gap-2 rounded-3xl border border-line bg-white p-2 focus-within:border-ink">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="e.g. Football got cancelled tonight"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] focus:outline-none"
            aria-label="Message the planner"
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Send"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-30">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      </form>
    </aside>
  );
}
