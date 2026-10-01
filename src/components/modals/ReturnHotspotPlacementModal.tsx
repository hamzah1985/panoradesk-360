import React from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { X } from 'lucide-react';
import { Project } from '../../types';
import { resolveAssetSrc } from '../../lib/media';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const PLACEMENT_PANORAMA_TIMEOUT_MS = 20_000;

type Props = {
  open: boolean;
  project: Project;
  sourceSceneId: string;
  targetSceneId: string;
  placementMode?: 'entry-view' | 'hotspot-position';
  title?: string;
  subtitle?: string;
  instruction?: string;
  helperText?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (coords: { yaw: number; pitch: number }) => void;
};

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, value));
}

function normalizeYaw(value: number) {
  let yaw = value;
  while (yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw < -Math.PI) yaw += Math.PI * 2;
  return yaw;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function imageCoordsToYawPitch(xPct: number, yPct: number) {
  const x = clamp01(xPct);
  const y = clamp01(yPct);
  const yaw = normalizeYaw((x - 0.5) * Math.PI * 2);
  const pitch = clampPitch((0.5 - y) * Math.PI);
  return { yaw, pitch };
}

function yawPitchToImageCoords(yaw: number, pitch: number) {
  const wrappedYaw = normalizeYaw(yaw);
  let x = (wrappedYaw / (Math.PI * 2)) + 0.5;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  const y = 0.5 - (clampPitch(pitch) / Math.PI);
  return { xPct: clamp01(x), yPct: clamp01(y) };
}

function normalizeViewerPosition(raw: any): { yaw: number; pitch: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const yaw = Number(raw?.yaw);
  const pitch = Number(raw?.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return { yaw, pitch };
}

const ReturnHotspotPlacementModal: React.FC<Props> = ({
  open,
  project,
  sourceSceneId,
  targetSceneId,
  placementMode = 'entry-view',
  title = 'Set Target Entry View',
  subtitle,
  instruction = 'Drag to aim the center crosshair where the visitor should face',
  helperText = 'Press Enter to save this entry view.',
  confirmLabel = 'Save Entry View',
  onCancel,
  onConfirm,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const imageRef = React.useRef<HTMLImageElement>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const [placement, setPlacement] = React.useState<{ yaw: number; pitch: number } | null>(null);
  const placementRef = React.useRef<{ yaw: number; pitch: number } | null>(null);
  const [viewerLoadState, setViewerLoadState] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [viewerRetryKey, setViewerRetryKey] = React.useState(0);
  useEscapeClose(open, onCancel);

  const sourceScene = React.useMemo(() => project.scenes.find((s) => s.id === sourceSceneId) || null, [project.scenes, sourceSceneId]);
  const targetScene = React.useMemo(() => project.scenes.find((s) => s.id === targetSceneId) || null, [project.scenes, targetSceneId]);
  const panoramaSrc = React.useMemo(() => (
    targetScene ? resolveAssetSrc(project, targetScene.image) : ''
  ), [project, targetScene]);

  React.useEffect(() => {
    if (!open) {
      setPlacement(null);
      setViewerLoadState('idle');
    }
  }, [open]);
  React.useEffect(() => {
    placementRef.current = placement;
  }, [placement]);
  const resolveConfirmPlacement = React.useCallback((): { yaw: number; pitch: number } | null => {
    if (placementMode === 'entry-view') {
      if (viewerLoadState !== 'ready') return null;
      const live = normalizeViewerPosition((viewerRef.current as any)?.getPosition?.());
      if (live) return live;
    }
    return placementRef.current;
  }, [placementMode, viewerLoadState]);
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('button, a[href], [role="button"]')) return;
      const next = resolveConfirmPlacement();
      if (!next) return;
      e.preventDefault();
      onConfirm(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onConfirm, resolveConfirmPlacement]);

  React.useEffect(() => {
    if (placementMode !== 'entry-view') return;
    if (!open || !containerRef.current || !targetScene) return;
    setPlacement(null);
    setViewerLoadState('loading');
    let viewer: Viewer;
    try {
      viewer = new Viewer({
        container: containerRef.current,
        panorama: panoramaSrc,
        defaultYaw: targetScene.initialYaw || 0,
        defaultPitch: targetScene.initialPitch || 0,
        defaultZoomLvl: targetScene.initialZoom ?? 20,
        mousewheel: true,
        loadingTxt: '',
        navbar: false,
        plugins: [[MarkersPlugin, { markers: [] }]],
      });
    } catch {
      setViewerLoadState('error');
      return;
    }
    viewerRef.current = viewer;
    const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
    markersPlugin.setMarkers([]);

    let alive = true;
    let ready = false;
    const updatePlacementFromViewer = () => {
      if (!alive || !ready) return;
      const pos = normalizeViewerPosition((viewer as any)?.getPosition?.());
      if (!pos) return;
      setPlacement(pos);
    };
    const onViewerRender = () => updatePlacementFromViewer();
    const onPanoramaLoaded = () => {
      if (!alive) return;
      ready = true;
      window.clearTimeout(loadTimeout);
      setViewerLoadState('ready');
      updatePlacementFromViewer();
    };
    const onPanoramaError = () => {
      if (!alive || ready) return;
      window.clearTimeout(loadTimeout);
      setPlacement(null);
      setViewerLoadState('error');
      try { (viewer as any)?.loader?.hide?.(); } catch {}
      try { (viewer as any)?.hideError?.(); } catch {}
    };

    const loadTimeout = window.setTimeout(() => {
      if (!alive || ready) return;
      try { (viewer as any)?.textureLoader?.abortLoading?.(); } catch {}
      onPanoramaError();
    }, PLACEMENT_PANORAMA_TIMEOUT_MS);
    viewer.addEventListener('panorama-loaded', onPanoramaLoaded as any);
    viewer.addEventListener('panorama-error', onPanoramaError as any);
    viewer.addEventListener('position-updated', onViewerRender as any);
    viewer.addEventListener('zoom-updated', onViewerRender as any);
    viewer.addEventListener('size-updated', onViewerRender as any);
    return () => {
      alive = false;
      window.clearTimeout(loadTimeout);
      viewer.removeEventListener('panorama-loaded', onPanoramaLoaded as any);
      viewer.removeEventListener('panorama-error', onPanoramaError as any);
      viewer.removeEventListener('position-updated', onViewerRender as any);
      viewer.removeEventListener('zoom-updated', onViewerRender as any);
      viewer.removeEventListener('size-updated', onViewerRender as any);
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [open, placementMode, panoramaSrc, targetScene?.id, targetScene?.image, targetScene?.initialPitch, targetScene?.initialYaw, targetScene?.initialZoom, viewerRetryKey]);

  const handleFlatImageClick = React.useCallback((event: React.MouseEvent<HTMLImageElement>) => {
    const img = imageRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const xPct = clamp01((event.clientX - rect.left) / rect.width);
    const yPct = clamp01((event.clientY - rect.top) / rect.height);
    setPlacement(imageCoordsToYawPitch(xPct, yPct));
  }, []);

  const crosshair = React.useMemo(() => {
    if (placementMode === 'entry-view') return { xPct: 0.5, yPct: 0.5 };
    if (!placement) return null;
    return yawPitchToImageCoords(placement.yaw, placement.pitch);
  }, [placementMode, placement]);

  if (!open || !targetScene || !sourceScene) return null;

  return (
    <div onMouseDown={onCancel} className="fixed inset-0 z-[230] bg-black/80 backdrop-blur-sm p-4">
      <div onMouseDown={(e) => e.stopPropagation()} className="pd-return-modal h-full w-full rounded-lg overflow-hidden border border-slate-700/70 bg-[#1f2330] shadow-2xl flex flex-col">
        <div className="h-14 px-4 border-b border-slate-700/80 flex items-center justify-between text-slate-100">
          <div>
            <div className="text-3xl leading-none font-semibold text-slate-100/95">{title}</div>
            <div className="text-[11px] text-slate-300 mt-0.5">
              {subtitle || (
                <>
                  Hotspot from <span className="font-semibold">{sourceScene.name}</span> to <span className="font-semibold">{targetScene.name}</span>
                </>
              )}
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-white/10 text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative flex-1 min-h-0 bg-black border-y-2 border-cyan-400/70">
          {placementMode === 'entry-view' && (
            <>
              <div ref={containerRef} className="absolute inset-0" />
              {!!crosshair && (
                <>
                  <div className="pd-return-crosshair pd-return-crosshair-h" style={{ top: `${(crosshair.yPct * 100).toFixed(3)}%` }} />
                  <div className="pd-return-crosshair pd-return-crosshair-v" style={{ left: `${(crosshair.xPct * 100).toFixed(3)}%` }} />
                </>
              )}
              {viewerLoadState !== 'ready' && (
                <div className="absolute inset-0 z-[8] flex items-center justify-center bg-black/55">
                  {viewerLoadState === 'error' ? (
                    <div className="rounded-xl border border-red-400/30 bg-slate-900/90 px-5 py-4 text-center text-slate-100">
                      <div className="text-sm font-semibold">Target panorama could not be loaded</div>
                      <button
                        type="button"
                        onClick={() => setViewerRetryKey((value) => value + 1)}
                        className="mt-3 rounded-lg bg-[#0b86d9] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-full border border-white/20 bg-slate-900/80 px-3 py-1.5 text-xs text-white">Loading target panorama…</div>
                  )}
                </div>
              )}
            </>
          )}
          {placementMode === 'hotspot-position' && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/90">
              <div className="relative max-w-full max-h-full">
                <img
                  ref={imageRef}
                  src={panoramaSrc}
                  alt={targetScene.name}
                  className="block max-w-full max-h-full object-contain cursor-crosshair select-none"
                  draggable={false}
                  onClick={handleFlatImageClick}
                />
                {!!crosshair && (
                  <>
                    <div className="pd-return-crosshair pd-return-crosshair-h" style={{ top: `${(crosshair.yPct * 100).toFixed(3)}%`, left: 0, right: 0 }} />
                    <div className="pd-return-crosshair pd-return-crosshair-v" style={{ left: `${(crosshair.xPct * 100).toFixed(3)}%`, top: 0, bottom: 0 }} />
                    <div
                      className="pd-return-placement-marker absolute z-[6] pointer-events-none"
                      style={{
                        left: `${(crosshair.xPct * 100).toFixed(3)}%`,
                        top: `${(crosshair.yPct * 100).toFixed(3)}%`,
                        transform: 'translate(-50%, -50%)',
                      }}
                    />
                  </>
                )}
              </div>
            </div>
          )}
          <div className="pd-return-scene-name">{targetScene.name}</div>
        </div>

        <div className="h-20 px-4 border-t border-slate-700/80 flex items-center justify-between bg-[#2a2d37]">
          <div className="text-2xl text-white/80">
            {instruction}
            <div className="text-xs text-slate-300 mt-1">{helperText}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="px-4 py-2 rounded-md border border-slate-500 text-slate-100 hover:bg-slate-700">Skip</button>
            <button
              disabled={!placement || (placementMode === 'entry-view' && viewerLoadState !== 'ready')}
              onClick={() => {
                const next = resolveConfirmPlacement();
                if (!next) return;
                onConfirm(next);
              }}
              className="px-5 py-2 rounded-md bg-[#0b86d9] text-white font-semibold disabled:opacity-50 hover:brightness-110"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReturnHotspotPlacementModal;
