import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { Settings, MapPin, Info, Trash2, ExternalLink, X, RotateCcw } from 'lucide-react';
import TargetScenePickerModal from '../modals/TargetScenePickerModal';
import { useUiStore } from '../../store/uiStore';
import { HOTSPOT_ICONS, HotspotIconItem, hotspotHtmlIconGlyph, normalizeHotspotIconId } from '../../lib/hotspotIcons';
import { resolveAssetSrc } from '../../lib/media';

// Text fields buffer keystrokes locally and only commit to the store on blur /
// Enter. Committing on every keystroke pushes one undo entry per character and
// re-runs hotspot-integrity + autosave on each keypress.
function BufferedTextInput({ value, onCommit, ...rest }: { value: string; onCommit: (next: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { commit(); rest.onBlur?.(e); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        rest.onKeyDown?.(e);
      }}
    />
  );
}

function BufferedTextArea({ value, onCommit, ...rest }: { value: string; onCommit: (next: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <textarea
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => { commit(); rest.onBlur?.(e); }}
    />
  );
}

const WallRingHotspotPreview = ({ iconId, color, size = 64, floorCurve: floorCurveProp, borderWidth: borderWidthProp = 5 }: { iconId: string; color: string; size?: number; floorCurve?: number; borderWidth?: number }) => {
  const hex = String(color || '#ffffff').replace(/^#/, '');
  let r = 255, g = 255, b = 255;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  }
  const iconType = normalizeHotspotIconId(iconId);
  const glyph = hotspotHtmlIconGlyph(iconType);
  const isSvgGlyph = String(glyph || '').trim().startsWith('<svg');
  const alpha = (a: number) => `rgba(${r},${g},${b},${a})`;
  const isFloorLike = iconType === 'floor-pulse-ring' || iconType === 'floor-ring' || iconType === 'floor-circle';
  const curveValue = isFloorLike ? (Number.isFinite(floorCurveProp) ? Math.max(68, Number(floorCurveProp)) : 68) : 0;
  const curveRatio = Math.max(0, Math.min(1, curveValue / 100));
  const floorCurveVars = {
    '--pd-hotspot-floor-perspective': `${Math.round(180 + curveRatio * 140)}px`,
    '--pd-hotspot-floor-rotate': `${(curveRatio * 72).toFixed(2)}deg`,
    '--pd-hotspot-floor-scale-x': `${(1 + curveRatio * 0.08).toFixed(3)}`,
    '--pd-hotspot-floor-scale-y': `${(1 - curveRatio * 0.44).toFixed(3)}`,
    '--pd-hotspot-floor-shadow': `${(curveRatio * 0.22).toFixed(3)}`,
  };

  if (iconType === 'pulse-core') {
    return (
      <div
        className="pd-hotspot-core pd-hotspot-core-pulse"
        style={{ width: size, height: size, '--pd-hotspot-pulse-color': alpha(0.96), '--pd-hotspot-pulse-stroke': '2px' } as React.CSSProperties}
      >
        <span className="pd-hotspot-pulse-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '0s' } as React.CSSProperties} />
        <span className="pd-hotspot-pulse-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '0.8s' } as React.CSSProperties} />
        <span className="pd-hotspot-pulse-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '1.6s' } as React.CSSProperties} />
        <span className="pd-hotspot-pulse-center" />
      </div>
    );
  }

  if (iconType === 'vista-pulse') {
    return (
      <div
        className="pd-hotspot-core pd-hotspot-core-vista"
        style={{ width: size, height: size, '--pd-hotspot-vista-color': alpha(0.9), '--pd-hotspot-vista-ring-size': `${Math.round(size * 0.72)}px` } as React.CSSProperties}
      >
        <span className="pd-hotspot-vista-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '0s' } as React.CSSProperties} />
        <span className="pd-hotspot-vista-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '0.8s' } as React.CSSProperties} />
        <span className="pd-hotspot-vista-ring" style={{ '--pd-ring-size': `${Math.round(size * 0.72)}px`, animationDuration: '2.4s', animationDelay: '1.6s' } as React.CSSProperties} />
        <span className="pd-hotspot-vista-center" />
      </div>
    );
  }

  if (iconType === 'floor-pulse-ring' || iconType === 'floor-ring') {
    const ringWidth = Math.round(size * 0.85);
    const ringHeight = Math.max(12, Math.round(ringWidth * 0.345));
    return (
      <div
        className="pd-hotspot-core pd-hotspot-core-floor-pulse pd-hotspot-core-curved"
        style={{
          width: size,
          height: size,
          '--pd-hotspot-floor-ring-width': `${ringWidth}px`,
          '--pd-hotspot-floor-ring-height': `${ringHeight}px`,
          '--pd-hotspot-floor-ring-color': alpha(0.95),
          '--pd-hotspot-floor-ring-glow': alpha(0.7),
          '--pd-hotspot-floor-ring-glow-soft': alpha(0.35),
          '--pd-hotspot-floor-shadow-glow': alpha(0.12),
          '--pd-hotspot-floor-dot-color': alpha(0.95),
          '--pd-hotspot-floor-dot-glow': alpha(0.6),
          '--pd-hotspot-floor-pulse-duration': '2.4s',
          ...floorCurveVars,
        } as React.CSSProperties}
      >
        <span className="pd-hotspot-floor-shadow" />
        <span className="pd-hotspot-floor-ping" style={{ '--pd-ring-size': `${ringWidth}px`, animationDuration: '2.4s', animationDelay: '0s' } as React.CSSProperties} />
        <span className="pd-hotspot-floor-ping" style={{ '--pd-ring-size': `${ringWidth}px`, animationDuration: '2.4s', animationDelay: '0.8s' } as React.CSSProperties} />
        <span className="pd-hotspot-floor-ping" style={{ '--pd-ring-size': `${ringWidth}px`, animationDuration: '2.4s', animationDelay: '1.6s' } as React.CSSProperties} />
        <span className="pd-hotspot-floor-ring" />
        <span className="pd-hotspot-floor-dot" />
      </div>
    );
  }

  if (iconType === 'floor-circle') {
    const ringWidth = Math.round(size * 0.85);
    const ringHeight = Math.max(10, Math.round(ringWidth * 0.31));
    return (
      <div
        className="pd-hotspot-core pd-hotspot-core-floor-circle pd-hotspot-core-curved"
        style={{
          width: size,
          height: size,
          '--pd-hotspot-floor-circle-width': `${ringWidth}px`,
          '--pd-hotspot-floor-circle-height': `${ringHeight}px`,
          '--pd-hotspot-floor-circle-color': alpha(0.95),
          '--pd-hotspot-floor-circle-glow': alpha(0.7),
          '--pd-hotspot-floor-circle-soft': alpha(0.3),
          '--pd-hotspot-floor-circle-core': alpha(0.55),
          '--pd-hotspot-floor-circle-duration': '2.2s',
          ...floorCurveVars,
        } as React.CSSProperties}
      >
        <span className="pd-hotspot-floor-circle-ping" style={{ '--pd-ring-size': `${ringWidth}px`, animationDuration: '2.2s', animationDelay: '0s' } as React.CSSProperties} />
        <span className="pd-hotspot-floor-circle-ping" style={{ '--pd-ring-size': `${ringWidth}px`, animationDuration: '2.2s', animationDelay: '0.75s' } as React.CSSProperties} />
        <span className="pd-hotspot-floor-circle-ring" />
        <span className="pd-hotspot-floor-circle-inner" />
        <span className="pd-hotspot-floor-circle-dot" />
      </div>
    );
  }

  const bw = Math.max(1, Math.min(16, Math.round(Number(borderWidthProp) || 5)));
  const svgStrokeW = (bw * 100 / (size * 0.7)).toFixed(2);
  const svgR = Math.max(0.5, 50 - Number(svgStrokeW) / 2).toFixed(2);
  return (
    <div
      className="pd-whs-wrap"
      style={{ '--pd-whs-r': r, '--pd-whs-g': g, '--pd-whs-b': b, '--pd-whs-size': `${size}px`, '--pd-whs-speed': '2.6s', width: size, height: size } as React.CSSProperties}
    >
      <div className="pd-whs-halo" />
      <svg className="pd-whs-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r={svgR} fill="none" stroke={`rgba(${r},${g},${b},0.92)`} strokeWidth={svgStrokeW} strokeLinecap="round" />
      </svg>
      <div className="pd-whs-ping" />
      <div className="pd-whs-icon">
        {isSvgGlyph ? <span dangerouslySetInnerHTML={{ __html: glyph }} /> : glyph}
      </div>
    </div>
  );
};
const normalizeExternalUrl = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const TAU = Math.PI * 2;
const normalizeYaw = (yaw: number) => ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;

