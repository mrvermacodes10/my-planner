"use client";

import { useEffect, type ReactNode } from "react";

export const inputCls =
  "w-full rounded-xl border border-line bg-white px-3 py-2 text-[15px] text-ink placeholder:text-pencil/70 focus:border-ink focus:outline-none";

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm text-pencil">{label}</span>
      {children}
    </label>
  );
}

export function Button({
  children, onClick, kind = "primary", type = "button", disabled, className = "",
}: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "quiet" | "danger";
  type?: "button" | "submit"; disabled?: boolean; className?: string;
}) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink/85",
    quiet: "bg-transparent text-ink hover:bg-ink/5 border border-line",
    danger: "bg-transparent text-berry hover:bg-berry/10",
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/30 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="pop max-h-[92dvh] w-full overflow-y-auto rounded-t-[28px] bg-card p-6 shadow-2xl sm:max-w-md sm:rounded-[28px]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-pencil hover:bg-ink/5">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="mt-3 rounded-xl bg-berry/10 px-3 py-2 text-sm text-berry">{message}</p>;
}
