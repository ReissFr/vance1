"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Toast, type ToastVariant } from "./Toast";

type ToastEntry = {
  id: string;
  variant: ToastVariant;
  title: string;
  body?: string;
  meta?: string;
  ttl: number;
};

type Push = (t: Omit<ToastEntry, "id" | "ttl"> & { ttl?: number }) => void;

const Ctx = createContext<Push | null>(null);

export function useToast(): Push {
  const push = useContext(Ctx);
  if (!push) throw new Error("useToast must be used within ToastHost");
  return push;
}

export function ToastHost() {
  const [items, setItems] = useState<ToastEntry[]>([]);

  const push: Push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { id, ttl: t.ttl ?? 5000, ...t }]);
  }, []);

  useEffect(() => {
    (window as unknown as { __jarvisToast?: Push }).__jarvisToast = push;
    return () => {
      delete (window as unknown as { __jarvisToast?: Push }).__jarvisToast;
    };
  }, [push]);

  useEffect(() => {
    if (!items.length) return;
    const timers = items.map((it) =>
      setTimeout(
        () => setItems((prev) => prev.filter((p) => p.id !== it.id)),
        it.ttl,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [items]);

  return (
    <div
      style={{
        position: "fixed",
        top: 72,
        right: 24,
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            pointerEvents: "auto",
            animation: "jv-toast-in 220ms var(--ease)",
          }}
        >
          <Toast
            variant={t.variant}
            title={t.title}
            body={t.body}
            meta={t.meta}
          />
        </div>
      ))}
    </div>
  );
}

export function toast(input: Omit<ToastEntry, "id" | "ttl"> & { ttl?: number }) {
  if (typeof window === "undefined") return;
  const fn = (window as unknown as { __jarvisToast?: Push }).__jarvisToast;
  fn?.(input);
}
