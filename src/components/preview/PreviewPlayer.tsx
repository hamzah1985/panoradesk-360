import React from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin';
import { StereoPlugin } from '@photo-sphere-viewer/stereo-plugin';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { Project, Scene } from '../../types';
import { resolveAssetSrc } from '../../lib/media';
import { SHARED_VIEWER_INERTIA, SHARED_VIEWER_MOTION, SHARED_VIEWER_TRANSITION } from '../../lib/viewerMotion';
import { attachViewerInertia } from '../../lib/viewerInertia';
import { hotspotHtmlIconGlyph, normalizeHotspotIconId } from '../../lib/hotspotIcons';
import { ExternalLink, Info, RotateCcw, X } from 'lucide-react';
import type { Marker } from '../../types';
import { createPanoramaPreloader, setPanoramaBounded } from '../../lib/panoramaLoad';

type Props = {
  project: Project;
  initialSceneId?: string;
  onSceneChange?: (sceneId: string) => void;
  showLabels?: boolean;
};

type PreviewNavDetail = {
  type?: 'prev' | 'next' | 'home' | 'end';
  sceneId?: string;
};
type PreviewHotspotsDetail = { visible?: boolean };
type SceneEntryHint = { fromSceneId?: string; fromHotspotId?: string; fromYaw?: number; fromPitch?: number; entryYaw?: number; entryPitch?: number; customTargetView?: boolean; transitionDuration?: number; navigationMode?: 'original' | 'marzipano' | 'pannellum' };
type PendingNavigation = { sceneId: string; hint?: SceneEntryHint };
type NavigationLoadError = { sceneId: string; sceneName: string; hint?: SceneEntryHint };

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, value));
}

function sceneEntry(scene?: Scene | null) {
  return {
    yaw: Number.isFinite(Number(scene?.initialYaw)) ? Number(scene?.initialYaw) : 0,
    pitch: clampPitch(Number.isFinite(Number(scene?.initialPitch)) ? Number(scene?.initialPitch) : 0),
  };
}

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function previewMarkerHtml(scene: Scene, _targetThumb: string, targetSceneId: string, hotspotLabel?: string) {
  const label = escapeHtml(String(hotspotLabel || '').trim() || scene.name);
  return `
    <div data-preview-target-scene-id="${escapeHtml(targetSceneId)}" class="pd-hotspot-mini-label-wrap">
      <div class="pd-hotspot-mini-label">${label}</div>
    </div>
  `;
}

function normalizeExternalUrl(value?: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeAnimation(value?: string) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'static') return 'ping';
  return raw;
}

function alphaColor(input: string | undefined, alpha: number) {
  const raw = String(input || '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(255,255,255,${alpha})`;
}

function normalizeHotspotFloorCurve(value: any, fallback = 0) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0, Math.min(100, Math.round(safeFallback)));
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeHotspotPulseSpeed(value: any, fallback = 2.4) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 2.4;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0.8, Math.min(4, Number(safeFallback.toFixed(2))));
  return Math.max(0.8, Math.min(4, Number(num.toFixed(2))));
}

function normalizeHotspotRingCount(value: any, fallback = 3) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 3;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(1, Math.min(5, Math.round(safeFallback)));
  return Math.max(1, Math.min(5, Math.round(num)));
}

function normalizeHotspotRingWidth(value: any, fallback = 60) {
  const fallbackNum = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNum) ? fallbackNum : 60;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(30, Math.min(160, Math.round(safeFallback)));
  return Math.max(30, Math.min(160, Math.round(num)));
}

function isProjectedFloorHotspotIcon(icon?: string) {
  const normalized = normalizeHotspotIconId(icon);
  return normalized === 'floor-pulse-ring' || normalized === 'floor-circle' || normalized === 'floor-ring';
}

function normalizeYawRadians(yaw: number) {
  let next = yaw;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function projectedFloorRingPoints(yaw: number, pitch: number, yawRadius: number, pitchRadius: number, segments = 72) {
  const points: Array<[number, number]> = [];
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const safePitch = clampPitch(Number.isFinite(pitch) ? pitch : -0.45);
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    points.push([
      normalizeYawRadians(safeYaw + Math.cos(theta) * yawRadius),
      clampPitch(safePitch + Math.sin(theta) * pitchRadius),
    ]);
  }
  return points;
}

function projectedFloorHotspotMarkers(
  raw: any,
  project: Project,
  parsed: ReturnType<typeof extractHotspotData>,
  tooltip: any,
  alwaysLabel = '',
) {
  if (!parsed) return [];
  const icon = normalizeHotspotIconId(raw?.icon || project.hotspotStyle?.iconType || 'nav-default');
  const color = raw?.color || project.hotspotStyle?.color || '#ffffff';
  const size = Math.max(32, Math.round(Number(raw?.size || project.hotspotStyle?.size || 70)));
  const ringCount = normalizeHotspotRingCount(raw?.ringCount ?? (project.hotspotStyle as any)?.ringCount, 2);
  const pulseSpeed = normalizeHotspotPulseSpeed(raw?.pulseSpeed ?? (project.hotspotStyle as any)?.pulseSpeed, 4.0);
  const visualScale = Math.max(0.65, Math.min(2.6, size / 70));
  const baseYawRadius = 0.078 * visualScale;
  const basePitchRadius = baseYawRadius * (icon === 'floor-circle' ? 0.31 : 0.345);
  const ringDelayStep = pulseSpeed / Math.max(1, ringCount);
  const markerData = {
    targetSceneId: parsed.targetSceneId,
    entryYaw: parsed.entryYaw,
    entryPitch: parsed.entryPitch,
    sourceHotspotId: parsed.sourceHotspotId,
    linkedHotspotId: parsed.linkedHotspotId,
    navigationMode: parsed.navigationMode,
  };

  const markerId = String(raw?.id ?? `${parsed.targetSceneId}-${parsed.yaw}-${parsed.pitch}`);
  const coreMarker = {
    id: `${markerId}-floor-core`,
    polyline: projectedFloorRingPoints(parsed.yaw, parsed.pitch, baseYawRadius, basePitchRadius, 120),
    svgStyle: {
      stroke: alphaColor(color, 0.98),
      strokeWidth: String(Math.max(2.4, Math.min(5.5, size / 24))),
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    },
    className: 'pd-floor-projected-ring pd-floor-projected-ring-core',
    style: {
      cursor: 'pointer',
      animationDuration: `${pulseSpeed.toFixed(2)}s`,
      filter: `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.12))}px ${alphaColor(color, 0.7)})`,
    },
    tooltip,
    data: markerData,
    zIndex: 12,
  };
  const pingMarkers = Array.from({ length: Math.max(1, ringCount) }, (_, index) => {
    const scale = 1.28 + index * 0.46;
    const alpha = Math.max(0.26, 0.68 - index * 0.12);
    return {
      id: `${markerId}-floor-ping-${index}`,
      polyline: projectedFloorRingPoints(
        parsed.yaw,
        parsed.pitch,
        baseYawRadius * scale,
        basePitchRadius * scale,
        120,
      ),
      svgStyle: {
        stroke: alphaColor(color, alpha),
        strokeWidth: String(Math.max(1.4, Math.min(3.2, size / 42))),
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fill: 'none',
      },
      className: 'pd-floor-projected-ring pd-floor-projected-ring-ping',
      style: {
        cursor: 'pointer',
        animationDuration: `${pulseSpeed.toFixed(2)}s`,
        animationDelay: `${(index * ringDelayStep).toFixed(2)}s`,
        filter: `drop-shadow(0 0 ${Math.max(3, Math.round(size * 0.1))}px ${alphaColor(color, 0.55)})`,
      },
      tooltip,
      data: markerData,
      zIndex: 8 + index,
    };
  });

  return [
    coreMarker,
    ...pingMarkers,
    {
      id: markerId,
      type: 'html',
      html: `<div style="display:flex;flex-direction:column;align-items:center;"><div class="pd-hotspot-wrap"><div class="pd-floor-hotspot-hit" style="--pd-floor-hit-color:${alphaColor(color, 0.96)};--pd-floor-hit-glow:${alphaColor(color, 0.7)};--pd-floor-hit-speed:${pulseSpeed.toFixed(2)}s;--pd-floor-hit-size:${Math.max(42, Math.round(size * 0.72))}px;"></div></div>${alwaysLabel}</div>`,
      position: { yaw: parsed.yaw, pitch: parsed.pitch },
      anchor: 'center center',
      tooltip,
      data: markerData,
      zIndex: 20,
    },
  ];
}

