"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (options: { type?: ToastType; message: string }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

const toneMap: Record<ToastType, string> = {
  success: "border-emerald-500/40 bg-white text-emerald-700 shadow-emerald-500/10",
  error: "border-rose-500/40 bg-white text-rose-700 shadow-rose-500/10",
  info: "border-sky-500/40 bg-white text-sky-700 shadow-sky-500/10"
};

const iconMap: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ"
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ type = "success", message }: { type?: ToastType; message: string }) => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-2), { id, type, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 5000)
      );
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast: push }}>
      {children}
      {items.length > 0 && (
        <div className="fixed right-4 top-4 z-[80] flex w-full max-w-sm flex-col gap-2">
          {items.map((t) => (
            <div key={t.id} className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${toneMap[t.type]}`}>
              <span aria-hidden="true" className="text-base leading-none">
                {iconMap[t.type]}
              </span>
              <span className="min-w-0 flex-1">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-slate-400 transition hover:text-slate-600" aria-label="Dismiss notification">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}