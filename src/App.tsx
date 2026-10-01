/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { hasPendingProjectOperations, useProjectStore } from './store/projectStore';
import { AppMode } from './types';
import Dashboard from './components/dashboard/Dashboard';
import AppShell from './components/layout/AppShell';
import PreviewTour from './components/preview/PreviewTour';
import { motion, AnimatePresence } from 'motion/react';
import ToastHost from './components/ui/ToastHost';
import ConfirmDialog from './components/ui/ConfirmDialog';
import { useUiStore } from './store/uiStore';
import { hasEscapeCloseLayer } from './hooks/useEscapeClose';

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
    const initialState = useProjectStore.getState();
    const initialFingerprint = autosaveFingerprint(initialState.project);
    let lastSavedFingerprint = initialState.project
      && initialState.savedModifiedDate === initialState.project.modifiedDate
      ? initialFingerprint
      : '';
    let lastObservedFingerprint = initialFingerprint;
    let lastProjectId = initialState.project?.id ?? null;
    let projectEpoch = 0;
    let observedSaveState = initialState.saveState;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

    const performSave = async () => {
      const project = useProjectStore.getState().project;
      if (!project) return;
      const saveProjectId = project.id;
      const saveEpoch = projectEpoch;
      const fingerprint = autosaveFingerprint(project);
      if (!fingerprint || fingerprint === lastSavedFingerprint) return;
      await useProjectStore.getState().saveProject();
      // A save started for a previous editor session may finish after another
      // project (even the same project ID reopened) has become active.
      if (
        projectEpoch === saveEpoch
        && useProjectStore.getState().project?.id === saveProjectId
        && autosaveFingerprint(useProjectStore.getState().project) === fingerprint
      ) {
        lastSavedFingerprint = fingerprint;
      }
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

    const scheduleSave = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void runSave().catch(() => {});
      }, 700);
    };

    const unsubscribe = useProjectStore.subscribe((state) => {
      const saveJustSucceeded = state.saveState === 'saved' && observedSaveState !== 'saved';
      observedSaveState = state.saveState;
      const project = state.project;
      if (!project) {
        if (timer) { clearTimeout(timer); timer = null; }
        projectEpoch += 1;
        lastProjectId = null;
        lastSavedFingerprint = '';
        lastObservedFingerprint = '';
        return;
      }
      const nextFingerprint = autosaveFingerprint(project);

      if (project.id !== lastProjectId) {
        if (timer) { clearTimeout(timer); timer = null; }
        projectEpoch += 1;
        lastProjectId = project.id;
        lastObservedFingerprint = nextFingerprint;
        lastSavedFingerprint = state.savedModifiedDate === project.modifiedDate
          ? nextFingerprint
          : '';
        if (nextFingerprint !== lastSavedFingerprint) scheduleSave();
        return;
      }

      // Successful manual and initial saves also establish the autosave
      // baseline, but only if no edits landed while that snapshot was writing.
      if (saveJustSucceeded) {
        lastSavedFingerprint = nextFingerprint;
        lastObservedFingerprint = nextFingerprint;
        if (timer) { clearTimeout(timer); timer = null; }
        return;
      }

      // saveState/lastSavedAt updates do not represent new content. Scheduling
      // only on fingerprint changes avoids an endless retry loop after an error.
      if (nextFingerprint === lastObservedFingerprint) return;
      lastObservedFingerprint = nextFingerprint;
      if (nextFingerprint === lastSavedFingerprint) {
        if (timer) { clearTimeout(timer); timer = null; }
        return;
      }
      scheduleSave();
    });

    // In Electron, any non-undefined returnValue cancels the close outright —
    // no prompt. The desktop build already flushes through the IPC handshake
    // below, so blocking here would just wedge the window open.
    const hasCloseHandshake = !!(api?.onFlushBeforeClose && api?.confirmClose && api?.cancelClose);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timer) { clearTimeout(timer); timer = null; }
      const project = useProjectStore.getState().project;
      const hasUnsaved = !!project && (
        autosaveFingerprint(project) !== lastSavedFingerprint
        || hasPendingProjectOperations(project.id)
      );
      if (hasUnsaved && !hasCloseHandshake) {
        e.preventDefault();
        e.returnValue = '';
      }
      void useProjectStore.getState().flushProject().catch(() => {});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Electron: flush any pending/in-flight save before the window actually
    // closes so the last edits (still inside the 700ms debounce) aren't lost.
    let offFlush: (() => void) | undefined;
    if (api?.onFlushBeforeClose && api.confirmClose && api.cancelClose) {
      offFlush = api.onFlushBeforeClose(async (requestId) => {
        try {
          if (timer) { clearTimeout(timer); timer = null; }
          await useProjectStore.getState().flushProject();
          await api.confirmClose!(requestId);
        } catch {
          // saveProject already exposes the error through saveState. Do not
          // confirm the close when the flush failed, or unsaved edits are lost.
          useUiStore.getState().pushToast('error', 'Could not save the project, so the window was kept open. Fix the save error and try closing again.');
          try { await api.cancelClose!(requestId); } catch {}
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
      if (useUiStore.getState().confirm.open) return;
      if (hasEscapeCloseLayer()) return;
      if (useProjectStore.getState().currentMode !== AppMode.EDITOR) return;
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
