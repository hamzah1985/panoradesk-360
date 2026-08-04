/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { useProjectStore } from './store/projectStore';
import { AppMode } from './types';
import Dashboard from './components/dashboard/Dashboard';
import AppShell from './components/layout/AppShell';
import PreviewTour from './components/preview/PreviewTour';
import { motion, AnimatePresence } from 'motion/react';
import ToastHost from './components/ui/ToastHost';
import ConfirmDialog from './components/ui/ConfirmDialog';
import { useUiStore } from './store/uiStore';

function autosaveFingerprint(project: any) {
  if (!project) return '';
  const normalized = {
    ...project,
    modifiedDate: undefined,
  };
  return JSON.stringify(normalized);
}

export default function App() {
  const { currentMode, saveState, undo, redo } = useProjectStore();
  const { pushToast } = useUiStore();
  const desktopApi = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;
    let lastSavedFingerprint = autosaveFingerprint(useProjectStore.getState().project);
    let lastProjectId = useProjectStore.getState().project?.id ?? null;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

    const performSave = async () => {
      const project = useProjectStore.getState().project;
      if (!project) return;
      const fingerprint = autosaveFingerprint(project);
      if (!fingerprint || fingerprint === lastSavedFingerprint) return;
      await useProjectStore.getState().saveProject();
      lastSavedFingerprint = fingerprint;
    };

    // Resolves only when there is nothing left to write. The previous version
    // returned immediately while a save was in flight, so the close handshake
    // could confirm the close before the queued edits were ever written.
    const runSave = async (): Promise<void> => {
      if (inFlight) {
        return inFlight.catch(() => {}).then(() => runSave());
      }
      inFlight = performSave().finally(() => { inFlight = null; });
      return inFlight;
    };

    const unsubscribe = useProjectStore.subscribe((state) => {
      const project = state.project;
      if (!project) {
        lastProjectId = null;
        return;
      }
      // A freshly opened/created project already matches what's on disk, so adopt
      // it as the saved baseline rather than firing a redundant save that just
      // rewrites modifiedDate.
      if (project.id !== lastProjectId) {
        lastProjectId = project.id;
        lastSavedFingerprint = autosaveFingerprint(project);
        return;
      }
      const nextFingerprint = autosaveFingerprint(project);
      if (nextFingerprint === lastSavedFingerprint) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void runSave();
      }, 700);
    });

    // In Electron, any non-undefined returnValue cancels the close outright —
    // no prompt. The desktop build already flushes through the IPC handshake
    // below, so blocking here would just wedge the window open.
    const hasCloseHandshake = !!(api?.onFlushBeforeClose && api?.confirmClose);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timer) clearTimeout(timer);
      const project = useProjectStore.getState().project;
      const hasUnsaved = !!project && autosaveFingerprint(project) !== lastSavedFingerprint;
      if (hasUnsaved && !hasCloseHandshake) {
        e.preventDefault();
        e.returnValue = '';
      }
      void runSave();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Electron: flush any pending/in-flight save before the window actually
    // closes so the last edits (still inside the 700ms debounce) aren't lost.
    let offFlush: (() => void) | undefined;
    if (api?.onFlushBeforeClose && api.confirmClose) {
      offFlush = api.onFlushBeforeClose(async () => {
        try {
          if (timer) clearTimeout(timer);
          await runSave();
        } finally {
          try { await api.confirmClose!(); } catch {}
        }
      });
    }

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unsubscribe();
      offFlush?.();
    };
  }, []);

  useEffect(() => {
    if (saveState === 'error') pushToast('error', 'Failed to save project');
  }, [saveState, pushToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (typing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    let mounted = true;
    if (!desktopApi?.getMenuBarVisible) return;
    void desktopApi.getMenuBarVisible().then((visible) => {
      if (mounted) setMenuVisible(!!visible);
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, [desktopApi]);

  const toggleMenuBar = useCallback(async () => {
    if (!desktopApi?.toggleMenuBarVisible) return;
    try {
      const visible = await desktopApi.toggleMenuBarVisible();
      setMenuVisible(!!visible);
    } catch {}
  }, [desktopApi]);

  return (
    <div className="h-screen w-screen overflow-hidden font-sans">
      {!!desktopApi?.toggleMenuBarVisible && (
        <button
          type="button"
          onClick={() => { void toggleMenuBar(); }}
          className="absolute left-1/2 top-0 z-[80] -translate-x-1/2 rounded-b-lg border border-t-0 border-white/15 bg-slate-950/55 px-3 py-1 text-[11px] font-medium tracking-wide text-white/85 backdrop-blur-md transition hover:bg-slate-900/75"
          title={menuVisible ? 'Hide menu bar' : 'Show menu bar'}
        >
          {menuVisible ? 'Menu Tab: Hide' : 'Menu Tab: Show'}
        </button>
      )}
      <ToastHost />
      <ConfirmDialog />
      <AnimatePresence mode="wait">
        {currentMode === AppMode.DASHBOARD && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <Dashboard />
          </motion.div>
        )}

        {currentMode === AppMode.EDITOR && (
          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <AppShell />
          </motion.div>
        )}

        {currentMode === AppMode.PREVIEW && (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-full w-full"
          >
            <PreviewTour />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
