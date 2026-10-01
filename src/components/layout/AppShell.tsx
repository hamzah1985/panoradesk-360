import React from 'react';
import { MousePointer2, MapPin, Info, GalleryHorizontal, Map as MapIcon, ImagePlus, Crosshair } from 'lucide-react';
import TopBar from './TopBar';
import LeftSidebar from './LeftSidebar';
import RightPropertiesPanel from './RightPropertiesPanel';
import PanoramaViewer from '../viewer/PanoramaViewer';
import ProjectSettingsModal from '../modals/ProjectSettingsModal';
import FloorPlanPanel from '../floorplan/FloorPlanPanel';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { useUiStore } from '../../store/uiStore';
import { cn } from '../../lib/utils';

const AppShell = () => {
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [isFloorPlanOpen, setIsFloorPlanOpen] = React.useState(false);
  const [isFocusMode, setIsFocusMode] = React.useState(false);
  const [isFloorPlanPlacing, setIsFloorPlanPlacing] = React.useState(false);
  const { selectedId, project } = useProjectStore();
  const { activeTool, setActiveTool } = useEditorStore();
  const { pushToast } = useUiStore();

  const hasNavigationTargets = (project?.scenes?.length || 0) > 1;
  const hasScene = (project?.scenes?.length || 0) > 0;

  const tools = [
    { id: 'select' as const, icon: MousePointer2, label: 'Select', shortcut: 'S', enabled: true },
    { id: 'hotspot' as const, icon: MapPin, label: 'Hotspot', shortcut: 'H', enabled: hasNavigationTargets, iconColor: 'text-red-400' },
    { id: 'marker' as const, icon: Info, label: 'Marker', shortcut: 'M', enabled: true, iconColor: 'text-blue-400' },
  ];

  React.useEffect(() => {
    const onToggleFloorPlan = () => setIsFloorPlanOpen((prev) => !prev);
    window.addEventListener('toggle-floorplan', onToggleFloorPlan as EventListener);
    return () => window.removeEventListener('toggle-floorplan', onToggleFloorPlan as EventListener);
  }, []);
  React.useEffect(() => {
    const onPlacing = (evt: Event) => setIsFloorPlanPlacing((evt as CustomEvent<{ active: boolean }>).detail.active);
    window.addEventListener('floor-plan-placing', onPlacing as EventListener);
    return () => window.removeEventListener('floor-plan-placing', onPlacing as EventListener);
  }, []);

  React.useEffect(() => {
    const onSetTool = (evt: Event) => {
      const detail = (evt as CustomEvent<{ tool?: 'select' | 'hotspot' | 'marker' }>).detail;
      if (!detail?.tool) return;
      setActiveTool(detail.tool);
    };
    window.addEventListener('set-tool', onSetTool as EventListener);
    return () => window.removeEventListener('set-tool', onSetTool as EventListener);
  }, [setActiveTool]);

  const hasScenes = (project?.scenes?.length || 0) > 0;

  return (
    <div className="flex flex-col h-full w-full bg-workspace overflow-hidden">
      {/* Skip-to-content for keyboard/screen-reader users */}
      <a
        href="#main-viewer"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[200] focus:bg-slate-900 focus:text-white focus:px-3 focus:py-1.5 focus:rounded-lg focus:text-xs focus:font-bold"
      >
        Skip to viewer
      </a>
      <TopBar onToggleSettings={() => setIsSettingsOpen(true)} onToggleFocus={() => setIsFocusMode((v) => !v)} isFocusMode={isFocusMode} />

      <div className="flex-1 flex overflow-hidden">
        {!isFocusMode && <LeftSidebar />}

        <main id="main-viewer" className="flex-1 relative flex flex-col min-w-0">
          {/* Viewer — fills all remaining space, no bottom toolbar */}
          <div className="flex-1 relative overflow-hidden bg-black shadow-inner">
            <PanoramaViewer />

            {/* Empty-project onboarding overlay */}
            {!hasScenes && !isFocusMode && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-slate-950/80 backdrop-blur-sm pointer-events-none select-none">
                <div className="flex flex-col items-center gap-3 text-center max-w-xs">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <ImagePlus className="w-7 h-7 text-slate-400" />
                  </div>
                  <p className="text-slate-200 font-semibold text-base">Import your first panorama</p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Drag a 360° image into the <strong className="text-slate-300">Scenes</strong> panel on the left, or click the import button to get started.
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 text-xs font-mono">H</kbd>
                    <span className="text-slate-500 text-xs">hotspot tool</span>
                    <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 text-xs font-mono">M</kbd>
                    <span className="text-slate-500 text-xs">marker tool</span>
                    <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-400 text-xs font-mono">?</kbd>
                    <span className="text-slate-500 text-xs">shortcuts</span>
                  </div>
                </div>
              </div>
            )}

            {isFloorPlanPlacing && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-primary/95 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg pointer-events-none select-none animate-in fade-in duration-150">
                <Crosshair className="w-3.5 h-3.5" />
                Floor plan placement active — click the map to pin this scene · Esc to cancel
              </div>
            )}
            {isFloorPlanOpen && <FloorPlanPanel onClose={() => setIsFloorPlanOpen(false)} />}

            {/* Tool pill — left edge so it never blocks center panorama content */}
            <div className="absolute bottom-5 left-4 z-30 flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl px-2 py-1.5 shadow-xl">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    if (!tool.enabled) {
                      pushToast('info', 'Add at least one more scene to enable navigation hotspots.');
                      return;
                    }
                    setActiveTool(tool.id);
                  }}
                  title={`${tool.label} (${tool.shortcut})`}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all',
                    activeTool === tool.id
                      ? 'bg-slate-700 text-white shadow-inner'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800',
                    !tool.enabled && 'opacity-40 cursor-not-allowed hover:text-slate-400 hover:bg-transparent',
                  )}
                >
                  <tool.icon className={cn('w-3.5 h-3.5', activeTool === tool.id ? (tool.iconColor || 'text-primary') : 'text-slate-500')} />
                  {tool.label}
                </button>
              ))}
            </div>

            {/* Viewer utility buttons — bottom-right overlay, replacing the bottom toolbar */}
            <div className="absolute bottom-5 right-4 z-30 flex items-center gap-1 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-2xl px-2 py-1.5 shadow-xl">
              <button
                disabled={!hasScene}
                onClick={() => window.dispatchEvent(new CustomEvent('toggle-gallery'))}
                title="Toggle gallery (G)"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-all"
              >
                <GalleryHorizontal className="w-3.5 h-3.5" />
                Gallery
              </button>
              <button
                disabled={!hasScene}
                onClick={() => setIsFloorPlanOpen((prev) => !prev)}
                title="Toggle floor plan"
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-30 disabled:pointer-events-none',
                  isFloorPlanOpen
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800',
                )}
              >
                <MapIcon className="w-3.5 h-3.5" />
                Floorplan
              </button>
            </div>
          </div>
        </main>

        {/* Right panel — always visible in editor mode, collapses in focus mode */}
        <div className={cn('transition-all duration-200 overflow-hidden flex-shrink-0', !isFocusMode ? 'w-80' : 'w-0')}>
          {!isFocusMode && <RightPropertiesPanel />}
        </div>
      </div>

      {isSettingsOpen && <ProjectSettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </div>
  );
};

export default AppShell;
