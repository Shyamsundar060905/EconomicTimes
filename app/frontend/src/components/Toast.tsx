"use client";
/**
 * Toast — transient feedback for work that finished while you were looking
 * somewhere else.
 *
 * WHY THIS EXISTS (it is not decoration): `useAgentRun` has always returned
 * `error` and `lastRun`, and nothing consumed either. Clicking "Run full
 * pipeline", closing the drawer and going back to the map meant a failed run
 * was completely silent — the agents turned red inside a panel nobody was
 * looking at. A pipeline run is exactly the case a toast is for: slow, started
 * deliberately, finishes out of view.
 *
 * Deliberately small. No queue limits, no swipe, no promise API — those are
 * features nothing here asks for yet.
 *
 * Accessibility: the viewport is a live region. Errors are assertive (they
 * interrupt), everything else is polite (it waits for a pause). The toast is
 * NOT focus-stealing — you can ignore it and it leaves.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { icon, CircleCheck, Info, TriangleAlert, X } from "@/components/Icon";

type ToastTone = "info" | "positive" | "caution" | "critical";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  /** ms before auto-dismiss; 0 keeps it until dismissed. */
  duration: number;
}

type ToastInput = Omit<Partial<Toast>, "id" | "title"> & { title: string };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Fire a toast. Returns a no-op outside the provider so a component can call
 *  it without caring whether it is mounted inside one. */
export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? (() => {});
}

const TONE_ICON = {
  info: Info,
  positive: CircleCheck,
  caution: TriangleAlert,
  critical: TriangleAlert,
} as const;

function ToastRow({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const Glyph = TONE_ICON[toast.tone];

  useEffect(() => {
    if (!toast.duration) return;
    const t = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div className={`toast toast-${toast.tone}`}>
      <Glyph {...icon.md} aria-hidden />
      <div className="toast-body">
        <strong>{toast.title}</strong>
        {toast.body}
      </div>
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        <X {...icon.sm} aria-hidden />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((input: ToastInput) => {
    const tone: ToastTone = input.tone ?? "info";
    setToasts((prev) => [
      // Cap the stack. Three is already more than anyone reads.
      ...prev.slice(-2),
      {
        id: nextId.current++,
        tone,
        title: input.title,
        body: input.body,
        // Failures stay until dismissed — they usually need an action, and a
        // message that vanishes before it is read is worse than none.
        duration: input.duration ?? (tone === "critical" ? 0 : 5000),
      },
    ]);
  }, []);

  const value = useMemo(() => push, [push]);
  const hasCritical = toasts.some((t) => t.tone === "critical");

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            className="toast-viewport"
            role="status"
            aria-live={hasCritical ? "assertive" : "polite"}
          >
            {toasts.map((t) => (
              <ToastRow key={t.id} toast={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}