const ResolutionRow = ({ sceneImage, project }: { sceneImage: string; project: any }) => {
  const [label, setLabel] = React.useState('-');
  React.useEffect(() => {
    if (!project || !sceneImage) { setLabel('-'); return; }
    const src = resolveAssetSrc(project, sceneImage);
    if (!src) { setLabel('-'); return; }
    let canceled = false;
    const img = new Image();
    img.onload = () => { if (!canceled) { const w = img.naturalWidth; const h = img.naturalHeight; setLabel(w > 0 && h > 0 ? `${w}×${h}` : '-'); } };
    img.onerror = () => { if (!canceled) setLabel('-'); };
    img.src = src;
    return () => { canceled = true; };
  }, [project, sceneImage]);
  if (label === '-') return null;
  return (
    <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
      <span className="font-bold uppercase tracking-widest">Resolution</span>
      <span className="font-mono">{label}</span>
    </div>
  );
};

const RightPropertiesPanel = () => {
  const { project, currentSceneId, selectedId, updateScene, updateHotspot, updateMarker, updateProject, setSelectedId, setCurrentScene } = useProjectStore();
  const { openConfirm, pushToast } = useUiStore();
  const [scenePickerOpen, setScenePickerOpen] = React.useState(false);
  const [iconPickerOpen, setIconPickerOpen] = React.useState(false);
  const [pendingIcon, setPendingIcon] = React.useState<string | null>(null);
  const [targetViewCapture, setTargetViewCapture] = React.useState<{ sourceSceneId: string; hotspotId: string; targetSceneId: string } | null>(null);
  const scene = project?.scenes.find((s) => s.id === currentSceneId);

  const hotspot = scene?.hotspots.find((h) => h.id === selectedId);
  const marker = scene?.markers.find((m) => m.id === selectedId);
  const markerExternalUrl = React.useMemo(() => normalizeExternalUrl(marker?.link), [marker?.link]);
  const captureHotspot = React.useMemo(() => {
    if (!project || !targetViewCapture) return null;
    const sourceScene = project.scenes.find((s) => s.id === targetViewCapture.sourceSceneId);
    if (!sourceScene) return null;
    return sourceScene.hotspots.find((h) => h.id === targetViewCapture.hotspotId) || null;
  }, [project, targetViewCapture]);
  const requestViewerPosition = React.useCallback((expectedSceneId: string) => new Promise<{ yaw: number; pitch: number } | null>((resolve) => {
    const requestId = `viewer-position-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let done = false;
    const finish = (value: { yaw: number; pitch: number } | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener('viewer-position-response', onResponse as EventListener);
      resolve(value);
    };
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; sceneId?: string | null; position?: { yaw?: number; pitch?: number } | null }>).detail;
      if (!detail || detail.requestId !== requestId) return;
      if (detail.sceneId !== expectedSceneId) {
        finish(null);
        return;
      }
      const yaw = Number(detail.position?.yaw);
      const pitch = Number(detail.position?.pitch);
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
        finish(null);
        return;
      }
      finish({ yaw, pitch });
    };
    const timeoutId = window.setTimeout(() => finish(null), 700);
    window.addEventListener('viewer-position-response', onResponse as EventListener);
    window.dispatchEvent(new CustomEvent('viewer-position-request', { detail: { requestId, expectedSceneId } }));
  }), []);
  const requestViewerObjectDelete = React.useCallback((sceneId: string, objectId: string) => {
    window.dispatchEvent(new CustomEvent('viewer-delete-object-request', {
      detail: { sceneId, objectId, confirmSingle: true },
    }));
  }, []);
  const [activeTab, setActiveTab] = React.useState<'scene' | 'hotspot' | 'marker'>('scene');

  React.useEffect(() => {
    if (!scene) return;

    // Keep Scene tab visible while target-view capture is armed.
    if (targetViewCapture) {
      setActiveTab('scene');
      return;
    }

    // Default behavior: keep hotspot properties open by selecting the first hotspot.
    if (!selectedId && scene.hotspots.length > 0) {
      setSelectedId(scene.hotspots[0].id);
      setActiveTab('hotspot');
      return;
    }

    if (hotspot) setActiveTab('hotspot');
    else if (marker) setActiveTab('marker');
    else if (scene.hotspots.length > 0) setActiveTab('hotspot');
    else setActiveTab('scene');
  }, [scene, selectedId, hotspot?.id, marker?.id, setSelectedId, targetViewCapture]);
  React.useEffect(() => {
    setScenePickerOpen(false);
    setIconPickerOpen(false);
    setPendingIcon(null);
  }, [currentSceneId]);
  const beginTargetViewCapture = React.useCallback((sourceSceneId: string, hotspotId: string, targetSceneId: string) => {
    setTargetViewCapture({ sourceSceneId, hotspotId, targetSceneId });
    setCurrentScene(targetSceneId);
    setActiveTab('scene');
    pushToast('info', 'Rotate the target scene, then click Set Target View.');
  }, [pushToast, setCurrentScene]);
  const finishTargetViewCapture = React.useCallback((capture: NonNullable<typeof targetViewCapture>) => {
    const latest = useProjectStore.getState();
    const sourceScene = latest.project?.scenes.find((item) => item.id === capture.sourceSceneId);
    const sourceHotspot = sourceScene?.hotspots.find((item) => item.id === capture.hotspotId);
    setTargetViewCapture(null);
    if (!sourceScene || !sourceHotspot) return;
    latest.setCurrentScene(sourceScene.id);
    latest.setSelectedId(sourceHotspot.id);
    setActiveTab('hotspot');
  }, []);
  const setCapturedTargetView = React.useCallback(async () => {
    if (!targetViewCapture) {
      pushToast('error', 'Select a hotspot first.');
      return;
    }
    if (currentSceneId !== targetViewCapture.targetSceneId) {
      pushToast('info', 'Open the hotspot target scene before setting target view.');
      return;
    }
    const capture = targetViewCapture;
    const position = await requestViewerPosition(capture.targetSceneId);
    if (!position) {
      pushToast('info', 'Wait for the target panorama to finish loading, then try again.');
      return;
    }
    const latest = useProjectStore.getState();
    const latestSource = latest.project?.scenes.find((item) => item.id === capture.sourceSceneId);
    const latestHotspot = latestSource?.hotspots.find((item) => item.id === capture.hotspotId);
    if (latest.currentSceneId !== capture.targetSceneId || latestHotspot?.targetSceneId !== capture.targetSceneId) {
      pushToast('info', 'The target scene changed before the view could be saved.');
      return;
    }
    latest.updateHotspot(capture.sourceSceneId, capture.hotspotId, {
      targetYaw: position.yaw,
      targetPitch: position.pitch,
      entryYaw: position.yaw,
      entryPitch: position.pitch,
      customTargetView: true,
    });
    finishTargetViewCapture(capture);
    pushToast('success', 'Target view saved for hotspot.');
  }, [currentSceneId, finishTargetViewCapture, pushToast, requestViewerPosition, targetViewCapture]);
  const rotateCaptureTargetYaw = React.useCallback((delta: number) => {
    if (!targetViewCapture || !captureHotspot) {
      pushToast('error', 'No hotspot is armed for target-view capture.');
      return;
    }
    const targetScene = project?.scenes.find((s) => s.id === captureHotspot.targetSceneId);
    const baseYaw = Number.isFinite(Number((captureHotspot as any).targetYaw))
      ? Number((captureHotspot as any).targetYaw)
      : (Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0);
    updateHotspot(targetViewCapture.sourceSceneId, targetViewCapture.hotspotId, {
      targetYaw: normalizeYaw(baseYaw + delta),
      customTargetView: true,
    });
    pushToast('success', 'Target yaw adjusted.');
  }, [captureHotspot, project?.scenes, pushToast, targetViewCapture, updateHotspot]);
  const rotateSelectedHotspotTargetYaw = React.useCallback((delta: number) => {
    if (!hotspot) return;
    const targetScene = project?.scenes.find((s) => s.id === hotspot.targetSceneId);
    const baseYaw = Number.isFinite(Number((hotspot as any).targetYaw))
      ? Number((hotspot as any).targetYaw)
      : (Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0);
    updateHotspot(scene.id, hotspot.id, {
      targetYaw: normalizeYaw(baseYaw + delta),
      customTargetView: true,
    });
    pushToast('success', 'Target yaw adjusted.');
  }, [hotspot, project?.scenes, pushToast, scene?.id, updateHotspot]);
  React.useEffect(() => {
    if (!targetViewCapture) return;
    if (!captureHotspot || captureHotspot.targetSceneId !== targetViewCapture.targetSceneId) {
      setTargetViewCapture(null);
    }
  }, [captureHotspot, targetViewCapture]);

  if (!scene || !project) {
    return (
      <aside className="w-80 bg-white border-l border-slate-200 p-6 flex flex-col items-center justify-center text-center gap-4">
        <div className="p-4 bg-slate-50 rounded-full">
          <Settings className="w-8 h-8 text-slate-300" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800">Properties</h3>
          <p className="text-sm text-slate-500 mt-1">Open a scene to view and edit its properties.</p>
        </div>
        <div className="text-left bg-slate-50 rounded-xl p-4 w-full space-y-2 text-xs text-slate-500">
          <p><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">H</kbd> — add a navigation hotspot</p>
          <p><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">M</kbd> — add an info marker</p>
          <p><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">S</kbd> — select / move objects</p>
          <p><kbd className="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">?</kbd> — keyboard shortcuts</p>
        </div>
      </aside>
    );
  }

  return (
    <>
    <aside className="w-80 bg-white border-l border-slate-200 overflow-y-auto custom-scrollbar shadow-xl z-20">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-bold text-slate-800 flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          Properties
        </h2>
        {selectedId && (
          <button
            onClick={() => requestViewerObjectDelete(scene.id, selectedId)}
            className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete Selected"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="px-5 pt-4">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
          <button type="button" onClick={() => setActiveTab('scene')} className={`text-xs py-2 rounded-lg font-semibold ${activeTab === 'scene' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Scene</button>
          <button type="button" onClick={() => setActiveTab('hotspot')} className={`text-xs py-2 rounded-lg font-semibold ${activeTab === 'hotspot' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Hotspot {scene.hotspots.length}</button>
          <button type="button" onClick={() => setActiveTab('marker')} className={`text-xs py-2 rounded-lg font-semibold ${activeTab === 'marker' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Marker {scene.markers.length}</button>
        </div>
      </div>

      <div className="p-5 space-y-6">
        {activeTab === 'scene' && (
        <section className="transition-all">
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Scene Stats</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white border border-slate-200 px-2 py-2">
                <div className="text-slate-400">Hotspots</div>
                <div className="font-semibold text-slate-800">{scene.hotspots.length}</div>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 px-2 py-2">
                <div className="text-slate-400">Markers</div>
                <div className="font-semibold text-slate-800">{scene.markers.length}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!scene.hotspots.length) {
                    window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'hotspot' } }));
                    return;
                  }
                  setSelectedId(scene.hotspots[0].id);
                  setActiveTab('hotspot');
                }}
                className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
              >
                {scene.hotspots.length ? 'Select Hotspot' : 'Add Hotspot'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!scene.markers.length) {
                    window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'marker' } }));
                    return;
                  }
                  setSelectedId(scene.markers[0].id);
                  setActiveTab('marker');
                }}
                className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
              >
                {scene.markers.length ? 'Select Marker' : 'Add Marker'}
              </button>
            </div>
          </div>
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Default Hotspot Style</div>
            <div className="text-[11px] text-slate-600">
              Fixed lightweight style (no icon or size variants).
            </div>
          </div>
          {targetViewCapture && captureHotspot && (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-2">Target View Capture</div>
              <div className="text-[11px] text-amber-900">
                Hotspot: {captureHotspot.label || 'Untitled hotspot'}
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                Source: {project.scenes.find((s) => s.id === targetViewCapture.sourceSceneId)?.name || 'Unknown'} | Target: {project.scenes.find((s) => s.id === targetViewCapture.targetSceneId)?.name || 'Unknown'}
              </div>
              <div className="text-[11px] text-amber-800 mt-0.5">
                Current target yaw {Number((captureHotspot as any).targetYaw || 0).toFixed(3)} | pitch {Number((captureHotspot as any).targetPitch || 0).toFixed(3)}
              </div>
              <button
                type="button"
                onClick={() => { void setCapturedTargetView(); }}
                className="mt-2 w-full text-[11px] rounded-md border border-amber-300 bg-white px-2 py-1.5 text-amber-800 hover:bg-amber-100"
              >
                Set Target View
              </button>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => rotateCaptureTargetYaw(-Math.PI / 2)}
                  className="text-[11px] rounded-md border border-amber-300 bg-white px-2 py-1.5 text-amber-800 hover:bg-amber-100"
                >
                  90° Left
                </button>
                <button
                  type="button"
                  onClick={() => rotateCaptureTargetYaw(Math.PI / 2)}
                  className="text-[11px] rounded-md border border-amber-300 bg-white px-2 py-1.5 text-amber-800 hover:bg-amber-100"
                >
                  90° Right
                </button>
                <button
                  type="button"
                  onClick={() => rotateCaptureTargetYaw(Math.PI)}
                  className="text-[11px] rounded-md border border-amber-300 bg-white px-2 py-1.5 text-amber-800 hover:bg-amber-100"
                >
                  180°
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (targetViewCapture) finishTargetViewCapture(targetViewCapture);
                }}
                className="mt-2 w-full text-[11px] rounded-md border border-amber-300 bg-white px-2 py-1.5 text-amber-800 hover:bg-amber-100"
              >
                Cancel Capture
              </button>
            </div>
          )}
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Scene Name</label>
            <BufferedTextInput type="text" value={scene.name} onCommit={(v) => updateScene(scene.id, { name: v })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="mt-3">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">View Controls</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('capture-view'))}
                className="flex-1 flex items-center justify-center px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 hover:bg-white hover:border-primary/40 hover:text-primary transition-colors"
                title={`Save current camera angle as scene start (Alt+V)\nSaved: yaw ${(scene.initialYaw || 0).toFixed(2)}, pitch ${(scene.initialPitch || 0).toFixed(2)}`}
              >
                Save View
              </button>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('reset-view'))}
                className="flex-1 flex items-center justify-center px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700 hover:bg-white hover:border-slate-300 transition-colors"
                title="Reset to saved scene view"
              >
                Reset View
              </button>
            </div>
          </div>
          <ResolutionRow sceneImage={scene.image} project={project} />

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Scene Intro Title</label>
              <span className={`text-[10px] tabular-nums ${(scene.introTitle || '').length >= 70 ? 'text-amber-500' : 'text-slate-400'}`}>{(scene.introTitle || '').length}/80</span>
            </div>
            <BufferedTextInput type="text" maxLength={80} value={scene.introTitle || ''} onCommit={(v) => updateScene(scene.id, { introTitle: v })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Scene Intro Description</label>
              <span className={`text-[10px] tabular-nums ${(scene.introDescription || '').length >= 260 ? 'text-amber-500' : 'text-slate-400'}`}>{(scene.introDescription || '').length}/300</span>
            </div>
            <BufferedTextArea rows={3} maxLength={300} value={scene.introDescription || ''} onCommit={(v) => updateScene(scene.id, { introDescription: v })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none" />
          </div>

        </section>
        )}

        {!hotspot && activeTab === 'hotspot' && (
          <section className="pt-6 border-t border-slate-100">
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
              <h4 className="text-sm font-semibold text-slate-700">No hotspot selected</h4>
              <p className="text-xs text-slate-500 mt-1">Switch to `Add Hotspot` tool and click in the viewer, or select an existing hotspot.</p>
              <div className="mt-3 flex gap-2">
                {scene.hotspots.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedId(scene.hotspots[0].id)}
                    className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Select First Hotspot
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'hotspot' } }))}
                    className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Switch To Add Hotspot
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {hotspot && activeTab === 'hotspot' && (
          <section className="pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-red-500"><MapPin className="w-4 h-4" /><h3 className="font-bold text-sm uppercase tracking-widest">Navigation Hotspot</h3></div>
            <div className="space-y-4">
              <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Display Label</label><BufferedTextInput type="text" value={hotspot.label} onCommit={(v) => updateHotspot(scene.id, hotspot.id, { label: v })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Target Scene</label>
                <div className="flex gap-1">
                  <button onClick={() => setScenePickerOpen(true)} className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-left truncate">
                    {project.scenes.find((s) => s.id === hotspot.targetSceneId)?.name || 'Select target scene'}
                  </button>
                  {hotspot.targetSceneId && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetScene = project.scenes.find((s) => s.id === hotspot.targetSceneId);
                        updateHotspot(scene.id, hotspot.id, {
                          targetYaw: Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0,
                          targetPitch: Number.isFinite(Number(targetScene?.initialPitch)) ? Number(targetScene?.initialPitch) : 0,
                          customTargetView: true,
                        });
                      }}
                      title="Reset target view to scene's default orientation"
                      className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50 transition-colors flex-shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {hotspot.targetSceneId && Number.isFinite(Number(hotspot.targetYaw)) && (
                  <div className="mt-1 text-[10px] text-slate-400 font-mono px-0.5">
                    Entry view: yaw {Number(hotspot.targetYaw).toFixed(2)} · pitch {Number(hotspot.targetPitch ?? 0).toFixed(2)}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!hotspot.targetSceneId) return;
                    beginTargetViewCapture(scene.id, hotspot.id, hotspot.targetSceneId);
                    setSelectedId(null);
                  }}
                  disabled={!hotspot.targetSceneId}
                  className="mt-2 text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                >
                  Open Target Scene For Capture
                </button>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Navigation Style</label>
                <select
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  value={String((hotspot as any).navigationMode || 'marzipano')}
                  onChange={(e) => {
                    const value = String(e.target.value || 'marzipano');
                    updateHotspot(scene.id, hotspot.id, {
                      navigationMode: value === 'original' ? 'original' : value === 'pannellum' ? 'pannellum' : 'marzipano',
                    });
                  }}
                >
                  <option value="original">Original (manual target view)</option>
                  <option value="marzipano">Marzipano Style (auto entry)</option>
                  <option value="pannellum">Pannellum Style (carry heading)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Icon</label>
                <button
                  type="button"
                  onClick={() => { setIconPickerOpen(true); setPendingIcon(null); }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {(() => {
                      const selected = HOTSPOT_ICONS.find((item) => item.id === normalizeHotspotIconId(hotspot.icon || project.hotspotStyle.iconType));
                      if (!selected) return null;
                      const IconComp = selected.Component;
                      return (
                        <span className="inline-flex w-7 h-7 rounded-full border border-slate-300 items-center justify-center shrink-0">
                          <IconComp size={15} stroke={1.8} />
                        </span>
                      );
                    })()}
                    <span className="truncate">
                      {HOTSPOT_ICONS.find((item) => item.id === normalizeHotspotIconId(hotspot.icon || project.hotspotStyle.iconType))?.label || 'Choose icon'}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">Change</span>
                </button>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-2">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { hex: '#ffffff', label: 'White' },
                    { hex: '#2dd4bf', label: 'Teal' },
                    { hex: '#fbbf24', label: 'Yellow' },
                    { hex: '#f87171', label: 'Red' },
                    { hex: '#a78bfa', label: 'Purple' },
                    { hex: '#4ade80', label: 'Green' },
                  ].map(({ hex, label }) => {
                    const active = (hotspot.color || project.hotspotStyle?.color || '#ffffff').toLowerCase() === hex;
                    return (
                      <button
                        key={hex}
                        type="button"
                        title={label}
                        aria-label={`Set color: ${label}`}
                        aria-pressed={active}
                        onClick={() => {
                          updateHotspot(scene.id, hotspot.id, { color: hex });
                        }}
                        style={{ background: hex }}
                        className={`w-7 h-7 rounded-full border-2 transition-transform ${active ? 'border-slate-700 scale-110' : 'border-slate-300 hover:scale-105'}`}
                      />
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                  Size — {hotspot.size || project.hotspotStyle?.size || 70}px
                </label>
                <input
                  type="range"
                  min={40}
                  max={160}
                  step={5}
                  value={hotspot.size || project.hotspotStyle?.size || 70}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateHotspot(scene.id, hotspot.id, { size: v });
                  }}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                  Border Width — {Math.max(1, Math.min(16, Math.round(Number((hotspot as any).borderWidth ?? project.hotspotStyle?.borderWidth ?? 5))))}px
                </label>
                <input
                  type="range"
                  min={1}
                  max={16}
                  step={1}
                  value={Math.max(1, Math.min(16, Math.round(Number((hotspot as any).borderWidth ?? project.hotspotStyle?.borderWidth ?? 5))))}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateHotspot(scene.id, hotspot.id, { borderWidth: v });
                  }}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                  Pulse Duration — {(hotspot.pulseSpeed || project.hotspotStyle?.pulseSpeed || 4.0).toFixed(1)}s <span className="normal-case font-normal text-slate-500">(shorter = faster)</span>
                </label>
                <input
                  type="range"
                  min={0.8}
                  max={4}
                  step={0.1}
                  value={hotspot.pulseSpeed || project.hotspotStyle?.pulseSpeed || 4.0}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateHotspot(scene.id, hotspot.id, { pulseSpeed: v });
                  }}
                  className="w-full accent-primary"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                  Rings — {hotspot.ringCount || project.hotspotStyle?.ringCount || 2}
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((n) => {
                    const active = (hotspot.ringCount || project.hotspotStyle?.ringCount || 2) === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => {
                          updateHotspot(scene.id, hotspot.id, { ringCount: n });
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${active ? 'bg-primary text-white border-primary' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  openConfirm({
                    title: 'Apply Style to All Hotspots',
                    message: 'This will copy the icon, color, size, animation, and all style settings of this hotspot to every hotspot in the project. Continue?',
                    confirmLabel: 'Apply to All',
                    cancelLabel: 'Cancel',
                    tone: 'default',
                    onConfirm: () => {
                      const latest = useProjectStore.getState().project;
                      if (!latest) return;
                      const styleFields = {
                        icon: (hotspot as any).icon,
                        color: (hotspot as any).color,
                        size: (hotspot as any).size,
                        animation: (hotspot as any).animation,
                        navigationMode: (hotspot as any).navigationMode || 'marzipano',
                        opacity: (hotspot as any).opacity,
                        borderWidth: (hotspot as any).borderWidth,
                        floorCurve: (hotspot as any).floorCurve,
                        pulseSpeed: (hotspot as any).pulseSpeed,
                        ringCount: (hotspot as any).ringCount,
                        ringWidth: (hotspot as any).ringWidth,
                      };
                      updateProject({
                        scenes: latest.scenes.map((s) => ({
                          ...s,
                          hotspots: s.hotspots.map((h) => ({ ...h, ...styleFields })),
                        })),
                        hotspotStyle: {
                          ...latest.hotspotStyle,
                          iconType: styleFields.icon,
                          color: styleFields.color,
                          size: styleFields.size,
                          animation: styleFields.animation,
                          opacity: styleFields.opacity,
                          borderWidth: styleFields.borderWidth,
                          floorCurve: styleFields.floorCurve,
                          pulseSpeed: styleFields.pulseSpeed,
                          ringCount: styleFields.ringCount,
                          ringWidth: styleFields.ringWidth,
                        },
                      });
                      pushToast('success', 'Style applied to all hotspots.');
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-700 text-xs font-semibold hover:bg-slate-800 transition-colors"
              >
                Apply Style to All Hotspots
              </button>
              <button
                onClick={() => requestViewerObjectDelete(scene.id, hotspot.id)}
                className="w-full px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-100 text-xs font-semibold"
              >
                Delete
              </button>
              <p className="text-[11px] text-slate-500">Drag the hotspot directly in the panorama to reposition it.</p>
            </div>
          </section>
        )}

        {!marker && activeTab === 'marker' && (
          <section className="pt-6 border-t border-slate-100">
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
              <h4 className="text-sm font-semibold text-slate-700">No marker selected</h4>
              <p className="text-xs text-slate-500 mt-1">Switch to `Add Marker` tool and click in the viewer, or select an existing marker.</p>
              <div className="mt-3 flex gap-2">
                {scene.markers.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelectedId(scene.markers[0].id)}
                    className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Select First Marker
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('set-tool', { detail: { tool: 'marker' } }))}
                    className="text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Switch To Add Marker
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {marker && activeTab === 'marker' && (
          <section className="pt-6 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4 text-blue-500"><Info className="w-4 h-4" /><h3 className="font-bold text-sm uppercase tracking-widest">Info Marker</h3></div>
            <div className="space-y-4">
              <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Title</label><input type="text" value={marker.title} onChange={(e) => updateMarker(scene.id, marker.id, { title: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Description</label><textarea rows={4} value={marker.description} onChange={(e) => updateMarker(scene.id, marker.id, { description: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs resize-none" /></div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">External Link</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="https://..."
                    value={marker.link || ''}
                    onChange={(e) => updateMarker(scene.id, marker.id, { link: e.target.value })}
                    className={`w-full bg-slate-50 rounded-lg pl-3 pr-8 py-2 text-xs border ${marker.link && !markerExternalUrl ? 'border-red-400 focus:ring-red-200' : 'border-slate-200'}`}
                  />
                  <ExternalLink className="w-3.5 h-3.5 absolute right-2.5 top-2.5 text-slate-300" />
                </div>
                {marker.link && !markerExternalUrl && (
                  <p className="text-[10px] text-red-500 mt-1">Invalid URL — must start with https:// or http://</p>
                )}
                {markerExternalUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(markerExternalUrl, '_blank', 'noopener,noreferrer')}
                    className="mt-2 text-[11px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-700 hover:bg-slate-100"
                  >
                    Open Link
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
      <div className="sticky bottom-0 h-10 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(255,255,255,0.96) 0%, transparent 100%)' }} />
    </aside>
      {hotspot && (
        <>
          {iconPickerOpen && (() => {
            const activeColor = hotspot.color || project.hotspotStyle?.color || '#ffffff';
            const currentIconId = normalizeHotspotIconId(hotspot.icon || project.hotspotStyle.iconType);
            const selectedIconId = pendingIcon ?? currentIconId;
            const grouped = HOTSPOT_ICONS.reduce((acc, item) => {
              if (!acc[item.category]) acc[item.category] = [];
              acc[item.category].push(item);
              return acc;
            }, {} as Record<string, HotspotIconItem[]>);
            const closeAndReset = () => { setIconPickerOpen(false); setPendingIcon(null); };
            return (
              <div
                className="fixed inset-0 z-[160] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
                onMouseDown={closeAndReset}
              >
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl flex flex-col"
                  style={{ background: 'linear-gradient(160deg,#0f172a 0%,#1e293b 100%)', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '85vh' }}
                >
                  <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div>
                      <h3 className="font-bold text-white text-base leading-tight">Choose Icon</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">Select an icon, then choose who to apply it to</p>
                    </div>
                    <button
                      onClick={closeAndReset}
                      className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-white transition-colors"
                      style={{ background: 'rgba(255,255,255,0.07)' }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="p-5 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-0">
                    {Object.entries(grouped).map(([category, items]) => (
                      <div key={category}>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{category}</div>
                        <div className="grid grid-cols-4 gap-2">
                          {items.map((item) => {
                            const isActive = selectedIconId === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setPendingIcon(item.id)}
                                className="flex flex-col items-center gap-2 py-3 px-1 rounded-xl transition-all"
                                style={{
                                  background: isActive ? 'rgba(200,169,106,0.18)' : 'rgba(255,255,255,0.03)',
                                  outline: isActive ? '2px solid rgba(200,169,106,0.8)' : '2px solid transparent',
                                }}
                                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'; }}
                                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                              >
                                <WallRingHotspotPreview iconId={item.id} color={activeColor} size={62} />
                                <span
                                  className="text-[10px] text-center leading-tight line-clamp-2"
                                  style={{ color: isActive ? '#C8A96A' : '#94a3b8' }}
                                >
                                  {item.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="px-5 py-4 shrink-0 flex items-center justify-between gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <button
                      onClick={closeAndReset}
                      className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      Cancel
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const icon = pendingIcon ?? currentIconId;
                          updateHotspot(scene.id, hotspot.id, { icon });
                          closeAndReset();
                        }}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                        style={{ background: 'rgba(255,255,255,0.1)', color: '#e2e8f0' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.18)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; }}
                      >
                        Change This One
                      </button>
                      <button
                        onClick={() => {
                          const icon = pendingIcon ?? currentIconId;
                          const latest = useProjectStore.getState().project;
                          if (!latest) { closeAndReset(); return; }
                          updateProject({
                            scenes: latest.scenes.map((s) => ({
                              ...s,
                              hotspots: s.hotspots.map((h) => ({ ...h, icon })),
                            })),
                            hotspotStyle: { ...latest.hotspotStyle, iconType: icon },
                          });
                          closeAndReset();
                        }}
                        className="px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                        style={{ background: 'rgba(200,169,106,0.85)', color: '#0f172a' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(200,169,106,1)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(200,169,106,0.85)'; }}
                      >
                        Change All Hotspots
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
          <TargetScenePickerModal
            open={scenePickerOpen}
            project={project}
            currentSceneId={scene.id}
            selectedTargetId={hotspot.targetSceneId}
            onClose={() => setScenePickerOpen(false)}
            onPick={(sceneId) => {
              updateHotspot(scene.id, hotspot.id, { targetSceneId: sceneId });
              setScenePickerOpen(false);
            }}
          />
        </>
      )}
    </>
  );
};

export default RightPropertiesPanel;
