import React from 'react';
import { Viewer } from '@photo-sphere-viewer/core';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { useProjectStore } from '../../store/projectStore';
import { useEditorStore } from '../../store/editorStore';
import { AppMode } from '../../types';
import AddHotspotModal from '../modals/AddHotspotModal';
import AddMarkerModal from '../modals/AddMarkerModal';
import ReturnHotspotPlacementModal from '../modals/ReturnHotspotPlacementModal';
import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { resolveAssetSrc } from '../../lib/media';
import { SHARED_VIEWER_INERTIA, SHARED_VIEWER_MOTION, SHARED_VIEWER_TRANSITION } from '../../lib/viewerMotion';
import { attachViewerInertia } from '../../lib/viewerInertia';
import { createPanoramaPreloader, PANORAMA_LOAD_TIMEOUT_MS } from '../../lib/panoramaLoad';
import { v4 as uuidv4 } from 'uuid';
import { useUiStore } from '../../store/uiStore';
import { hasEscapeCloseLayer } from '../../hooks/useEscapeClose';
import { hotspotHtmlIconGlyph, normalizeHotspotIconId } from '../../lib/hotspotIcons';

function hotspotHtml(
  iconType: string,
  color: string,
  size: number,
  opacityRaw?: number,
  borderWidthRaw?: number,
  floorCurveRaw?: number,
  pulseSpeed?: number,
  ringCount?: number,
  ringWidthRaw?: number,
) {
  const normalizedIcon = normalizeHotspotIconId(iconType);
  const s = Math.max(32, Math.round(Number(size) || 70));
  const opacity = Number.isFinite(Number(opacityRaw)) ? Math.max(0, Math.min(1, Number(opacityRaw))) : 0.1;
  const borderWidth = Math.max(1, Math.min(16, Math.round(Number(borderWidthRaw) || 5)));
  const floorCurve = normalizeHotspotFloorCurve(floorCurveRaw, 0);
  const speed = normalizeHotspotPulseSpeed(pulseSpeed, 4.0);
  const rings = normalizeHotspotRingCount(ringCount, 2);
  const ringWidth = normalizeHotspotRingWidth(ringWidthRaw, Math.round(s * 0.95));
  const ringDelayStep = speed / Math.max(1, rings);
  const isFloorRing = normalizedIcon === 'floor-ring';
  const isPulseCore = normalizedIcon === 'pulse-core';
  const isVistaPulse = normalizedIcon === 'vista-pulse';
  const isFloorPulseRing = normalizedIcon === 'floor-pulse-ring';
  const isFloorCircle = normalizedIcon === 'floor-circle';
  const floorLike = isFloorRing || isFloorPulseRing || isFloorCircle;
  const curveAmount = floorLike ? Math.max(68, floorCurve) : floorCurve;
  const curveRatio = Math.max(0, Math.min(1, curveAmount / 100));
  const curveClass = (floorLike || curveRatio > 0) ? ' pd-hotspot-core-curved' : '';

  const raw = String(color || '#ffffff').trim();
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

  const alphaColor = (input: string, alpha: number) => {
    const source = String(input || '').trim();
    const sourceHex = source.startsWith('#') ? source.slice(1) : source;
    if (/^[0-9a-fA-F]{6}$/.test(sourceHex)) {
      const rr = parseInt(sourceHex.slice(0, 2), 16);
      const gg = parseInt(sourceHex.slice(2, 4), 16);
      const bb = parseInt(sourceHex.slice(4, 6), 16);
      return `rgba(${rr},${gg},${bb},${alpha})`;
    }
    if (/^[0-9a-fA-F]{3}$/.test(sourceHex)) {
      const rr = parseInt(sourceHex[0] + sourceHex[0], 16);
      const gg = parseInt(sourceHex[1] + sourceHex[1], 16);
      const bb = parseInt(sourceHex[2] + sourceHex[2], 16);
      return `rgba(${rr},${gg},${bb},${alpha})`;
    }
    return `rgba(255,255,255,${alpha})`;
  };

  const makeRings = (className: string) => Array.from({ length: rings }, (_, index) => (
    `<span class="${className}" style="animation-duration:${speed.toFixed(2)}s;animation-delay:${(index * ringDelayStep).toFixed(2)}s;--pd-ring-size:${ringWidth}px;"></span>`
  )).join('');

  const commonCurveVars = `--pd-hotspot-floor-perspective:${Math.round(180 + curveRatio * 140)}px;--pd-hotspot-floor-rotate:${(curveRatio * 72).toFixed(2)}deg;--pd-hotspot-floor-scale-x:${(1 + curveRatio * 0.08).toFixed(3)};--pd-hotspot-floor-scale-y:${(1 - curveRatio * 0.44).toFixed(3)};--pd-hotspot-floor-shadow:${(curveRatio * 0.22).toFixed(3)}`;
  const fill = isFloorRing ? 'rgba(255,255,255,0)' : alphaColor(color || '#ffffff', opacity);

  if (isPulseCore) {
    const pulseColor = alphaColor(color || '#ffffff', 0.96);
    const pulseStroke = Math.max(1, Math.min(5, Math.round(borderWidth * 0.45)));
    return `<div class="pd-hotspot-core pd-hotspot-core-pulse${curveClass}" style="width:${s}px;height:${s}px;--pd-hotspot-size:${s}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-pulse-color:${pulseColor};--pd-hotspot-pulse-stroke:${pulseStroke}px;${commonCurveVars}">${makeRings('pd-hotspot-pulse-ring')}<span class="pd-hotspot-pulse-center"></span></div>`;
  }

  if (isVistaPulse) {
    const vistaColor = alphaColor(color || '#ffffff', 0.9);
    return `<div class="pd-hotspot-core pd-hotspot-core-vista${curveClass}" style="width:${s}px;height:${s}px;--pd-hotspot-size:${s}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-vista-color:${vistaColor};--pd-hotspot-vista-ring-size:${ringWidth}px;${commonCurveVars}">${makeRings('pd-hotspot-vista-ring')}<span class="pd-hotspot-vista-center"></span></div>`;
  }

  if (isFloorPulseRing) {
    const floorRingHeight = Math.max(12, Math.round(ringWidth * 0.345));
    return `<div class="pd-hotspot-core pd-hotspot-core-floor-pulse${curveClass}" style="width:${s}px;height:${s}px;--pd-hotspot-size:${s}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-floor-pulse-duration:${speed.toFixed(2)}s;--pd-hotspot-floor-ring-width:${ringWidth}px;--pd-hotspot-floor-ring-height:${floorRingHeight}px;--pd-hotspot-floor-ring-color:${alphaColor(color || '#ffffff', 0.95)};--pd-hotspot-floor-ring-glow:${alphaColor(color || '#ffffff', 0.7)};--pd-hotspot-floor-ring-glow-soft:${alphaColor(color || '#ffffff', 0.35)};--pd-hotspot-floor-shadow-glow:${alphaColor(color || '#ffffff', 0.12)};--pd-hotspot-floor-dot-color:${alphaColor(color || '#ffffff', 0.95)};--pd-hotspot-floor-dot-glow:${alphaColor(color || '#ffffff', 0.6)};${commonCurveVars}"><span class="pd-hotspot-floor-shadow"></span>${makeRings('pd-hotspot-floor-ping')}<span class="pd-hotspot-floor-ring"></span><span class="pd-hotspot-floor-dot"></span></div>`;
  }

  if (isFloorCircle) {
    const floorCircleHeight = Math.max(10, Math.round(ringWidth * 0.31));
    return `<div class="pd-hotspot-core pd-hotspot-core-floor-circle${curveClass}" style="width:${s}px;height:${s}px;--pd-hotspot-size:${s}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;--pd-hotspot-floor-circle-duration:${speed.toFixed(2)}s;--pd-hotspot-floor-circle-width:${ringWidth}px;--pd-hotspot-floor-circle-height:${floorCircleHeight}px;--pd-hotspot-floor-circle-color:${alphaColor(color || '#ffffff', 0.95)};--pd-hotspot-floor-circle-glow:${alphaColor(color || '#ffffff', 0.7)};--pd-hotspot-floor-circle-soft:${alphaColor(color || '#ffffff', 0.3)};--pd-hotspot-floor-circle-core:${alphaColor(color || '#ffffff', 0.55)};${commonCurveVars}">${makeRings('pd-hotspot-floor-circle-ping')}<span class="pd-hotspot-floor-circle-ring"></span><span class="pd-hotspot-floor-circle-inner"></span><span class="pd-hotspot-floor-circle-dot"></span></div>`;
  }

  const glyph = hotspotHtmlIconGlyph(normalizedIcon);
  const pingDivs = Array.from({ length: rings }, (_, i) => {
    const delay = i === 0 ? '' : ` style="animation-delay:${(-(speed * i / rings)).toFixed(2)}s"`;
    return `<div class="pd-whs-ping"${delay}></div>`;
  }).join('');
  const svgStrokeW = (borderWidth * 100 / (s * 0.7)).toFixed(2);
  const svgR = Math.max(0.5, 50 - Number(svgStrokeW) / 2).toFixed(2);
  const ringSvg = `<svg class="pd-whs-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="${svgR}" fill="none" stroke="rgba(${r},${g},${b},0.92)" stroke-width="${svgStrokeW}" stroke-linecap="round"/></svg>`;
  return `<div class="pd-whs-wrap" style="width:${s}px;height:${s}px;--pd-whs-r:${r};--pd-whs-g:${g};--pd-whs-b:${b};--pd-whs-size:${s}px;--pd-whs-speed:${speed}s;--pd-whs-border:${borderWidth}px"><div class="pd-whs-halo"></div>${ringSvg}${pingDivs}<div class="pd-whs-icon">${glyph}</div></div>`;
}

function hotspotWrapperHtml(innerHtml: string, selected: boolean, hotspotId: string, animation: string, targetSceneId?: string, sceneId?: string) {
  const rawAnimation = String(animation || '').trim().toLowerCase();
  const normalizedAnimation = (!rawAnimation || rawAnimation === 'none' || rawAnimation === 'static') ? 'ping' : rawAnimation;
  const animClass = `pd-anim-${normalizedAnimation}`;
  const targetAttr = targetSceneId ? ` data-hotspot-target="${targetSceneId}"` : '';
  const sceneAttr = sceneId ? ` data-hotspot-scene="${sceneId}"` : '';
  const delSvg = `<svg width="9" height="9" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5L7.5 7.5M7.5 1.5L1.5 7.5" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>`;
  // psv--capture-event tells PSV's EventsHandler to skip its own mousedown drag logic for
  // hotspot elements. Without this, PSV enters its CLICK/MOVING state on every hotspot
  // press and rotates the camera even when we disable mousemove — because PSV uses mousedown
  // (not pointerdown), so stopImmediatePropagation on pointerdown never blocks PSV.
  if (!selected) return `<div data-hotspot-id="${hotspotId}"${targetAttr}${sceneAttr} class="pd-hotspot-wrap psv--capture-event ${animClass}">${innerHtml}</div>`;
  return `<div data-hotspot-id="${hotspotId}"${targetAttr}${sceneAttr} class="pd-hotspot-wrap psv--capture-event ${animClass}">${innerHtml}<button data-hotspot-delete="${hotspotId}" title="Delete hotspot" aria-label="Delete hotspot" class="pd-hotspot-del">${delSvg}</button></div>`;
}

