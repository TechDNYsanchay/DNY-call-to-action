"use client";

import clsx from "clsx";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

// A small toast queue: role=status, slides 8 px up, 6 s with an optional undo. One provider in the
// shell; any client component calls useToast().

export interface ToastInput {
  message: string;
  tone?: "neutral" | "signal";
  /** Runs when Undo is pressed; the result (often a server action's promise) is not awaited here. */
  undo?: () => unknown;
  durationMs?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  // Outside the provider (the /design route renders pieces alone) toasts are simply not shown.
  return push ?? (() => {});
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: ToastInput) => {
      const id = ++counter.current;
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.durationMs ?? 6000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom,0px))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx("toast-in pointer-events-auto flex h-11 max-w-[420px] items-center gap-3 rounded-card bg-ink px-4 text-[14px] text-sheet shadow-card", t.tone === "signal" && "border-l-[3px] border-l-signal")}
          >
            <span className="min-w-0 flex-1 truncate">{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="h-7 rounded-chip px-2 text-[13px] font-medium text-sheet/90 underline-offset-2 hover:underline"
                onClick={() => {
                  void t.undo?.();
                  dismiss(t.id);
                }}
              >
                Undo
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
