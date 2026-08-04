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
type SceneEntryHint = { fromSceneId?: string; fromHotspotId?: string; fromYaw?: number; fromPitch?: number; entryYaw?: number; entryPitch?: number; customTargetView?: boolean; navigationMode?: 'original' | 'marzipano' | 'pannellum' };

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

function previewMarkerHtml(scene: Scene, _targetThumb: string, targetSceneId: string) {
  const label = escapeHtml(scene.name);
  return `
    <div data-preview-target-scene-id="${targetSceneId}" class="pd-hotspot-mini-label-wrap">
      <div class="pd-hotspot-mini-label">${label}</div>
    </div>
  `;
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

function projectedFloorHotspotMarkers(raw: any, project: Project, parsed: ReturnType<typeof extractHotspotData>, tooltip: any) {
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
      html: `<div class="pd-hotspot-wrap"><div class="pd-floor-hotspot-hit" style="--pd-floor-hit-color:${alphaColor(color, 0.96)};--pd-floor-hit-glow:${alphaColor(color, 0.7)};--pd-floor-hit-speed:${pulseSpeed.toFixed(2)}s;--pd-floor-hit-size:${Math.max(42, Math.round(size * 0.72))}px;"></div></div>`,
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
  const sourceHotspotId = typeof raw?.id === 'string' ? raw.id : undefined;
  const linkedHotspotId = typeof raw?.linkedHotspotId === 'string' ? raw.linkedHotspotId : undefined;
  const modeRaw = String(raw?.navigationMode || 'marzipano').trim().toLowerCase();
  const navigationMode = modeRaw === 'marzipano' ? 'marzipano' : modeRaw === 'pannellum' ? 'pannellum' : 'marzipano';
  return { yaw, pitch, targetSceneId, entryYaw, entryPitch, customTargetView, sourceHotspotId, linkedHotspotId, navigationMode };
}

export default function PreviewPlayer({ project, initialSceneId, onSceneChange, showLabels }: Props) {
  const initialScene = React.useMemo(
    () => project.scenes.find((s) => s.id === initialSceneId) || project.scenes[0],
    [project.scenes, initialSceneId],
  );
  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const stopInertiaRef = React.useRef<(() => void) | null>(null);
  const preloadCacheRef = React.useRef<Set<string>>(new Set());
  const preloadInflightRef = React.useRef<Set<string>>(new Set());
  const currentSceneIdRef = React.useRef<string>(initialScene?.id || '');
  const isNavigatingRef = React.useRef(false);
  const hotspotsVisibleRef = React.useRef(true);
  const showLabelsRef = React.useRef(showLabels ?? false);
  const scenesRef = React.useRef(project.scenes);
  const showSceneNames = project.exportSettings?.showSceneNames ?? false;

  React.useEffect(() => { scenesRef.current = project.scenes; }, [project.scenes]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.classList.toggle('pd-labels-visible', showLabels ?? false);
  }, [showLabels]);

  const getScene = React.useCallback((id: string | undefined) => {
    if (!id) return null;
    return scenesRef.current.find((s) => s.id === id) || null;
  }, []);

  const preloadScenePanorama = React.useCallback(async (sceneId: string) => {
    const target = getScene(sceneId);
    if (!target) return;
    const src = resolveAssetSrc(project, target.image);
    if (!src || preloadCacheRef.current.has(src) || preloadInflightRef.current.has(src)) return;
    preloadInflightRef.current.add(src);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { preloadCacheRef.current.add(src); preloadInflightRef.current.delete(src); resolve(); };
      img.onerror = () => { preloadInflightRef.current.delete(src); resolve(); };
      img.src = src;
    });
  }, [getScene, project.path]);

  const applySceneMarkers = React.useCallback((scene: Scene) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
    if (!hotspotsVisibleRef.current) {
      try {
        markersPlugin.setMarkers([]);
      } catch {
      }
      return;
    }
    const markers = scene.hotspots
      .flatMap((h): any[] => {
        const raw = h as any;
        const parsed = extractHotspotData(raw);
        if (!parsed) {
          return [];
        }
        const { yaw, pitch, targetSceneId, entryYaw, entryPitch, customTargetView, sourceHotspotId, linkedHotspotId, navigationMode } = parsed;
        const target = getScene(targetSceneId);
        if (!target) {
          return [];
        }
        void preloadScenePanorama(targetSceneId);
        const thumb = resolveAssetSrc(project, target.thumbnail || target.image);
        const tooltipContent = showSceneNames
          ? previewMarkerHtml(target, thumb, targetSceneId)
          : (thumb ? `<div class="pd-hotspot-preview"><div class="pd-hotspot-preview-bg" style="background-image:url('${thumb}')"></div></div>` : '');
        const tooltip = tooltipContent ? { content: tooltipContent, position: 'top center' } : undefined;
        const icon = normalizeHotspotIconId(raw?.icon || project.hotspotStyle?.iconType);

        if (isProjectedFloorHotspotIcon(icon)) {
          return projectedFloorHotspotMarkers(raw, project, parsed, tooltip);
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
        const labelTag = `<div class="pd-always-label pd-hotspot-mini-label-wrap" style="margin-top:6px;pointer-events:none;"><div class="pd-hotspot-mini-label">${escapeHtml(target.name)}</div></div>`;
        const finalHtml = `<div style="display:flex;flex-direction:column;align-items:center;">${markerHtml}${labelTag}</div>`;
        return [{
          id: String(raw?.id ?? `${targetSceneId}-${yaw}-${pitch}`),
          type: 'html',
          html: finalHtml,
          position: { yaw, pitch },
          anchor: 'center center',
          tooltip,
          data: { targetSceneId, entryYaw, entryPitch, customTargetView, sourceHotspotId, linkedHotspotId, navigationMode },
        }];
      })
      .filter(Boolean);
    try {
      markersPlugin.setMarkers(markers as any);
    } catch {
      markersPlugin.setMarkers([]);
    }
  }, [getScene, project.path, project.hotspotStyle, preloadScenePanorama]);

  const navigateToScene = React.useCallback(async (targetSceneId: string, hint?: SceneEntryHint) => {
    if (isNavigatingRef.current) return;
    const viewer = viewerRef.current;
    const target = getScene(targetSceneId);
    if (!viewer || !target) return;
    if (currentSceneIdRef.current === targetSceneId) return;
    const fromSceneId = currentSceneIdRef.current;
    const previousSceneId = fromSceneId;

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
    try {
      stopInertiaRef.current?.();
      try {
        const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
        markersPlugin?.setMarkers?.([]);
      } catch {
      }
      currentSceneIdRef.current = targetSceneId;
      await preloadScenePanorama(targetSceneId);
      const sceneZoom = Number.isFinite(Number(target.initialZoom)) ? Number(target.initialZoom) : 20;
      await viewer.setPanorama(resolveAssetSrc(project, target.image), {
        transition: {
          speed: SHARED_VIEWER_TRANSITION.duration,
          effect: SHARED_VIEWER_TRANSITION.effect,
          rotation: false,
        } as any,
        position: { yaw: entry.yaw, pitch: entry.pitch },
        caption: target.name,
        defaultYaw: entry.yaw,
        defaultPitch: entry.pitch,
        zoom: sceneZoom,
      });
      viewer.rotate({ yaw: entry.yaw, pitch: entry.pitch });
      viewer.zoom(sceneZoom);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applySceneMarkers(target);
          try {
            const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
            markersPlugin?.renderMarkers?.();
          } catch {
          }
        });
      });
      onSceneChange?.(targetSceneId);
    } catch {
      currentSceneIdRef.current = previousSceneId;
    } finally {
      isNavigatingRef.current = false;
    }
  }, [applySceneMarkers, getScene, onSceneChange, project.path, preloadScenePanorama]);

  const navigateByType = React.useCallback((type: NonNullable<PreviewNavDetail['type']>) => {
    const scenes = scenesRef.current;
    const sceneIndex = scenes.findIndex((scene) => scene.id === currentSceneIdRef.current);
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
      panorama: resolveAssetSrc(project, firstScene.image),
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
    currentSceneIdRef.current = firstScene.id;
    onSceneChange?.(firstScene.id);

    const markersPlugin = viewer.getPlugin(MarkersPlugin) as any;
    const stereoPlugin = viewer.getPlugin(StereoPlugin as any) as any;
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
      requestAnimationFrame(() => {
        applySceneMarkers(active);
        try {
          markersPlugin.renderMarkers();
        } catch {
        }
      });
    };
    const onPanoramaError = () => {};
    viewer.addEventListener('panorama-loaded', onPanoramaLoaded);
    viewer.addEventListener('panorama-error', onPanoramaError as any);
    const onSelectMarker = ({ marker }: any) => {
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
          navigationMode: marker?.data?.navigationMode === 'marzipano' ? 'marzipano' : marker?.data?.navigationMode === 'pannellum' ? 'pannellum' : 'marzipano',
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
      if (typing) return;
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
      try {
        stereoPlugin?.toggle?.();
        emitVrState(!!stereoPlugin?.isEnabled?.());
      } catch {
      }
    };
    const onStereoUpdated = (event: any) => {
      emitVrState(!!event?.stereoEnabled);
    };
    stereoPlugin?.addEventListener?.('stereo-updated', onStereoUpdated);
    emitVrState(!!stereoPlugin?.isEnabled?.());
    emitAutorotateState();

    window.addEventListener('preview-navigate-scene', onPreviewNavigate as EventListener);
    window.addEventListener('preview-request-current-scene', onPreviewRequestCurrent as EventListener);
    window.addEventListener('preview-set-hotspots-visible', onPreviewSetHotspotsVisible as EventListener);
    window.addEventListener('preview-set-autorotate', onPreviewSetAutorotate as EventListener);
    window.addEventListener('preview-toggle-vr', onPreviewToggleVr as EventListener);
    window.addEventListener('keydown', onKeyDown);
    container.addEventListener('click', onPreviewClick, true);
    container.addEventListener('pointerdown', onPreviewClick, true);

    return () => {
      window.removeEventListener('preview-request-current-scene', onPreviewRequestCurrent as EventListener);
      window.removeEventListener('preview-navigate-scene', onPreviewNavigate as EventListener);
      window.removeEventListener('preview-set-hotspots-visible', onPreviewSetHotspotsVisible as EventListener);
      window.removeEventListener('preview-set-autorotate', onPreviewSetAutorotate as EventListener);
      window.removeEventListener('preview-toggle-vr', onPreviewToggleVr as EventListener);
      window.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('click', onPreviewClick, true);
      container.removeEventListener('pointerdown', onPreviewClick, true);
      stereoPlugin?.removeEventListener?.('stereo-updated', onStereoUpdated);
      markersPlugin.removeEventListener('select-marker', onSelectMarker);
      viewer.removeEventListener('panorama-loaded', onPanoramaLoaded);
      viewer.removeEventListener('panorama-error', onPanoramaError as any);
      inertia.detach();
      stopInertiaRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [applySceneMarkers, navigateToScene, navigateByType, project.path, initialScene, onSceneChange, getScene]);

  return (
    <div className="h-full w-full bg-black relative">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