function infoMarkerDataUri(size = 32, color = '#3b82f6') {
  const s = Math.max(18, Number(size) || 32);
  const half = s / 2;
  const innerY = half + Math.max(3, s * 0.12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <circle cx="${half}" cy="${half}" r="${Math.max(8, half - 2)}" fill="${color}" fill-opacity="0.92" stroke="rgba(15,23,42,.4)" stroke-width="2" />
    <text x="${half}" y="${innerY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(11, s * 0.46)}" fill="white">i</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function previewHotspotHtml(
  thumbnailSrc: string,
  label: string,
  size: number,
  iconType: string,
  color: string,
  opacity?: number,
  borderWidth?: number,
  floorCurve?: number,
  pulseSpeed?: number,
  ringCount?: number,
  ringWidth?: number,
) {
  const s = Math.max(88, Math.round((Number(size) || 34) * 2.6));
  const iconSize = Math.max(26, Math.round((Number(size) || 34) * 0.95));
  const thumb = thumbnailSrc
    ? `<div class="pd-hotspot-thumb"><img src="${thumbnailSrc}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center center;transform:scale(1.32);opacity:.85;display:block;" /></div>`
    : `<div class="pd-hotspot-thumb pd-hotspot-thumb-fallback">${escapeHtml(label || 'Scene')}</div>`;
  const iconCore = hotspotHtml(iconType || 'nav-floor', color || '#ffffff', iconSize, opacity, borderWidth, floorCurve, pulseSpeed, ringCount, ringWidth);
  return `
    <div class="pd-hotspot-preview-wrap" style="--pd-preview-thumb-width:${s}px">
      <div class="pd-hotspot-preview-chip">${thumb}</div>
      <div class="pd-hotspot-preview-icon">${iconCore}</div>
    </div>
  `;
}
function editorHotspotHtml(
  thumbnailSrc: string,
  label: string,
  size: number,
  iconType: string,
  color: string,
  opacity?: number,
  borderWidth?: number,
  floorCurve?: number,
  pulseSpeed?: number,
  ringCount?: number,
  ringWidth?: number,
) {
  const s = Math.max(88, Math.round((Number(size) || 34) * 2.6));
  const iconSize = Math.max(26, Math.round((Number(size) || 34) * 0.95));
  const chip = thumbnailSrc
    ? `<div class="pd-hotspot-preview-chip"><img src="${thumbnailSrc}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center center;transform:scale(1.32);opacity:.85;display:block;" /></div>`
    : `<div class="pd-hotspot-preview-chip pd-hotspot-thumb-fallback">${escapeHtml(label || 'Scene')}</div>`;
  const iconCore = hotspotHtml(iconType || 'nav-default', color || '#ffffff', iconSize, opacity, borderWidth, floorCurve, pulseSpeed, ringCount, ringWidth);
  return `<div class="pd-hotspot-preview-wrap pd-editor-hover-wrap" style="--pd-preview-thumb-width:${s}px">${chip}<div class="pd-hotspot-preview-icon">${iconCore}</div></div>`;
}

function normalizeDropSphericalPosition(raw: any): { yaw: number; pitch: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const yawCandidate = typeof raw.yaw === 'number' ? raw.yaw : (typeof raw.longitude === 'number' ? raw.longitude : undefined);
  const pitchCandidate = typeof raw.pitch === 'number' ? raw.pitch : (typeof raw.latitude === 'number' ? raw.latitude : undefined);
  if (!Number.isFinite(yawCandidate) || !Number.isFinite(pitchCandidate)) return null;
  return { yaw: yawCandidate, pitch: pitchCandidate };
}

function hasValidPosition(value: any): value is { yaw: number; pitch: number } {
  return !!value && Number.isFinite(value.yaw) && Number.isFinite(value.pitch);
}

function escapeHtml(value: string | number | undefined | null) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSamePanoramaOrInflight(currentLoadKey: string, panoramaKey: string) {
  return currentLoadKey === panoramaKey || currentLoadKey === `loading:${panoramaKey}`;
}


function withPanoramaLoadTimeout<T>(promise: Promise<T>, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      reject(new Error('Panorama load timed out'));
    }, PANORAMA_LOAD_TIMEOUT_MS);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function clampPitch(value: number) {
  return Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, value));
}