function previewHotspotMarkerHtml(
  iconRaw: string | undefined,
  colorRaw: string | undefined,
  sizeRaw: number | undefined,
  opacityRaw?: number,
  animationRaw?: string,
  borderWidthRaw?: number,
  floorCurveRaw?: number,
  pulseSpeedRaw?: number,
  ringCountRaw?: number,
  ringWidthRaw?: number,
) {
  const size = Math.max(32, Math.round(Number(sizeRaw) || 70));
  const iconType = normalizeHotspotIconId(iconRaw);
  const isFloorRing = iconType === 'floor-ring';
  const isPulseCore = iconType === 'pulse-core';
  const isVistaPulse = iconType === 'vista-pulse';
  const isFloorPulseRing = iconType === 'floor-pulse-ring';
  const isFloorCircle = iconType === 'floor-circle';
  const floorLike = isFloorRing || isFloorPulseRing || isFloorCircle;
  const floorCurveBase = normalizeHotspotFloorCurve(floorCurveRaw, 0);
  const floorCurve = floorLike ? Math.max(68, floorCurveBase) : floorCurveBase;
  const curveAmount = floorCurve;
  const curveRatio = Math.max(0, Math.min(1, curveAmount / 100));
  const curveClass = (floorLike || curveRatio > 0) ? ' pd-hotspot-core-curved' : '';
  const glyph = hotspotHtmlIconGlyph(iconType);
  const pulseSpeed = normalizeHotspotPulseSpeed(pulseSpeedRaw, 4.0);
  const ringCount = normalizeHotspotRingCount(ringCountRaw, 2);
  const ringWidth = normalizeHotspotRingWidth(ringWidthRaw, Math.round(size * 0.95));
  const borderWidth = Math.max(1, Math.min(16, Math.round(Number(borderWidthRaw) || 5)));
  const opacity = Number.isFinite(Number(opacityRaw)) ? Math.max(0, Math.min(1, Number(opacityRaw))) : 0.1;
  const ringDelayStep = pulseSpeed / Math.max(1, ringCount);
  const anim = normalizeAnimation(animationRaw);
  const makeRings = (className: string) => Array.from({ length: ringCount }, (_, index) => (
    `<span class="${className}" style="animation-duration:${pulseSpeed.toFixed(2)}s;animation-delay:${(index * ringDelayStep).toFixed(2)}s;--pd-ring-size:${ringWidth}px;"></span>`
  )).join('');
  const raw = String(colorRaw || '#ffffff').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  let r = 255, g = 255, b = 255;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  }

  const alpha = (a: number) => `rgba(${r},${g},${b},${a})`;
  const commonCurveVars = `--pd-hotspot-floor-perspective:${Math.round(180 + curveRatio * 140)}px;--pd-hotspot-floor-rotate:${(curveRatio * 72).toFixed(2)}deg;--pd-hotspot-floor-scale-x:${(1 + curveRatio * 0.08).toFixed(3)};--pd-hotspot-floor-scale-y:${(1 - curveRatio * 0.44).toFixed(3)};--pd-hotspot-floor-shadow:${(curveRatio * 0.22).toFixed(3)}`;
  const fill = isFloorRing ? 'rgba(255,255,255,0)' : alpha(opacity);

  if (isPulseCore) {
    const pulseStroke = Math.max(1, Math.min(5, Math.round(borderWidth * 0.45)));
    const core = `<div class="pd-hotspot-core pd-hotspot-core-pulse${curveClass}" style="width:${size}px;height:${size}px;--pd-hotspot-size:${size}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-pulse-color:${alpha(0.96)};--pd-hotspot-pulse-stroke:${pulseStroke}px;${commonCurveVars}">${makeRings('pd-hotspot-pulse-ring')}<span class="pd-hotspot-pulse-center"></span></div>`;
    return `<div class="pd-hotspot-wrap pd-anim-${anim}" style="cursor:pointer;">${core}</div>`;
  }

  if (isVistaPulse) {
    const core = `<div class="pd-hotspot-core pd-hotspot-core-vista${curveClass}" style="width:${size}px;height:${size}px;--pd-hotspot-size:${size}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-vista-color:${alpha(0.9)};--pd-hotspot-vista-ring-size:${ringWidth}px;${commonCurveVars}">${makeRings('pd-hotspot-vista-ring')}<span class="pd-hotspot-vista-center"></span></div>`;
    return `<div class="pd-hotspot-wrap pd-anim-${anim}" style="cursor:pointer;">${core}</div>`;
  }

  if (isFloorPulseRing) {
    const floorRingHeight = Math.max(12, Math.round(ringWidth * 0.345));
    const core = `<div class="pd-hotspot-core pd-hotspot-core-floor-pulse${curveClass}" style="width:${size}px;height:${size}px;--pd-hotspot-size:${size}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-floor-pulse-duration:${pulseSpeed.toFixed(2)}s;--pd-hotspot-floor-ring-width:${ringWidth}px;--pd-hotspot-floor-ring-height:${floorRingHeight}px;--pd-hotspot-floor-ring-color:${alpha(0.95)};--pd-hotspot-floor-ring-glow:${alpha(0.7)};--pd-hotspot-floor-ring-glow-soft:${alpha(0.35)};--pd-hotspot-floor-shadow-glow:${alpha(0.12)};--pd-hotspot-floor-dot-color:${alpha(0.95)};--pd-hotspot-floor-dot-glow:${alpha(0.6)};${commonCurveVars}"><span class="pd-hotspot-floor-shadow"></span>${makeRings('pd-hotspot-floor-ping')}<span class="pd-hotspot-floor-ring"></span><span class="pd-hotspot-floor-dot"></span></div>`;
    return `<div class="pd-hotspot-wrap pd-anim-${anim}" style="cursor:pointer;">${core}</div>`;
  }

  if (isFloorCircle) {
    const floorCircleHeight = Math.max(10, Math.round(ringWidth * 0.31));
    const core = `<div class="pd-hotspot-core pd-hotspot-core-floor-circle${curveClass}" style="width:${size}px;height:${size}px;--pd-hotspot-size:${size}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-floor-circle-duration:${pulseSpeed.toFixed(2)}s;--pd-hotspot-floor-circle-width:${ringWidth}px;--pd-hotspot-floor-circle-height:${floorCircleHeight}px;--pd-hotspot-floor-circle-color:${alpha(0.95)};--pd-hotspot-floor-circle-glow:${alpha(0.7)};--pd-hotspot-floor-circle-soft:${alpha(0.3)};--pd-hotspot-floor-circle-core:${alpha(0.55)};${commonCurveVars}">${makeRings('pd-hotspot-floor-circle-ping')}<span class="pd-hotspot-floor-circle-ring"></span><span class="pd-hotspot-floor-circle-inner"></span><span class="pd-hotspot-floor-circle-dot"></span></div>`;
    return `<div class="pd-hotspot-wrap pd-anim-${anim}" style="cursor:pointer;">${core}</div>`;
  }

  const pingDivs = Array.from({ length: ringCount }, (_, i) => {
    const delay = i === 0 ? '' : ` style="animation-delay:${(-(pulseSpeed * i / ringCount)).toFixed(2)}s"`;
    return `<div class="pd-whs-ping"${delay}></div>`;
  }).join('');
  const svgStrokeW = (borderWidth * 100 / (size * 0.7)).toFixed(2);
  const svgR = Math.max(0.5, 50 - Number(svgStrokeW) / 2).toFixed(2);
  const ringSvg = `<svg class="pd-whs-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="${svgR}" fill="none" stroke="rgba(${r},${g},${b},0.92)" stroke-width="${svgStrokeW}" stroke-linecap="round"/></svg>`;
  const core = `<div class="pd-whs-wrap" style="width:${size}px;height:${size}px;--pd-whs-r:${r};--pd-whs-g:${g};--pd-whs-b:${b};--pd-whs-size:${size}px;--pd-whs-speed:${pulseSpeed}s;--pd-whs-border:${borderWidth}px"><div class="pd-whs-halo"></div>${ringSvg}${pingDivs}<div class="pd-whs-icon">${glyph}</div></div>`;
  return `<div class="pd-hotspot-wrap pd-anim-${anim}" style="cursor:pointer;">${core}</div>`;
}

