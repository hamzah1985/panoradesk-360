import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const ConfirmDialog = () => {
  const { confirm, closeConfirm, pushToast } = useUiStore();
  const [submitting, setSubmitting] = React.useState(false);
  useEscapeClose(confirm.open, closeConfirm);
  const runConfirm = React.useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await confirm.onConfirm?.();
      closeConfirm();
    } catch {
      pushToast('error', 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [confirm.onConfirm, closeConfirm, submitting, pushToast]);
  const runAlt = React.useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await confirm.onAlt?.();
      closeConfirm();
    } catch {
      pushToast('error', 'Action failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [confirm.onAlt, closeConfirm, submitting, pushToast]);

  React.useEffect(() => {
    if (!confirm.open) setSubmitting(false);
  }, [confirm.open]);

  React.useEffect(() => {
    if (!confirm.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void runConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirm.open, runConfirm]);

  if (!confirm.open) return null;

  return (
    <div onMouseDown={() => !submitting && closeConfirm()} className="fixed inset-0 z-[210] bg-black/55 backdrop-blur-sm flex items-center justify-center p-6">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl">
        <div className="p-4 border-b border-slate-200 flex items-center gap-2">
          <AlertTriangle className={`w-5 h-5 ${confirm.tone === 'danger' ? 'text-red-600' : 'text-amber-600'}`} />
          <h3 className="font-semibold text-slate-800">{confirm.title}</h3>
        </div>
        <div className="p-4 text-sm text-slate-600">{confirm.message}</div>
        <div className="px-4 text-[11px] text-slate-500">Press Enter to confirm, Esc to cancel.</div>
        <div className="p-4 border-t border-slate-200 flex justify-end gap-2 flex-wrap">
          <button disabled={submitting} onClick={closeConfirm} className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 disabled:opacity-60 disabled:cursor-not-allowed">
            {confirm.cancelLabel}
          </button>
          {confirm.altLabel && (
            <button
              onClick={() => { void runAlt(); }}
              disabled={submitting}
              className={`px-3 py-2 rounded-lg text-sm text-white ${(confirm.altTone ?? 'default') === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800'} ${submitting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {submitting ? 'Working...' : confirm.altLabel}
            </button>
          )}
          <button
            onClick={() => { void runConfirm(); }}
            disabled={submitting}
            className={`px-3 py-2 rounded-lg text-sm text-white ${confirm.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-700'} ${submitting ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {submitting ? 'Working...' : confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