function sceneEntry(scene?: { initialYaw?: number; initialPitch?: number } | null) {
  return {
    yaw: Number.isFinite(Number(scene?.initialYaw)) ? Number(scene?.initialYaw) : 0,
    pitch: clampPitch(Number.isFinite(Number(scene?.initialPitch)) ? Number(scene?.initialPitch) : 0),
  };
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

// Marzipano-style auto-entry: find the return hotspot in the target scene (the one
// pointing back to fromScene) and face the OPPOSITE direction — so you look INTO
// the new space rather than at the door you just came through.
function autoEntryOrientation(
  project: any,
  fromSceneId: string | null | undefined,
  toSceneId: string,
): { yaw: number; pitch: number } | null {
  if (!project || !fromSceneId) return null;
  const toScene = (project.scenes as any[])?.find((s: any) => s.id === toSceneId);
  const returnHotspot = toScene?.hotspots?.find((h: any) => h.targetSceneId === fromSceneId);
  if (returnHotspot && Number.isFinite(Number(returnHotspot.yaw))) {
    return {
      yaw: normalizeYawRadians(Number(returnHotspot.yaw) + Math.PI),
      pitch: clampPitch(Number(returnHotspot.pitch || 0) * 0.25),
    };
  }
  return null;
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

function markerAlphaColor(input: string | undefined, alpha: number) {
  const source = String(input || '').trim();
  const sourceHex = source.startsWith('#') ? source.slice(1) : source;
  if (/^[0-9a-fA-F]{6}$/.test(sourceHex)) {
    const r = parseInt(sourceHex.slice(0, 2), 16);
    const g = parseInt(sourceHex.slice(2, 4), 16);
    const b = parseInt(sourceHex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(sourceHex)) {
    const r = parseInt(sourceHex[0] + sourceHex[0], 16);
    const g = parseInt(sourceHex[1] + sourceHex[1], 16);
    const b = parseInt(sourceHex[2] + sourceHex[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(255,255,255,${alpha})`;
}

function projectedFloorHotspotMarkers(
  hotspot: any,
  project: any,
  sceneId: string,
  selected: boolean,
  tooltip: any,
) {
  const icon = normalizeHotspotIconId(hotspot?.icon || project.hotspotStyle?.iconType || 'nav-default');
  const color = hotspot?.color || project.hotspotStyle?.color || '#ffffff';
  const size = Math.max(32, Math.round(Number(hotspot?.size || project.hotspotStyle?.size || 70)));
  const ringCount = normalizeHotspotRingCount(hotspot?.ringCount ?? project.hotspotStyle?.ringCount, 2);
  const pulseSpeed = normalizeHotspotPulseSpeed(hotspot?.pulseSpeed ?? project.hotspotStyle?.pulseSpeed, 4.0);
  const visualScale = Math.max(0.65, Math.min(2.6, size / 70));
  const baseYawRadius = 0.078 * visualScale;
  const basePitchRadius = baseYawRadius * (icon === 'floor-circle' ? 0.31 : 0.345);
  const ringDelayStep = pulseSpeed / Math.max(1, ringCount);
  const targetSceneId = hotspot?.targetSceneId;
  const markerData = {
    targetSceneId,
    targetYaw: hotspot?.targetYaw,
    targetPitch: hotspot?.targetPitch,
    customTargetView: hotspot?.customTargetView === true,
    transitionType: hotspot?.transitionType,
    transitionDuration: hotspot?.transitionDuration,
    sourceSceneId: sceneId,
    sourceHotspotId: hotspot?.id,
    entryYaw: hotspot?.entryYaw,
    entryPitch: hotspot?.entryPitch,
    navigationMode: hotspot?.navigationMode,
  };

  const coreStrokeWidth = Math.max(2.4, Math.min(5.5, size / 24));
  const coreMarker = {
    id: `${hotspot.id}-floor-core`,
    polyline: projectedFloorRingPoints(
      Number(hotspot.yaw),
      Number(hotspot.pitch),
      baseYawRadius,
      basePitchRadius,
      120,
    ),
    svgStyle: {
      stroke: markerAlphaColor(color, 0.98),
      strokeWidth: String(coreStrokeWidth),
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    },
    className: 'pd-floor-projected-ring pd-floor-projected-ring-core psv--capture-event',
    style: {
      cursor: 'pointer',
      animationDuration: `${pulseSpeed.toFixed(2)}s`,
      filter: `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.12))}px ${markerAlphaColor(color, 0.7)})`,
    },
    tooltip,
    targetSceneId,
    targetYaw: hotspot?.targetYaw,
    targetPitch: hotspot?.targetPitch,
    transitionType: hotspot?.transitionType,
    transitionDuration: hotspot?.transitionDuration,
    sourceHotspotId: hotspot?.id,
    entryYaw: hotspot?.entryYaw,
    entryPitch: hotspot?.entryPitch,
    navigationMode: hotspot?.navigationMode,
    data: markerData,
    zIndex: 12,
  };
  const pingMarkers = Array.from({ length: Math.max(1, ringCount) }, (_, index) => {
    const scale = 1.28 + index * 0.46;
    const alpha = Math.max(0.26, 0.68 - index * 0.12);
    const strokeWidth = Math.max(1.4, Math.min(3.2, size / 42));
    return {
      id: `${hotspot.id}-floor-ping-${index}`,
      polyline: projectedFloorRingPoints(
        Number(hotspot.yaw),
        Number(hotspot.pitch),
        baseYawRadius * scale,
        basePitchRadius * scale,
        120,
      ),
      svgStyle: {
        stroke: markerAlphaColor(color, alpha),
        strokeWidth: String(strokeWidth),
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        fill: 'none',
      },
      className: 'pd-floor-projected-ring pd-floor-projected-ring-ping psv--capture-event',
      style: {
        cursor: 'pointer',
        animationDuration: `${pulseSpeed.toFixed(2)}s`,
        animationDelay: `${(index * ringDelayStep).toFixed(2)}s`,
        filter: `drop-shadow(0 0 ${Math.max(3, Math.round(size * 0.1))}px ${markerAlphaColor(color, 0.55)})`,
      },
      tooltip,
      targetSceneId,
      targetYaw: hotspot?.targetYaw,
      targetPitch: hotspot?.targetPitch,
      transitionType: hotspot?.transitionType,
      transitionDuration: hotspot?.transitionDuration,
      sourceHotspotId: hotspot?.id,
      entryYaw: hotspot?.entryYaw,
      entryPitch: hotspot?.entryPitch,
    navigationMode: hotspot?.navigationMode,
      data: markerData,
      zIndex: 8 + index,
    };
  });
  const hitHtml = `<div class="pd-floor-hotspot-hit" style="--pd-floor-hit-color:${markerAlphaColor(color, 0.96)};--pd-floor-hit-glow:${markerAlphaColor(color, 0.7)};--pd-floor-hit-speed:${pulseSpeed.toFixed(2)}s;--pd-floor-hit-size:${Math.max(42, Math.round(size * 0.72))}px;"></div>`;

  const hitMarker = {
    id: hotspot.id,
    type: 'html',
    html: hotspotWrapperHtml(
      hitHtml,
      selected,
      hotspot.id,
      hotspot.animation || project.hotspotStyle?.animation || 'ping',
      targetSceneId,
      sceneId,
    ),
    position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
    tooltip,
    targetSceneId,
    targetYaw: hotspot?.targetYaw,
    targetPitch: hotspot?.targetPitch,
    transitionType: hotspot?.transitionType,
    transitionDuration: hotspot?.transitionDuration,
    sourceHotspotId: hotspot?.id,
    entryYaw: hotspot?.entryYaw,
    entryPitch: hotspot?.entryPitch,
    navigationMode: hotspot?.navigationMode,
    data: markerData,
    anchor: 'center center',
    zIndex: 20,
  };

  return [coreMarker, ...pingMarkers, hitMarker];
}

const PanoramaViewer = () => {
  type CreateNavigationOptions = {
    promptTargetViewPlacement?: boolean;
    resumeTool?: 'select' | 'hotspot' | 'marker';
    icon?: string;
    navigationMode?: 'original' | 'marzipano' | 'pannellum';
  };

  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewerRef = React.useRef<Viewer | null>(null);
  const detachInertiaRef = React.useRef<(() => void) | null>(null);
  const stopInertiaRef = React.useRef<(() => void) | null>(null);
  const setEnabledInertiaRef = React.useRef<((v: boolean) => void) | null>(null);
  const loadedPanoramaKeyRef = React.useRef('');
  const lastSuccessfulPanoramaRef = React.useRef<{ sceneId: string; key: string } | null>(null);
  const initialPanoramaPendingKeyRef = React.useRef<string | null>(null);
  const initialPanoramaTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const panoramaLoadRequestRef = React.useRef(0);
  const draggingHotspotRef = React.useRef<{
    sceneId: string;
    hotspotId: string;
    pointerId: number;
    startX: number;
    startY: number;
    currentYaw: number;
    currentPitch: number;
    moved: boolean;
  } | null>(null);
  const onDragStartHotspotRef = React.useRef<((evt: PointerEvent) => void) | null>(null);
  const lastHotspotClickRef = React.useRef<{ hotspotId: string; time: number } | null>(null);
  const { project, currentSceneId, selectedId, setSelectedId, setCurrentScene, saveProject, currentMode, addHotspot, updateHotspot } = useProjectStore();
  const { activeTool, setActiveTool } = useEditorStore();
  const { pushToast, openConfirm } = useUiStore();
  const isPanoramaInteractionBlocked = React.useCallback(() => {
    const loadKey = String(loadedPanoramaKeyRef.current || '');
    const state = useProjectStore.getState();
    const activeScene = state.project?.scenes.find((scene) => scene.id === state.currentSceneId);
    if (!activeScene) return true;
    const activeKey = `${activeScene.id}|${activeScene.image}`;
    return loadKey !== activeKey;
  }, []);

  const handleHotspotDelete = React.useCallback((sceneId: string, hotspotId: string, confirmSingle = false) => {
    const state = useProjectStore.getState();
    if (state.currentSceneId !== sceneId) return;
    const scene = state.project?.scenes.find((s) => s.id === sceneId);
    const hotspot = scene?.hotspots.find((h) => h.id === hotspotId) as any;
    const marker = scene?.markers.find((m) => m.id === hotspotId);
    if (!hotspot && !marker) return;
    const linkedId: string | undefined = hotspot?.linkedHotspotId;
    if (!linkedId) {
      const deleteSingle = () => {
        const latest = useProjectStore.getState();
        const latestScene = latest.project?.scenes.find((item) => item.id === sceneId);
        const stillExists = latestScene?.hotspots.some((item) => item.id === hotspotId)
          || latestScene?.markers.some((item) => item.id === hotspotId);
        if (latest.currentSceneId === sceneId && stillExists) {
          latest.deleteObject(sceneId, hotspotId);
        }
      };
      if (!confirmSingle) {
        deleteSingle();
        return;
      }
      openConfirm({
        title: marker ? 'Delete Marker' : 'Delete Hotspot',
        message: `Delete this ${marker ? 'marker' : 'hotspot'}?`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        tone: 'danger',
        onConfirm: deleteSingle,
      });
      return;
    }
    openConfirm({
      title: 'Delete Hotspot',
      message: 'This hotspot has a linked return hotspot in the target scene. Would you like to delete both hotspots, or just this one?',
      confirmLabel: 'Delete Both',
      altLabel: 'Delete This Only',
      cancelLabel: 'Cancel',
      tone: 'danger',
      altTone: 'danger',
      onConfirm: () => {
        const latest = useProjectStore.getState();
        if (latest.currentSceneId === sceneId) {
          latest.deleteObjectAndLinked(sceneId, hotspotId);
        }
      },
      onAlt: () => {
        const latest = useProjectStore.getState();
        if (latest.currentSceneId === sceneId) {
          latest.deleteObject(sceneId, hotspotId);
        }
      },
    });
  }, [openConfirm]);

  const [modalCoords, setModalCoords] = React.useState<{ yaw: number; pitch: number } | null>(null);
  const [modalType, setModalType] = React.useState<'hotspot' | 'marker' | null>(null);
  const [isDragOverViewer, setIsDragOverViewer] = React.useState(false);
  const [isSceneLoading, setIsSceneLoading] = React.useState(false);
  const [failedSceneId, setFailedSceneId] = React.useState<string | null>(null);
  const [targetViewPlacement, setTargetViewPlacement] = React.useState<{
    sourceSceneId: string;
    hotspotId: string;
    targetSceneId: string;
    resumeTool: 'select' | 'hotspot' | 'marker';
  } | null>(null);
const [viewerTick, setViewerTick] = React.useState(0);
  const pendingPreviewTargetRef = React.useRef<string | null>(null);
  const previewTransitioningRef = React.useRef(false);
  const previewEntryFromSceneRef = React.useRef<string | null>(null);
  const previewEntryFromHotspotRef = React.useRef<string | null>(null);
  const previewEntryOrientationRef = React.useRef<{ yaw: number; pitch: number } | null>(null);
  const previewEntryTargetSceneRef = React.useRef<string | null>(null);
  const previewCarryZoomRef = React.useRef<number | null>(null);
  const pendingTransitionRef = React.useRef<{ type: 'fade'; duration: number } | null>(null);
  const preloaderRef = React.useRef(createPanoramaPreloader());
  const preserveEditorZoomOnceRef = React.useRef(false);

  const currentScene = project?.scenes.find((s) => s.id === currentSceneId);
  const resolveTargetSceneEntry = React.useCallback((targetSceneId: string) => {
    const targetScene = project?.scenes.find((scene) => scene.id === targetSceneId);
    return sceneEntry(targetScene);
  }, [project]);
  const isPreview = currentMode === AppMode.PREVIEW;
  const resolveHotspotEntry = React.useCallback((
    sourceSceneId: string | null | undefined,
    targetSceneId: string,
    hotspotConfig: any,
  ) => {
    const modeRaw = String(hotspotConfig?.navigationMode || 'marzipano').toLowerCase();
    const mode = modeRaw === 'marzipano' ? 'marzipano' : modeRaw === 'pannellum' ? 'pannellum' : 'marzipano';
    const hasCustomTargetView = hotspotConfig?.customTargetView === true;
    const explicitEntryYaw = Number(hotspotConfig?.targetYaw);
    const explicitEntryPitch = Number(hotspotConfig?.targetPitch);
    const hasExplicitEntry = Number.isFinite(explicitEntryYaw) && Number.isFinite(explicitEntryPitch);
    if (hasCustomTargetView && hasExplicitEntry) {
      return { yaw: explicitEntryYaw, pitch: clampPitch(explicitEntryPitch) };
    }

    if (mode === 'pannellum') {
      const currentPos = viewerRef.current?.getPosition?.();
      const currentYaw = Number(currentPos?.yaw);
      const currentPitch = Number(currentPos?.pitch);
      const sourceScene = project?.scenes.find((scene) => scene.id === sourceSceneId);
      const targetScene = project?.scenes.find((scene) => scene.id === targetSceneId);
      const sourceNorth = Number.isFinite(Number(sourceScene?.initialYaw)) ? Number(sourceScene?.initialYaw) : 0;
      const targetNorth = Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0;
      const yaw = Number.isFinite(currentYaw)
        ? normalizeYawRadians(currentYaw + sourceNorth - targetNorth)
        : (Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0);
      const pitch = Number.isFinite(currentPitch)
        ? clampPitch(currentPitch)
        : clampPitch(Number.isFinite(Number(targetScene?.initialPitch)) ? Number(targetScene?.initialPitch) : 0);
      return { yaw, pitch };
    }
    if (mode === 'marzipano') {
      return autoEntryOrientation(useProjectStore.getState().project, sourceSceneId, targetSceneId) ?? resolveTargetSceneEntry(targetSceneId);
    }
    if (hasExplicitEntry) return { yaw: explicitEntryYaw, pitch: clampPitch(explicitEntryPitch) };
    return autoEntryOrientation(useProjectStore.getState().project, sourceSceneId, targetSceneId) ?? resolveTargetSceneEntry(targetSceneId);
  }, [project, resolveTargetSceneEntry]);
  const isPreviewRef = React.useRef(isPreview);
  const activeToolRef = React.useRef(activeTool);

  React.useEffect(() => { isPreviewRef.current = isPreview; }, [isPreview]);
  React.useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  const setPreviewControlsEnabled = React.useCallback((enabled: boolean) => {
    setEnabledInertiaRef.current?.(enabled);
    const viewer = viewerRef.current as any;
    if (!viewer) return;
    try {
      viewer?.setOptions?.({ mousewheel: enabled ? SHARED_VIEWER_MOTION.mousewheel : false });
    } catch {
    }
  }, []);
  React.useEffect(() => {
    const viewer = viewerRef.current as any;
    if (!viewer) return;
    const navbar = isPreview ? ['fullscreen'] : false;
    try {
      if (typeof viewer.setOption === 'function') {
        viewer.setOption('navbar', navbar);
      } else if (typeof viewer.setOptions === 'function') {
        viewer.setOptions({ navbar });
      }
    } catch {
    }
  }, [isPreview, viewerTick]);

  const preloadPanorama = React.useCallback(async (sceneId: string, priority = false) => {
    if (!project) return;
    const target = project.scenes.find((s) => s.id === sceneId);
    if (!target) return;
    const src = resolveAssetSrc(project, target.image);
    if (!src) return;
    await preloaderRef.current.preload(src, { priority });
  }, [project]);

  const smoothPreviewNavigate = React.useCallback((targetSceneId: string, marker: any) => {
    const viewer = viewerRef.current as any;
    if (!viewer) return;
    if (previewTransitioningRef.current) return;
    if (targetSceneId === currentSceneId) return;
    void (async () => {
      previewTransitioningRef.current = true;
      setIsSceneLoading(true);
      pendingPreviewTargetRef.current = targetSceneId;
      previewEntryTargetSceneRef.current = targetSceneId;
      previewEntryFromSceneRef.current = currentSceneId || null;
      previewEntryFromHotspotRef.current = String(marker?.config?.sourceHotspotId || marker?.id || '');
      const cfg = marker?.config || {};
      previewEntryOrientationRef.current = resolveHotspotEntry(currentSceneId, targetSceneId, cfg);
      const transitionDuration = Math.max(150, Math.min(5000, Math.round(Number(cfg?.transitionDuration) || SHARED_VIEWER_TRANSITION.duration)));
      pendingTransitionRef.current = { type: 'fade', duration: transitionDuration };
      setPreviewControlsEnabled(false);
      await preloadPanorama(targetSceneId, true);
      previewCarryZoomRef.current = null;
      setCurrentScene(targetSceneId);
    })()
      .catch(() => {
        pendingPreviewTargetRef.current = null;
        previewEntryFromSceneRef.current = null;
        previewEntryFromHotspotRef.current = null;
        previewEntryOrientationRef.current = null;
        previewEntryTargetSceneRef.current = null;
        previewCarryZoomRef.current = null;
        pendingTransitionRef.current = null;
        previewTransitioningRef.current = false;
        setPreviewControlsEnabled(true);
        setIsSceneLoading(false);
      })
      .finally(() => {
      // Intentionally keep transition lock active until setPanorama completes.
      });
  }, [currentSceneId, preloadPanorama, resolveHotspotEntry, setCurrentScene, setPreviewControlsEnabled]);
  const smoothPreviewNavigateRef = React.useRef(smoothPreviewNavigate);
  React.useEffect(() => { smoothPreviewNavigateRef.current = smoothPreviewNavigate; }, [smoothPreviewNavigate]);
  React.useEffect(() => {
    if (!isPreview || !project || !currentScene) return;
    const sceneIds = new Set(project.scenes.map((scene) => scene.id));
    const targetIds = Array.from(new Set(
      (currentScene.hotspots || [])
        .map((hotspot) => String(hotspot.targetSceneId || ''))
        .filter((sceneId) => sceneId && sceneId !== currentScene.id && sceneIds.has(sceneId)),
    ));
    targetIds.forEach((sceneId) => {
      void preloadPanorama(sceneId);
    });
  }, [isPreview, project, currentScene, preloadPanorama]);

  React.useEffect(() => {
    const onViewerPositionRequest = (evt: Event) => {
      const detail = (evt as CustomEvent<{ requestId?: string; expectedSceneId?: string }>).detail;
      if (!detail?.requestId) return;
      const state = useProjectStore.getState();
      const activeScene = state.project?.scenes.find((scene) => scene.id === state.currentSceneId);
      const activeKey = activeScene ? `${activeScene.id}|${activeScene.image}` : '';
      const ownsLoadedScene = !!(
        activeScene
        && loadedPanoramaKeyRef.current === activeKey
        && (!detail.expectedSceneId || detail.expectedSceneId === activeScene.id)
      );
      const pos = ownsLoadedScene ? viewerRef.current?.getPosition?.() : null;
      const yaw = Number(pos?.yaw);
      const pitch = Number(pos?.pitch);
      const payload = Number.isFinite(yaw) && Number.isFinite(pitch)
        ? { yaw, pitch }
        : null;
      window.dispatchEvent(new CustomEvent('viewer-position-response', {
        detail: {
          requestId: detail.requestId,
          sceneId: ownsLoadedScene ? activeScene?.id : null,
          position: payload,
        },
      }));
    };
    window.addEventListener('viewer-position-request', onViewerPositionRequest as EventListener);
    return () => window.removeEventListener('viewer-position-request', onViewerPositionRequest as EventListener);
  }, []);

  const createNavigationHotspot = React.useCallback((targetSceneId: string, yaw: number, pitch: number, label?: string, options?: CreateNavigationOptions) => {
    if (isPanoramaInteractionBlocked()) return false;
    if (!project || !currentSceneId || !targetSceneId) return false;
    if (targetSceneId === currentSceneId) return false;
    const targetScene = project.scenes.find((scene) => scene.id === targetSceneId);
    const sourceScene = project.scenes.find((scene) => scene.id === currentSceneId);
    if (!targetScene) return false;
    if (!sourceScene) return false;
    const hotspotId = uuidv4();
    addHotspot(currentSceneId, {
      id: hotspotId,
      type: 'navigation',
      label: label || `Go to ${targetScene.name}`,
      targetSceneId,
      yaw: Number.isFinite(yaw) ? yaw : 0,
      pitch: Number.isFinite(pitch) ? pitch : 0,
      entryYaw: Number.isFinite(yaw) ? yaw : undefined,
      entryPitch: Number.isFinite(pitch) ? pitch : undefined,
      icon: normalizeHotspotIconId((options as any)?.icon || project.hotspotStyle?.iconType || 'nav-default'),
      animation: project.hotspotStyle?.animation || 'ping',
      color: project.hotspotStyle?.color || '#ffffff',
      opacity: 0.1,
      size: project.hotspotStyle?.size || 70,
      borderWidth: (project.hotspotStyle as any)?.borderWidth || 5,
      pulseSpeed: project.hotspotStyle?.pulseSpeed || 4.0,
      ringCount: project.hotspotStyle?.ringCount || 2,
      navigationMode: (options?.navigationMode || 'marzipano'),
    }, { createReverse: true });
    if (options?.promptTargetViewPlacement === true && targetScene.image) {
      setTargetViewPlacement({
        sourceSceneId: currentSceneId,
        hotspotId,
        targetSceneId,
        resumeTool: options.resumeTool || activeToolRef.current,
      });
    }
    return true;
  }, [project, currentSceneId, addHotspot, isPanoramaInteractionBlocked]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().confirm.open) return;
      if (hasEscapeCloseLayer()) return;
      const active = document.activeElement as HTMLElement | null;
      const targetTag = (active?.tagName || '').toUpperCase();
      const typing = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || !!active?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void saveProject().catch(() => {});
      }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p' && (project?.scenes?.length || 0) > 0) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('request-preview'));
      }
      if (!typing && !isPreviewRef.current && currentSceneId && selectedId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        handleHotspotDelete(currentSceneId, selectedId, true);
      }
      if (!typing && e.altKey && e.key.toLowerCase() === 'v' && currentSceneId && !isPreviewRef.current) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('capture-view'));
      }
      if (!typing && e.altKey && project?.scenes?.length) {
        const idx = project.scenes.findIndex((scene) => scene.id === currentSceneId);
        if (idx >= 0 && e.key === 'ArrowLeft' && idx > 0) {
          e.preventDefault();
          setCurrentScene(project.scenes[idx - 1].id);
        } else if (idx >= 0 && e.key === 'ArrowRight' && idx < project.scenes.length - 1) {
          e.preventDefault();
          setCurrentScene(project.scenes[idx + 1].id);
        }
      }
    };

    const handleCaptureView = () => {
      if (isPanoramaInteractionBlocked()) return;
      if (viewerRef.current && currentSceneId && !isPreviewRef.current) {
        const pos = viewerRef.current.getPosition();
        useProjectStore.getState().updateSceneOrientation(currentSceneId, pos.yaw, pos.pitch);
      }
    };

    const handleResetView = () => {
      if (isPanoramaInteractionBlocked()) return;
      const state = useProjectStore.getState();
      const scene = state.project?.scenes.find((s) => s.id === state.currentSceneId);
      if (!viewerRef.current || !scene) return;
      stopInertiaRef.current?.();
      try { (viewerRef.current as any)?.stopAll?.(); } catch {}
      void (viewerRef.current as any)?.animate?.({
        yaw: scene.initialYaw || 0,
        pitch: scene.initialPitch || 0,
        zoom: scene.initialZoom ?? 20,
        speed: '4rpm',
      });
    };
    const handleToggleViewerFullscreen = () => {
      if (!viewerRef.current) return;
      viewerRef.current.toggleFullscreen();
    };
    const handleDeleteObjectRequest = (event: Event) => {
      const detail = (event as CustomEvent<{
        sceneId?: string;
        objectId?: string;
        confirmSingle?: boolean;
      }>).detail;
      if (!detail?.sceneId || !detail.objectId) return;
      handleHotspotDelete(detail.sceneId, detail.objectId, detail.confirmSingle !== false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('capture-view', handleCaptureView);
    window.addEventListener('reset-view', handleResetView);
    window.addEventListener('toggle-viewer-fullscreen', handleToggleViewerFullscreen);
    window.addEventListener('viewer-delete-object-request', handleDeleteObjectRequest as EventListener);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('capture-view', handleCaptureView);
      window.removeEventListener('reset-view', handleResetView);
      window.removeEventListener('toggle-viewer-fullscreen', handleToggleViewerFullscreen);
      window.removeEventListener('viewer-delete-object-request', handleDeleteObjectRequest as EventListener);
    };
  }, [saveProject, currentSceneId, selectedId, handleHotspotDelete, project?.scenes, setCurrentScene, isPanoramaInteractionBlocked]);

  React.useEffect(() => {
    const onViewerDeleteClick = (evt: MouseEvent) => {
      if (isPanoramaInteractionBlocked()) return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest('[data-hotspot-delete]') as HTMLElement | null;
      if (!btn) return;
      const hotspotId = btn.getAttribute('data-hotspot-delete');
      const state = useProjectStore.getState();
      const sceneId = state.currentSceneId;
      if (!hotspotId || !sceneId) return;
      evt.preventDefault();
      evt.stopPropagation();
      handleHotspotDelete(sceneId, hotspotId);
    };
    const onPreviewHotspotClick = (evt: MouseEvent) => {
      if (isPanoramaInteractionBlocked()) return;
      if (!isPreviewRef.current) return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      const holder = target.closest('[data-hotspot-id]') as HTMLElement | null;
      if (!holder) return;
      const hotspotId = holder.getAttribute('data-hotspot-id');
      if (!hotspotId) return;
      const sceneId = useProjectStore.getState().currentSceneId;
      const scene = useProjectStore.getState().project?.scenes.find((s) => s.id === sceneId);
      const hotspot = scene?.hotspots.find((h) => h.id === hotspotId);
      const targetSceneId = hotspot?.targetSceneId;
      if (!hotspot || !targetSceneId) return;
      evt.preventDefault();
      evt.stopPropagation();
      smoothPreviewNavigate(targetSceneId, {
        config: {
          sourceHotspotId: hotspot.id,
          position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
          targetYaw: (hotspot as any).targetYaw,
          targetPitch: (hotspot as any).targetPitch,
          customTargetView: (hotspot as any).customTargetView === true,
          navigationMode: (hotspot as any).navigationMode,
          transitionType: (hotspot as any).transitionType,
          transitionDuration: (hotspot as any).transitionDuration,
          entryYaw: (hotspot as any).entryYaw,
          entryPitch: (hotspot as any).entryPitch,
        },
      });
    };
    const onEditorHotspotDoubleClick = (evt: MouseEvent) => {
      if (isPanoramaInteractionBlocked()) return;
      if (isPreviewRef.current) return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-hotspot-delete]')) return;
      
      const holder = target.closest('[data-hotspot-id]') as HTMLElement | null;
      if (!holder) return;
      const targetSceneId = holder.getAttribute('data-hotspot-target');
      if (!targetSceneId) return;
      evt.preventDefault();
      evt.stopPropagation();
      setSelectedId(null);
      const hotspotId = holder.getAttribute('data-hotspot-id');
      const sourceSceneId = useProjectStore.getState().currentSceneId;
      const sourceScene = useProjectStore.getState().project?.scenes.find((s) => s.id === sourceSceneId);
      const sourceHotspot = sourceScene?.hotspots.find((h) => h.id === hotspotId);
      const targetScene = project?.scenes.find((s) => s.id === targetSceneId);
      previewEntryOrientationRef.current = resolveHotspotEntry(sourceSceneId, targetSceneId, sourceHotspot as any);
      previewEntryTargetSceneRef.current = targetSceneId;
      previewEntryFromSceneRef.current = sourceSceneId || null;
      previewEntryFromHotspotRef.current = hotspotId;
      pendingTransitionRef.current = {
        type: 'fade',
        duration: Math.max(150, Math.min(5000, Math.round(Number((sourceHotspot as any)?.transitionDuration) || SHARED_VIEWER_TRANSITION.duration))),
      };
      preserveEditorZoomOnceRef.current = true;
      if (targetScene?.image) {
        const preload = new Image();
        preload.src = resolveAssetSrc(project, targetScene.image);
      }
      const viewer = viewerRef.current as any;
      if (!viewer) {
        setCurrentScene(targetSceneId);
        return;
      }
      setCurrentScene(targetSceneId);
    };
    const openTargetViewPlacementFromHotspot = (holder: HTMLElement) => {
      const state = useProjectStore.getState();
      const sourceSceneId = holder.getAttribute('data-hotspot-scene') || state.currentSceneId;
      const hotspotId = holder.getAttribute('data-hotspot-id');
      if (!sourceSceneId || !hotspotId) return false;
      const sourceScene = state.project?.scenes.find((scene) => scene.id === sourceSceneId);
      const hotspot = sourceScene?.hotspots.find((item) => item.id === hotspotId);
      if (!hotspot?.targetSceneId) return false;
      const targetScene = state.project?.scenes.find((scene) => scene.id === hotspot.targetSceneId);
      if (!targetScene?.image) {
        pushToast('error', 'Target scene has no panorama image.');
        return false;
      }
      setTargetViewPlacement({
        sourceSceneId,
        hotspotId,
        targetSceneId: hotspot.targetSceneId,
        resumeTool: activeToolRef.current,
      });
      pushToast('info', 'Click in the target panorama to set entry direction.');
      return true;
    };
    const container = containerRef.current;
    if (!container) return;

    const onDragStartHotspot = (evt: PointerEvent) => {
      if (isPanoramaInteractionBlocked()) return;
      if (isPreviewRef.current) return;
      if (evt.button !== 0 || evt.isPrimary === false) return;
      if (evt.pointerType === 'touch') return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-hotspot-delete]')) return;
      const holder = target.closest('[data-hotspot-id]') as HTMLElement | null;
      const markerConfig = (target as any)?.psvMarker?.config || {};
      const markerData = markerConfig.data || {};
      const projectedHotspotId = markerConfig.sourceHotspotId || markerData.sourceHotspotId;
      if (!holder && !projectedHotspotId) return;
      if (evt.altKey) {
        return;
      }
      if (evt.ctrlKey) {
        const opened = holder ? openTargetViewPlacementFromHotspot(holder) : false;
        if (opened) {
          evt.preventDefault();
          evt.stopPropagation();
        }
        return;
      }
      if (activeToolRef.current !== 'select') return;
      const hotspotId = holder?.getAttribute('data-hotspot-id') || projectedHotspotId;
      if (!hotspotId) return;

      // Double-click detection: native dblclick is unreliable with pointer capture,
      // so we detect two fast presses on the same hotspot and navigate to target scene.
      const now = Date.now();
      const lastClick = lastHotspotClickRef.current;
      if (lastClick && lastClick.hotspotId === hotspotId && now - lastClick.time < 350) {
        lastHotspotClickRef.current = null;
        const targetSceneId = holder?.getAttribute('data-hotspot-target');
        if (targetSceneId) {
          evt.preventDefault();
          evt.stopImmediatePropagation();
          // Replicate preview-style navigation: set entry orientation, transition, preload.
          setSelectedId(null);
          const state = useProjectStore.getState();
          const sourceSceneId = state.currentSceneId;
          const sourceScene = state.project?.scenes.find((s) => s.id === sourceSceneId);
          const sourceHotspot = sourceScene?.hotspots.find((h) => h.id === hotspotId);
          const targetScene = project?.scenes.find((s) => s.id === targetSceneId);
          previewEntryOrientationRef.current = resolveHotspotEntry(sourceSceneId, targetSceneId, sourceHotspot as any);
          previewEntryTargetSceneRef.current = targetSceneId;
          previewEntryFromSceneRef.current = sourceSceneId || null;
          previewEntryFromHotspotRef.current = hotspotId;
          pendingTransitionRef.current = {
            type: 'fade',
            duration: Math.max(150, Math.min(5000, Math.round(Number((sourceHotspot as any)?.transitionDuration) || SHARED_VIEWER_TRANSITION.duration))),
          };
          preserveEditorZoomOnceRef.current = true;
          if (targetScene?.image) {
            const preload = new Image();
            preload.src = resolveAssetSrc(project, targetScene.image);
          }
          setCurrentScene(targetSceneId);
          return;
        }
      } else {
        lastHotspotClickRef.current = { hotspotId, time: now };
      }

      evt.stopImmediatePropagation();
      // Kill any running inertia immediately — inertia's onPointerDown is bubble-phase
      // and never fires here (we stopped propagation), so it can't call stopInertia()
      // itself. Without this, the RAF tick keeps calling viewer.rotate() during drag.
      stopInertiaRef.current?.();
      try { containerRef.current?.setPointerCapture(evt.pointerId); } catch {}
      // Read actual hotspot position so drag initializes at true coords (not 0,0)
      const storeState = useProjectStore.getState();
      const storeScene = storeState.project?.scenes.find((s) => s.id === storeState.currentSceneId);
      if (!storeScene || !storeState.currentSceneId) return;
      const storeHotspot = storeScene?.hotspots.find((h) => h.id === hotspotId)
        || storeScene?.markers.find((m) => m.id === hotspotId);
      draggingHotspotRef.current = {
        sceneId: storeState.currentSceneId,
        hotspotId,
        pointerId: evt.pointerId,
        startX: evt.clientX,
        startY: evt.clientY,
        currentYaw: storeHotspot?.yaw ?? 0,
        currentPitch: storeHotspot?.pitch ?? 0,
        moved: false,
      };
    };

    // Store in ref — the stable pointerdown listener (registered before PSV) calls through this ref.
    // We intentionally do NOT register onDragStartHotspot directly here because Effect A re-runs
    // whenever project changes, which would re-register the listener AFTER PSV's listeners and
    // break the capture-phase ordering (PSV would see pointerdown first on every subsequent drag).
    onDragStartHotspotRef.current = onDragStartHotspot;

    const onEditorHotspotClick = (evt: MouseEvent) => {
      if (isPanoramaInteractionBlocked()) return;
      if (isPreviewRef.current) return;
      if (activeToolRef.current !== 'select') return;
      const target = evt.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-hotspot-delete]')) return;
      const holder = target.closest('[data-hotspot-id]') as HTMLElement | null;
      if (!holder) return;
      const hotspotId = holder.getAttribute('data-hotspot-id');
      if (!hotspotId) return;
      evt.stopPropagation();
      setSelectedId(hotspotId);
    };

    container.addEventListener('click', onViewerDeleteClick, true);
    container.addEventListener('click', onPreviewHotspotClick, true);
    container.addEventListener('click', onEditorHotspotClick, true);
    container.addEventListener('dblclick', onEditorHotspotDoubleClick, true);
    return () => {
      container.removeEventListener('click', onPreviewHotspotClick, true);
      container.removeEventListener('dblclick', onEditorHotspotDoubleClick, true);
      container.removeEventListener('click', onViewerDeleteClick, true);
      container.removeEventListener('click', onEditorHotspotClick, true);
    };
  }, [project, resolveTargetSceneEntry, smoothPreviewNavigate, setCurrentScene, setSelectedId, pushToast, isPanoramaInteractionBlocked]);

  const handleViewerDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (isPreviewRef.current || isPanoramaInteractionBlocked()) {
      setIsDragOverViewer(false);
      return;
    }
    const hasScene = !!((window as any).__panoraDragSceneId
      || e.dataTransfer?.types.includes('application/x-panoradesk-scene-id')
      || e.dataTransfer?.types.includes('text/plain'));
    if (!hasScene) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOverViewer(true);
  }, [isPanoramaInteractionBlocked]);

  const handleViewerDragLeave = React.useCallback(() => {
    setIsDragOverViewer(false);
  }, []);

  const handleViewerDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOverViewer(false);
    const clearDragSceneId = () => {
      (window as any).__panoraDragSceneId = null;
    };

    if (!project || !currentSceneId || isPreviewRef.current || isPanoramaInteractionBlocked() || !viewerRef.current || !containerRef.current) {
      clearDragSceneId();
      return;
    }

    const targetSceneId = e.dataTransfer?.getData('application/x-panoradesk-scene-id')
      || e.dataTransfer?.getData('text/plain')
      || (window as any).__panoraDragSceneId;

    if (!targetSceneId || targetSceneId === currentSceneId) {
      clearDragSceneId();
      return;
    }

    const targetScene = project.scenes.find((scene) => scene.id === targetSceneId);
    if (!targetScene) {
      clearDragSceneId();
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const sphericalRaw = (viewerRef.current as any)?.dataHelper?.viewerCoordsToSphericalCoords(point);
    const spherical = normalizeDropSphericalPosition(sphericalRaw)
      || normalizeDropSphericalPosition((viewerRef.current as any)?.getPosition?.());
    const safeSpherical = spherical || { yaw: 0, pitch: 0 };

    createNavigationHotspot(targetSceneId, safeSpherical.yaw, safeSpherical.pitch, `Go to ${targetScene.name}`, { promptTargetViewPlacement: false });
    clearDragSceneId();
  }, [project, currentSceneId, createNavigationHotspot, isPanoramaInteractionBlocked]);

  // Register the pointerdown drag-start listener ONCE at mount, before the viewer is created,
  // so it is always first in the capture-phase queue. Effect A updates onDragStartHotspotRef
  // whenever project changes; this stable wrapper calls through the ref so we never need to
  // re-register and therefore never fall behind PSV's listeners.
  React.useEffect(() => {
    const dragContainer = containerRef.current;
    if (!dragContainer) return;
    const stable = (evt: PointerEvent) => { onDragStartHotspotRef.current?.(evt); };
    dragContainer.addEventListener('pointerdown', stable, true);
    return () => { dragContainer.removeEventListener('pointerdown', stable, true); };
  }, []);

  React.useEffect(() => {
    if (!containerRef.current || !project || !currentScene?.image) return;
    if (viewerRef.current) return;
    const initialKey = `${currentScene.id}|${currentScene.image}`;
    loadedPanoramaKeyRef.current = `loading:${initialKey}`;
    initialPanoramaPendingKeyRef.current = initialKey;
    setFailedSceneId(null);
    setIsSceneLoading(true);

    const viewer = new Viewer({
      container: containerRef.current,
      panorama: resolveAssetSrc(project, currentScene?.image || ''),
      caption: currentScene?.name || '',
      ...SHARED_VIEWER_MOTION,
      defaultYaw: currentScene?.initialYaw || 0,
      defaultPitch: currentScene?.initialPitch || 0,
      defaultZoomLvl: currentScene?.initialZoom ?? 20,
      loadingTxt: '',
      navbar: isPreviewRef.current ? ['fullscreen'] : false,
      plugins: [[MarkersPlugin, { markers: [] }]],
    });

    viewerRef.current = viewer;
    setViewerTick((n) => n + 1);
    const clearInitialLoadTimeout = () => {
      if (initialPanoramaTimeoutRef.current) {
        clearTimeout(initialPanoramaTimeoutRef.current);
        initialPanoramaTimeoutRef.current = null;
      }
    };
    const ownsInitialPanoramaLoad = () => {
      const state = useProjectStore.getState();
      const activeScene = state.project?.scenes.find((scene) => scene.id === state.currentSceneId);
      return (
        viewerRef.current === viewer
        && initialPanoramaPendingKeyRef.current === initialKey
        && loadedPanoramaKeyRef.current === `loading:${initialKey}`
        && activeScene?.id === currentScene.id
        && `${activeScene.id}|${activeScene.image}` === initialKey
      );
    };
    viewer.addEventListener('panorama-loaded', () => {
      const ownsInitialLoad = ownsInitialPanoramaLoad();
      if (ownsInitialLoad) {
        clearInitialLoadTimeout();
        initialPanoramaPendingKeyRef.current = null;
        loadedPanoramaKeyRef.current = initialKey;
        lastSuccessfulPanoramaRef.current = { sceneId: currentScene.id, key: initialKey };
        setPreviewControlsEnabled(true);
        setIsSceneLoading(false);
        setFailedSceneId(null);
      } else if (initialPanoramaPendingKeyRef.current === initialKey) {
        // The user selected another scene before the constructor panorama settled.
        clearInitialLoadTimeout();
        initialPanoramaPendingKeyRef.current = null;
        if (loadedPanoramaKeyRef.current === `loading:${initialKey}`) {
          loadedPanoramaKeyRef.current = '';
          setPreviewControlsEnabled(true);
          setIsSceneLoading(false);
        }
      }
      setViewerTick((n) => n + 1);
    });
    viewer.addEventListener('panorama-error', () => {
      const ownsInitialLoad = ownsInitialPanoramaLoad();
      if (!ownsInitialLoad) {
        if (initialPanoramaPendingKeyRef.current === initialKey) {
          clearInitialLoadTimeout();
          initialPanoramaPendingKeyRef.current = null;
          if (loadedPanoramaKeyRef.current === `loading:${initialKey}`) {
            loadedPanoramaKeyRef.current = '';
            setPreviewControlsEnabled(true);
            setIsSceneLoading(false);
          }
        }
        // Subsequent loads are owned by their guarded setPanorama promise.
        return;
      }
      clearInitialLoadTimeout();
      initialPanoramaPendingKeyRef.current = null;
      loadedPanoramaKeyRef.current = '';
      try { (viewer as any)?.loader?.hide?.(); } catch {}
      try { viewer.hideError(); } catch {}
      setPreviewControlsEnabled(true);
      setIsSceneLoading(false);
      setFailedSceneId(currentScene.id);
      pushToast('error', 'Failed to load panorama. Check the image file is a valid 360° photo and the path is correct.');
    });

    initialPanoramaTimeoutRef.current = setTimeout(() => {
      initialPanoramaTimeoutRef.current = null;
      const ownsInitialLoad = ownsInitialPanoramaLoad();
      if (!ownsInitialLoad) return;
      initialPanoramaPendingKeyRef.current = null;
      try { (viewer as any)?.textureLoader?.abortLoading?.(); } catch {}
      try { (viewer as any)?.loader?.hide?.(); } catch {}
      try { viewer.hideError(); } catch {}
      loadedPanoramaKeyRef.current = '';
      setPreviewControlsEnabled(true);
      setIsSceneLoading(false);
      setFailedSceneId(currentScene.id);
      pushToast('error', 'Panorama loading timed out. Check the image file or connection, then try again.');
    }, PANORAMA_LOAD_TIMEOUT_MS);

    viewer.addEventListener('click', ({ data }) => {
      if (isPanoramaInteractionBlocked()) return;
      if (isPreviewRef.current) return;
      const normalized = normalizeDropSphericalPosition(data) || normalizeDropSphericalPosition((viewer as any)?.getPosition?.());
      if (!normalized) return;
      const state = useProjectStore.getState();
      const stateProject = state.project;

      const tool = activeToolRef.current;
      if (tool === 'hotspot') {
        if ((stateProject?.scenes?.length || 0) < 2) {
          pushToast('info', 'Add at least one more scene before placing navigation hotspots.');
          return;
        }
        setModalCoords({ yaw: normalized.yaw, pitch: normalized.pitch });
        setModalType('hotspot');
      } else if (tool === 'marker') {
        setModalCoords({ yaw: normalized.yaw, pitch: normalized.pitch });
        setModalType('marker');
      }
    });

    const markersPlugin = viewer.getPlugin(MarkersPlugin);
    markersPlugin.addEventListener('select-marker', ({ marker }) => {
      if (isPanoramaInteractionBlocked()) return;
      const markerConfig = (marker as any)?.config || {};
      const markerData = markerConfig.data || (marker as any)?.data || {};
      const sourceHotspotId = markerConfig.sourceHotspotId || markerData.sourceHotspotId;
      if (!isPreviewRef.current) setSelectedId(sourceHotspotId || marker.id);
      const targetSceneId = markerConfig.targetSceneId || markerData.targetSceneId;
      if (isPreviewRef.current && targetSceneId) {
        smoothPreviewNavigateRef.current(targetSceneId, marker);
      }
    });

    const inertia = attachViewerInertia(viewer as any, containerRef.current as HTMLElement, {
      alphaDragging: SHARED_VIEWER_INERTIA.alphaDragging,
      alphaIdle: SHARED_VIEWER_INERTIA.alphaIdle,
      minFovDeg: SHARED_VIEWER_MOTION.minFov,
      maxFovDeg: SHARED_VIEWER_MOTION.maxFov,
    });
    detachInertiaRef.current = inertia.detach;
    stopInertiaRef.current = inertia.stop;
    setEnabledInertiaRef.current = inertia.setEnabled;
    if (isPanoramaInteractionBlocked()) setPreviewControlsEnabled(false);
  }, [project, currentScene?.id, currentScene?.image, createNavigationHotspot, setActiveTool, setSelectedId, setCurrentScene, pushToast, isPanoramaInteractionBlocked, setPreviewControlsEnabled]);

  React.useEffect(() => {
    const cancelDrag = (evt?: Event, restoreVisual = true) => {
      const drag = draggingHotspotRef.current;
      if (!drag) return;
      if (evt && 'pointerId' in evt && Number((evt as PointerEvent).pointerId) !== drag.pointerId) return;
      try {
        if (containerRef.current?.hasPointerCapture?.(drag.pointerId)) {
          containerRef.current.releasePointerCapture(drag.pointerId);
        }
      } catch {}
      draggingHotspotRef.current = null;
      lastHotspotClickRef.current = null;
      document.body.style.cursor = '';
      stopInertiaRef.current?.();
      if (!isPanoramaInteractionBlocked()) {
        try { (viewerRef.current as any)?.setOptions?.({ mousewheel: SHARED_VIEWER_MOTION.mousewheel }); } catch {}
      }
      // Dragging updates PSV directly for responsiveness. Re-render from the
      // store on cancellation so the visible and persisted positions agree.
      if (restoreVisual && drag.moved && useProjectStore.getState().currentSceneId === drag.sceneId) {
        setViewerTick((value) => value + 1);
      }
    };
    const onHotspotDragMove = (evt: PointerEvent) => {
      const drag = draggingHotspotRef.current;
      if (!drag || !containerRef.current || !viewerRef.current) return;
      if (evt.pointerId !== drag.pointerId) return;
      // Block PSV from seeing this pointermove (capture-phase listener fires first)
      evt.stopImmediatePropagation();
      if (
        isPanoramaInteractionBlocked()
        || useProjectStore.getState().currentSceneId !== drag.sceneId
      ) {
        cancelDrag(evt);
        return;
      }
      const dx = evt.clientX - drag.startX;
      const dy = evt.clientY - drag.startY;
      if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        lastHotspotClickRef.current = null;
        document.body.style.cursor = 'grabbing';
      }
      const rect = containerRef.current.getBoundingClientRect();
      const point = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      const spherical = (viewerRef.current as any)?.dataHelper?.viewerCoordsToSphericalCoords(point);
      if (!spherical || !Number.isFinite(spherical.yaw) || !Number.isFinite(spherical.pitch)) return;
      drag.currentYaw = spherical.yaw;
      drag.currentPitch = spherical.pitch;
      try {
        const markersPlugin = viewerRef.current.getPlugin(MarkersPlugin);
        markersPlugin.updateMarker({ id: drag.hotspotId, position: { yaw: spherical.yaw, pitch: spherical.pitch } } as any);
        const state = useProjectStore.getState();
        const scene = state.project?.scenes.find((s) => s.id === state.currentSceneId);
        const hotspot = scene?.hotspots.find((h) => h.id === drag.hotspotId) as any;
        const icon = normalizeHotspotIconId(hotspot?.icon || state.project?.hotspotStyle?.iconType || 'nav-default');
        if (hotspot && state.project && isProjectedFloorHotspotIcon(icon)) {
          const size = Math.max(32, Math.round(Number(hotspot?.size || state.project.hotspotStyle?.size || 70)));
          const ringCount = normalizeHotspotRingCount(hotspot?.ringCount ?? state.project.hotspotStyle?.ringCount, 2);
          const visualScale = Math.max(0.65, Math.min(2.6, size / 70));
          const baseYawRadius = 0.078 * visualScale;
          const basePitchRadius = baseYawRadius * (icon === 'floor-circle' ? 0.31 : 0.345);
          markersPlugin.updateMarker({
            id: `${drag.hotspotId}-floor-core`,
            polyline: projectedFloorRingPoints(spherical.yaw, spherical.pitch, baseYawRadius, basePitchRadius, 120),
          } as any);
          for (let index = 0; index < ringCount; index += 1) {
            const scale = 1.28 + index * 0.46;
            markersPlugin.updateMarker({
              id: `${drag.hotspotId}-floor-ping-${index}`,
              polyline: projectedFloorRingPoints(spherical.yaw, spherical.pitch, baseYawRadius * scale, basePitchRadius * scale, 120),
            } as any);
          }
        }
      } catch {}
    };
    const onHotspotDragEnd = (evt: PointerEvent) => {
      const drag = draggingHotspotRef.current;
      if (!drag) return;
      if (evt.pointerId !== drag.pointerId) return;
      // Stop PSV from seeing this pointerup — it never saw the pointerdown either,
      // and a stray pointerup leaves PSV's internal pointer-tracking in a broken state
      // that causes the camera to pan on the next mouse move.
      evt.stopImmediatePropagation();
      try { containerRef.current?.releasePointerCapture(evt.pointerId); } catch {}
      draggingHotspotRef.current = null;
      document.body.style.cursor = '';
      const interactionBlocked = isPanoramaInteractionBlocked();
      if (!interactionBlocked) {
        try { (viewerRef.current as any)?.setOptions?.({ mousewheel: SHARED_VIEWER_MOTION.mousewheel }); } catch {}
      }
      if (interactionBlocked || useProjectStore.getState().currentSceneId !== drag.sceneId) return;
      if (!drag.moved) {
        useProjectStore.getState().setSelectedId(drag.hotspotId);
        return;
      }
      const state = useProjectStore.getState();
      const sceneId = drag.sceneId;
      const scene = state.project?.scenes.find((s) => s.id === sceneId);
      if (!scene) return;
      if (scene.hotspots.some((h) => h.id === drag.hotspotId)) {
        state.updateHotspot(sceneId, drag.hotspotId, { yaw: drag.currentYaw, pitch: drag.currentPitch });
      } else if (scene.markers.some((m) => m.id === drag.hotspotId)) {
        state.updateMarker(sceneId, drag.hotspotId, { yaw: drag.currentYaw, pitch: drag.currentPitch });
      }
    };
    // Capture phase on the container so our handlers fire before PSV's bubble-phase
    // listeners. setPointerCapture routes events here even when mouse leaves the element.
    const dragContainer = containerRef.current;
    dragContainer?.addEventListener('pointermove', onHotspotDragMove, true);
    dragContainer?.addEventListener('pointerup', onHotspotDragEnd, true);
    dragContainer?.addEventListener('pointercancel', cancelDrag, true);
    window.addEventListener('blur', cancelDrag);
    return () => {
      cancelDrag(undefined, false);
      dragContainer?.removeEventListener('pointermove', onHotspotDragMove, true);
      dragContainer?.removeEventListener('pointerup', onHotspotDragEnd, true);
      dragContainer?.removeEventListener('pointercancel', cancelDrag, true);
      window.removeEventListener('blur', cancelDrag);
    };
  }, [isPanoramaInteractionBlocked]);

  React.useEffect(() => {
    return () => {
      panoramaLoadRequestRef.current += 1;
      preloaderRef.current.cancelAll();
      document.body.style.cursor = '';
      detachInertiaRef.current?.();
      detachInertiaRef.current = null;
      stopInertiaRef.current = null;
      setEnabledInertiaRef.current = null;
      if (viewerRef.current) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
      loadedPanoramaKeyRef.current = '';
      if (initialPanoramaTimeoutRef.current) clearTimeout(initialPanoramaTimeoutRef.current);
      initialPanoramaTimeoutRef.current = null;
      initialPanoramaPendingKeyRef.current = null;
      lastSuccessfulPanoramaRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!viewerRef.current || !currentScene || !project) {
      // Removing the last scene must also remove the old WebGL texture and
      // marker DOM. Keeping the Viewer alive leaves the deleted panorama
      // orbitable behind the empty-project overlay.
      panoramaLoadRequestRef.current += 1;
      loadedPanoramaKeyRef.current = '';
      lastSuccessfulPanoramaRef.current = null;
      if (initialPanoramaTimeoutRef.current) clearTimeout(initialPanoramaTimeoutRef.current);
      initialPanoramaTimeoutRef.current = null;
      initialPanoramaPendingKeyRef.current = null;
      previewTransitioningRef.current = false;
      pendingPreviewTargetRef.current = null;
      previewEntryFromSceneRef.current = null;
      previewEntryFromHotspotRef.current = null;
      previewEntryOrientationRef.current = null;
      previewEntryTargetSceneRef.current = null;
      previewCarryZoomRef.current = null;
      pendingTransitionRef.current = null;
      preserveEditorZoomOnceRef.current = false;
      document.body.style.cursor = '';
      draggingHotspotRef.current = null;
      detachInertiaRef.current?.();
      detachInertiaRef.current = null;
      stopInertiaRef.current = null;
      setEnabledInertiaRef.current = null;
      const staleViewer = viewerRef.current;
      viewerRef.current = null;
      if (staleViewer) {
        try { (staleViewer as any)?.textureLoader?.abortLoading?.(); } catch {}
        try { staleViewer.getPlugin(MarkersPlugin)?.setMarkers?.([]); } catch {}
        try { staleViewer.destroy(); } catch {}
      }
      setPreviewControlsEnabled(true);
      setIsSceneLoading(false);
      setFailedSceneId(null);
      return;
    }

    if (viewerRef.current && currentScene && project) {
      const panoramaKey = `${currentScene.id}|${currentScene.image}`;
      if (!isSamePanoramaOrInflight(loadedPanoramaKeyRef.current, panoramaKey)) {
        const viewer = viewerRef.current;
        const previousSuccessfulPanorama = lastSuccessfulPanoramaRef.current;
        const loadRequest = ++panoramaLoadRequestRef.current;
        const isCurrentLoad = () => {
          const state = useProjectStore.getState();
          const activeScene = state.project?.scenes.find((scene) => scene.id === state.currentSceneId);
          return (
            panoramaLoadRequestRef.current === loadRequest
            && viewerRef.current === viewer
            && activeScene?.id === currentScene.id
            && `${activeScene.id}|${activeScene.image}` === panoramaKey
          );
        };
        const targetPanorama = resolveAssetSrc(project, currentScene.image);
        const hasPendingEntry = previewEntryTargetSceneRef.current === currentScene.id;
        const usePreviewCarryZoom = isPreviewRef.current
          && hasPendingEntry
          && pendingPreviewTargetRef.current === currentScene.id
          && Number.isFinite(Number(previewCarryZoomRef.current));
        const preserveEditorZoom = !isPreviewRef.current && hasPendingEntry && preserveEditorZoomOnceRef.current;
        const currentZoom = Number(viewerRef.current?.getZoomLevel?.());
        const targetZoom = usePreviewCarryZoom
          ? Number(previewCarryZoomRef.current)
          : (preserveEditorZoom && Number.isFinite(currentZoom))
          ? currentZoom
          : (currentScene.initialZoom ?? 20);
        let entryYaw = Number.isFinite(Number(currentScene.initialYaw)) ? Number(currentScene.initialYaw) : 0;
        let entryPitch = Number.isFinite(Number(currentScene.initialPitch)) ? Number(currentScene.initialPitch) : 0;
        if (hasPendingEntry && previewEntryOrientationRef.current) {
          entryYaw = previewEntryOrientationRef.current.yaw;
          entryPitch = previewEntryOrientationRef.current.pitch;
        }
        if (initialPanoramaTimeoutRef.current) clearTimeout(initialPanoramaTimeoutRef.current);
        initialPanoramaTimeoutRef.current = null;
        initialPanoramaPendingKeyRef.current = null;
        setFailedSceneId(null);
        setModalCoords(null);
        setModalType(null);
        setIsDragOverViewer(false);
        setIsSceneLoading(true);
        loadedPanoramaKeyRef.current = `loading:${panoramaKey}`;
        setPreviewControlsEnabled(false);
        const pendingTransition = hasPendingEntry ? pendingTransitionRef.current : null;
        const fadeDuration = pendingTransition
          ? Math.max(500, Math.min(2000, pendingTransition.duration))
          : SHARED_VIEWER_TRANSITION.duration;
        // PSV skips transition automatically when state.ready is false (first load),
        // so we always pass the fade option and let PSV decide.
        const transitionOption = { speed: fadeDuration, effect: SHARED_VIEWER_TRANSITION.effect, rotation: false };
        void (async () => {
          let loadFailed = false;
          try {
            const completed = await withPanoramaLoadTimeout(
              viewer.setPanorama(targetPanorama, {
                caption: currentScene.name,
                transition: transitionOption as any,
                showLoader: false,
                position: { yaw: entryYaw, pitch: entryPitch },
                defaultYaw: entryYaw,
                defaultPitch: entryPitch,
                zoom: targetZoom,
              }),
              () => {
                // A stale timeout must never abort the texture request owned by a
                // newer rapid scene switch on the same Viewer instance.
                if (!isCurrentLoad()) return;
                try { (viewer as any)?.textureLoader?.abortLoading?.(); } catch {}
                try { (viewer as any)?.state?.transitionAnimation?.cancel?.(); } catch {}
                try { (viewer as any)?.loader?.hide?.(); } catch {}
                try { viewer.hideError(); } catch {}
              },
            );
            if (!isCurrentLoad()) return;
            if (completed === false) {
              loadFailed = true;
              loadedPanoramaKeyRef.current = '';
              if (!isPreviewRef.current) {
                pushToast('error', 'Could not load this panorama image. Verify the file exists and is a valid 360° photo.');
              }
              return;
            }
            loadedPanoramaKeyRef.current = panoramaKey;
            lastSuccessfulPanoramaRef.current = { sceneId: currentScene.id, key: panoramaKey };
            // A pointer press during the previous scene may have left an old target
            // behind. Rebase from the completed panorama before restoring controls.
            stopInertiaRef.current?.();
            viewer.rotate?.({ yaw: entryYaw, pitch: entryPitch });
            if (isPreviewRef.current && pendingPreviewTargetRef.current === currentScene.id) {
              pendingPreviewTargetRef.current = null;
            }
            const sceneZoom = Number.isFinite(Number(currentScene.initialZoom)) ? Number(currentScene.initialZoom) : 20;
            const finalZoom = isPreviewRef.current && usePreviewCarryZoom
              ? Math.max(sceneZoom, Number.isFinite(Number(targetZoom)) ? Number(targetZoom) : sceneZoom)
              : preserveEditorZoom && Number.isFinite(Number(targetZoom))
              ? Number(targetZoom)
              : sceneZoom;
            viewer.zoom?.(finalZoom);
            // Delay marker rendering by one RAF frame so PSV has rendered the new
            // camera position before setMarkers positions the hotspot DOM elements.
            // Without this, markers briefly appear at stale positions then snap.
            requestAnimationFrame(() => {
              if (!isCurrentLoad()) return;
              requestAnimationFrame(() => {
                if (!isCurrentLoad()) return;
                requestAnimationFrame(() => {
                  if (isCurrentLoad()) setViewerTick((n) => n + 1);
                });
              });
            });
          } catch {
            if (!isCurrentLoad()) return;
            loadFailed = true;
            loadedPanoramaKeyRef.current = '';
            try { (viewer as any)?.loader?.hide?.(); } catch {}
            try { viewer.hideError(); } catch {}
            if (!isPreviewRef.current) {
              pushToast('error', 'Could not load this panorama image. Verify the file exists and is a valid 360° photo.');
            }
          } finally {
            // An aborted older request must not unlock input or clear state owned by
            // the newer panorama that replaced it.
            if (!isCurrentLoad()) return;
            previewTransitioningRef.current = false;
            if (pendingPreviewTargetRef.current === currentScene.id) {
              pendingPreviewTargetRef.current = null;
            }
            previewEntryFromSceneRef.current = null;
            previewEntryFromHotspotRef.current = null;
            previewEntryOrientationRef.current = null;
            previewEntryTargetSceneRef.current = null;
            previewCarryZoomRef.current = null;
            pendingTransitionRef.current = null;
            preserveEditorZoomOnceRef.current = false;

            let keepControlsLocked = false;
            if (loadFailed) {
              try { (viewer as any)?.loader?.hide?.(); } catch {}
              const state = useProjectStore.getState();
              const previousScene = previousSuccessfulPanorama
                ? state.project?.scenes.find((scene) => scene.id === previousSuccessfulPanorama.sceneId)
                : null;
              const previousKey = previousScene ? `${previousScene.id}|${previousScene.image}` : '';
              const canReusePreviousPanorama = !!(
                previousScene
                && previousSuccessfulPanorama
                && previousKey === previousSuccessfulPanorama.key
              );
              const canReloadPreviousScene = !!(
                previousScene
                && previousSuccessfulPanorama
                && previousScene.id !== currentScene.id
              );

              // In the editor keep the failing scene selected (so it can be repaired and
              // retried); only preview navigation falls back to the previous scene.
              if (isPreviewRef.current && previousScene && (canReusePreviousPanorama || canReloadPreviousScene)) {
                if (canReusePreviousPanorama && state.project) {
                  // setPanorama updates config before its texture promise settles.
                  // Restore that metadata together with the still-rendered texture.
                  try {
                    const rawViewer = viewer as any;
                    rawViewer.config.panorama = resolveAssetSrc(state.project, previousScene.image);
                    rawViewer.config.caption = previousScene.name;
                    rawViewer.navbar?.setCaption?.(previousScene.name);
                    rawViewer.loader?.hide?.();
                    rawViewer.hideError?.();
                  } catch {}
                }
                loadedPanoramaKeyRef.current = canReusePreviousPanorama ? previousKey : '';
                setFailedSceneId(null);
                keepControlsLocked = !canReusePreviousPanorama;
                state.setCurrentScene(previousScene.id);
                if (canReusePreviousPanorama) setViewerTick((n) => n + 1);
              } else {
                loadedPanoramaKeyRef.current = '';
                setFailedSceneId(currentScene.id);
              }
            }

            setPreviewControlsEnabled(!keepControlsLocked);
            setIsSceneLoading(keepControlsLocked);
          }
        })();
      }
      const markersPlugin = viewerRef.current.getPlugin(MarkersPlugin);

      if (String(loadedPanoramaKeyRef.current || '').startsWith('loading:')) {
        try {
          markersPlugin.setMarkers([]);
        } catch {
          markersPlugin.setMarkers([]);
        }
        return;
      }

      const sceneIds = new Set(project.scenes.map((scene) => scene.id));
      const cleanedHotspotsRaw = currentScene.hotspots.filter((h) => (
        hasValidPosition(h)
        && typeof h.targetSceneId === 'string'
        && h.targetSceneId.length > 0
        && h.targetSceneId !== currentScene.id
        && sceneIds.has(h.targetSceneId)
      ));
      const cleanedMarkersRaw = currentScene.markers.filter((m) => hasValidPosition(m));

      // Render only the valid hotspots/markers (below), but do NOT persist the
      // cleanup here — writing to the store while merely viewing a scene would
      // dirty the project, fire autosave, and add bogus undo steps. Invalid
      // entries are sanitized on load / on the next real edit instead.

      const hotspotMarkers = cleanedHotspotsRaw.flatMap((h): any[] => {
        const target = project.scenes.find((s) => s.id === h.targetSceneId);
        const thumb = target ? resolveAssetSrc(project, target.thumbnail || target.image) : '';
        const labelText = escapeHtml(h.label || target?.name || 'Scene');
        const tooltip = isPreviewRef.current
          ? { content: `<div class="pd-hotspot-mini-label">${labelText}</div>`, position: 'top' as const }
          : undefined;
        const icon = normalizeHotspotIconId(h.icon || project.hotspotStyle?.iconType || 'nav-default');

        if (isProjectedFloorHotspotIcon(icon)) {
          return projectedFloorHotspotMarkers(
            h,
            project,
            currentScene.id,
            !isPreviewRef.current && h.id === selectedId,
            tooltip,
          );
        }

        const hotspotArgs: [number, string, string, number | undefined, number | undefined, number | undefined, number | undefined, number | undefined, number | undefined] = [
          h.size || project.hotspotStyle?.size || 70,
          h.icon || project.hotspotStyle?.iconType || 'nav-default',
          h.color || project.hotspotStyle?.color || '#ffffff',
          h.opacity ?? project.hotspotStyle?.opacity,
          h.borderWidth ?? project.hotspotStyle?.borderWidth,
          h.floorCurve ?? project.hotspotStyle?.floorCurve,
          h.pulseSpeed ?? project.hotspotStyle?.pulseSpeed,
          h.ringCount ?? project.hotspotStyle?.ringCount,
          h.ringWidth ?? project.hotspotStyle?.ringWidth,
        ];
        const markerHtml = isPreviewRef.current
          ? previewHotspotHtml(thumb, h.label || target?.name || 'Scene', ...hotspotArgs)
          : editorHotspotHtml(thumb, h.label || target?.name || 'Scene', ...hotspotArgs);

        return [{
          id: h.id,
          type: 'html',
          html: hotspotWrapperHtml(
            markerHtml,
            !isPreviewRef.current && h.id === selectedId,
            h.id,
            h.animation || project.hotspotStyle?.animation || 'ping',
            h.targetSceneId,
            currentScene.id,
          ),
          position: { yaw: h.yaw, pitch: h.pitch },
          tooltip,
          targetSceneId: h.targetSceneId,
          targetYaw: (h as any).targetYaw,
          targetPitch: (h as any).targetPitch,
          customTargetView: (h as any).customTargetView === true,
          transitionType: (h as any).transitionType,
          transitionDuration: (h as any).transitionDuration,
          sourceHotspotId: h.id,
          entryYaw: (h as any).entryYaw,
          entryPitch: (h as any).entryPitch,
          navigationMode: (h as any).navigationMode,
          anchor: 'center center',
        }];
      });

      const infoMarkers = isPreviewRef.current ? [] : cleanedMarkersRaw.map((m) => ({
        id: m.id,
        type: 'image',
        image: infoMarkerDataUri(32, '#3b82f6'),
        width: 32,
        height: 32,
        position: { yaw: m.yaw, pitch: m.pitch },
        tooltip: { content: m.title, position: 'top' },
      }));

      const psvMarkers = [...hotspotMarkers, ...infoMarkers];
      try {
        markersPlugin.setMarkers(psvMarkers as any);
      } catch {
        markersPlugin.setMarkers([]);
      }
    }
  }, [project, currentSceneId, currentScene?.id, currentScene?.image, currentScene?.hotspots, currentScene?.markers, selectedId, viewerTick, setPreviewControlsEnabled, isPreview]);

  return (
    <>
      <div
        ref={containerRef}
        className="w-full h-full bg-slate-950 relative"
        onDragOver={handleViewerDragOver}
        onDragEnter={handleViewerDragOver}
        onDragLeave={handleViewerDragLeave}
        onDrop={handleViewerDrop}
      />
      {isSceneLoading && (
        <div className="absolute inset-0 z-20 pointer-events-auto flex items-center justify-center bg-slate-950/22 backdrop-blur-[1px]">
          <div className="px-3 py-1.5 rounded-full border border-white/20 bg-slate-900/65 text-[11px] text-white/90 tracking-wide">
            Loading scene...
          </div>
        </div>
      )}
      {!isSceneLoading && !!failedSceneId && failedSceneId === currentSceneId && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/55 backdrop-blur-[1px]">
          <div className="rounded-xl border border-red-400/30 bg-slate-900/90 px-5 py-4 text-center shadow-xl">
            <div className="text-sm font-semibold text-slate-100">Scene could not be loaded</div>
            <div className="mt-1 text-xs text-slate-400">Check the panorama file, then try again.</div>
            <button
              type="button"
              className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
              onClick={() => {
                loadedPanoramaKeyRef.current = '';
                setFailedSceneId(null);
                setViewerTick((n) => n + 1);
              }}
            >
              Retry scene
            </button>
          </div>
        </div>
      )}
      {!isPreview && isDragOverViewer && (
        <div className="absolute inset-6 rounded-2xl border-2 border-dashed border-primary/70 bg-primary/10 pointer-events-none z-30 flex items-center justify-center">
          <div className="px-4 py-2 rounded-lg bg-slate-900/80 text-primary text-sm font-semibold tracking-wide">Drop Scene To Create Hotspot</div>
        </div>
      )}
      {!isPreview && (!project || project.scenes.length === 0) && (
        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center">
          <div className="rounded-xl border border-slate-600 bg-slate-900/80 px-5 py-4 text-center">
            <div className="text-sm font-semibold text-slate-100">No scenes loaded</div>
            <div className="text-xs text-slate-400 mt-1">Import panoramas from the left sidebar to start building your tour.</div>
          </div>
        </div>
      )}
      {!isPreview && currentScene && currentScene.hotspots.length === 0 && project && project.scenes.length > 1 && (
        <div className="absolute left-4 bottom-16 z-20 rounded-lg border border-primary/30 bg-slate-900/85 px-3 py-2 max-w-sm">
          <div className="text-xs font-semibold text-primary">Quick tip</div>
          <div className="text-[11px] text-slate-300 mt-0.5">Drag a scene thumbnail from the left panel into this view to create a linked hotspot.</div>
        </div>
      )}
      {!isPreview && activeTool === 'hotspot' && (
        <div className="absolute right-4 bottom-16 z-20 rounded-lg border border-red-400/30 bg-slate-900/85 px-3 py-2">
          <div className="text-[11px] font-semibold text-red-300">Hotspot Mode</div>
          <div className="text-[11px] text-slate-300">Click in the panorama to add a hotspot.</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Tip: Ctrl + Click = target entry view, Alt + Click = return hotspot position.</div>
        </div>
      )}
      {!isPreview && activeTool === 'marker' && (
        <div className="absolute right-4 bottom-16 z-20 rounded-lg border border-blue-400/30 bg-slate-900/85 px-3 py-2">
          <div className="text-[11px] font-semibold text-blue-300">Marker Mode</div>
          <div className="text-[11px] text-slate-300">Click in the panorama to add an info marker.</div>
        </div>
      )}

      {!isPreview && !isPanoramaInteractionBlocked() && modalCoords && modalType === 'hotspot' && (
          <AddHotspotModal
            sceneId={currentSceneId!}
            coords={modalCoords}
            onCreate={(draft) => {
              createNavigationHotspot(draft.targetSceneId, modalCoords.yaw, modalCoords.pitch, draft.label, {
                promptTargetViewPlacement: false,
                icon: draft.icon,
                navigationMode: draft.navigationMode,
              });
            }}
          onClose={() => { setModalCoords(null); setModalType(null); }}
        />
      )}

      {!isPreview && !isPanoramaInteractionBlocked() && modalCoords && modalType === 'marker' && (
        <AddMarkerModal sceneId={currentSceneId!} coords={modalCoords} onClose={() => { setModalCoords(null); setModalType(null); setActiveTool('select'); }} />
      )}

      {!isPreview && project && targetViewPlacement && (
        <ReturnHotspotPlacementModal
          open={!!targetViewPlacement}
          project={project}
          sourceSceneId={targetViewPlacement.sourceSceneId}
          targetSceneId={targetViewPlacement.targetSceneId}
          onCancel={() => {
            setCurrentScene(targetViewPlacement.sourceSceneId);
            setActiveTool(targetViewPlacement.resumeTool);
            setSelectedId(targetViewPlacement.hotspotId);
            setTargetViewPlacement(null);
            pushToast('info', 'Target entry view skipped. You can set it later from hotspot properties.');
          }}
          onConfirm={(coords) => {
            updateHotspot(targetViewPlacement.sourceSceneId, targetViewPlacement.hotspotId, {
              targetYaw: coords.yaw,
              targetPitch: coords.pitch,
              entryYaw: coords.yaw,
              entryPitch: coords.pitch,
              customTargetView: true,
            });
            setCurrentScene(targetViewPlacement.sourceSceneId);
            setActiveTool(targetViewPlacement.resumeTool);
            setSelectedId(targetViewPlacement.hotspotId);
            setTargetViewPlacement(null);
            pushToast('success', 'Target entry view saved.');
          }}
        />
      )}
    </>
  );
};

export default PanoramaViewer;