function extractHotspotData(raw: any) {
  const yaw = Number(raw?.yaw ?? raw?.position?.yaw ?? raw?.longitude);
  const pitch = Number(raw?.pitch ?? raw?.position?.pitch ?? raw?.latitude);
  const targetCandidates = [
    raw?.targetSceneId,
    raw?.targetScene?.id,
    raw?.target?.sceneId,
    raw?.data?.targetSceneId,
    typeof raw?.target === 'string' ? raw.target : '',
  ];
  const targetSceneId = targetCandidates
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .find((value) => value.length > 0) || '';
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || !targetSceneId) return null;
  const entryYaw = Number.isFinite(Number(raw?.targetYaw))
    ? Number(raw.targetYaw)
    : undefined;
  const entryPitch = Number.isFinite(Number(raw?.targetPitch))
    ? Number(raw.targetPitch)
    : undefined;
  const customTargetView = raw?.customTargetView === true;
  const transitionDuration = Number.isFinite(Number(raw?.transitionDuration)) ? Number(raw.transitionDuration) : undefined;
  const sourceHotspotId = typeof raw?.id === 'string' ? raw.id : undefined;
  const linkedHotspotId = typeof raw?.linkedHotspotId === 'string' ? raw.linkedHotspotId : undefined;
  const modeRaw = String(raw?.navigationMode || 'marzipano').trim().toLowerCase();
  const navigationMode = modeRaw === 'original' ? 'original' : modeRaw === 'pannellum' ? 'pannellum' : 'marzipano';
  return { yaw, pitch, targetSceneId, entryYaw, entryPitch, customTargetView, transitionDuration, sourceHotspotId, linkedHotspotId, navigationMode };
}

