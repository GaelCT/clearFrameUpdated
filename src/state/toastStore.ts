import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
}

export const useToasts = create<ToastState>(() => ({ toasts: [] }));

let counter = 0;

export function pushToast(toast: Omit<Toast, 'id'>, timeoutMs?: number): number {
  counter += 1;
  const id = counter;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
  const ttl = timeoutMs ?? (toast.tone === 'error' ? 0 : toast.tone === 'warning' ? 9000 : 5000);
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export function dismissToast(id: number): void {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
