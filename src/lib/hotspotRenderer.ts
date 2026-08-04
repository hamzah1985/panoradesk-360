// Single source of truth for hotspot HTML generation.
// Used by PanoramaViewer (editor), PreviewPlayer (preview), and the export player.
// No React, no DOM, no PSV imports — pure string-generation functions.

import { normalizeHotspotIconId, hotspotHtmlIconGlyph } from './hotspotGlyphs';

// ── Colour helpers ────────────────────────────────────────────────────────────

export function hexToRgb(color: string): { r: number; g: number; b: number } {
  const raw = String(color || '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
  }
  return { r: 255, g: 255, b: 255 };
}

export function alphaColor(color: string, alpha: number): string {
  const { r, g, b } = hexToRgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Normalisation helpers ─────────────────────────────────────────────────────

export function normalizeFloorCurve(value: unknown, fallback = 0): number {
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0, Math.min(100, Math.round(safeFallback)));
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function normalizePulseSpeed(value: unknown, fallback = 2.4): number {
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 2.4;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(0.8, Math.min(4, Number(safeFallback.toFixed(2))));
  return Math.max(0.8, Math.min(4, Number(num.toFixed(2))));
}

export function normalizeRingCount(value: unknown, fallback = 3): number {
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 3;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(1, Math.min(5, Math.round(safeFallback)));
  return Math.max(1, Math.min(5, Math.round(num)));
}

export function normalizeRingWidth(value: unknown, fallback = 60): number {
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 60;
  const num = Number(value);
  if (!Number.isFinite(num)) return Math.max(30, Math.min(160, Math.round(safeFallback)));
  return Math.max(30, Math.min(160, Math.round(num)));
}

export function normalizeAnimation(value?: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'static') return 'ping';
  return raw;
}

export function clampPitch(value: number): number {
  return Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, value));
}

export function normalizeYaw(yaw: number): number {
  let next = Number.isFinite(yaw) ? yaw : 0;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

export function isProjectedFloorIcon(icon?: string): boolean {
  const id = normalizeHotspotIconId(icon);
  return id === 'floor-pulse-ring' || id === 'floor-circle' || id === 'floor-ring';
}

// ── Projected-floor polyline points ──────────────────────────────────────────

export function projectedFloorRingPoints(
  yaw: number,
  pitch: number,
  yawRadius: number,
  pitchRadius: number,
  segments = 72,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const safePitch = clampPitch(Number.isFinite(pitch) ? pitch : -0.45);
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    points.push([normalizeYaw(safeYaw + Math.cos(theta) * yawRadius), clampPitch(safePitch + Math.sin(theta) * pitchRadius)]);
  }
  return points;
}

// ── Main hotspot inner HTML (no outer wrapper) ────────────────────────────────

export function buildHotspotInnerHtml(
  iconRaw: string | undefined,
  colorRaw: string,
  sizeRaw: number,
  opacityRaw?: number,
  borderWidthRaw?: number,
  floorCurveRaw?: number,
  pulseSpeedRaw?: number,
  ringCountRaw?: number,
  ringWidthRaw?: number,
): string {
  const icon = normalizeHotspotIconId(iconRaw);
  const size = Math.max(32, Math.round(Number(sizeRaw) || 70));
  const opacity = Number.isFinite(Number(opacityRaw)) ? Math.max(0, Math.min(1, Number(opacityRaw))) : 0.1;
  const borderWidth = Math.max(1, Math.min(16, Math.round(Number(borderWidthRaw) || 5)));
  const floorCurve = normalizeFloorCurve(floorCurveRaw, 0);
  const speed = normalizePulseSpeed(pulseSpeedRaw, 4.0);
  const rings = normalizeRingCount(ringCountRaw, 2);
  const ringWidth = normalizeRingWidth(ringWidthRaw, Math.round(size * 0.95));
  const ringDelayStep = speed / Math.max(1, rings);

  const isFloorRing = icon === 'floor-ring';
  const isPulseCore = icon === 'pulse-core';
  const isVistaPulse = icon === 'vista-pulse';
  const isFloorPulseRing = icon === 'floor-pulse-ring';
  const isFloorCircle = icon === 'floor-circle';
  const floorLike = isFloorRing || isFloorPulseRing || isFloorCircle;

  const curveAmount = floorLike ? Math.max(68, floorCurve) : floorCurve;
  const curveRatio = Math.max(0, Math.min(1, curveAmount / 100));
  const curveClass = (floorLike || curveRatio > 0) ? ' pd-hotspot-core-curved' : '';
  const fill = isFloorRing ? 'rgba(255,255,255,0)' : alphaColor(colorRaw, opacity);

  const commonCurveVars = [
    `--pd-hotspot-floor-perspective:${Math.round(180 + curveRatio * 140)}px`,
    `--pd-hotspot-floor-rotate:${(curveRatio * 72).toFixed(2)}deg`,
    `--pd-hotspot-floor-scale-x:${(1 + curveRatio * 0.08).toFixed(3)}`,
    `--pd-hotspot-floor-scale-y:${(1 - curveRatio * 0.44).toFixed(3)}`,
    `--pd-hotspot-floor-shadow:${(curveRatio * 0.22).toFixed(3)}`,
  ].join(';');

  const makeSpanRings = (cls: string) => Array.from({ length: rings }, (_, i) =>
    `<span class="${cls}" style="animation-duration:${speed.toFixed(2)}s;animation-delay:${(i * ringDelayStep).toFixed(2)}s;--pd-ring-size:${ringWidth}px;"></span>`,
  ).join('');

  const baseStyle = `width:${size}px;height:${size}px;--pd-hotspot-size:${size}px;--pd-hotspot-fill:${fill};--pd-hotspot-border:${borderWidth}px;`;

  if (isPulseCore) {
    const pulseStroke = Math.max(1, Math.min(5, Math.round(borderWidth * 0.45)));
    return `<div class="pd-hotspot-core pd-hotspot-core-pulse${curveClass}" style="${baseStyle}--pd-hotspot-pulse-color:${alphaColor(colorRaw, 0.96)};--pd-hotspot-pulse-stroke:${pulseStroke}px;${commonCurveVars}">${makeSpanRings('pd-hotspot-pulse-ring')}<span class="pd-hotspot-pulse-center"></span></div>`;
  }
  if (isVistaPulse) {
    return `<div class="pd-hotspot-core pd-hotspot-core-vista${curveClass}" style="${baseStyle}--pd-hotspot-vista-color:${alphaColor(colorRaw, 0.9)};--pd-hotspot-vista-ring-size:${ringWidth}px;${commonCurveVars}">${makeSpanRings('pd-hotspot-vista-ring')}<span class="pd-hotspot-vista-center"></span></div>`;
  }
  if (isFloorPulseRing) {
    const floorRingHeight = Math.max(12, Math.round(ringWidth * 0.345));
    return `<div class="pd-hotspot-core pd-hotspot-core-floor-pulse${curveClass}" style="${baseStyle}--pd-hotspot-floor-pulse-duration:${speed.toFixed(2)}s;--pd-hotspot-floor-ring-width:${ringWidth}px;--pd-hotspot-floor-ring-height:${floorRingHeight}px;--pd-hotspot-floor-ring-color:${alphaColor(colorRaw, 0.95)};--pd-hotspot-floor-ring-glow:${alphaColor(colorRaw, 0.7)};--pd-hotspot-floor-ring-glow-soft:${alphaColor(colorRaw, 0.35)};--pd-hotspot-floor-shadow-glow:${alphaColor(colorRaw, 0.12)};--pd-hotspot-floor-dot-color:${alphaColor(colorRaw, 0.95)};--pd-hotspot-floor-dot-glow:${alphaColor(colorRaw, 0.6)};${commonCurveVars}"><span class="pd-hotspot-floor-shadow"></span>${makeSpanRings('pd-hotspot-floor-ping')}<span class="pd-hotspot-floor-ring"></span><span class="pd-hotspot-floor-dot"></span></div>`;
  }
  if (isFloorCircle) {
    const floorCircleHeight = Math.max(10, Math.round(ringWidth * 0.31));
    return `<div class="pd-hotspot-core pd-hotspot-core-floor-circle${curveClass}" style="${baseStyle}--pd-hotspot-floor-circle-duration:${speed.toFixed(2)}s;--pd-hotspot-floor-circle-width:${ringWidth}px;--pd-hotspot-floor-circle-height:${floorCircleHeight}px;--pd-hotspot-floor-circle-color:${alphaColor(colorRaw, 0.95)};--pd-hotspot-floor-circle-glow:${alphaColor(colorRaw, 0.7)};--pd-hotspot-floor-circle-soft:${alphaColor(colorRaw, 0.3)};--pd-hotspot-floor-circle-core:${alphaColor(colorRaw, 0.55)};${commonCurveVars}">${makeSpanRings('pd-hotspot-floor-circle-ping')}<span class="pd-hotspot-floor-circle-ring"></span><span class="pd-hotspot-floor-circle-inner"></span><span class="pd-hotspot-floor-circle-dot"></span></div>`;
  }

  // Standard wall-ring hotspot — pd-whs-wrap system (matches preview and editor)
  const { r, g, b } = hexToRgb(colorRaw);
  const svgStrokeW = (borderWidth * 100 / (size * 0.7)).toFixed(2);
  const svgR = Math.max(0.5, 50 - Number(svgStrokeW) / 2).toFixed(2);
  const ringSvg = `<svg class="pd-whs-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="${svgR}" fill="none" stroke="rgba(${r},${g},${b},0.92)" stroke-width="${svgStrokeW}" stroke-linecap="round"/></svg>`;
  const pingDivs = Array.from({ length: rings }, (_, i) => {
    const delay = i === 0 ? '' : ` style="animation-delay:${(-(speed * i / rings)).toFixed(2)}s"`;
    return `<div class="pd-whs-ping"${delay}></div>`;
  }).join('');
  return `<div class="pd-whs-wrap" style="width:${size}px;height:${size}px;--pd-whs-r:${r};--pd-whs-g:${g};--pd-whs-b:${b};--pd-whs-size:${size}px;--pd-whs-speed:${speed}s;--pd-whs-border:${borderWidth}px"><div class="pd-whs-halo"></div>${ringSvg}${pingDivs}<div class="pd-whs-icon">${hotspotHtmlIconGlyph(icon)}</div></div>`;
}

