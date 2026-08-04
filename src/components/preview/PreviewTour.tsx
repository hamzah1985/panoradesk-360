import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { AppMode } from '../../types';
import { ChevronLeft, Expand, Minimize2, Tag } from 'lucide-react';
import PreviewPlayer from './PreviewPlayer';
import PreviewBurgerMenu from './PreviewBurgerMenu';

const PreviewTour = () => {
  const { setMode, setSelectedId, project, setCurrentScene, currentSceneId } = useProjectStore();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [showLabels, setShowLabels] = React.useState(project?.exportSettings?.showSceneNames ?? false);
  const initialSceneIdRef = React.useRef<string | undefined>(currentSceneId || project?.scenes[0]?.id);
  const handleSceneChange = React.useCallback((sceneId: string) => {
    setCurrentScene(sceneId);
  }, [setCurrentScene]);

  React.useEffect(() => {
    const state = useProjectStore.getState();
    initialSceneIdRef.current = state.currentSceneId || state.project?.scenes[0]?.id;
  }, [project?.id]);

  React.useEffect(() => {
    setSelectedId(null);
  }, [setSelectedId]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setMode(AppMode.EDITOR);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [setMode]);

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('preview-request-current-scene'));
  }, []);

  React.useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = React.useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      const target = rootRef.current;
      if (target?.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch {
      // Swallow fullscreen errors to avoid breaking preview interaction.
    }
  }, []);

  return (
    <div ref={rootRef} className="h-full w-full relative bg-black overflow-hidden font-sans">
      <div className="absolute inset-0">
        {project ? <PreviewPlayer project={project} initialSceneId={initialSceneIdRef.current} onSceneChange={handleSceneChange} showLabels={showLabels} /> : null}
      </div>

      <button 
        onClick={() => setMode(AppMode.EDITOR)}
        className="absolute top-6 left-6 z-50 p-3 bg-black/40 backdrop-blur-md text-white rounded-2xl hover:bg-black/60 transition-all border border-white/10 flex items-center gap-2 group shadow-2xl"
      >
        <div className="p-1 bg-white/10 rounded-lg group-hover:bg-primary transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </div>
        <span className="text-xs font-bold uppercase tracking-widest">Back to Editor</span>
      </button>

      <div className="absolute right-3 bottom-3 z-50 flex items-center gap-2">
        <button
          onClick={() => setShowLabels((v) => !v)}
          className={`p-2.5 backdrop-blur-md text-white rounded-xl transition-all border shadow-2xl ${showLabels ? 'bg-white/20 border-white/30' : 'bg-black/45 border-white/10 hover:bg-black/65'}`}
          title={showLabels ? 'Hide hotspot labels' : 'Always show hotspot labels'}
          aria-label={showLabels ? 'Hide hotspot labels' : 'Always show hotspot labels'}
        >
          <Tag className="w-4 h-4" />
        </button>
        <button
          onClick={() => { void toggleFullscreen(); }}
          className="p-2.5 bg-black/45 backdrop-blur-md text-white rounded-xl hover:bg-black/65 transition-all border border-white/10 shadow-2xl"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
        </button>
      </div>

      {project && (
        <PreviewBurgerMenu
          project={project}
          currentSceneId={currentSceneId || null}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => {
            void toggleFullscreen();
          }}
        />
      )}

      {/* Final-product style: clean viewport, no editor-style badges */}
    </div>
  );
};

export default PreviewTour;
