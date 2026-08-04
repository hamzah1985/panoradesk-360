import React from 'react';
import { Image as ImageIcon, Trash2, Layers, Copy, ArrowUp, ArrowDown, GripVertical, Upload, HardDrive } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';
import { cn } from '../../lib/utils';
import { getDesktopApi, SceneImportProgress } from '../../lib/desktop';
import { resolveAssetSrc } from '../../lib/media';
import { useUiStore } from '../../store/uiStore';

const SCENE_IMPORT_MAX_EDGE = 4096;
const SCENE_IMPORT_JPEG_QUALITY = 0.88;

async function resizeSceneImage(dataUrl: string, maxEdge = SCENE_IMPORT_MAX_EDGE): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      if (scale >= 1) {
        resolve(dataUrl);
        return;
      }
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', SCENE_IMPORT_JPEG_QUALITY));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function generateThumbnail(dataUrl: string, maxWidth = 320): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

const LeftSidebar = () => {
  const { project, currentSceneId, addScene, setCurrentScene, deleteScene, deleteScenes, updateProject, duplicateScene, moveScene, moveSceneToIndex, moveScenesToIndex, updateScene } = useProjectStore();
  const { openConfirm, pushToast } = useUiStore();
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = React.useState<string[]>([]);
  const [renamingSceneId, setRenamingSceneId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; sceneId: string } | null>(null);
  const [hoveredScene, setHoveredScene] = React.useState<{ id: string; y: number } | null>(null);
  const [isDragOverFiles, setIsDragOverFiles] = React.useState(false);
  const [importProgress, setImportProgress] = React.useState<SceneImportProgress | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const sceneCardRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const sceneListScrollRef = React.useRef<HTMLDivElement>(null);
  const lastClickedRef = React.useRef<string | null>(null);
  const flipSnapshot = React.useRef<Record<string, DOMRect>>({});
  const pendingFlip = React.useRef(false);
  const dragFromIndex = React.useRef<number | null>(null);
  const draggingCardHeight = React.useRef<number>(0);
  const draggedIndicesRef = React.useRef<Set<number>>(new Set());
  const totalScenesRef = React.useRef<number>(0);

  const capturePositions = React.useCallback(() => {
    const snapshot: Record<string, DOMRect> = {};
    // Explicit tuple type: Object.entries over a useRef record infers the
    // value as unknown under the React 19 typings.
    Object.entries(sceneCardRefs.current).forEach(([id, el]: [string, HTMLDivElement | null]) => {
      if (el) snapshot[id] = el.getBoundingClientRect();
    });
    flipSnapshot.current = snapshot;
    pendingFlip.current = true;
  }, []);

  // Resolve where a reordered scene (or selection) should land based on the
  // pointer's Y position. Uses layout offsets (offsetTop/offsetHeight) rather
  // than getBoundingClientRect so the live drag transforms don't skew the math.
  // Returns an insertion index into the list with the dragged scenes removed,
  // which is exactly what moveSceneToIndex / moveScenesToIndex expect.
  const getReorderTarget = React.useCallback((clientY: number): number => {
    const scenes = project?.scenes || [];
    const container = sceneListScrollRef.current;
    if (!container || scenes.length === 0) return 0;
    const contentY = clientY - container.getBoundingClientRect().top + container.scrollTop;
    let insertAt = scenes.length;
    for (let i = 0; i < scenes.length; i++) {
      const el = sceneCardRefs.current[scenes[i].id];
      if (!el) continue;
      if (contentY < el.offsetTop + el.offsetHeight / 2) { insertAt = i; break; }
    }
    let draggedBefore = 0;
    draggedIndicesRef.current.forEach((idx) => { if (idx < insertAt) draggedBefore++; });
    return insertAt - draggedBefore;
  }, [project?.scenes]);

  const getDragTransform = React.useCallback((cardIndex: number, isDraggedCard: boolean): string => {
    if (isDraggedCard || !draggingId || dragOverIndex === null) return '';
    const draggedIdxSet = draggedIndicesRef.current;
    const numDragged = draggedIdxSet.size;
    if (numDragged === 0) return '';
    const slotHeight = draggingCardHeight.current + 8;
    const remainingCount = totalScenesRef.current - numDragged;
    const clampedTarget = Math.min(dragOverIndex, remainingCount);
    let dragsBeforeI = 0;
    draggedIdxSet.forEach(idx => { if (idx < cardIndex) dragsBeforeI++; });
    const r_i = cardIndex - dragsBeforeI;
    const finalPos = r_i < clampedTarget ? r_i : r_i + numDragged;
    const deltaSlots = finalPos - cardIndex;
    if (deltaSlots === 0) return '';
    return `translateY(${deltaSlots * slotHeight}px)`;
  }, [dragOverIndex, draggingId]);

  React.useLayoutEffect(() => {
    if (!pendingFlip.current) return;
    pendingFlip.current = false;
    const old = flipSnapshot.current;
    Object.entries(sceneCardRefs.current).forEach(([id, el]: [string, HTMLDivElement | null]) => {
      if (!el || !old[id]) return;
      const deltaY = old[id].top - el.getBoundingClientRect().top;
      if (Math.abs(deltaY) < 2) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${deltaY}px)`;
      el.getBoundingClientRect(); // force reflow so the browser sees the start state
      el.style.transition = 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      el.style.transform = 'translateY(0)';
      const cleanup = () => { el.style.transform = ''; el.style.transition = ''; el.removeEventListener('transitionend', cleanup); };
      el.addEventListener('transitionend', cleanup);
    });
  }, [project?.scenes]);

  const addImportedScenes = (scenes: Array<{ name: string; image: string; thumbnail: string }> = []) => {
    scenes.forEach((scene) => addScene({ name: scene.name, image: scene.image, thumbnail: scene.thumbnail, initialYaw: 0, initialPitch: 0, initialZoom: 20 }));
  };

  const handleDesktopImport = async () => {
    const desktop = getDesktopApi();
    if (!desktop || !project) return;
    setImportProgress({ stage: 'start', total: 0, current: 0, currentFile: null });
    let unsubscribeProgress = () => {};
    if (desktop.onSceneImportProgress) {
      unsubscribeProgress = desktop.onSceneImportProgress((progress) => {
        setImportProgress(progress);
      });
    }
    try {
      const imported = await desktop.importSceneImages(project);
      const importedPath = (imported as any)?.projectPath;
      const importedScenes = Array.isArray((imported as any)?.scenes) ? (imported as any).scenes : [];
      if (importedPath && importedPath !== project.path) updateProject({ path: importedPath });
      addImportedScenes(importedScenes);
      if (!importedScenes.length) {
        pushToast('info', 'No scenes were imported.');
      }
    } catch {
      pushToast('error', 'Failed to import scenes');
    } finally {
      unsubscribeProgress();
      setImportProgress(null);
    }
  };

  const processImportedFiles = React.useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        pushToast('info', `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)}MB — large images may slow performance`);
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = String(reader.result || '');
          const img = new Image();
          const loadOk = await new Promise<boolean>((res) => {
            img.onload = () => res(true);
            img.onerror = () => res(false);
            img.src = dataUrl;
          });
          if (!loadOk) {
            pushToast('error', `"${file.name}" is corrupt or not a valid image — skipped`);
            resolve();
            return;
          }
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const aspect = h > 0 ? w / h : 0;
          if (aspect > 0 && (aspect < 1.5 || aspect > 3.5)) {
            pushToast('info', `"${file.name}" is ${w}×${h} (${aspect.toFixed(1)}:1). Expected ~2:1 for 360° panoramas.`);
          } else if (w > 0 && h > 0) {
            pushToast('success', `Imported "${file.name}" — ${w}×${h}`);
          }
          try {
            const sceneImage = await resizeSceneImage(dataUrl);
            const thumbnail = await generateThumbnail(sceneImage, 320);
            addScene({ name: file.name.split('.')[0], image: sceneImage, thumbnail, initialYaw: 0, initialPitch: 0, initialZoom: 20 });
          } catch {
            addScene({ name: file.name.split('.')[0], image: dataUrl, thumbnail: dataUrl, initialYaw: 0, initialPitch: 0, initialZoom: 20 });
          }
          resolve();
        };
        reader.onerror = () => {
          pushToast('error', `Failed to read "${file.name}" — check the file is not locked or corrupt`);
          resolve();
        };
        reader.onabort = () => { resolve(); };
        reader.readAsDataURL(file);
      });
    }
  }, [addScene, pushToast]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const desktop = getDesktopApi();
    if (desktop) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const files = Array.from(e.target.files || []) as File[];
    await processImportedFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isExternalFileDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('application/x-panoradesk-scene-id');

  const handleListDragOver = (e: React.DragEvent) => {
    // Reordering an existing scene: make the whole list a valid drop target
    // (not only the individual cards) so drops near the top/bottom edges or in
    // the gaps opened by the drag preview still register instead of snapping
    // back. We must preventDefault here for the drop event to fire at all.
    if (draggingId) {
      const container = sceneListScrollRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const ZONE = 80;
        const distFromTop = e.clientY - rect.top;
        const distFromBottom = rect.bottom - e.clientY;
        if (distFromTop < ZONE) container.scrollTop -= Math.round((1 - distFromTop / ZONE) * 14);
        else if (distFromBottom < ZONE) container.scrollTop += Math.round((1 - distFromBottom / ZONE) * 14);
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverIndex(getReorderTarget(e.clientY));
      return;
    }
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverFiles(true);
  };

  const handleListDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverFiles(false);
    }
  };

  const handleListDrop = async (e: React.DragEvent) => {
    // Commit a scene reorder dropped anywhere in the list (including the gaps a
    // card-level onDrop would miss). The per-card onDrop handlers were removed
    // so this is the single place a reorder is applied.
    if (draggingId) {
      e.preventDefault();
      const ids = draggingIds;
      const target = getReorderTarget(e.clientY);
      capturePositions();
      if (ids.length > 1) moveScenesToIndex(ids, target);
      else if (ids.length === 1) moveSceneToIndex(ids[0], target);
      setDraggingId(null);
      setDragOverIndex(null);
      dragFromIndex.current = null;
      draggedIndicesRef.current = new Set();
      setIsDragOverFiles(false);
      return;
    }
    setIsDragOverFiles(false);
    if (!isExternalFileDrag(e)) return;
    e.preventDefault();
    const desktop = getDesktopApi();
    if (desktop) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => (f as File).type.startsWith('image/')) as File[];
    await processImportedFiles(files);
  };

  const confirmDeleteSceneFromDisk = (sceneId: string) => {
    const scene = project?.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    openConfirm({
      title: 'Delete Scene and File',
      message: `This will remove "${scene.name}" from the project AND permanently delete the image file from your folder. This cannot be undone.`,
      confirmLabel: 'Delete from Disk',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        const desktop = getDesktopApi();
        const projectPath = project?.path;
        if (desktop && projectPath) {
          const targets = Array.from(
            new Set([scene.image, scene.thumbnail].filter((p): p is string => !!p && !p.startsWith('data:'))),
          );
          let imageRemoved = true;
          for (const rel of targets) {
            const ok = await desktop.deleteFile(projectPath, rel);
            if (!ok && rel === scene.image) imageRemoved = false;
          }
          if (!imageRemoved) {
            pushToast('error', `Could not delete the image file for "${scene.name}" from disk — removing from project only`);
          }
        }
        deleteScene(sceneId);
      },
    });
  };

  const filteredScenes = React.useMemo(() => [...(project?.scenes || [])], [project?.scenes]);
  const draggingIds = draggingId && selectedSceneIds.includes(draggingId) ? selectedSceneIds : draggingId ? [draggingId] : [];

  React.useEffect(() => {
    setSelectedSceneIds((prev) => prev.filter((id) => project?.scenes.some((s) => s.id === id)));
  }, [project?.scenes]);

  React.useEffect(() => {
    const onWindowClick = () => setContextMenu(null);
    window.addEventListener('click', onWindowClick);
    return () => window.removeEventListener('click', onWindowClick);
  }, []);
  React.useEffect(() => {
    const el = sceneListScrollRef.current;
    if (!el) return;
    const onScroll = () => setContextMenu(null);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  React.useEffect(() => {
    if (!currentSceneId) return;
    const card = sceneCardRefs.current[currentSceneId];
    card?.scrollIntoView({ block: 'nearest' });
  }, [currentSceneId]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (isTyping) return;
      if (e.key === 'Escape') {
        setContextMenu(null);
        setRenamingSceneId(null);
        setSelectedSceneIds([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && filteredScenes.length > 0) {
        e.preventDefault();
        setSelectedSceneIds(filteredScenes.map((scene) => scene.id));
        return;
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && filteredScenes.length > 0) {
        e.preventDefault();
        const currentIndex = Math.max(0, filteredScenes.findIndex((scene) => scene.id === currentSceneId));
        const nextIndex = e.key === 'ArrowDown'
          ? Math.min(filteredScenes.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
        const nextSceneId = filteredScenes[nextIndex]?.id;
        if (nextSceneId) {
          setCurrentScene(nextSceneId);
          setSelectedSceneIds([nextSceneId]);
        }
        return;
      }
      if (e.key === 'Enter' && selectedSceneIds.length === 1) {
        e.preventDefault();
        setCurrentScene(selectedSceneIds[0]);
        return;
      }
      if (e.key !== 'Delete' || selectedSceneIds.length === 0 || renamingSceneId) return;
      const selectedObjectId = useProjectStore.getState().selectedId;
      if (selectedObjectId) return;
      e.preventDefault();
      deleteSelectedScenes();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredScenes, selectedSceneIds, renamingSceneId, currentSceneId, setCurrentScene]);

  const contextMenuPos = React.useMemo(() => {
    if (!contextMenu) return null;
    const menuWidth = 176;
    const menuHeight = 230;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(8, Math.min(contextMenu.x, viewportWidth - menuWidth - 8));
    const top = Math.max(8, Math.min(contextMenu.y, viewportHeight - menuHeight - 8));
    return { left, top };
  }, [contextMenu]);

  const toggleSceneSelection = (sceneId: string, keepExisting: boolean, isShift = false) => {
    if (isShift && lastClickedRef.current && lastClickedRef.current !== sceneId) {
      const ids = filteredScenes.map((s) => s.id);
      const a = ids.indexOf(lastClickedRef.current);
      const b = ids.indexOf(sceneId);
      if (a >= 0 && b >= 0) {
        const rangeIds = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelectedSceneIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
        return;
      }
    }
    lastClickedRef.current = sceneId;
    setSelectedSceneIds((prev) => {
      if (!keepExisting) return [sceneId];
      return prev.includes(sceneId) ? prev.filter((id) => id !== sceneId) : [...prev, sceneId];
    });
  };

  const deleteSelectedScenes = () => {
    if (selectedSceneIds.length === 0) return;
    openConfirm({
      title: 'Delete Selected Scenes',
      message: `Delete ${selectedSceneIds.length} selected scene${selectedSceneIds.length > 1 ? 's' : ''}?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        deleteScenes(selectedSceneIds);
        setSelectedSceneIds([]);
        pushToast('success', 'Selected scenes deleted');
      },
    });
  };

  const startRenameScene = (sceneId: string, currentName: string) => {
    setRenamingSceneId(sceneId);
    setRenameValue(currentName);
    setContextMenu(null);
  };

  const commitRenameScene = () => {
    if (!renamingSceneId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingSceneId(null);
      return;
    }
    updateSceneName(renamingSceneId, name);
    setRenamingSceneId(null);
  };

  const updateSceneName = (sceneId: string, name: string) => {
    const scene = project?.scenes.find((s) => s.id === sceneId);
    if (!scene || scene.name === name) return;
    updateScene(sceneId, { name });
    pushToast('success', 'Scene renamed');
  };

  const confirmDeleteScene = (sceneId: string) => {
    const scene = project?.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    openConfirm({
      title: 'Delete Scene',
      message: `Delete scene "${scene.name}"?`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        deleteScene(sceneId);
        setSelectedSceneIds((prev) => prev.filter((id) => id !== sceneId));
      },
    });
  };
  const openContextMenuForScene = (sceneId: string, x: number, y: number) => {
    setContextMenu({ x, y, sceneId });
    setSelectedSceneIds([sceneId]);
  };

  const previewScene = hoveredScene && !draggingId
    ? project?.scenes.find((s) => s.id === hoveredScene.id)
    : null;
  const progressPercent = importProgress && importProgress.total > 0
    ? Math.max(0, Math.min(100, Math.round((importProgress.current / importProgress.total) * 100)))
    : 0;
  const isImporting = !!importProgress;

  return (
    <aside className="w-72 bg-sidebar flex flex-col h-full border-r border-border-dark text-white shadow-2xl z-30">
      <div className="p-4 border-b border-border-dark">
        <div className="flex items-center gap-2"><Layers className="w-5 h-5 text-primary" /><h2 className="font-bold text-sm uppercase tracking-widest text-slate-400">Scenes</h2></div>
        <input ref={fileInputRef} type="file" className="hidden" accept="image/*" multiple onChange={handleImport} />
      </div>
      <div className="px-4 pt-3 pb-2 border-b border-border-dark">
        <button
          type="button"
          onClick={() => {
            const desktop = getDesktopApi();
            if (desktop) {
              if (isImporting) return;
              void handleDesktopImport();
            } else {
              fileInputRef.current?.click();
            }
          }}
          disabled={isImporting}
          className="w-full text-xs font-semibold uppercase tracking-wider rounded-lg px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Upload className="w-3.5 h-3.5" />
          {isImporting ? 'Importing...' : 'Bulk Import Scenes'}
        </button>
        {isImporting && (
          <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/70 p-2">
            <div className="flex items-center justify-between text-[10px] text-slate-300 mb-1">
              <span>Importing panoramas</span>
              <span>{importProgress?.current || 0}/{importProgress?.total || 0}</span>
            </div>
            <div className="h-1.5 w-full rounded bg-slate-700 overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-slate-400 truncate">
              {importProgress?.currentFile || 'Preparing files...'}
            </div>
          </div>
        )}
      </div>

      {selectedSceneIds.length > 1 && (
        <div className="px-4 py-2 border-b border-border-dark flex items-center justify-between bg-primary/10">
          <span className="text-[11px] font-semibold text-primary">{selectedSceneIds.length} scenes selected</span>
          <button
            type="button"
            onClick={() => setSelectedSceneIds([])}
            className="text-[10px] text-slate-400 hover:text-white transition-colors underline"
          >
            Deselect all
          </button>
        </div>
      )}
      <div
        ref={sceneListScrollRef}
        className={cn('flex-1 overflow-y-auto custom-scrollbar-dark p-3 space-y-2 relative transition-colors', isDragOverFiles && 'bg-primary/5')}
        onDragOver={handleListDragOver}
        onDragLeave={handleListDragLeave}
        onDrop={handleListDrop}
      >
        {isDragOverFiles && (
          <div className="absolute inset-2 z-10 rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <Upload className="w-8 h-8 text-primary mx-auto mb-2 opacity-80" />
              <p className="text-sm font-semibold text-primary">Drop panoramas to import</p>
            </div>
          </div>
        )}
        {project?.scenes.length === 0 ? (
          <div className="text-center py-12 px-4"><div className="w-12 h-12 bg-slate-800 flex items-center justify-center rounded-2xl mx-auto mb-4"><ImageIcon className="w-6 h-6 text-slate-600" /></div><p className="text-sm text-slate-500 font-medium">No scenes yet. Import your first 360 panorama.</p></div>
        ) : (
          filteredScenes.map((scene, index) => (
            <div
              key={scene.id}
              draggable
              onDragStart={(e) => {
                if (!selectedSceneIds.includes(scene.id)) {
                  setSelectedSceneIds([scene.id]);
                  lastClickedRef.current = scene.id;
                }
                setDraggingId(scene.id);
                dragFromIndex.current = index;
                draggingCardHeight.current = sceneCardRefs.current[scene.id]?.offsetHeight ?? 0;
                const idsBeingDragged = selectedSceneIds.includes(scene.id) ? selectedSceneIds : [scene.id];
                const idSet = new Set(idsBeingDragged);
                draggedIndicesRef.current = new Set(
                  filteredScenes.map((s, i) => (idSet.has(s.id) ? i : -1)).filter((i): i is number => i >= 0)
                );
                totalScenesRef.current = filteredScenes.length;
                e.dataTransfer.setData('application/x-panoradesk-scene-id', scene.id);
                e.dataTransfer.setData('text/plain', scene.id);
                e.dataTransfer.effectAllowed = 'all';
                (window as any).__panoraDragSceneId = scene.id;
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDragOverIndex(null);
                dragFromIndex.current = null;
                draggedIndicesRef.current = new Set();
                (window as any).__panoraDragSceneId = null;
              }}
              ref={(el) => {
                sceneCardRefs.current[scene.id] = el;
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenuForScene(scene.id, e.clientX, e.clientY);
              }}
              onClick={(e) => {
                toggleSceneSelection(scene.id, e.ctrlKey || e.metaKey, e.shiftKey);
                if (!e.shiftKey) setCurrentScene(scene.id);
              }}
              onDoubleClick={() => startRenameScene(scene.id, scene.name)}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setHoveredScene({ id: scene.id, y: rect.top + rect.height / 2 });
              }}
              onMouseLeave={() => setHoveredScene(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSceneSelection(scene.id, e.ctrlKey || e.metaKey, e.shiftKey);
                  if (!e.shiftKey) setCurrentScene(scene.id);
                  return;
                }
                if (e.key === 'F2') {
                  e.preventDefault();
                  startRenameScene(scene.id, scene.name);
                  return;
                }
                if (e.key === 'Delete') {
                  e.preventDefault();
                  confirmDeleteScene(scene.id);
                  return;
                }
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault();
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  openContextMenuForScene(scene.id, rect.left + 16, rect.top + 16);
                }
              }}
              role="button"
              tabIndex={0}
              aria-selected={currentSceneId === scene.id}
              aria-label={`Scene ${index + 1}: ${scene.name}`}
              style={{
                transform: getDragTransform(index, draggingIds.includes(scene.id)),
                ...(draggingId ? { transition: 'transform 220ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 150ms ease, box-shadow 150ms ease' } : {}),
              }}
              className={cn('group relative rounded-xl overflow-hidden cursor-pointer transition-all border-2', currentSceneId === scene.id ? 'border-primary bg-primary/5' : 'border-transparent bg-slate-800/40 hover:bg-slate-800', selectedSceneIds.includes(scene.id) && 'ring-2 ring-primary/60', draggingIds.includes(scene.id) && 'opacity-40 shadow-2xl shadow-black/60')}
            >
              <div className="aspect-[16/9] bg-black overflow-hidden relative">
                <img
                  src={resolveAssetSrc(project, scene.thumbnail || scene.image)}
                  alt={scene.name}
                  className="w-full h-full object-cover object-center opacity-85 group-hover:opacity-100 transition-opacity"
                  style={{ transform: 'scale(1.32)' }}
                />
                {index === 0 && (
                  <div className="absolute top-2 left-2 bg-primary text-black text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-md">
                    Start
                  </div>
                )}
                {draggingId === scene.id && draggingIds.length > 1 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="bg-primary text-black text-xs font-bold px-2.5 py-1 rounded-full shadow-lg">
                      {draggingIds.length} scenes
                    </div>
                  </div>
                )}
              </div>
              <div className="p-3 flex items-center justify-between gap-2">
                <div className="truncate pr-1">
                  <div className="flex items-center gap-1"><GripVertical className="w-3.5 h-3.5 text-slate-500" /><div className="text-sm font-semibold truncate">{scene.name}</div></div>
                </div>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(ev) => { ev.stopPropagation(); capturePositions(); moveScene(scene.id, 'up'); }}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Move Up"
                    aria-label={`Move scene ${scene.name} up`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); capturePositions(); moveScene(scene.id, 'down'); }}
                    className="p-1 text-slate-400 hover:text-white"
                    title="Move Down"
                    aria-label={`Move scene ${scene.name} down`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(ev) => { ev.stopPropagation(); duplicateScene(scene.id); }} className="p-1 text-slate-400 hover:text-white" title="Duplicate Scene" aria-label={`Duplicate scene ${scene.name}`}><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={(ev) => { ev.stopPropagation(); confirmDeleteSceneFromDisk(scene.id); }} className="p-1 text-slate-400 hover:text-orange-400" title="Delete scene and remove file from disk" aria-label={`Delete scene ${scene.name} from disk`}><HardDrive className="w-3.5 h-3.5" /></button>
                  <button onClick={(ev) => { ev.stopPropagation(); confirmDeleteScene(scene.id); }} className="p-1 text-slate-400 hover:text-red-400" title="Delete Scene from project" aria-label={`Delete scene ${scene.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {renamingSceneId === scene.id && (
                <div className="px-3 pb-3">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRenameScene();
                      if (e.key === 'Escape') setRenamingSceneId(null);
                    }}
                    onBlur={commitRenameScene}
                    className="w-full text-xs rounded-md px-2 py-1 bg-slate-900 border border-slate-600 text-slate-100"
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="fixed z-[180] w-44 rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-2xl"
          style={contextMenuPos || { left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { setCurrentScene(contextMenu.sceneId); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 rounded">Open scene</button>
          <button
            onClick={() => {
              const current = project?.scenes.find((s) => s.id === contextMenu.sceneId);
              if (current) startRenameScene(current.id, current.name);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 rounded"
          >
            Rename
          </button>
          <button onClick={() => { duplicateScene(contextMenu.sceneId); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 rounded">Duplicate</button>
          <button
            onClick={() => {
              capturePositions();
              moveSceneToIndex(contextMenu.sceneId, 0);
              setContextMenu(null);
              pushToast('success', 'Set as starting scene');
            }}
            disabled={project?.scenes[0]?.id === contextMenu.sceneId}
            className="w-full text-left px-3 py-1.5 text-sm text-primary hover:bg-slate-800 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Set as starting scene
          </button>
          <button
            onClick={() => {
              capturePositions();
              moveScene(contextMenu.sceneId, 'up');
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 rounded"
          >
            Move up
          </button>
          <button
            onClick={() => {
              capturePositions();
              moveScene(contextMenu.sceneId, 'down');
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 rounded"
          >
            Move down
          </button>
          <button onClick={() => { confirmDeleteScene(contextMenu.sceneId); setContextMenu(null); }} className="w-full text-left px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/30 rounded">Delete</button>
        </div>
      )}

      {/* Hover thumbnail preview — floats to the right of the sidebar */}
      {previewScene && hoveredScene && project && (
        <div
          className="fixed z-[190] pointer-events-none"
          style={{ left: 288 + 10, top: Math.max(8, hoveredScene.y - 60) }}
        >
          <div className="w-56 rounded-xl overflow-hidden shadow-2xl border border-slate-700 bg-slate-900">
            <img
              src={resolveAssetSrc(project, previewScene.thumbnail || previewScene.image)}
              alt={previewScene.name}
              className="w-full aspect-video object-cover"
            />
            <div className="px-2.5 py-1.5 text-xs font-semibold text-slate-200 truncate">{previewScene.name}</div>
          </div>
        </div>
      )}

      <div className="p-4 bg-slate-900/50 border-t border-border-dark flex items-center justify-between text-[11px] text-slate-500 font-medium">
        <span>{project?.scenes.length || 0} TOTAL SCENES</span>
        <div className="flex items-center gap-2">
          {filteredScenes.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedSceneIds(filteredScenes.map((s) => s.id))}
              className="text-[10px] font-semibold text-slate-500 hover:text-white px-2 py-0.5 rounded border border-slate-700 hover:border-slate-500 transition-colors"
            >
              Select All
            </button>
          )}
          <span className="text-primary/60">PANORADESK 360 · Build {__BUILD_NUMBER__}</span>
        </div>
      </div>
    </aside>
  );
};

export default LeftSidebar;
