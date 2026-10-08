"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import ChatPanel from "./ChatPanel";
import SettingsDialog from "./SettingsDialog";
import { ViewContext } from "./ViewContext";

const TABS = [
  { href: "/schedule", label: "Schedule", short: "Schedule" },
  { href: "/todo", label: "To-Do", short: "To-Do" },
  { href: "/planner", label: "Daily Planner", short: "Planner" },
  { href: "/assessments", label: "Assessments", short: "Tests" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [plannerDate, setPlannerDate] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ViewContext.Provider value={{ plannerDate, setPlannerDate }}>
      <div className="min-h-dvh lg:pr-[400px]">
        <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
            <Link href="/planner" className="hidden font-display text-lg font-bold tracking-tight sm:block">My Planner</Link>
            <nav aria-label="Pages" className="flex rounded-full bg-white/70 p-1 shadow-[inset_0_0_0_1px_var(--color-line)] ">
              {TABS.map((t) => {
                const active = pathname.startsWith(t.href);
                return (
                  <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
                    className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-medium transition-colors sm:px-4 sm:text-sm ${
                      active ? "bg-ink text-white" : "text-pencil hover:text-ink"}`}>
                    <span className="sm:hidden">{t.short}</span>
                    <span className="hidden sm:inline">{t.label}</span>
                  </Link>
                );
              })}
            </nav>
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings"
              className="ml-auto rounded-full p-2 text-pencil hover:bg-ink/5 hover:text-ink">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
              </svg>
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-32 pt-6 sm:px-6 sm:pt-8">{children}</main>
      </div>

      <ChatPanel open={chatOpen} onOpen={() => setChatOpen(true)} onClose={() => setChatOpen(false)} />

      {!chatOpen && (
        <button onClick={() => setChatOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-ink py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-xl lg:hidden">
          <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-lilac text-ink">✦</span>
          Tell the planner
        </button>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ViewContext.Provider>
  );
}
