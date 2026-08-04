import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  createdAt: number;
};

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'danger' | 'default';
  onConfirm: (() => void | Promise<void>) | null;
  altLabel?: string;
  altTone?: 'danger' | 'default';
  onAlt?: (() => void | Promise<void>) | null;
};

interface UiState {
  toasts: Toast[];
  confirm: ConfirmState;
  pushToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
  openConfirm: (input: Omit<ConfirmState, 'open'>) => void;
  closeConfirm: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  confirm: {
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    tone: 'default',
    onConfirm: null,
  },
  pushToast: (type, message) =>
    set((state) => {
      const now = Date.now();
      const latest = state.toasts[state.toasts.length - 1];
      if (latest && latest.type === type && latest.message === message && now - latest.createdAt < 1200) {
        return state;
      }
      const next = [...state.toasts, { id: crypto.randomUUID(), type, message, createdAt: now }];
      return { toasts: next.slice(-5) };
    }),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  openConfirm: (input) =>
    set({
      confirm: {
        open: true,
        ...input,
      },
    }),
  closeConfirm: () =>
    set((state) => ({
      confirm: { ...state.confirm, open: false, onConfirm: null, onAlt: null },
    })),
}));
