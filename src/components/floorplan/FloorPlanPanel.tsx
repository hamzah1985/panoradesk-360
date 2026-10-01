import React from 'react';
import { runProjectOperation, useProjectStore } from '../../store/projectStore';
import { X, Upload, Map as MapIcon, Crosshair, Trash2, SkipForward, ImageMinus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getDesktopApi } from '../../lib/desktop';
import { resolveAssetSrc } from '../../lib/media';
import { getEscapeCloseLayerCount, useEscapeClose } from '../../hooks/useEscapeClose';
import { useUiStore } from '../../store/uiStore';

interface FloorPlanPanelProps {
  onClose: () => void;
}

const FloorPlanPanel: React.FC<FloorPlanPanelProps> = ({ onClose }) => {
  const { project, updateScene, currentSceneId, setCurrentScene } = useProjectStore();
  const { pushToast, openConfirm } = useUiStore();
  const [isEditing, setIsEditing] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapUploadInputRef = React.useRef<HTMLInputElement>(null);
  useEscapeClose(true, onClose);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('floor-plan-placing', { detail: { active: isEditing } }));
  }, [isEditing]);
  React.useEffect(() => {
    return () => { window.dispatchEvent(new CustomEvent('floor-plan-placing', { detail: { active: false } })); };
  }, []);

  const currentScene = project?.scenes.find((scene) => scene.id === currentSceneId) || null;
  const pinnedCount = project?.scenes.filter((scene) => !!scene.floorPlan).length || 0;
  const unpinnedScenes = project?.scenes.filter((scene) => !scene.floorPlan) || [];
  const nextUnpinnedScene = unpinnedScenes[0] || null;
  const canClearCurrentPin = !!currentSceneId && !!currentScene?.floorPlan;

  const handleMapUpload = async () => {
    if (!project) return;
    const ownerProjectId = project.id;
    const desktop = getDesktopApi();
    if (desktop) {
      const ownerProject = project;
      await runProjectOperation(ownerProjectId, async () => {
        try {
          const result = await desktop.uploadFloorPlan(ownerProject);
          if (!result) return;
          const latest = useProjectStore.getState();
          if (latest.project?.id !== ownerProjectId) return;
          latest.updateProject({ floorPlanImage: result.path, path: result.projectPath });
        } catch {
          if (useProjectStore.getState().project?.id === ownerProjectId) {
            pushToast('error', 'Failed to upload floor plan');
          }
        }
      });
    } else {
      mapUploadInputRef.current?.click();
    }
  };
  const handleMapFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    const ownerProjectId = project.id;
    void runProjectOperation(ownerProjectId, () => new Promise<void>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const latest = useProjectStore.getState();
        if (latest.project?.id === ownerProjectId) {
          latest.updateProject({ floorPlanImage: reader.result as string });
          pushToast('success', `Floor plan "${file.name}" uploaded`);
        }
        resolve();
      };
      reader.onerror = () => {
        if (useProjectStore.getState().project?.id === ownerProjectId) {
          pushToast('error', 'Failed to read floor plan image');
        }
        resolve();
      };
      reader.onabort = () => resolve();
      try {
        reader.readAsDataURL(file);
      } catch {
        if (useProjectStore.getState().project?.id === ownerProjectId) {
          pushToast('error', 'Failed to read floor plan image');
        }
        resolve();
      }
    }));
    e.target.value = '';
  };

  const clearCurrentScenePin = () => {
    if (!currentSceneId) return;
    updateScene(currentSceneId, { floorPlan: undefined });
    setIsEditing(false);
    pushToast('success', 'Current scene pin removed from floor plan');
  };
  const clearAllScenePins = () => {
    if (!project || pinnedCount === 0) return;
    const ownerProjectId = project.id;
    openConfirm({
      title: 'Clear All Floor Plan Pins',
      message: `Remove floor plan pins from ${pinnedCount} scene${pinnedCount === 1 ? '' : 's'}?`,
      confirmLabel: 'Clear Pins',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        const latest = useProjectStore.getState().project;
        if (!latest || latest.id !== ownerProjectId) return;
        useProjectStore.getState().updateProject({
          scenes: latest.scenes.map((scene) => ({ ...scene, floorPlan: undefined })),
        });
        setIsEditing(false);
        pushToast('success', 'All floor plan pins cleared');
      },
    });
  };
  const moveToNextUnpinned = () => {
    if (!nextUnpinnedScene) return;
    setCurrentScene(nextUnpinnedScene.id);
    setIsEditing(true);
    pushToast('info', `Selected "${nextUnpinnedScene.name}". Click map to place its pin.`);
  };
  const clearFloorPlanImage = () => {
    if (!project?.floorPlanImage) return;
    const ownerProjectId = project.id;
    openConfirm({
      title: 'Remove Floor Plan',
      message: 'Remove the floor plan image and all scene pins from this project?',
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: () => {
        const latest = useProjectStore.getState().project;
        if (!latest || latest.id !== ownerProjectId) return;
        useProjectStore.getState().updateProject({
          floorPlanImage: undefined,
          scenes: latest.scenes.map((scene) => ({ ...scene, floorPlan: undefined })),
        });
        setIsEditing(false);
        pushToast('success', 'Floor plan removed from project');
      },
    });
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditing || !currentSceneId || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));

    updateScene(currentSceneId, {
      floorPlan: { x, y },
    });
    setIsEditing(false);
    pushToast('success', `Pinned "${currentScene?.name || 'scene'}" on floor plan`);
  };
  React.useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useUiStore.getState().confirm.open) return;
      // The floor-plan panel contributes one Escape layer itself. Any layer
      // above it owns the keyboard while its modal/overlay is open.
      if (getEscapeCloseLayerCount() > 1) return;
      e.preventDefault();
      e.stopPropagation();
      setIsEditing(false);
      pushToast('info', 'Floor plan placement canceled');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isEditing, pushToast]);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().confirm.open) return;
      if (getEscapeCloseLayerCount() > 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (typing) return;
      if (e.key.toLowerCase() === 'n' && nextUnpinnedScene) {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveToNextUnpinned();
        return;
      }
      if (e.key.toLowerCase() === 'p' && project?.floorPlanImage) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setIsEditing((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [nextUnpinnedScene, project?.floorPlanImage]);

  if (!project) return null;

  return (
    <div className="absolute bottom-20 right-6 w-96 bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 overflow-hidden flex flex-col z-40 animate-in slide-in-from-bottom-4 duration-300">
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
        <div className="flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-primary" />
          <h3 className="font-bold text-sm text-slate-800 uppercase tracking-widest">Floor Plan</h3>
        </div>
        <div className="flex items-center gap-1">
          {canClearCurrentPin && (
            <button
              onClick={clearCurrentScenePin}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
              title="Remove current scene pin from map"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {project.floorPlanImage && !!nextUnpinnedScene && (
            <button
              onClick={moveToNextUnpinned}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              title={`Jump to next unpinned scene (${nextUnpinnedScene.name})`}
            >
              <SkipForward className="w-4 h-4" />
            </button>
          )}
          {project.floorPlanImage && pinnedCount > 0 && (
            <button
              onClick={clearAllScenePins}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
              title="Remove all scene pins"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {project.floorPlanImage && (
            <button
              onClick={clearFloorPlanImage}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
              title="Remove floor plan image and pins"
            >
              <ImageMinus className="w-4 h-4" />
            </button>
          )}
          {project.floorPlanImage && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={cn('p-1.5 rounded-lg transition-colors', isEditing ? 'bg-primary text-white' : 'hover:bg-slate-100 text-slate-400')}
              title="Place current scene pin (P)"
            >
              <Crosshair className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-slate-50 min-h-[300px] relative">
        {!project.floorPlanImage ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
            <div className="p-4 bg-white rounded-2xl shadow-sm mb-4">
              <Upload className="w-6 h-6 text-slate-300" />
            </div>
            <p className="text-xs text-slate-500 font-medium mb-1">No floor plan uploaded yet.</p>
            <p className="text-[10px] text-slate-400 mb-4 leading-relaxed max-w-[200px]">Upload a floor plan image, then use the crosshair button to place scene pins on the map.</p>
            <button onClick={handleMapUpload} className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:brightness-110 transition-all">
              Upload Map
            </button>
          </div>
        ) : (
          <div ref={containerRef} className={cn('relative w-full cursor-crosshair', !isEditing && 'cursor-default')} onClick={handleMapClick}>
            <img src={resolveAssetSrc(project, project.floorPlanImage)} alt="Floor Plan" className="w-full h-auto" />

            {project.scenes.map(
              (scene) =>
                scene.floorPlan && (
                  <button
                    key={scene.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentScene(scene.id);
                    }}
                    className={cn(
                      'absolute w-4 h-4 rounded-full border-2 border-white shadow-lg transition-all transform -translate-x-1/2 -translate-y-1/2 hover:scale-125',
                      currentSceneId === scene.id ? 'bg-primary scale-125 z-10' : 'bg-slate-800',
                    )}
                    title={scene.name}
                    aria-label={`Floor plan pin for ${scene.name}`}
                    style={{ left: `${scene.floorPlan.x}%`, top: `${scene.floorPlan.y}%` }}
                  >
                    {currentSceneId === scene.id && <div className="absolute -inset-1 rounded-full border border-primary animate-ping opacity-50" />}
                  </button>
                ),
            )}

            {isEditing && (
              <div className="absolute top-2 left-2 right-2 bg-primary/95 px-3 py-2 rounded-lg shadow-lg text-[11px] text-white font-semibold animate-pulse flex items-center gap-2">
                <Crosshair className="w-3.5 h-3.5 flex-shrink-0" />
                Click the map to pin "{currentScene?.name || 'this scene'}" · Esc to cancel
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-3 bg-white text-[10px] text-slate-400 font-bold uppercase tracking-tighter text-center">
        {project.floorPlanImage
          ? `${pinnedCount}/${project.scenes.length} scenes pinned | Click dots to navigate | P toggle placement | N jump to next unpinned`
          : 'Ready to upload'}
      </div>
      <input
        ref={mapUploadInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleMapFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </div>
  );
};

export default FloorPlanPanel;
