import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';

const ToastHost = () => {
  const { toasts, removeToast } = useUiStore();
  const timersRef = React.useRef<Map<string, number>>(new Map());
  const clearToastTimer = React.useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);
  const startToastTimer = React.useCallback((id: string, timeoutMs = 2800) => {
    if (timersRef.current.has(id)) return;
    const timer = window.setTimeout(() => {
      timersRef.current.delete(id);
      removeToast(id);
    }, timeoutMs);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  React.useEffect(() => {
    const visibleIds = new Set(toasts.map((toast) => toast.id));

    toasts.forEach((toast) => {
      startToastTimer(toast.id);
    });

    for (const [id, timer] of timersRef.current.entries()) {
      if (visibleIds.has(id)) continue;
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, [toasts, startToastTimer]);

  React.useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) window.clearTimeout(timer);
      timersRef.current.clear();
    };
  }, []);

  return (
    <div className="fixed top-4 right-4 z-[220] flex flex-col gap-2" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          onMouseEnter={() => clearToastTimer(t.id)}
          onMouseLeave={() => startToastTimer(t.id, 2200)}
          className="min-w-[280px] max-w-[420px] rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2 flex items-start gap-2"
        >
          {t.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          {t.type === 'error' && <AlertCircle className="w-4 h-4 text-red-600" />}
          {t.type === 'info' && <Info className="w-4 h-4 text-sky-600" />}
          <div className="text-sm text-slate-700 flex-1 leading-5">{t.message}</div>
          <button
            onClick={() => {
              clearToastTimer(t.id);
              removeToast(t.id);
            }}
            className="p-0.5 text-slate-400 hover:text-slate-700 rounded"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default ToastHost;
