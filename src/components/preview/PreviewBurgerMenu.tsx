import React from 'react';
import { Project } from '../../types';
import { resolveAssetSrc } from '../../lib/media';
import {
  Menu, X, Map as MapIcon, Eye, EyeOff, Expand, Minimize2, Compass,
  GalleryHorizontal, ChevronLeft, ChevronRight, ZoomIn, Images,
} from 'lucide-react';

type Props = {
  project: Project;
  currentSceneId: string | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
};

const PreviewBurgerMenu: React.FC<Props> = ({ project, currentSceneId, isFullscreen, onToggleFullscreen }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [floorPlanOpen, setFloorPlanOpen] = React.useState(false);
  const [hotspotsVisible, setHotspotsVisible] = React.useState(true);
  const [vrEnabled, setVrEnabled] = React.useState(false);
  const [galleryOpen, setGalleryOpen] = React.useState(false);
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);
  const [sceneThumbs, setSceneThumbs] = React.useState<Record<string, string>>({});

  const hasFloorPlan = !!project.floorPlanImage;
  const galleryImages = React.useMemo(
    () => (project.galleryImages ?? []).map((src) => resolveAssetSrc(project, src)).filter(Boolean),
    [project, project.galleryImages],
  );
  const pinnedScenes = React.useMemo(
    () => project.scenes.filter((scene) => !!scene.floorPlan),
    [project.scenes],
  );

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('preview-set-hotspots-visible', { detail: { visible: hotspotsVisible } }));
  }, [hotspotsVisible]);

  React.useEffect(() => {
    const onVrState = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail || {};
      setVrEnabled(!!detail.enabled);
    };
    window.addEventListener('preview-vr-state', onVrState as EventListener);
    return () => {
      window.removeEventListener('preview-vr-state', onVrState as EventListener);
    };
  }, []);

  React.useEffect(() => {
    const onCloseTopOverlay = (event: Event) => {
      if (lightboxIndex !== null) {
        event.preventDefault();
        setLightboxIndex(null);
        return;
      }
      if (galleryOpen) {
        event.preventDefault();
        setGalleryOpen(false);
        return;
      }
      if (floorPlanOpen) {
        event.preventDefault();
        setFloorPlanOpen(false);
        return;
      }
      if (menuOpen) {
        event.preventDefault();
        setMenuOpen(false);
      }
    };
    window.addEventListener('preview-close-top-overlay', onCloseTopOverlay);
    return () => window.removeEventListener('preview-close-top-overlay', onCloseTopOverlay);
  }, [lightboxIndex, galleryOpen, floorPlanOpen, menuOpen]);

  const navigateScene = React.useCallback((sceneId: string) => {
    window.dispatchEvent(new CustomEvent('preview-navigate-scene', { detail: { sceneId } }));
    setMenuOpen(false);
    setFloorPlanOpen(false);
  }, []);

  React.useEffect(() => {
    let alive = true;
    const makeCompressedThumb = async (src: string) => new Promise<string>((resolve) => {
      const img = new Image();
      let settled = false;
      let timeoutId: number | null = null;
      const finish = (value: string) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        img.onload = null;
        img.onerror = null;
        resolve(value);
      };
      img.decoding = 'async';
      img.loading = 'eager';
      img.onload = () => {
        try {
          const side = 128;
          const canvas = document.createElement('canvas');
          canvas.width = side;
          canvas.height = side;
          const ctx = canvas.getContext('2d');
          if (!ctx) { finish(src); return; }
          const sourceSide = Math.min(img.naturalWidth, img.naturalHeight);
          const sx = Math.max(0, Math.floor((img.naturalWidth - sourceSide) / 2));
          const sy = Math.max(0, Math.floor((img.naturalHeight - sourceSide) / 2));
          ctx.drawImage(img, sx, sy, sourceSide, sourceSide, 0, 0, side, side);
          finish(canvas.toDataURL('image/jpeg', 0.42));
        } catch {
          finish(src);
        }
      };
      img.onerror = () => finish(src);
      timeoutId = window.setTimeout(() => finish(src), 8_000);
      img.src = src;
    });

    const buildThumbs = async () => {
      setSceneThumbs({});
      await Promise.all(project.scenes.map(async (scene) => {
        const src = resolveAssetSrc(project, scene.thumbnail || scene.image);
        if (!src) return;
        const compressed = await makeCompressedThumb(src);
        if (!alive) return;
        // Commit independently so one slow or broken remote thumbnail cannot
        // hold back every other scene in the menu.
        setSceneThumbs((current) => ({ ...current, [scene.id]: compressed }));
      }));
    };
    void buildThumbs();
    return () => { alive = false; };
  }, [project]);

  const currentSceneIndex = project.scenes.findIndex((s) => s.id === currentSceneId);

  return (
    <>
      {/* Burger button */}
      <button
        type="button"
        onClick={() => {
          if (!menuOpen) window.dispatchEvent(new Event('preview-dismiss-info-marker'));
          setMenuOpen((prev) => !prev);
        }}
        className="absolute top-6 right-6 z-50 h-11 w-11 rounded-xl border border-white/10 bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70 shadow-lg"
        title={menuOpen ? 'Close menu' : 'Open menu'}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      >
        {menuOpen ? <X className="mx-auto h-5 w-5" /> : <Menu className="mx-auto h-5 w-5" />}
      </button>

      {/* Slide-in menu panel */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
          <div data-preview-overlay className="absolute top-0 right-0 z-50 h-full w-80 bg-black/70 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
              <div className="text-xs font-bold uppercase tracking-widest text-white/50">Menu</div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Controls */}
            <div className="px-4 py-3 border-b border-white/8 flex-shrink-0 space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => { setFloorPlanOpen(true); setMenuOpen(false); }}
                  disabled={!hasFloorPlan}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-xs font-medium text-white hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-35 transition"
                >
                  <MapIcon className="h-3.5 w-3.5 text-white/70" />
                  Floor Plan
                </button>
                <button
                  type="button"
                  onClick={() => { onToggleFullscreen(); setMenuOpen(false); }}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-xs font-medium text-white hover:bg-white/12 transition"
                >
                  {isFullscreen ? <Minimize2 className="h-3.5 w-3.5 text-white/70" /> : <Expand className="h-3.5 w-3.5 text-white/70" />}
                  {isFullscreen ? 'Exit Full' : 'Fullscreen'}
                </button>
              </div>

              <button
                type="button"
                onClick={() => { setGalleryOpen(true); setMenuOpen(false); }}
                disabled={galleryImages.length === 0}
                className="w-full flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-left text-xs font-medium text-white hover:bg-white/12 disabled:opacity-35 disabled:cursor-not-allowed transition"
              >
                <Images className="h-3.5 w-3.5 text-white/70" />
                Gallery
                {galleryImages.length > 0 && (
                  <span className="ml-auto text-[10px] text-white/40 tabular-nums">{galleryImages.length}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setHotspotsVisible((prev) => !prev)}
                className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition ${
                  hotspotsVisible
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/12'
                }`}
              >
                {hotspotsVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {hotspotsVisible ? 'Hotspots On' : 'Hotspots Off'}
              </button>

              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('preview-toggle-vr'))}
                className={`w-full flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition ${
                  vrEnabled
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/12'
                }`}
              >
                <Compass className="h-3.5 w-3.5" />
                {vrEnabled ? 'Exit VR Mode' : 'Enter VR Mode'}
              </button>
            </div>

            {/* Scenes list */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-5 py-3 flex items-center justify-between flex-shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Scenes</span>
                <span className="text-[10px] text-white/30 tabular-nums">{project.scenes.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar-dark px-3 pb-3 space-y-1">
                {project.scenes.map((scene, index) => {
                  const isActive = currentSceneId === scene.id;
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => navigateScene(scene.id)}
                      className={`w-full rounded-xl border px-2.5 py-2 text-left flex items-center gap-3 transition ${
                        isActive
                          ? 'border-primary/50 bg-primary/15'
                          : 'border-white/8 bg-white/4 hover:bg-white/10 hover:border-white/15'
                      }`}
                    >
                      <div className="h-10 w-16 shrink-0 rounded-md overflow-hidden border border-white/10 bg-black/40">
                        {sceneThumbs[scene.id] ? (
                          <img
                            src={sceneThumbs[scene.id]}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="h-full w-full bg-white/8" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold truncate ${isActive ? 'text-primary' : 'text-white/85'}`}>
                          {scene.name}
                        </div>
                        <div className="text-[10px] text-white/35 tabular-nums mt-0.5">Scene {index + 1}</div>
                      </div>
                      {isActive && (
                        <div className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scene navigation arrows */}
            {project.scenes.length > 1 && (
              <div className="px-4 py-3 border-t border-white/8 flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  disabled={currentSceneIndex <= 0}
                  onClick={() => {
                    const prev = project.scenes[currentSceneIndex - 1];
                    if (prev) navigateScene(prev.id);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </button>
                <button
                  type="button"
                  disabled={currentSceneIndex >= project.scenes.length - 1 || currentSceneIndex < 0}
                  onClick={() => {
                    const next = project.scenes[currentSceneIndex + 1];
                    if (next) navigateScene(next.id);
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-white/70 hover:bg-white/12 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Floor Plan overlay */}
      {floorPlanOpen && (
        <div data-preview-overlay className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-sm p-6">
          <div className="mx-auto flex h-full max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/75 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <MapIcon className="h-4 w-4 text-white/60" />
                <span className="text-sm font-semibold tracking-wide">Floor Plan</span>
              </div>
              <button
                type="button"
                onClick={() => setFloorPlanOpen(false)}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label="Close floor plan"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative flex-1 overflow-hidden bg-black/40 p-4 flex items-center justify-center">
              {!project.floorPlanImage ? (
                <div className="flex h-full items-center justify-center text-sm text-white/50">No floor plan uploaded.</div>
              ) : (
                <div className="relative" style={{ display: 'inline-block', maxWidth: '100%', maxHeight: '100%' }}>
                  <img src={resolveAssetSrc(project, project.floorPlanImage)} alt="Floor plan" className="block max-w-full max-h-full rounded-xl border border-white/10" style={{ maxHeight: 'calc(86vh - 7rem)', objectFit: 'contain' }} />
                  {pinnedScenes.map((scene) => (
                    <button
                      key={scene.id}
                      type="button"
                      onClick={() => navigateScene(scene.id)}
                      className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg transition hover:scale-125 ${
                        currentSceneId === scene.id ? 'bg-primary' : 'bg-red-500'
                      }`}
                      style={{ left: `${scene.floorPlan!.x}%`, top: `${scene.floorPlan!.y}%` }}
                      title={scene.name}
                      aria-label={`Go to ${scene.name}`}
                    >
                      {currentSceneId === scene.id && <span className="absolute -inset-1 rounded-full border border-primary animate-ping opacity-60" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Gallery overlay */}
      {galleryOpen && (
        <div data-preview-overlay className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex flex-col">
          {/* Gallery header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <GalleryHorizontal className="h-5 w-5 text-white/60" />
              <span className="text-sm font-semibold text-white tracking-wide">Gallery</span>
              <span className="text-xs text-white/40 tabular-nums">({galleryImages.length} photos)</span>
            </div>
            <button
              type="button"
              onClick={() => setGalleryOpen(false)}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 border border-white/10 transition"
              aria-label="Close gallery"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Gallery grid */}
          <div className="flex-1 overflow-y-auto custom-scrollbar-dark p-6">
            {galleryImages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-white/40">
                <Images className="h-12 w-12" />
                <div className="text-center">
                  <div className="text-sm font-medium">No gallery images</div>
                  <div className="text-xs mt-1">Add images in Project Settings</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {galleryImages.map((src, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    className="group relative aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/40 hover:border-white/30 transition"
                  >
                    <img
                      src={src}
                      alt={`Gallery image ${index + 1}`}
                      className="w-full h-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <ZoomIn className="h-6 w-6 text-white drop-shadow-lg" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && galleryImages.length > 0 && (
        <div data-preview-overlay className="absolute inset-0 z-[70] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
            <span className="text-sm text-white/50 tabular-nums">{lightboxIndex + 1} / {galleryImages.length}</span>
            <button
              type="button"
              onClick={() => setLightboxIndex(null)}
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 border border-white/10 transition"
              aria-label="Close lightbox"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center px-16 py-4 relative min-h-0">
            <img
              src={galleryImages[lightboxIndex]}
              alt={`Gallery image ${lightboxIndex + 1}`}
              className="max-w-full max-h-full object-contain rounded-xl"
            />
            {lightboxIndex > 0 && (
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => (i !== null ? i - 1 : null))}
                className="absolute left-4 h-11 w-11 rounded-xl flex items-center justify-center text-white/70 hover:text-white bg-black/40 hover:bg-black/60 border border-white/10 transition"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {lightboxIndex < galleryImages.length - 1 && (
              <button
                type="button"
                onClick={() => setLightboxIndex((i) => (i !== null ? i + 1 : null))}
                className="absolute right-4 h-11 w-11 rounded-xl flex items-center justify-center text-white/70 hover:text-white bg-black/40 hover:bg-black/60 border border-white/10 transition"
                aria-label="Next image"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default PreviewBurgerMenu;