export default function PreviewPlayer({ project, initialSceneId, onSceneChange, showLabels }: Props) {
  const initialScene = React.useMemo(
    () => project.scenes.find((s) => s.id === initialSceneId) || project.scenes[0],
    [project.scenes, initialSceneId],
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const stopInertiaRef = React.useRef<(() => void) | null>(null);
  const setInertiaEnabledRef = React.useRef<((enabled: boolean) => void) | null>(null);
  const preloaderRef = React.useRef(createPanoramaPreloader());
  const currentSceneIdRef = React.useRef<string>(initialScene?.id || '');
  const isNavigatingRef = React.useRef(false);
  const initialLoadInProgressRef = React.useRef(false);
  const initialLoadAbortRef = React.useRef<AbortController | null>(null);
  const hasLoadedPanoramaRef = React.useRef(false);
  const navigationRequestRef = React.useRef(0);
  const navigationAbortRef = React.useRef<AbortController | null>(null);
  const pendingNavigationRef = React.useRef<PendingNavigation | null>(null);
  const navigateToSceneRef = React.useRef<(sceneId: string, hint?: SceneEntryHint) => void>(() => {});
  const retryInitialLoadRef = React.useRef<(() => void) | null>(null);
  const stereoPluginRef = React.useRef<any>(null);
  const vrChangeInProgressRef = React.useRef(false);
  const vrOperationIdRef = React.useRef(0);
  const vrDesiredEnabledRef = React.useRef(false);
  const navigationVrDesiredRef = React.useRef<boolean | null>(null);
  const hotspotsVisibleRef = React.useRef(true);
  const scenesRef = React.useRef(project.scenes);
  const showSceneNames = project.exportSettings?.showSceneNames ?? false;
  const [initialLoadStatus, setInitialLoadStatus] = React.useState<'loading' | 'ready' | 'error'>(initialScene ? 'loading' : 'ready');
  const [navigationLoading, setNavigationLoading] = React.useState(false);
  const navigationLoaderTimerRef = React.useRef<number | null>(null);
  const [navigationLoadError, setNavigationLoadError] = React.useState<NavigationLoadError | null>(null);
  const [activeInfoMarker, setActiveInfoMarker] = React.useState<Marker | null>(null);

  React.useEffect(() => { scenesRef.current = project.scenes; }, [project.scenes]);

  const setNavigationControlsEnabled = React.useCallback((enabled: boolean) => {
    const controlsEnabled = enabled
      && !isNavigatingRef.current
      && !initialLoadInProgressRef.current
      && !vrChangeInProgressRef.current
      && !stereoPluginRef.current?.isEnabled?.()
      && navigationVrDesiredRef.current !== true;
    setInertiaEnabledRef.current?.(controlsEnabled);
    try {
      viewerRef.current?.setOptions?.({
        mousewheel: controlsEnabled ? SHARED_VIEWER_MOTION.mousewheel : false,
      });
    } catch {
    }
  }, []);

  React.useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.classList.toggle('pd-labels-visible', showLabels ?? false);
  }, [showLabels]);

  React.useEffect(() => {
    const onCloseTopOverlay = (event: Event) => {
      if (!activeInfoMarker) return;
      event.preventDefault();
      setActiveInfoMarker(null);
    };
    const onDismissInfoMarker = () => setActiveInfoMarker(null);
    window.addEventListener('preview-close-top-overlay', onCloseTopOverlay);
    window.addEventListener('preview-dismiss-info-marker', onDismissInfoMarker);
    return () => {
      window.removeEventListener('preview-close-top-overlay', onCloseTopOverlay);
      window.removeEventListener('preview-dismiss-info-marker', onDismissInfoMarker);
    };
  }, [activeInfoMarker]);

  const getScene = React.useCallback((id: string | undefined) => {
    if (!id) return null;
    return scenesRef.current.find((s) => s.id === id) || null;
  }, []);

  const flushPendingNavigation = React.useCallback(() => {
    if (
      !pendingNavigationRef.current
      || isNavigatingRef.current
      || initialLoadInProgressRef.current
      || vrChangeInProgressRef.current
    ) return;
    const pending = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    window.queueMicrotask(() => {
      navigateToSceneRef.current(pending.sceneId, pending.hint);
    });
  }, []);

  const preloadScenePanorama = React.useCallback(async (sceneId: string, signal?: AbortSignal) => {
    const target = getScene(sceneId);
    if (!target) return false;
    const src = resolveAssetSrc(project, target.image);
    if (!src) return false;
    // A signal means a navigation is about to show this scene, so skip the
    // background queue.
    return preloaderRef.current.preload(src, { signal, priority: !!signal });
  }, [getScene, project.path]);

  const applySceneMarkers = React.useCallback((scene: Scene) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
    if (!hotspotsVisibleRef.current) {
      try {
        markersPlugin.setMarkers([]);
        if (stereoPluginRef.current?.isEnabled?.()) markersPlugin.hideAllMarkers?.();
      } catch {
      }
      return;
    }
    const navigationMarkers = scene.hotspots
      .flatMap((h): any[] => {
        const raw = h as any;
        const parsed = extractHotspotData(raw);
        if (!parsed) {
          return [];
        }
        const { yaw, pitch, targetSceneId, entryYaw, entryPitch, customTargetView, transitionDuration, sourceHotspotId, linkedHotspotId, navigationMode } = parsed;
        const target = getScene(targetSceneId);
        if (!target) {
          return [];
        }
        void preloadScenePanorama(targetSceneId);
        const thumb = resolveAssetSrc(project, target.thumbnail || target.image);
        const hotspotLabel = String(raw?.label || '').trim() || target.name;
        const tooltipContent = showSceneNames
          ? previewMarkerHtml(target, thumb, targetSceneId, hotspotLabel)
          : (thumb ? `<div class="pd-hotspot-preview"><img src="${escapeHtml(thumb)}" alt="" /></div>` : '');
        const tooltip = tooltipContent ? { content: tooltipContent, position: 'top center' } : undefined;
        const icon = normalizeHotspotIconId(raw?.icon || project.hotspotStyle?.iconType);
        const labelTag = `<div class="pd-always-label pd-hotspot-mini-label-wrap" style="margin-top:6px;pointer-events:none;"><div class="pd-hotspot-mini-label">${escapeHtml(hotspotLabel)}</div></div>`;

        if (isProjectedFloorHotspotIcon(icon)) {
          return projectedFloorHotspotMarkers(raw, project, parsed, tooltip, labelTag);
        }

        const markerHtml = previewHotspotMarkerHtml(
          raw?.icon || project.hotspotStyle?.iconType,
          raw?.color || project.hotspotStyle?.color,
          raw?.size || project.hotspotStyle?.size,
          raw?.opacity ?? project.hotspotStyle?.opacity,
          raw?.animation || project.hotspotStyle?.animation,
          raw?.borderWidth ?? (project.hotspotStyle as any)?.borderWidth,
          raw?.floorCurve ?? (project.hotspotStyle as any)?.floorCurve,
          raw?.pulseSpeed ?? (project.hotspotStyle as any)?.pulseSpeed,
          raw?.ringCount ?? (project.hotspotStyle as any)?.ringCount,
          raw?.ringWidth ?? (project.hotspotStyle as any)?.ringWidth,
        );
        const finalHtml = `<div style="display:flex;flex-direction:column;align-items:center;">${markerHtml}${labelTag}</div>`;
        return [{
          id: String(raw?.id ?? `${targetSceneId}-${yaw}-${pitch}`),
          type: 'html',
          html: finalHtml,
          position: { yaw, pitch },
          anchor: 'center center',
          tooltip,
          data: { targetSceneId, entryYaw, entryPitch, customTargetView, transitionDuration, sourceHotspotId, linkedHotspotId, navigationMode },
        }];
      })
      .filter(Boolean);
    const infoMarkers = (scene.markers || []).map((marker) => ({
      id: `preview-info-${marker.id}`,
      type: 'html',
      html: `<button type="button" aria-label="${escapeHtml(marker.title || 'Information')}" style="width:34px;height:34px;border-radius:9999px;border:2px solid rgba(255,255,255,.94);background:#2563eb;color:white;display:flex;align-items:center;justify-content:center;font:700 19px/1 ui-sans-serif,system-ui;box-shadow:0 4px 14px rgba(0,0,0,.45);cursor:pointer;">i</button>`,
      position: { yaw: marker.yaw, pitch: marker.pitch },
      anchor: 'center center',
      tooltip: marker.title ? { content: escapeHtml(marker.title), position: 'top center' } : undefined,
      data: { infoMarkerId: marker.id },
      zIndex: 30,
    }));
    const markers = [...navigationMarkers, ...infoMarkers];
    try {
      markersPlugin.setMarkers(markers as any);
    } catch {
      markersPlugin.setMarkers([]);
    }
    // StereoPlugin hides the markers that exist when it starts. Replacing the
    // marker collection afterwards creates visible markers unless we preserve
    // that hidden state explicitly.
    if (stereoPluginRef.current?.isEnabled?.() || navigationVrDesiredRef.current === true) {
      try { markersPlugin.hideAllMarkers?.(); } catch {
      }
    }
  }, [getScene, project.path, project.hotspotStyle, preloadScenePanorama, showSceneNames]);

  const finishNavigationVrChain = React.useCallback(async () => {
    const desired = navigationVrDesiredRef.current;
    if (desired === null || pendingNavigationRef.current) return;
    const stereoPlugin = stereoPluginRef.current;
    if (desired && stereoPlugin && !stereoPlugin.isEnabled?.()) {
      try { await stereoPlugin.start?.(); } catch {
      }
    }

    // A destination may have been queued while StereoPlugin was starting. In
    // that case keep the chain's desired state, stop the transient stereo
    // session, and let the final queued destination restore it once.
    if (pendingNavigationRef.current) {
      if (desired && stereoPlugin?.isEnabled?.()) {
        try { stereoPlugin.stop?.(); } catch {
        }
      }
      return;
    }

    const actual = !!stereoPlugin?.isEnabled?.();
    vrDesiredEnabledRef.current = actual;
    navigationVrDesiredRef.current = null;
  }, []);

  const navigateToScene = React.useCallback(async (targetSceneId: string, hint?: SceneEntryHint) => {
    const target = getScene(targetSceneId);
    if (!target) return;
    if (isNavigatingRef.current || initialLoadInProgressRef.current || vrChangeInProgressRef.current) {
      // A repeated request for the transition already in flight is a no-op. It
      // must not cancel and restart the same panorama (pointerdown + click used
      // to do exactly that). Any different request supersedes the old one.
      const sameRequestIsStillActive = currentSceneIdRef.current === targetSceneId && (
        (isNavigatingRef.current && !navigationAbortRef.current?.signal.aborted)
        || (initialLoadInProgressRef.current && !initialLoadAbortRef.current?.signal.aborted)
        || vrChangeInProgressRef.current
      );
      if (sameRequestIsStillActive) {
        pendingNavigationRef.current = null;
        return;
      }
      pendingNavigationRef.current = { sceneId: targetSceneId, hint };
      if (isNavigatingRef.current) navigationAbortRef.current?.abort();
      if (initialLoadInProgressRef.current) initialLoadAbortRef.current?.abort();
      return;
    }
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (currentSceneIdRef.current === targetSceneId) {
      if (!hasLoadedPanoramaRef.current) retryInitialLoadRef.current?.();
      else await finishNavigationVrChain();
      return;
    }
    const fromSceneId = currentSceneIdRef.current;
    const previousSceneId = fromSceneId;
    const requestId = ++navigationRequestRef.current;
    const viewerAny = viewer as any;
    const previousScene = getScene(previousSceneId);
    const previousViewerMetadata = {
      panorama: viewerAny.config?.panorama ?? (previousScene ? resolveAssetSrc(project, previousScene.image) : undefined),
      caption: viewerAny.config?.caption ?? previousScene?.name ?? null,
      description: viewerAny.config?.description,
      sphereCorrection: viewerAny.config?.sphereCorrection,
    };
    if (navigationVrDesiredRef.current === null) {
      navigationVrDesiredRef.current = vrDesiredEnabledRef.current
        || !!stereoPluginRef.current?.isEnabled?.();
    }
    const isCurrentNavigation = () => (
      navigationRequestRef.current === requestId
      && viewerRef.current === viewer
    );
    const restorePreviousScene = () => {
      currentSceneIdRef.current = previousSceneId;
      try { viewerAny.hideError?.(); } catch {
      }
      try { viewerAny.loader?.hide?.(); } catch {
      }
      try {
        if (viewerAny.config) Object.assign(viewerAny.config, previousViewerMetadata);
        if (viewerAny.state) viewerAny.state.loadingPromise = null;
        viewerAny.navbar?.setCaption?.(previousViewerMetadata.caption);
      } catch {
      }
      if (!previousScene) return;
      applySceneMarkers(previousScene);
      try {
        const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
        markersPlugin?.renderMarkers?.();
      } catch {
      }
    };

    // Entry orientation: explicit override > Marzipano auto-entry > scene default.
    let entry: { yaw: number; pitch: number };
    const modeRaw = String(hint?.navigationMode || 'marzipano').toLowerCase();
    const useMarzipano = modeRaw === 'marzipano';
    const usePannellum = modeRaw === 'pannellum';
    if (hint?.customTargetView === true && Number.isFinite(Number(hint?.entryYaw)) && Number.isFinite(Number(hint?.entryPitch))) {
      entry = { yaw: Number(hint!.entryYaw), pitch: clampPitch(Number(hint!.entryPitch)) };
    } else if (usePannellum) {
      const currentPos = viewer.getPosition?.();
      const currentYaw = Number(currentPos?.yaw);
      const currentPitch = Number(currentPos?.pitch);
      const sourceScene = getScene(fromSceneId);
      const sourceNorth = Number.isFinite(Number(sourceScene?.initialYaw)) ? Number(sourceScene?.initialYaw) : 0;
      const targetNorth = Number.isFinite(Number(target.initialYaw)) ? Number(target.initialYaw) : 0;
      entry = {
        yaw: Number.isFinite(currentYaw) ? normalizeYawRadians(currentYaw + sourceNorth - targetNorth) : (target.initialYaw || 0),
        pitch: Number.isFinite(currentPitch) ? clampPitch(currentPitch) : clampPitch(target.initialPitch || 0),
      };
    } else if (!useMarzipano && Number.isFinite(Number(hint?.entryYaw)) && Number.isFinite(Number(hint?.entryPitch))) {
      entry = { yaw: Number(hint!.entryYaw), pitch: clampPitch(Number(hint!.entryPitch)) };
    } else {
      // Auto-entry: find the return hotspot in the target scene (points back to current scene),
      // then face away from it (yaw + π) so you arrive looking into the new space.
      const returnHotspot = target.hotspots?.find((h: any) => h.targetSceneId === fromSceneId);
      if (returnHotspot && Number.isFinite(Number((returnHotspot as any).yaw))) {
        entry = {
          yaw: normalizeYawRadians(Number((returnHotspot as any).yaw) + Math.PI),
          pitch: clampPitch(Number((returnHotspot as any).pitch || 0) * 0.25),
        };
      } else {
        entry = sceneEntry(target);
      }
    }

    isNavigatingRef.current = true;
    // Only show the spinner when loading is not near-instant (preloaded scenes).
    if (navigationLoaderTimerRef.current !== null) window.clearTimeout(navigationLoaderTimerRef.current);
    navigationLoaderTimerRef.current = window.setTimeout(() => {
      navigationLoaderTimerRef.current = null;
      setNavigationLoading(true);
    }, 300);
    setNavigationLoadError(null);
    setActiveInfoMarker(null);
    if (!hasLoadedPanoramaRef.current) setInitialLoadStatus('loading');
    navigationAbortRef.current?.abort();
    const navigationAbort = new AbortController();
    navigationAbortRef.current = navigationAbort;
    const reportLoadFailure = () => {
      if (navigationAbort.signal.aborted || pendingNavigationRef.current) return;
      if (hasLoadedPanoramaRef.current) {
        setNavigationLoadError({ sceneId: targetSceneId, sceneName: target.name, hint });
      } else {
        setInitialLoadStatus('error');
      }
    };
    setNavigationControlsEnabled(false);
    try {
      stopInertiaRef.current?.();
      try {
        const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
        markersPlugin?.setMarkers?.([]);
      } catch {
      }
      currentSceneIdRef.current = targetSceneId;
      // Adjacent scenes are normally preloaded already. If this one is not,
      // warm it in parallel instead of waiting up to the preload timeout before
      // PSV is allowed to start its own bounded panorama request.
      void preloadScenePanorama(targetSceneId, navigationAbort.signal);
      if (!isCurrentNavigation()) return;
      if (navigationAbort.signal.aborted) {
        restorePreviousScene();
        return;
      }
      const sceneZoom = Number.isFinite(Number(target.initialZoom)) ? Number(target.initialZoom) : 20;
      const completed = await setPanoramaBounded(viewer, resolveAssetSrc(project, target.image), {
        transition: {
          // Honour the hotspot's own fade time (same 500-2000 ms clamp as the editor).
          speed: Number.isFinite(Number(hint?.transitionDuration))
            ? Math.max(500, Math.min(2000, Number(hint?.transitionDuration)))
            : SHARED_VIEWER_TRANSITION.duration,
          effect: SHARED_VIEWER_TRANSITION.effect,
          rotation: false,
        } as any,
        position: { yaw: entry.yaw, pitch: entry.pitch },
        caption: target.name,
        defaultYaw: entry.yaw,
        defaultPitch: entry.pitch,
        zoom: sceneZoom,
      }, navigationAbort.signal);
      if (!isCurrentNavigation()) return;
      if (completed === false) {
        restorePreviousScene();
        reportLoadFailure();
        return;
      }
      hasLoadedPanoramaRef.current = true;
      setInitialLoadStatus('ready');
      stopInertiaRef.current?.();
      viewer.rotate({ yaw: entry.yaw, pitch: entry.pitch });
      viewer.zoom(sceneZoom);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!isCurrentNavigation() || currentSceneIdRef.current !== targetSceneId) return;
          applySceneMarkers(target);
          try {
            const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
            markersPlugin?.renderMarkers?.();
          } catch {
          }
        });
      });
      try { onSceneChange?.(targetSceneId); } catch {
      }
    } catch {
      if (isCurrentNavigation()) {
        restorePreviousScene();
        reportLoadFailure();
      }
    } finally {
      if (navigationAbortRef.current === navigationAbort) {
        navigationAbortRef.current = null;
      }
      if (isCurrentNavigation()) {
        if (navigationLoaderTimerRef.current !== null) {
          window.clearTimeout(navigationLoaderTimerRef.current);
          navigationLoaderTimerRef.current = null;
        }
        setNavigationLoading(false);
        if (!pendingNavigationRef.current) await finishNavigationVrChain();
        isNavigatingRef.current = false;
        setNavigationControlsEnabled(true);
        window.dispatchEvent(new CustomEvent('preview-vr-state', {
          detail: {
            enabled: navigationVrDesiredRef.current
              ?? !!stereoPluginRef.current?.isEnabled?.(),
          },
        }));
        flushPendingNavigation();
      }
    }
  }, [applySceneMarkers, finishNavigationVrChain, flushPendingNavigation, getScene, onSceneChange, project.path, preloadScenePanorama, setNavigationControlsEnabled]);

  navigateToSceneRef.current = navigateToScene;

  const navigateByType = React.useCallback((type: NonNullable<PreviewNavDetail['type']>) => {
    const scenes = scenesRef.current;
    // Repeated keyboard/menu navigation should advance from the latest queued
    // destination, not repeatedly from the transition currently loading.
    const navigationBaseId = pendingNavigationRef.current?.sceneId || currentSceneIdRef.current;
    const sceneIndex = scenes.findIndex((scene) => scene.id === navigationBaseId);
    if (sceneIndex < 0) return;
    if (type === 'prev' && sceneIndex > 0) {
      void navigateToScene(scenes[sceneIndex - 1].id);
      return;
    }
    if (type === 'next' && sceneIndex < scenes.length - 1) {
      void navigateToScene(scenes[sceneIndex + 1].id);
      return;
    }
    if (type === 'home' && scenes.length > 0) {
      void navigateToScene(scenes[0].id);
      return;
    }
    if (type === 'end' && scenes.length > 0) {
      void navigateToScene(scenes[scenes.length - 1].id);
    }
  }, [navigateToScene]);

  React.useEffect(() => {
    const container = containerRef.current;
    const firstScene = initialScene;
    if (!container || !firstScene) return;

    const viewer = new Viewer({
      container,
      caption: firstScene.name,
      defaultYaw: firstScene.initialYaw || 0,
      defaultPitch: firstScene.initialPitch || 0,
      defaultZoomLvl: firstScene.initialZoom ?? 20,
      loadingTxt: '',
      ...SHARED_VIEWER_MOTION,
      defaultTransition: {
        speed: 520,
        effect: 'fade',
        rotation: false,
      },
      navbar: false,
      plugins: [
        [MarkersPlugin, { markers: [], clickEventOnMarker: true }],
        GyroscopePlugin,
        StereoPlugin,
      ],
    });
    viewerRef.current = viewer;
    const inertia = attachViewerInertia(viewer as any, container, {
      alphaDragging: SHARED_VIEWER_INERTIA.alphaDragging,
      alphaIdle: SHARED_VIEWER_INERTIA.alphaIdle,
      minFovDeg: SHARED_VIEWER_MOTION.minFov,
      maxFovDeg: SHARED_VIEWER_MOTION.maxFov,
    });
    stopInertiaRef.current = inertia.stop;
    setInertiaEnabledRef.current = inertia.setEnabled;
    currentSceneIdRef.current = firstScene.id;
    onSceneChange?.(firstScene.id);

    const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
    const stereoPlugin = viewer.getPlugin(StereoPlugin as any) as any;
    stereoPluginRef.current = stereoPlugin;
    vrDesiredEnabledRef.current = !!stereoPlugin?.isEnabled?.();
    let panoramaLoadedRaf: number | null = null;
    const emitVrState = (enabled: boolean) => {
      window.dispatchEvent(new CustomEvent('preview-vr-state', { detail: { enabled: !!enabled } }));
    };
    const emitAutorotateState = () => {
      window.dispatchEvent(new CustomEvent('preview-autorotate-state', { detail: { enabled: false } }));
    };
    const onPanoramaLoaded = () => {
      if (isNavigatingRef.current) return;
      const active = getScene(currentSceneIdRef.current);
      if (!active) return;
      if (panoramaLoadedRaf !== null) cancelAnimationFrame(panoramaLoadedRaf);
      panoramaLoadedRaf = requestAnimationFrame(() => {
        panoramaLoadedRaf = null;
        if (
          viewerRef.current !== viewer
          || isNavigatingRef.current
          || currentSceneIdRef.current !== active.id
        ) return;
        applySceneMarkers(active);
        try {
          markersPlugin.renderMarkers();
        } catch {
        }
      });
    };
    const onPanoramaError = () => {
      if (initialLoadInProgressRef.current && !initialLoadAbortRef.current?.signal.aborted) {
        setInitialLoadStatus('error');
      }
    };
    viewer.addEventListener('panorama-loaded', onPanoramaLoaded);
    viewer.addEventListener('panorama-error', onPanoramaError as any);
    const onSelectMarker = ({ marker }: any) => {
      const infoMarkerId = marker?.data?.infoMarkerId as string | undefined;
      if (infoMarkerId) {
        const activeScene = getScene(currentSceneIdRef.current);
        const infoMarker = activeScene?.markers?.find((candidate) => candidate.id === infoMarkerId) || null;
        if (infoMarker) setActiveInfoMarker(infoMarker);
        return;
      }
      const targetSceneId = marker?.data?.targetSceneId as string | undefined;
      if (targetSceneId) {
        const entryYaw = Number(marker?.data?.entryYaw);
        const entryPitch = Number(marker?.data?.entryPitch);
        const yaw = Number(marker?.config?.position?.yaw ?? marker?.config?.yaw ?? marker?.props?.position?.yaw);
        const pitch = Number(marker?.config?.position?.pitch ?? marker?.config?.pitch ?? marker?.props?.position?.pitch);
        void navigateToScene(targetSceneId, {
          fromSceneId: currentSceneIdRef.current,
          fromHotspotId: marker?.data?.sourceHotspotId,
          fromYaw: yaw,
          fromPitch: pitch,
          entryYaw: Number.isFinite(entryYaw) ? entryYaw : undefined,
          entryPitch: Number.isFinite(entryPitch) ? entryPitch : undefined,
          customTargetView: marker?.data?.customTargetView === true,
          transitionDuration: Number.isFinite(Number(marker?.data?.transitionDuration)) ? Number(marker.data.transitionDuration) : undefined,
          navigationMode: marker?.data?.navigationMode === 'original' ? 'original' : marker?.data?.navigationMode === 'pannellum' ? 'pannellum' : 'marzipano',
        });
      }
    };
    markersPlugin.addEventListener('select-marker', onSelectMarker);

    const onPreviewClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const trigger = target.closest('[data-preview-target-scene-id]') as HTMLElement | null;
      if (!trigger) return;
      const targetSceneId = trigger.dataset.previewTargetSceneId;
      if (targetSceneId) {
        event.preventDefault();
        event.stopPropagation();
        void navigateToScene(targetSceneId, { fromSceneId: currentSceneIdRef.current });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (typing || document.querySelector('[data-preview-overlay]')) return;
      const sceneIndex = scenesRef.current.findIndex((scene) => scene.id === currentSceneIdRef.current);
      if (sceneIndex < 0) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        navigateByType('prev');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        navigateByType('next');
      } else if (event.key === 'Home') {
        event.preventDefault();
        navigateByType('home');
      } else if (event.key === 'End') {
        event.preventDefault();
        navigateByType('end');
      }
    };

    const onPreviewNavigate = (event: Event) => {
      const detail = (event as CustomEvent<PreviewNavDetail>).detail || {};
      if (detail.sceneId) {
        void navigateToScene(detail.sceneId);
        return;
      }
      if (!detail.type) return;
      navigateByType(detail.type);
    };

    const onPreviewRequestCurrent = () => {
      onSceneChange?.(currentSceneIdRef.current);
    };
    const onPreviewSetHotspotsVisible = (event: Event) => {
      const detail = (event as CustomEvent<PreviewHotspotsDetail>).detail || {};
      const visible = detail.visible !== false;
      hotspotsVisibleRef.current = visible;
      if (!visible) setActiveInfoMarker(null);
      if (isNavigatingRef.current) return;
      const active = getScene(currentSceneIdRef.current);
      if (!active) return;
      applySceneMarkers(active);
      try {
        markersPlugin.renderMarkers();
      } catch {
      }
    };
    const onPreviewSetAutorotate = () => {
      emitAutorotateState();
    };
    const onPreviewToggleVr = () => {
      if (
        !stereoPlugin
        || isNavigatingRef.current
        || initialLoadInProgressRef.current
        || vrChangeInProgressRef.current
        || navigationVrDesiredRef.current !== null
      ) return;
      const operationId = ++vrOperationIdRef.current;
      const desired = !stereoPlugin.isEnabled?.();
      vrDesiredEnabledRef.current = desired;
      vrChangeInProgressRef.current = true;
      stopInertiaRef.current?.();
      setNavigationControlsEnabled(false);
      void (async () => {
        try {
          if (!desired) stereoPlugin.stop?.();
          else await stereoPlugin.start?.();
        } catch {
        } finally {
          if (viewerRef.current !== viewer || vrOperationIdRef.current !== operationId) return;
          vrChangeInProgressRef.current = false;
          vrDesiredEnabledRef.current = !!stereoPlugin.isEnabled?.();
          setNavigationControlsEnabled(true);
          emitVrState(vrDesiredEnabledRef.current);
          flushPendingNavigation();
        }
      })();
    };
    const onStereoUpdated = (event: any) => {
      const enabled = !!event?.stereoEnabled;
      if (!isNavigatingRef.current && !vrChangeInProgressRef.current) {
        vrDesiredEnabledRef.current = enabled;
      }
      if (!isNavigatingRef.current) setNavigationControlsEnabled(true);
      emitVrState(navigationVrDesiredRef.current ?? enabled);
    };
    stereoPlugin?.addEventListener?.('stereo-updated', onStereoUpdated);
    emitVrState(!!stereoPlugin?.isEnabled?.());
    emitAutorotateState();

    let initialLoadAttemptId = 0;
    const loadInitialScene = async () => {
      const attemptId = ++initialLoadAttemptId;
      initialLoadAbortRef.current?.abort();
      const controller = new AbortController();
      initialLoadAbortRef.current = controller;
      initialLoadInProgressRef.current = true;
      setInitialLoadStatus('loading');
      setActiveInfoMarker(null);
      stopInertiaRef.current?.();
      setNavigationControlsEnabled(false);
      try { (viewer as any).hideError?.(); } catch {
      }
      const entry = sceneEntry(firstScene);
      const zoom = Number.isFinite(Number(firstScene.initialZoom)) ? Number(firstScene.initialZoom) : 20;
      const src = resolveAssetSrc(project, firstScene.image);
      const completed = src
        ? await setPanoramaBounded(viewer, src, {
          transition: false,
          position: entry,
          caption: firstScene.name,
          zoom,
        }, controller.signal)
        : false;
      const ownsAttempt = attemptId === initialLoadAttemptId && viewerRef.current === viewer;
      if (ownsAttempt && !controller.signal.aborted) {
        if (completed) {
          hasLoadedPanoramaRef.current = true;
          currentSceneIdRef.current = firstScene.id;
          viewer.rotate(entry);
          viewer.zoom(zoom);
          applySceneMarkers(firstScene);
          setInitialLoadStatus('ready');
        } else {
          setInitialLoadStatus('error');
          try { (viewer as any).showError?.('Unable to load this panorama.'); } catch {
          }
        }
      }
      if (initialLoadAbortRef.current === controller) initialLoadAbortRef.current = null;
      if (ownsAttempt) {
        initialLoadInProgressRef.current = false;
        setNavigationControlsEnabled(true);
        flushPendingNavigation();
      }
    };
    retryInitialLoadRef.current = () => { void loadInitialScene(); };

    window.addEventListener('preview-navigate-scene', onPreviewNavigate as EventListener);
    window.addEventListener('preview-request-current-scene', onPreviewRequestCurrent as EventListener);
    window.addEventListener('preview-set-hotspots-visible', onPreviewSetHotspotsVisible as EventListener);
    window.addEventListener('preview-set-autorotate', onPreviewSetAutorotate as EventListener);
    window.addEventListener('preview-toggle-vr', onPreviewToggleVr as EventListener);
    window.addEventListener('keydown', onKeyDown);
    container.addEventListener('click', onPreviewClick, true);
    void loadInitialScene();

    return () => {
      initialLoadAttemptId += 1;
      navigationRequestRef.current += 1;
      isNavigatingRef.current = false;
      initialLoadInProgressRef.current = false;
      hasLoadedPanoramaRef.current = false;
      vrChangeInProgressRef.current = false;
      vrOperationIdRef.current += 1;
      vrDesiredEnabledRef.current = false;
      navigationVrDesiredRef.current = null;
      pendingNavigationRef.current = null;
      retryInitialLoadRef.current = null;
      if (panoramaLoadedRaf !== null) cancelAnimationFrame(panoramaLoadedRaf);
      panoramaLoadedRaf = null;
      navigationAbortRef.current?.abort();
      navigationAbortRef.current = null;
      initialLoadAbortRef.current?.abort();
      initialLoadAbortRef.current = null;
      preloaderRef.current.cancelAll();
      if (navigationLoaderTimerRef.current !== null) window.clearTimeout(navigationLoaderTimerRef.current);
      navigationLoaderTimerRef.current = null;
      window.removeEventListener('preview-request-current-scene', onPreviewRequestCurrent as EventListener);
      window.removeEventListener('preview-navigate-scene', onPreviewNavigate as EventListener);
      window.removeEventListener('preview-set-hotspots-visible', onPreviewSetHotspotsVisible as EventListener);
      window.removeEventListener('preview-set-autorotate', onPreviewSetAutorotate as EventListener);
      window.removeEventListener('preview-toggle-vr', onPreviewToggleVr as EventListener);
      window.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('click', onPreviewClick, true);
      stereoPlugin?.removeEventListener?.('stereo-updated', onStereoUpdated);
      markersPlugin.removeEventListener('select-marker', onSelectMarker);
      viewer.removeEventListener('panorama-loaded', onPanoramaLoaded);
      viewer.removeEventListener('panorama-error', onPanoramaError as any);
      inertia.detach();
      stopInertiaRef.current = null;
      setInertiaEnabledRef.current = null;
      stereoPluginRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [applySceneMarkers, flushPendingNavigation, navigateToScene, navigateByType, project.path, initialScene, onSceneChange, getScene, setNavigationControlsEnabled]);

  return (
    <div className="h-full w-full bg-black relative">
      <div ref={containerRef} className="h-full w-full" />
      {navigationLoading && (
        <div className="pointer-events-none absolute left-1/2 top-6 z-[110] -translate-x-1/2 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-3.5 py-1.5 text-xs text-white/90 backdrop-blur-md" role="status" aria-live="polite">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Loading scene…
        </div>
      )}
      {initialLoadStatus === 'error' && (
        <div data-preview-overlay className="absolute inset-0 z-[120] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-950/95 p-6 text-center text-white shadow-2xl">
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <RotateCcw className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold">Panorama could not be loaded</h2>
            <p className="mt-2 text-sm leading-5 text-white/55">
              Check the image source or connection, then try this scene again.
            </p>
            <button
              type="button"
              onClick={() => retryInitialLoadRef.current?.()}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white/85"
            >
              <RotateCcw className="h-4 w-4" />
              Retry panorama
            </button>
          </div>
        </div>
      )}
      {navigationLoadError && (
        <div
          data-preview-overlay
          className="absolute inset-0 z-[120] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNavigationLoadError(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Panorama load failed"
            className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-950/95 p-6 text-center text-white shadow-2xl"
          >
            <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-amber-400/15 text-amber-300">
              <RotateCcw className="h-5 w-5" />
            </div>
            <h2 className="text-base font-semibold">Could not load {navigationLoadError.sceneName}</h2>
            <p className="mt-2 text-sm leading-5 text-white/55">
              The previous scene was restored. Check the image source or connection, then try again.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setNavigationLoadError(null)}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => {
                  const failedNavigation = navigationLoadError;
                  setNavigationLoadError(null);
                  navigateToSceneRef.current(failedNavigation.sceneId, failedNavigation.hint);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-white/85"
              >
                <RotateCcw className="h-4 w-4" />
                Retry scene
              </button>
            </div>
          </div>
        </div>
      )}
      {activeInfoMarker && (() => {
        const markerLink = normalizeExternalUrl(activeInfoMarker.link);
        const markerImage = resolveAssetSrc(project, activeInfoMarker.image);
        return (
          <div
            data-preview-overlay
            className="absolute inset-0 z-[65] flex items-center justify-center bg-black/55 p-5 backdrop-blur-sm"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setActiveInfoMarker(null);
            }}
          >
            <article
              role="dialog"
              aria-modal="true"
              aria-label={activeInfoMarker.title || 'Information'}
              className="relative max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 text-white shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setActiveInfoMarker(null)}
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/45 text-white/65 transition hover:bg-black/70 hover:text-white"
                aria-label="Close information"
              >
                <X className="h-4 w-4" />
              </button>
              {markerImage && (
                <img
                  src={markerImage}
                  alt=""
                  className="max-h-64 w-full rounded-t-2xl object-cover"
                />
              )}
              <div className="p-6 pr-14">
                <div className="mb-3 flex items-center gap-2 text-blue-300">
                  <Info className="h-4 w-4" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.18em]">Information</span>
                </div>
                <h2 className="text-xl font-semibold leading-7">{activeInfoMarker.title || 'Information'}</h2>
                {activeInfoMarker.description && (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/70">{activeInfoMarker.description}</p>
                )}
                {markerLink && (
                  <a
                    href={markerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
                  >
                    Open link
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </article>
          </div>
        );
      })()}
    </div>
  );
}
