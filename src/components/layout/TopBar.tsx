import React from 'react';
import { Save, Play, Download, Settings, ChevronLeft, Maximize2, Minimize2, Undo2, Redo2, RefreshCw, Loader2 } from 'lucide-react';
import { deleteProject, useProjectStore } from '../../store/projectStore';
import { AppMode } from '../../types';
import ExportWebsiteModal from '../modals/ExportWebsiteModal';
import { useUiStore } from '../../store/uiStore';
import KeyboardShortcutsModal from '../modals/KeyboardShortcutsModal';
import CommandPaletteModal from '../modals/CommandPaletteModal';
import appLogo from '../../assets/app-logo.svg';
import { hasEscapeCloseLayer } from '../../hooks/useEscapeClose';

const TopBar = ({ onToggleSettings, onToggleFocus, isFocusMode }: { onToggleSettings: () => void; onToggleFocus: () => void; isFocusMode: boolean }) => {
  const { project, setMode, saveProject, flushProject, setProject, saveState, lastSavedAt, setCurrentScene, undo, redo, duplicateScene, deleteScene, currentSceneId } = useProjectStore();
  const canUndoValue = useProjectStore((s) => s.canUndo());
  const canRedoValue = useProjectStore((s) => s.canRedo());
  const { openConfirm, pushToast } = useUiStore();
  const [isExportOpen, setIsExportOpen] = React.useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = React.useState(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState(false);
  const [isOpeningPreview, setIsOpeningPreview] = React.useState(false);
  const mountedRef = React.useRef(true);
  const modeRequestRef = React.useRef(0);
  const sceneCount = project?.scenes?.length || 0;

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modeRequestRef.current += 1;
    };
  }, []);

  const [relativeTime, setRelativeTime] = React.useState('');
  React.useEffect(() => {
    const update = () => {
      if (!lastSavedAt) { setRelativeTime(''); return; }
      const diffMs = Date.now() - new Date(lastSavedAt).getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) setRelativeTime('just now');
      else if (diffMin === 1) setRelativeTime('1 min ago');
      else setRelativeTime(`${diffMin} min ago`);
    };
    update();
    const timer = setInterval(update, 30000);
    return () => clearInterval(timer);
  }, [lastSavedAt]);

  const currentSceneIndex = React.useMemo(
    () => project?.scenes.findIndex((s) => s.id === currentSceneId) ?? -1,
    [project?.scenes, currentSceneId],
  );

  const handleBackToDashboard = React.useCallback(async () => {
    const requestId = ++modeRequestRef.current;
    setIsOpeningPreview(false);
    // Do not expose a stale dashboard copy while the final editor snapshot is
    // still queued. Reopening and editing that copy could otherwise overwrite
    // the flush that was meant to protect the latest changes.
    try {
      await flushProject();
      if (!mountedRef.current || modeRequestRef.current !== requestId) return;
      // Dashboard actions must never retain a hidden active editor project. In
      // particular, deleting that recent project would otherwise leave close
      // trying forever to flush a deliberately tombstoned ID.
      setProject(null);
    } catch {
      // Stay in the editor so the user can retry instead of losing changes.
      if (mountedRef.current) pushToast('error', 'Could not save the project, so it was not closed. Retry the save first.');
    }
  }, [flushProject, setProject, pushToast]);

  const handleOpenPreview = React.useCallback(async () => {
    const liveProject = useProjectStore.getState().project;
    if (!liveProject?.scenes.length) {
      pushToast('info', 'Add at least one scene before opening preview.');
      return;
    }
    if (isOpeningPreview) return;
    const requestId = ++modeRequestRef.current;
    setIsOpeningPreview(true);
    try {
      // Project operations include scene imports and asset uploads. Keep the
      // editor mounted until their results have reached the store and the final
      // stable snapshot is saved, then preview that exact snapshot.
      await flushProject();
      if (!mountedRef.current || modeRequestRef.current !== requestId) return;
      setIsOpeningPreview(false);
      setMode(AppMode.PREVIEW);
    } catch {
      if (!mountedRef.current || modeRequestRef.current !== requestId) return;
      setIsOpeningPreview(false);
      pushToast('error', 'Unable to open preview until pending project changes finish saving.');
    }
  }, [flushProject, isOpeningPreview, pushToast, setMode]);

  React.useEffect(() => {
    const onPreviewRequest = () => { void handleOpenPreview(); };
    window.addEventListener('request-preview', onPreviewRequest);
    return () => window.removeEventListener('request-preview', onPreviewRequest);
  }, [handleOpenPreview]);

  const handleDeleteCurrentProject = React.useCallback(async () => {
    if (!project?.id) return;
    openConfirm({
      title: 'Delete Project',
      message: `Delete project "${project.name}"${project.path ? `\n${project.path}` : ''} from disk? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        try {
          const deleted = await deleteProject(project.id, project.path);
          if (!deleted) { pushToast('error', 'Failed to delete this project from disk'); return; }
          pushToast('success', 'Project deleted');
          setProject(null);
          setMode(AppMode.DASHBOARD);
        } catch {
          pushToast('error', 'Failed to delete this project from disk');
        }
      },
    });
  }, [project, openConfirm, pushToast, setProject, setMode]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().confirm.open) return;
      if (hasEscapeCloseLayer()) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (typing) return;
      if (e.key === '?') setIsShortcutsOpen(true);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commandItems = React.useMemo(() => {
    const items: Array<{ id: string; label: string; hint?: string; run: () => void }> = [
      { id: 'save', label: 'Save Project', hint: 'Ctrl/Cmd+S', run: () => { void saveProject().catch(() => {}); } },
      {
        id: 'preview',
        label: 'Open Preview',
        hint: 'P',
        run: () => {
          void handleOpenPreview();
        },
      },
      {
        id: 'export',
        label: 'Open Export Website',
        run: () => {
          if (!sceneCount) { pushToast('info', 'Add at least one scene before exporting.'); return; }
          setIsExportOpen(true);
        },
      },
      { id: 'dashboard', label: 'Back To Dashboard', run: () => { void handleBackToDashboard(); } },
      { id: 'delete-project', label: 'Delete Current Project', run: () => { void handleDeleteCurrentProject(); } },
      { id: 'settings', label: 'Open Project Settings', run: () => onToggleSettings() },
      { id: 'shortcuts', label: 'Open Keyboard Shortcuts', hint: '?', run: () => setIsShortcutsOpen(true) },
      { id: 'focus', label: isFocusMode ? 'Exit Focus Mode' : 'Enter Focus Mode', run: () => onToggleFocus() },
      { id: 'tool-select', label: 'Tool: Select', run: () => window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'select' } })) },
      { id: 'tool-hotspot', label: 'Tool: Add Hotspot', run: () => window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'hotspot' } })) },
      { id: 'tool-marker', label: 'Tool: Add Marker', run: () => window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'marker' } })) },
      { id: 'toggle-gallery', label: 'Toggle Gallery', run: () => window.dispatchEvent(new CustomEvent('toggle-gallery')) },
      { id: 'toggle-floorplan', label: 'Toggle Floor Plan', run: () => window.dispatchEvent(new CustomEvent('toggle-floorplan')) },
      { id: 'capture-view', label: 'Save Current View', run: () => window.dispatchEvent(new CustomEvent('capture-view')) },
      { id: 'reset-view', label: 'Reset Scene View', run: () => window.dispatchEvent(new CustomEvent('reset-view')) },
    ];
    const sceneList = project?.scenes || [];
    const currentIndex = sceneList.findIndex((s) => s.id === currentSceneId);
    if (currentIndex >= 0) {
      if (currentIndex > 0) items.push({ id: 'scene-prev', label: 'Go to Previous Scene', hint: 'Alt+Left', run: () => setCurrentScene(sceneList[currentIndex - 1].id) });
      if (currentIndex < sceneList.length - 1) items.push({ id: 'scene-next', label: 'Go to Next Scene', hint: 'Alt+Right', run: () => setCurrentScene(sceneList[currentIndex + 1].id) });
      items.push({ id: 'scene-duplicate-current', label: 'Duplicate Current Scene', run: () => duplicateScene(sceneList[currentIndex].id) });
      items.push({
        id: 'scene-delete-current',
        label: 'Delete Current Scene',
        run: () => openConfirm({
          title: 'Delete Scene',
          message: `Delete scene "${sceneList[currentIndex].name}"?`,
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          tone: 'danger',
          onConfirm: () => deleteScene(sceneList[currentIndex].id),
        }),
      });
    }
    sceneList.forEach((scene, index) => {
      items.push({ id: `scene-${scene.id}`, label: `Go to Scene: ${scene.name}`, hint: `Scene ${index + 1}`, run: () => setCurrentScene(scene.id) });
    });
    return items;
  }, [saveProject, sceneCount, project?.scenes, pushToast, onToggleSettings, isFocusMode, onToggleFocus, setCurrentScene, currentSceneId, duplicateScene, deleteScene, openConfirm, handleBackToDashboard, handleDeleteCurrentProject, handleOpenPreview]);

  const saveLabel = saveState === 'saving'
    ? 'Saving…'
    : saveState === 'error'
    ? 'Save failed'
    : saveState === 'saved' && relativeTime
    ? `Saved ${relativeTime}`
    : '';

  const saveLabelColor = saveState === 'saving'
    ? 'text-amber-400'
    : saveState === 'saved'
    ? 'text-emerald-400'
    : saveState === 'error'
    ? 'text-red-400'
    : 'text-slate-600';

  const saveDotColor = saveState === 'saving'
    ? 'bg-amber-400 animate-pulse'
    : saveState === 'error'
    ? 'bg-red-400'
    : saveState === 'saved'
    ? 'bg-emerald-400'
    : project
    ? 'bg-slate-600'
    : '';

  return (
    <>
      <header className="h-11 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-40">
        {/* Left cluster: back · logo · name · scene position · save state · ⌘K hint */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => { void handleBackToDashboard(); }}
            className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white flex-shrink-0"
            title="Back to dashboard"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <div className="p-0.5 bg-slate-800 rounded-lg overflow-hidden flex-shrink-0">
              <img src={appLogo} alt="PanoraDesk 360 logo" className="w-5 h-5 object-cover" />
            </div>
            <span className="font-semibold text-slate-100 text-sm truncate max-w-[180px]">
              {project?.name || 'Untitled Project'}
            </span>
          </div>

          {sceneCount > 0 && currentSceneIndex >= 0 && (
            <span className="text-[11px] font-medium text-slate-600 flex-shrink-0 tabular-nums">
              {currentSceneIndex + 1} / {sceneCount}
            </span>
          )}

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {saveState === 'saving'
              ? <Loader2 className="w-3 h-3 text-amber-400 animate-spin flex-shrink-0" />
              : saveDotColor && <span className={`w-1.5 h-1.5 rounded-full transition-colors ${saveDotColor}`} />}
            {saveLabel && (
              <span className={`text-[11px] font-medium ${saveLabelColor} transition-colors`}>
                {saveLabel}
              </span>
            )}
            {saveState === 'error' && (
              <button
                onClick={() => { void saveProject().catch(() => {}); }}
                title="Retry save"
                className="p-0.5 rounded text-red-400 hover:text-red-300 hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={() => setIsCommandOpen(true)}
            title="Command palette (Ctrl+K)"
            className="hidden md:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-colors flex-shrink-0 border border-slate-800"
          >
            <span>⌘K</span>
          </button>
        </div>

        {/* Right cluster: Undo · Redo · | · Save · Preview · Export · | · Focus · Settings */}
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndoValue}
            title="Undo (Ctrl/Cmd+Z)"
            className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedoValue}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Redo2 className="w-4 h-4" />
          </button>

          <button
            disabled={!project || saveState === 'saving'}
            onClick={() => { void saveProject().catch(() => {}); }}
            title="Save (Ctrl/Cmd+S)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            <Save className="w-4 h-4" />
            <span className="hidden lg:inline">Save</span>
          </button>

          <div className="w-px h-5 bg-slate-700 mx-1" />

          <button
            disabled={sceneCount === 0 || isOpeningPreview}
            onClick={() => { void handleOpenPreview(); }}
            title={sceneCount === 0 ? 'Add at least one scene to preview' : isOpeningPreview ? 'Finishing pending project changes…' : 'Preview (P)'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
          >
            {isOpeningPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span className="hidden lg:inline">Preview</span>
          </button>

          <button
            disabled={sceneCount === 0}
            onClick={() => setIsExportOpen(true)}
            title={sceneCount === 0 ? 'Add at least one scene to export' : 'Export Website'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-primary hover:brightness-110 rounded-lg shadow-sm transition-all disabled:opacity-40 disabled:hover:brightness-100"
          >
            <Download className="w-4 h-4" />
            <span>Export</span>
          </button>

          <div className="w-px h-5 bg-slate-700 mx-1" />

          <button
            onClick={onToggleFocus}
            title={isFocusMode ? 'Exit Focus Mode' : 'Focus Mode'}
            className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
          >
            {isFocusMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={onToggleSettings}
            title="Project Settings"
            className="p-2 text-slate-400 hover:bg-slate-800 hover:text-white rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {isExportOpen && <ExportWebsiteModal onClose={() => setIsExportOpen(false)} />}
      <KeyboardShortcutsModal open={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <CommandPaletteModal open={isCommandOpen} onClose={() => setIsCommandOpen(false)} items={commandItems} />
    </>
  );
};

export default TopBar;
