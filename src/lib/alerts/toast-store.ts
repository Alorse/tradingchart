"use client";

import { create } from "zustand";

export interface ToastEntry {
  id: string;
  title: string;
  message?: string;
  variant: "alert" | "info";
  /** Auto-dismiss timestamp (ms). 0 = persistent. */
  expiresAt: number;
}

interface ToastState {
  toasts: ToastEntry[];
  push: (toast: Omit<ToastEntry, "id" | "expiresAt"> & { ttlMs?: number }) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_TTL = 6000;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: ({ ttlMs, ...rest }) =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random()}`,
          // `ttlMs: 0` means persistent, which is what `AlertsToast` reads
          // `expiresAt === 0` as. Adding Date.now() to it would instead expire
          // the toast on the very next sweep — the opposite of the intent, and
          // exactly the toasts that must not disappear (an unprotected
          // position) are the ones that ask for it.
          expiresAt: ttlMs === 0 ? 0 : Date.now() + (ttlMs ?? DEFAULT_TTL),
          ...rest,
        },
      ],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