// Outer wrapper — callers add their own extra classes/attrs on top
export function wrapHotspotHtml(innerHtml: string, animation: string, extraClasses = '', extraAttrs = ''): string {
  const anim = normalizeAnimation(animation);
  return `<div class="pd-hotspot-wrap pd-anim-${anim}${extraClasses ? ' ' + extraClasses : ''}"${extraAttrs} style="cursor:pointer;">${innerHtml}</div>`;
}

// ── Projected-floor marker set ────────────────────────────────────────────────

export function buildProjectedFloorMarkers(
  yaw: number,
  pitch: number,
  markerId: string,
  icon: string,
  color: string,
  size: number,
  pulseSpeedRaw: unknown,
  ringCountRaw: unknown,
  markerData: Record<string, unknown>,
  tooltip: unknown,
): unknown[] {
  const rings = normalizeRingCount(ringCountRaw, 2);
  const speed = normalizePulseSpeed(pulseSpeedRaw, 4.0);
  const visualScale = Math.max(0.65, Math.min(2.6, size / 70));
  const baseYawRadius = 0.078 * visualScale;
  const basePitchRadius = baseYawRadius * (icon === 'floor-circle' ? 0.31 : 0.345);
  const ringDelayStep = speed / Math.max(1, rings);

  const core = {
    id: `${markerId}-floor-core`,
    polyline: projectedFloorRingPoints(yaw, pitch, baseYawRadius, basePitchRadius, 120),
    svgStyle: { stroke: alphaColor(color, 0.98), strokeWidth: String(Math.max(2.4, Math.min(5.5, size / 24))), strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
    className: 'pd-floor-projected-ring pd-floor-projected-ring-core',
    style: { cursor: 'pointer', animationDuration: `${speed.toFixed(2)}s`, filter: `drop-shadow(0 0 ${Math.max(4, Math.round(size * 0.12))}px ${alphaColor(color, 0.7)})` },
    tooltip,
    data: markerData,
    zIndex: 12,
  };

  const pings = Array.from({ length: Math.max(1, rings) }, (_, i) => {
    const scale = 1.28 + i * 0.46;
    const alpha = Math.max(0.26, 0.68 - i * 0.12);
    return {
      id: `${markerId}-floor-ping-${i}`,
      polyline: projectedFloorRingPoints(yaw, pitch, baseYawRadius * scale, basePitchRadius * scale, 120),
      svgStyle: { stroke: alphaColor(color, alpha), strokeWidth: String(Math.max(1.4, Math.min(3.2, size / 42))), strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' },
      className: 'pd-floor-projected-ring pd-floor-projected-ring-ping',
      style: { cursor: 'pointer', animationDuration: `${speed.toFixed(2)}s`, animationDelay: `${(i * ringDelayStep).toFixed(2)}s`, filter: `drop-shadow(0 0 ${Math.max(3, Math.round(size * 0.1))}px ${alphaColor(color, 0.55)})` },
      tooltip,
      data: markerData,
      zIndex: 8 + i,
    };
  });

  const hitHtml = `<div class="pd-hotspot-wrap"><div class="pd-floor-hotspot-hit" style="--pd-floor-hit-color:${alphaColor(color, 0.96)};--pd-floor-hit-glow:${alphaColor(color, 0.7)};--pd-floor-hit-speed:${speed.toFixed(2)}s;--pd-floor-hit-size:${Math.max(42, Math.round(size * 0.72))}px;"></div></div>`;
  return [core, ...pings, { id: markerId, type: 'html', html: hitHtml, position: { yaw, pitch }, anchor: 'center center', tooltip, data: markerData, zIndex: 20 }];
}
