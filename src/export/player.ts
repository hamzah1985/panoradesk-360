// Compiled by esbuild to electron/vendor/player.js — deployed as assets/app.js in exported tours.
// PSV is a browser global loaded from vendor/psv.js before this script runs.
// All hotspot HTML generation delegates to hotspotRenderer.ts (single source of truth).

import { SHARED_VIEWER_INERTIA, SHARED_VIEWER_MOTION, SHARED_VIEWER_TRANSITION } from '../lib/viewerMotion';
import { attachViewerInertia } from '../lib/viewerInertia';
import { createPanoramaPreloader, setPanoramaBounded } from '../lib/panoramaLoad';
import {
  buildHotspotInnerHtml,
  wrapHotspotHtml,
  buildProjectedFloorMarkers,
  isProjectedFloorIcon,
  clampPitch,
  normalizeYaw,
} from '../lib/hotspotRenderer';
import { normalizeHotspotIconId } from '../lib/hotspotGlyphs';

declare const PhotoSphereViewer: {
  Viewer: any;
  MarkersPlugin: any;
  GalleryPlugin: any;
  AutorotatePlugin: any;
  GyroscopePlugin: any;
  StereoPlugin: any;
};

interface HotspotData {
  id: string;
  yaw: number;
  pitch: number;
  icon?: string;
  color?: string;
  size?: number;
  opacity?: number;
  borderWidth?: number;
  floorCurve?: number;
  pulseSpeed?: number;
  ringCount?: number;
  ringWidth?: number;
  animation?: string;
  label?: string;
  targetSceneId?: string;
  targetYaw?: number;
  targetPitch?: number;
  customTargetView?: boolean;
  transitionDuration?: number;
  navigationMode?: 'original' | 'marzipano' | 'pannellum';
}

interface SceneMarker {
  id: string;
  yaw: number;
  pitch: number;
  title?: string;
  description?: string;
  image?: string;
  link?: string;
  iconData?: string;
}

interface ProjectScene {
  id: string;
  name?: string;
  image?: string;
  thumbnail?: string;
  initialYaw?: number;
  initialPitch?: number;
  initialZoom?: number;
  introTitle?: string;
  introDescription?: string;
  hotspots?: HotspotData[];
  markers?: SceneMarker[];
  floorPlan?: { x: number; y: number };
}

interface HotspotStyle {
  iconType?: string;
  color?: string;
  size?: number;
  opacity?: number;
  borderWidth?: number;
  floorCurve?: number;
  pulseSpeed?: number;
  ringCount?: number;
  ringWidth?: number;
  animation?: string;
}

interface Project {
  name?: string;
  company?: string;
  logo?: string;
  primaryColor?: string;
  floorPlanImage?: string;
  hotspotStyle?: HotspotStyle;
  exportSettings?: {
    includeBranding?: boolean;
    showLoadingScreen?: boolean;
    showGallery?: boolean;
  };
  scenes?: ProjectScene[];
}

const FALLBACK_INFO_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 10v6"/><circle cx="12" cy="7.5" r="1" fill="#3b82f6"/></svg>',
);
const TOUR_DATA_TIMEOUT_MS = 15_000;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeExternalUrl(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function fetchJsonBounded(url: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TOUR_DATA_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal })
    .catch((error) => {
      if (controller.signal.aborted) {
        throw new Error('Tour data request timed out. Check the connection and try again.');
      }
      throw error;
    })
    .finally(() => window.clearTimeout(timeoutId));
}

async function boot() {
  const response = await fetchJsonBounded('./assets/tour.json');
  if (!response.ok) throw new Error(`Tour data request failed (${response.status})`);
  const project: Project = await response.json();

  document.documentElement.style.setProperty('--accent', project.primaryColor || '#C8A96A');

  const loadingOverlay = document.getElementById('loadingOverlay')!;
  if (!project.exportSettings?.showLoadingScreen) {
    loadingOverlay.style.display = 'none';
  }

  const branding = document.getElementById('branding')!;
  const brandLogo = document.getElementById('brandLogo') as HTMLImageElement;
  const brandTitle = document.getElementById('brandTitle')!;
  const brandSub = document.getElementById('brandSub')!;
  if (project.exportSettings?.includeBranding) {
    branding.hidden = false;
    brandTitle.textContent = project.name || 'PanoraDesk 360';
    brandSub.textContent = project.company || 'Interactive Tour';
    if (project.logo) { brandLogo.hidden = false; brandLogo.src = project.logo; }
  }

  const { Viewer, MarkersPlugin, GalleryPlugin, AutorotatePlugin, GyroscopePlugin, StereoPlugin } = PhotoSphereViewer;
  const galleryEnabled = project.exportSettings?.showGallery !== false;
  const isMobileLike = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)')?.matches);

  const first = (project.scenes || []).find((scene) => !!scene.image);
  const plugins: any[] = [
    [MarkersPlugin, { markers: [], clickEventOnMarker: true }],
  ];
  if (GalleryPlugin && galleryEnabled) plugins.push([GalleryPlugin, { visibleOnLoad: false, hideOnClick: false }]);
  if (AutorotatePlugin) plugins.push([AutorotatePlugin, { autostartOnIdle: false, autostartDelay: null, autorotateSpeed: '1rpm' }]);
  if (GyroscopePlugin) plugins.push(GyroscopePlugin);
  if (StereoPlugin) plugins.push(StereoPlugin);

  const viewer = new Viewer({
    container: 'viewer',
    caption: first?.name,
    defaultZoomLvl: first?.initialZoom ?? 20,
    defaultYaw: first?.initialYaw || 0,
    defaultPitch: first?.initialPitch || 0,
    ...SHARED_VIEWER_MOTION,
    mousemove: isMobileLike ? true : SHARED_VIEWER_MOTION.mousemove,
    moveInertia: isMobileLike ? true : SHARED_VIEWER_MOTION.moveInertia,
    moveSpeed: isMobileLike ? 1.3 : SHARED_VIEWER_MOTION.moveSpeed,
    zoomSpeed: isMobileLike ? 3 : SHARED_VIEWER_MOTION.zoomSpeed,
    minFov: isMobileLike ? 30 : SHARED_VIEWER_MOTION.minFov,
    maxFov: isMobileLike ? 100 : SHARED_VIEWER_MOTION.maxFov,
    touchmove: true,
    touchmoveTwoFingers: false,
    loadingTxt: '',
    defaultTransition: {
      speed: SHARED_VIEWER_TRANSITION.duration,
      effect: SHARED_VIEWER_TRANSITION.effect,
      rotation: false,
    },
    navbar: false,
    plugins,
  });

  const containerEl = document.getElementById('viewer');
  const inertia = (!isMobileLike && containerEl instanceof HTMLElement)
    ? attachViewerInertia(viewer as any, containerEl, {
        alphaDragging: SHARED_VIEWER_INERTIA.alphaDragging,
        alphaIdle: SHARED_VIEWER_INERTIA.alphaIdle,
        minFovDeg: SHARED_VIEWER_MOTION.minFov,
        maxFovDeg: SHARED_VIEWER_MOTION.maxFov,
        onInteractionStart: () => setAutorotate(false),
      })
    : null;
  const stopInertia = () => inertia?.stop?.();
  const stopViewerMotion = (dispatchStopAll = true) => {
    stopInertia();
    try {
      // Native touch momentum is owned by PSV's EventsHandler rather than its
      // public dynamics objects. stopAll dispatches the event that clears it.
      if (dispatchStopAll) void (viewer as any).stopAll?.();
      const dynamics = (viewer as any).dynamics;
      dynamics?.position?.stop?.();
      dynamics?.zoom?.stop?.();
      void viewer.stopAnimation?.();
    } catch { }
  };
  const setNavigationControlsEnabled = (enabled: boolean) => {
    const controlsEnabled = enabled
      && !navigationInProgress
      && !vrChangeInProgress
      && !stereoPlugin?.isEnabled?.()
      && navigationVrDesired !== true;
    inertia?.setEnabled?.(controlsEnabled);
    try {
      viewer.setOptions?.({
        mousewheel: controlsEnabled ? SHARED_VIEWER_MOTION.mousewheel : false,
        mousemove: controlsEnabled ? (isMobileLike ? true : SHARED_VIEWER_MOTION.mousemove) : false,
      });
    } catch { }
  };

  const markersPlugin = viewer.getPlugin(MarkersPlugin);
  const getPluginSafe = (pluginCtor: any) => { try { return pluginCtor ? viewer.getPlugin(pluginCtor) : null; } catch { return null; } };
  const stereoPlugin = getPluginSafe(StereoPlugin);
  const galleryPlugin = galleryEnabled ? getPluginSafe(GalleryPlugin) : null;
  const autorotatePlugin = getPluginSafe(AutorotatePlugin);

  const introBox = document.getElementById('sceneIntro')!;
  const introTitle = document.getElementById('sceneIntroTitle')!;
  const introDescription = document.getElementById('sceneIntroDescription')!;
  const menuToggle = document.getElementById('pdMenuToggle');
  const menuPanel = document.getElementById('pdMenuPanel');
  const menuBackdrop = document.getElementById('pdMenuBackdrop');
  const closeMenuBtn = document.getElementById('pdCloseMenu');
  const floorplanModal = document.getElementById('pdFloorplanModal');
  const floorplanMap = document.getElementById('pdFloorplanMap');
  const openFloorplanBtn = document.getElementById('pdOpenFloorplan') as HTMLButtonElement | null;
  const closeFloorplanBtn = document.getElementById('pdCloseFloorplan');
  const fullscreenBtn = document.getElementById('pdToggleFullscreen');
  const fullscreenFab = document.getElementById('pdFullscreenFab');
  const fullscreenFabIcon = document.getElementById('pdFullscreenFabIcon');
  const hotspotsBtn = document.getElementById('pdToggleHotspots');
  const autorotateBtn = document.getElementById('pdToggleAutorotate') as HTMLButtonElement | null;
  const galleryBtn = document.getElementById('pdToggleGallery') as HTMLButtonElement | null;
  const vrBtn = document.getElementById('pdToggleVr');
  const sceneList = document.getElementById('pdSceneList');
  const sceneCountEl = document.getElementById('pdSceneCount');
  const prevSceneBtn = document.getElementById('pdPrevScene') as HTMLButtonElement | null;
  const nextSceneBtn = document.getElementById('pdNextScene') as HTMLButtonElement | null;

  interface SceneNavigationOptions {
    skipTransition?: boolean;
    skipIntro?: boolean;
    entryYaw?: number;
    entryPitch?: number;
    forceReload?: boolean;
    initialLoad?: boolean;
    forceLoadingOverlay?: boolean;
    transitionDuration?: number;
  }
  interface NavigationRequest {
    id: number;
    sceneId: string;
    options: SceneNavigationOptions;
    resolve: (loaded: boolean) => void;
  }

  let currentSceneId = '';
  let hotspotsVisible = true;
  let vrEnabled = !!stereoPlugin?.isEnabled?.();
  let autorotateEnabled = false;
  let galleryVisible = false;
  let navigationInProgress = false;
  let vrChangeInProgress = false;
  let vrOperationId = 0;
  let vrChangePromise: Promise<boolean> | null = null;
  let navigationRequestId = 0;
  let pendingNavigation: NavigationRequest | null = null;
  let activeNavigation: NavigationRequest | null = null;
  let activeNavigationAbort: AbortController | null = null;
  let navigationWorkerPromise: Promise<void> | null = null;
  let navigationVrDesired: boolean | null = null;
  let introTimer: ReturnType<typeof setTimeout> | null = null;
  const preloader = createPanoramaPreloader();

  function setLoadingOverlay(message: string, force = false) {
    if (!force && !project.exportSettings?.showLoadingScreen) return;
    loadingOverlay.dataset.state = 'loading';
    loadingOverlay.style.display = 'flex';
    loadingOverlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'box';
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    const text = document.createElement('div');
    text.textContent = message;
    box.append(spinner, text);
    loadingOverlay.appendChild(box);
  }

  function hideLoadingOverlay() {
    loadingOverlay.dataset.state = '';
    loadingOverlay.style.display = 'none';
  }

  function showSceneLoadError(scene: ProjectScene, retry: () => void, canDismiss: boolean) {
    loadingOverlay.dataset.state = 'error';
    loadingOverlay.style.display = 'flex';
    loadingOverlay.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'box';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:8px';
    title.textContent = `Could not load ${scene.name || 'this scene'}`;
    const description = document.createElement('div');
    description.style.cssText = 'font-size:12px;opacity:.75;max-width:420px;line-height:1.5;margin-bottom:14px';
    description.textContent = 'The panorama did not finish loading. Check the connection or exported image, then try again.';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:center';
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.textContent = 'Retry';
    retryButton.style.cssText = 'border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:var(--accent);color:#111;font-weight:700';
    retryButton.addEventListener('click', retry, { once: true });
    actions.appendChild(retryButton);
    if (canDismiss) {
      const dismissButton = document.createElement('button');
      dismissButton.type = 'button';
      dismissButton.textContent = 'Return to current scene';
      dismissButton.style.cssText = 'border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:8px 14px;cursor:pointer;background:transparent;color:inherit';
      dismissButton.addEventListener('click', hideLoadingOverlay, { once: true });
      actions.appendChild(dismissButton);
    } else {
      const alternateScene = (project.scenes || []).find((candidate) => candidate.id !== scene.id && !!candidate.image);
      if (alternateScene) {
        const alternateButton = document.createElement('button');
        alternateButton.type = 'button';
        alternateButton.textContent = 'Open another scene';
        alternateButton.style.cssText = 'border:1px solid rgba(255,255,255,.25);border-radius:8px;padding:8px 14px;cursor:pointer;background:transparent;color:inherit';
        alternateButton.addEventListener('click', () => {
          setLoadingOverlay(`Loading ${alternateScene.name || 'scene'}...`, true);
          void updateScene(alternateScene.id, {
            skipTransition: true,
            initialLoad: true,
            forceReload: true,
            forceLoadingOverlay: true,
          });
        }, { once: true });
        actions.appendChild(alternateButton);
      }
    }
    box.append(title, description, actions);
    loadingOverlay.appendChild(box);
  }

  function openMenu() {
    menuPanel?.classList.remove('pdHidden');
    menuBackdrop?.classList.remove('pdHidden');
    if (menuToggle) menuToggle.innerHTML = '&#10005;';
  }

  function closeMenu() {
    menuPanel?.classList.add('pdHidden');
    menuBackdrop?.classList.add('pdHidden');
    if (menuToggle) menuToggle.innerHTML = '&#9776;';
  }

  function getSceneById(sceneId: string) {
    return (project.scenes || []).find((s) => s.id === sceneId) || null;
  }

  function getNavigableScenes() {
    return (project.scenes || []).filter((scene) => !!scene.image);
  }

  async function preloadScenePanorama(sceneId: string, signal?: AbortSignal) {
    const scene = getSceneById(sceneId);
    const src = String(scene?.image || '');
    if (!src) return false;
    // A signal means a navigation is about to show this scene: skip the queue.
    return preloader.preload(src, { signal, priority: !!signal });
  }

  function setBtnState(button: HTMLElement | null, active: boolean) {
    if (!button) return;
    button.classList.toggle('active', !!active);
  }

  function showIntro(scene: ProjectScene) {
    // Cancel the previous scene's hide timer, otherwise navigating mid-intro
    // lets the old timer cut the new scene's intro short.
    if (introTimer) { clearTimeout(introTimer); introTimer = null; }
    if (scene?.introTitle || scene?.introDescription) {
      introTitle.textContent = scene.introTitle || scene.name || '';
      introDescription.textContent = scene.introDescription || '';
      introBox.style.display = 'block';
      introTimer = setTimeout(() => { introBox.style.display = 'none'; introTimer = null; }, 4500);
    } else {
      introBox.style.display = 'none';
    }
  }

  function buildSceneMarkers(scene: ProjectScene) {
    const usedMarkerIds = new Set<string>();
    const validHotspots = (scene.hotspots || []).filter((h) => {
      const id = String(h?.id || '');
      const target = getSceneById(String(h?.targetSceneId || ''));
      if (!id || usedMarkerIds.has(id) || !target?.image || target.id === scene.id) return false;
      if (!Number.isFinite(Number(h?.yaw)) || !Number.isFinite(Number(h?.pitch))) return false;
      usedMarkerIds.add(id);
      return true;
    });
    const navMarkers = hotspotsVisible ? validHotspots.flatMap((h) => {
      const yaw = normalizeYaw(Number(h.yaw));
      const pitch = clampPitch(Number(h.pitch));
      const icon = normalizeHotspotIconId(h?.icon || project.hotspotStyle?.iconType || 'nav-default');
      const color = h?.color || project.hotspotStyle?.color || '#ffffff';
      const sizeValue = Number(h?.size ?? project.hotspotStyle?.size ?? 70);
      const size = Math.max(32, Math.min(240, Math.round(Number.isFinite(sizeValue) ? sizeValue : 70)));
      const label = String(h?.label || '').trim();
      const labelHtml = label
        ? `<div style="margin-top:6px;pointer-events:none;max-width:180px;padding:4px 8px;border-radius:9999px;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.28);box-shadow:0 2px 8px rgba(0,0,0,.35);color:#fff;font-size:11px;font-weight:700;line-height:1.2;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(label)}</div>`
        : '';
      const tooltip = label
        ? { content: escapeHtml(label), position: 'top center' }
        : undefined;
      const markerData = {
        targetSceneId: h.targetSceneId,
        targetYaw: h.targetYaw,
        targetPitch: h.targetPitch,
        customTargetView: h.customTargetView === true,
        transitionDuration: h.transitionDuration,
        navigationMode: h.navigationMode || 'marzipano',
        sourceSceneId: scene.id,
        sourceHotspotId: h.id,
      };

      if (isProjectedFloorIcon(icon)) {
        const projectedMarkers = buildProjectedFloorMarkers(
          yaw, pitch, h.id, icon, color, size,
          h?.pulseSpeed ?? project.hotspotStyle?.pulseSpeed,
          h?.ringCount ?? project.hotspotStyle?.ringCount,
          markerData,
          tooltip,
        ) as any[];
        if (labelHtml) {
          const hitMarker = projectedMarkers.find((marker) => marker?.id === h.id && typeof marker?.html === 'string');
          if (hitMarker) {
            hitMarker.html = `<div style="display:flex;flex-direction:column;align-items:center">${hitMarker.html}${labelHtml}</div>`;
          }
        }
        return projectedMarkers;
      }

      const animation = h?.animation || project.hotspotStyle?.animation;
      const opacity = Number.isFinite(Number(h?.opacity))
        ? Number(h.opacity)
        : Number(project.hotspotStyle?.opacity ?? 0.1);
      const innerHtml = buildHotspotInnerHtml(
        h?.icon || project.hotspotStyle?.iconType,
        color, size, opacity,
        h?.borderWidth ?? project.hotspotStyle?.borderWidth,
        h?.floorCurve ?? project.hotspotStyle?.floorCurve,
        h?.pulseSpeed ?? project.hotspotStyle?.pulseSpeed,
        h?.ringCount ?? project.hotspotStyle?.ringCount,
        h?.ringWidth ?? project.hotspotStyle?.ringWidth,
      );
      return [{
        id: h.id,
        type: 'html',
        html: `<div style="display:flex;flex-direction:column;align-items:center">${wrapHotspotHtml(innerHtml, animation || '')}${labelHtml}</div>`,
        position: { yaw, pitch },
        anchor: 'center center',
        tooltip,
        data: markerData,
      }];
    }) : [];

    const infoMarkers = (scene.markers || []).flatMap((m) => {
      const id = String(m?.id || '');
      if (!id || usedMarkerIds.has(id) || !Number.isFinite(Number(m?.yaw)) || !Number.isFinite(Number(m?.pitch))) {
        return [];
      }
      usedMarkerIds.add(id);
      const title = String(m.title || 'Information').trim() || 'Information';
      const description = String(m.description || '').trim();
      const image = String(m.image || '').trim();
      const link = normalizeExternalUrl(m.link);
      const content = [
        '<div style="max-width:420px;line-height:1.5">',
        image ? `<img src="${escapeHtml(image)}" alt="" style="display:block;width:100%;max-height:240px;object-fit:cover;border-radius:8px;margin-bottom:12px">` : '',
        `<h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(title)}</h2>`,
        description ? `<p style="white-space:pre-wrap;margin:0 0 12px">${escapeHtml(description)}</p>` : '',
        link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-weight:700">Open link</a>` : '',
        '</div>',
      ].join('');
      return {
        id, type: 'image',
        image: m.iconData || FALLBACK_INFO_ICON,
        width: 30, height: 30,
        position: { yaw: normalizeYaw(Number(m.yaw)), pitch: clampPitch(Number(m.pitch)) },
        tooltip: { content: escapeHtml(title), position: 'top center' },
        content,
        listContent: escapeHtml(title),
        data: { infoMarker: true },
      } as any;
    });

    return [...navMarkers, ...infoMarkers];
  }

  function replaceSceneMarkers(scene?: ProjectScene | null) {
    try {
      markersPlugin.setMarkers(scene ? buildSceneMarkers(scene) : []);
      if (stereoPlugin?.isEnabled?.() || navigationVrDesired === true) {
        markersPlugin.hideAllMarkers?.();
      }
    } catch { }
  }

  function syncGallerySelection(sceneId: string) {
    if (!galleryPlugin) return;
    try {
      galleryPlugin.currentId = sceneId || undefined;
      galleryPlugin.gallery?.setActive?.(sceneId || undefined);
    } catch { }
  }

  // Match the preview: set markers on panorama-loaded + single RAF
  viewer.addEventListener('panorama-loaded', () => {
    if (navigationInProgress) return;
    const scene = getSceneById(currentSceneId);
    if (!scene) return;
    requestAnimationFrame(() => {
      if (navigationInProgress || currentSceneId !== scene.id) return;
      replaceSceneMarkers(scene);
    });
  });

  function renderSceneList() {
    if (!sceneList) return;
    sceneList.innerHTML = '';
    const scenes = getNavigableScenes();
    const currentIndex = scenes.findIndex((s) => s.id === currentSceneId);
    if (sceneCountEl) sceneCountEl.textContent = String(scenes.length);
    if (prevSceneBtn) prevSceneBtn.disabled = currentIndex <= 0;
    if (nextSceneBtn) nextSceneBtn.disabled = currentIndex < 0 || currentIndex >= scenes.length - 1;
    scenes.forEach((scene, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pdSceneBtn' + (scene.id === currentSceneId ? ' current' : '');
      btn.textContent = (index + 1) + '. ' + (scene.name || 'Scene');
      btn.addEventListener('click', () => { void updateScene(scene.id); closeMenu(); });
      sceneList!.appendChild(btn);
    });
  }

  function renderFloorPlan() {
    if (!floorplanMap) return;
    if (!project.floorPlanImage) {
      floorplanMap.innerHTML = '<div style="padding:24px;text-align:center;opacity:.8">No floor plan uploaded.</div>';
      return;
    }
    const wrapper = document.createElement('div');
    const image = document.createElement('img');
    wrapper.style.position = 'relative';
    image.src = project.floorPlanImage;
    image.alt = 'Floor plan';
    wrapper.appendChild(image);
    getNavigableScenes().forEach((scene) => {
      if (!scene.floorPlan) return;
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pdFloorPin' + (scene.id === currentSceneId ? ' current' : '');
      pin.style.left = String(scene.floorPlan.x) + '%';
      pin.style.top = String(scene.floorPlan.y) + '%';
      pin.title = scene.name || 'Scene';
      pin.addEventListener('click', (event) => {
        event.preventDefault();
        updateScene(scene.id);
        floorplanModal?.classList.add('pdHidden');
      });
      wrapper.appendChild(pin);
    });
    floorplanMap.innerHTML = '';
    floorplanMap.appendChild(wrapper);
  }

  function applyControlLabels() {
    vrEnabled = stereoPlugin
      ? navigationVrDesired ?? !!stereoPlugin.isEnabled?.()
      : !!document.fullscreenElement;
    if (fullscreenBtn) fullscreenBtn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    if (fullscreenFab) {
      fullscreenFab.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
      fullscreenFab.setAttribute('title', document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen');
    }
    if (fullscreenFabIcon) fullscreenFabIcon.textContent = document.fullscreenElement ? '🗗' : '⛶';
    if (hotspotsBtn) hotspotsBtn.textContent = hotspotsVisible ? 'Hide Hotspots' : 'Show Hotspots';
    if (autorotateBtn) autorotateBtn.textContent = autorotateEnabled ? 'Stop Rotate' : 'Auto Rotate';
    if (galleryBtn) galleryBtn.textContent = galleryVisible ? 'Hide Gallery' : 'Gallery';
    if (vrBtn) vrBtn.textContent = vrEnabled ? 'Exit VR Mode' : 'Enter VR Mode';
    setBtnState(hotspotsBtn, !hotspotsVisible);
    setBtnState(autorotateBtn, autorotateEnabled);
    setBtnState(galleryBtn, galleryVisible);
    setBtnState(vrBtn, vrEnabled);
  }

  function setAutorotate(enabled: boolean) {
    if (enabled && (navigationInProgress || vrChangeInProgress)) return;
    autorotateEnabled = !!enabled && !!autorotatePlugin;
    try {
      if (autorotateEnabled) {
        stopInertia();
        if (stereoPlugin?.isEnabled?.()) {
          void startVrChange(false).then((vrStillEnabled) => {
            if (autorotateEnabled && !navigationInProgress && !stereoPlugin?.isEnabled?.()) {
              autorotatePlugin?.start?.();
            } else if (vrStillEnabled) {
              autorotateEnabled = false;
              applyControlLabels();
            }
          });
        } else if (!navigationInProgress) {
          autorotatePlugin?.start?.();
        }
      } else {
        autorotatePlugin?.stop?.();
      }
    } catch { }
    applyControlLabels();
  }

  function setGalleryVisible(visible: boolean) {
    if (!galleryPlugin) return;
    galleryVisible = !!visible;
    try {
      if (galleryVisible) galleryPlugin.show();
      else galleryPlugin.hide();
    } catch { }
    applyControlLabels();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { }
    applyControlLabels();
  }

  function setHotspotsVisible(visible: boolean) {
    hotspotsVisible = visible !== false;
    applyControlLabels();
    if (navigationInProgress) return;
    const active = getSceneById(currentSceneId);
    if (active) replaceSceneMarkers(active);
  }

  async function applyVrMode(enabled: boolean, operationId: number) {
    if (!stereoPlugin) {
      vrEnabled = false;
      applyControlLabels();
      return false;
    }
    stopInertia();
    setNavigationControlsEnabled(false);
    try {
      if (enabled) {
        setAutorotate(false);
        if (!stereoPlugin.isEnabled?.()) await stereoPlugin.start?.();
      } else if (stereoPlugin.isEnabled?.()) {
        stereoPlugin.stop?.();
      }
    } catch { }
    const actual = !!stereoPlugin.isEnabled?.();
    if (operationId === vrOperationId) {
      vrEnabled = actual;
      if (!actual && !navigationInProgress) {
        replaceSceneMarkers(getSceneById(currentSceneId));
      }
      setNavigationControlsEnabled(!navigationInProgress);
      applyControlLabels();
    }
    return actual;
  }

  function startVrChange(enabled: boolean) {
    if (vrChangePromise) return vrChangePromise;
    const operationId = ++vrOperationId;
    vrChangeInProgress = true;
    const operation = applyVrMode(enabled, operationId).finally(() => {
      if (operationId !== vrOperationId || vrChangePromise !== operation) return;
      vrChangeInProgress = false;
      vrChangePromise = null;
      vrEnabled = !!stereoPlugin?.isEnabled?.();
      if (!vrEnabled && !navigationInProgress) {
        replaceSceneMarkers(getSceneById(currentSceneId));
      }
      setNavigationControlsEnabled(!navigationInProgress);
      applyControlLabels();
    });
    vrChangePromise = operation;
    return operation;
  }

  async function toggleVr() {
    if (navigationInProgress || vrChangePromise || navigationVrDesired !== null) return;
    if (!stereoPlugin) {
      await toggleFullscreen();
      return;
    }
    await startVrChange(!stereoPlugin.isEnabled?.());
  }

  async function finishNavigationVrChain() {
    const desired = navigationVrDesired;
    if (desired === null || pendingNavigation) return;
    if (stereoPlugin) {
      if (desired && !stereoPlugin.isEnabled?.()) {
        try { await startVrChange(true); } catch { }
      } else if (!desired && stereoPlugin.isEnabled?.()) {
        try { stereoPlugin.stop?.(); } catch { }
      }
    }

    // A newer destination can arrive while StereoPlugin is starting. Keep the
    // chain open and immediately leave that transient stereo session so the
    // queued panorama can load before VR is restored for good.
    if (pendingNavigation) {
      if (desired && stereoPlugin?.isEnabled?.()) {
        try { stereoPlugin.stop?.(); } catch { }
      }
      return;
    }

    navigationVrDesired = null;
    vrEnabled = !!stereoPlugin?.isEnabled?.();
  }

  async function performSceneNavigation(sceneId: string, options: SceneNavigationOptions, signal: AbortSignal) {
    if (vrChangePromise) {
      try { await vrChangePromise; } catch { }
    }
    if (signal.aborted) return false;
    const scene = getSceneById(sceneId);
    if (!scene || !scene.image) {
      await finishNavigationVrChain();
      return false;
    }
    if (navigationVrDesired === null) {
      navigationVrDesired = !!stereoPlugin?.isEnabled?.();
    }
    if (!options.forceReload && sceneId === currentSceneId) {
      syncGallerySelection(currentSceneId);
      await finishNavigationVrChain();
      return true;
    }
    const shouldRestoreVr = navigationVrDesired === true;
    const prevSceneId = currentSceneId;
    const previousScene = getSceneById(prevSceneId);
    const previousViewerMetadata = {
      panorama: viewer.config?.panorama ?? previousScene?.image,
      caption: viewer.config?.caption ?? previousScene?.name ?? null,
      description: viewer.config?.description,
      sphereCorrection: viewer.config?.sphereCorrection,
    };
    navigationInProgress = true;
    // Show the loading overlay only if the panorama is not near-instant.
    let loaderTimer: ReturnType<typeof setTimeout> | null = null;
    if (!options.initialLoad && !options.forceLoadingOverlay) {
      loaderTimer = setTimeout(() => {
        loaderTimer = null;
        setLoadingOverlay(`Loading ${scene.name || 'scene'}...`, true);
      }, 300);
    }
    setNavigationControlsEnabled(false);
    try { autorotatePlugin?.stop?.(); } catch { }
    stopViewerMotion(!shouldRestoreVr);
    applyControlLabels();
    replaceSceneMarkers(null);
    if (options.forceLoadingOverlay || loadingOverlay.dataset.state === 'error') {
      setLoadingOverlay(`Loading ${scene.name || 'scene'}...`, true);
    } else if (options.initialLoad) {
      setLoadingOverlay(`Loading ${scene.name || 'scene'}...`);
    }
    const restorePreviousScene = () => {
      currentSceneId = prevSceneId;
      try { viewer.hideError?.(); } catch { }
      try { viewer.loader?.hide?.(); } catch { }
      try {
        if (viewer.config) Object.assign(viewer.config, previousViewerMetadata);
        if (viewer.state) viewer.state.loadingPromise = null;
        viewer.navbar?.setCaption?.(previousViewerMetadata.caption);
      } catch { }
      syncGallerySelection(prevSceneId);
      renderSceneList();
      renderFloorPlan();
    };
    let loaded = false;
    try {
      const skipTransition = !!options?.skipTransition;
      const skipIntro = !!options?.skipIntro;
      const entryYaw = Number(options?.entryYaw);
      const entryPitch = Number(options?.entryPitch);
      const hasEntry = Number.isFinite(entryYaw) && Number.isFinite(entryPitch);
      const targetYaw = hasEntry ? entryYaw : (scene.initialYaw || 0);
      const targetPitch = hasEntry ? entryPitch : (scene.initialPitch || 0);
      const sceneZoom = Number.isFinite(Number(scene.initialZoom)) ? Number(scene.initialZoom) : 20;

      // Preloading is advisory. Adjacent scenes are usually warm already; when
      // they are not, start warming without holding navigation hostage for the
      // preload timeout before PSV gets its own chance to load the image.
      void preloadScenePanorama(sceneId, signal).catch(() => {});
      if (signal.aborted) {
        restorePreviousScene();
        return false;
      }

      // Defaults to SHARED_VIEWER_TRANSITION — matches preview exactly
      const transitionOption = skipTransition
        ? false
        : {
          // Honour the hotspot's own fade time (500-2000 ms, as in the editor).
          speed: Number.isFinite(Number(options?.transitionDuration))
            ? Math.max(500, Math.min(2000, Number(options.transitionDuration)))
            : SHARED_VIEWER_TRANSITION.duration,
          effect: SHARED_VIEWER_TRANSITION.effect,
          rotation: false,
        };

      const loadOk = await setPanoramaBounded(viewer, scene.image, {
        caption: scene.name,
        position: { yaw: targetYaw, pitch: targetPitch },
        defaultYaw: targetYaw,
        defaultPitch: targetPitch,
        transition: transitionOption,
        zoom: sceneZoom,
      }, signal);
      // The panorama didn't switch — don't paint the failed scene's markers,
      // intro, or camera over the scene that's actually still showing.
      if (!loadOk) {
        restorePreviousScene();
        return false;
      }

      stopViewerMotion();
      try { viewer.rotate({ yaw: targetYaw, pitch: targetPitch }); } catch { }
      try { viewer.zoom(sceneZoom); } catch { }
      currentSceneId = scene.id;
      loaded = true;
      syncGallerySelection(scene.id);
      const hasDifferentPendingScene = !!pendingNavigation && pendingNavigation.sceneId !== scene.id;
      if (!skipIntro && !hasDifferentPendingScene) showIntro(scene);
      renderSceneList();
      renderFloorPlan();
      if (!hasDifferentPendingScene) hideLoadingOverlay();
      return true;
    } catch (error) {
      console.error(`[PanoraDesk 360] Scene "${sceneId}" failed to load:`, error);
      restorePreviousScene();
      return false;
    } finally {
      if (loaderTimer) { clearTimeout(loaderTimer); loaderTimer = null; }
      if (!pendingNavigation) await finishNavigationVrChain();
      navigationInProgress = false;
      const displayedScene = getSceneById(currentSceneId);
      replaceSceneMarkers(displayedScene);
      try { markersPlugin.renderMarkers?.(); } catch { }
      setNavigationControlsEnabled(true);
      if (autorotateEnabled && !stereoPlugin?.isEnabled?.()) setAutorotate(true);
      applyControlLabels();
      if (!loaded && !pendingNavigation && !signal.aborted) {
        showSceneLoadError(
          scene,
          () => {
            setLoadingOverlay(`Loading ${scene.name || 'scene'}...`, true);
            void updateScene(scene.id, { ...options, forceReload: true, forceLoadingOverlay: true });
          },
          !!previousScene,
        );
      }
    }
  }

  function startNavigationWorker() {
    if (navigationWorkerPromise) return;
    navigationWorkerPromise = (async () => {
      while (pendingNavigation) {
        const request = pendingNavigation;
        pendingNavigation = null;
        activeNavigation = request;
        const navigationAbort = new AbortController();
        activeNavigationAbort = navigationAbort;
        let loaded = false;
        try {
          loaded = await performSceneNavigation(request.sceneId, request.options, navigationAbort.signal);
        } catch (error) {
          console.error('[PanoraDesk 360] Unexpected navigation failure:', error);
        } finally {
          request.resolve(loaded);
          if (activeNavigation === request) activeNavigation = null;
          if (activeNavigationAbort === navigationAbort) activeNavigationAbort = null;
        }
      }
    })().finally(() => {
      navigationWorkerPromise = null;
      if (pendingNavigation) startNavigationWorker();
    });
  }

  function updateScene(sceneId: string, options: SceneNavigationOptions = {}) {
    if (!getSceneById(sceneId)) return Promise.resolve(false);
    if (
      activeNavigation?.sceneId === sceneId
      && !options.forceReload
      && !activeNavigationAbort?.signal.aborted
    ) {
      // The newest request agrees with the scene already loading. Drop any
      // older queued detour and let this transition finish uninterrupted.
      if (pendingNavigation) pendingNavigation.resolve(false);
      pendingNavigation = null;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      if (pendingNavigation) pendingNavigation.resolve(false);
      pendingNavigation = {
        id: ++navigationRequestId,
        sceneId,
        options,
        resolve,
      };
      // A different latest destination supersedes the active texture request;
      // the worker will start the queued scene as soon as abort cleanup ends.
      if (activeNavigation && activeNavigation.sceneId !== sceneId) {
        activeNavigationAbort?.abort();
      }
      startNavigationWorker();
    });
  }

  markersPlugin.addEventListener('select-marker', ({ marker }: any) => {
    if (navigationInProgress) return;
    const targetSceneId = marker?.data?.targetSceneId || marker?.config?.targetSceneId;
    if (!targetSceneId) return;
    const modeRaw = String(marker?.data?.navigationMode || 'marzipano').toLowerCase();
    const useMarzipano = modeRaw === 'marzipano';
    const usePannellum = modeRaw === 'pannellum';
    const explicitYaw = Number(marker?.data?.targetYaw);
    const explicitPitch = Number(marker?.data?.targetPitch);
    const explicitEntry = marker?.data?.customTargetView === true && Number.isFinite(explicitYaw) && Number.isFinite(explicitPitch)
      ? { yaw: explicitYaw, pitch: clampPitch(explicitPitch) }
      : (!useMarzipano && !usePannellum && Number.isFinite(explicitYaw) && Number.isFinite(explicitPitch)
      ? { yaw: explicitYaw, pitch: clampPitch(explicitPitch) }
      : null);
    const targetScene = getSceneById(targetSceneId);
    const fallbackEntry = {
      yaw: Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0,
      pitch: clampPitch(Number.isFinite(Number(targetScene?.initialPitch)) ? Number(targetScene?.initialPitch) : 0),
    };
    let finalEntry = explicitEntry;
    if (!finalEntry && usePannellum) {
      const currentPos = viewer.getPosition?.();
      const currentYaw = Number(currentPos?.yaw);
      const currentPitch = Number(currentPos?.pitch);
      const sourceScene = getSceneById(currentSceneId);
      const sourceNorth = Number.isFinite(Number(sourceScene?.initialYaw)) ? Number(sourceScene?.initialYaw) : 0;
      const targetNorth = Number.isFinite(Number(targetScene?.initialYaw)) ? Number(targetScene?.initialYaw) : 0;
      finalEntry = {
        yaw: Number.isFinite(currentYaw) ? normalizeYaw(currentYaw + sourceNorth - targetNorth) : fallbackEntry.yaw,
        pitch: Number.isFinite(currentPitch) ? clampPitch(currentPitch) : fallbackEntry.pitch,
      };
    }
    if (!finalEntry) {
      const returnHotspot = (targetScene?.hotspots || []).find((h) => h.targetSceneId === currentSceneId);
      if (returnHotspot && Number.isFinite(Number(returnHotspot.yaw))) {
        finalEntry = {
          yaw: normalizeYaw(Number(returnHotspot.yaw) + Math.PI),
          pitch: clampPitch(Number(returnHotspot.pitch || 0) * 0.25),
        };
      }
    }
    const entry = finalEntry || fallbackEntry;
    const hotspotFade = Number(marker?.data?.transitionDuration);
    void updateScene(targetSceneId, {
      entryYaw: entry.yaw,
      entryPitch: entry.pitch,
      transitionDuration: Number.isFinite(hotspotFade) ? hotspotFade : undefined,
    });
  });

  stereoPlugin?.addEventListener?.('stereo-updated', (event: any) => {
    vrEnabled = navigationVrDesired ?? !!event?.stereoEnabled;
    if (!vrEnabled && !navigationInProgress) {
      replaceSceneMarkers(getSceneById(currentSceneId));
    }
    if (!navigationInProgress && !vrChangeInProgress) setNavigationControlsEnabled(true);
    applyControlLabels();
  });
  autorotatePlugin?.addEventListener?.('autorotate', (event: any) => {
    const active = !!event?.autorotateEnabled;
    if (!navigationInProgress || active) autorotateEnabled = active;
    applyControlLabels();
  });

  menuToggle?.addEventListener('click', () => {
    if (menuPanel?.classList.contains('pdHidden')) openMenu(); else closeMenu();
  });
  closeMenuBtn?.addEventListener('click', closeMenu);
  menuBackdrop?.addEventListener('click', closeMenu);
  openFloorplanBtn?.addEventListener('click', () => {
    if (!project.floorPlanImage) return;
    closeMenu();
    floorplanModal?.classList.remove('pdHidden');
    renderFloorPlan();
  });
  closeFloorplanBtn?.addEventListener('click', () => floorplanModal?.classList.add('pdHidden'));
  floorplanModal?.addEventListener('click', (event) => {
    if (event.target === floorplanModal) floorplanModal.classList.add('pdHidden');
  });
  fullscreenBtn?.addEventListener('click', () => { closeMenu(); void toggleFullscreen(); });
  fullscreenFab?.addEventListener('click', () => { void toggleFullscreen(); });
  hotspotsBtn?.addEventListener('click', () => setHotspotsVisible(!hotspotsVisible));
  autorotateBtn?.addEventListener('click', () => setAutorotate(!autorotateEnabled));
  galleryBtn?.addEventListener('click', () => { setGalleryVisible(!galleryVisible); closeMenu(); });
  vrBtn?.addEventListener('click', () => { void toggleVr(); });
  prevSceneBtn?.addEventListener('click', () => {
    const scenes = getNavigableScenes();
    const requestedSceneId = pendingNavigation?.sceneId || activeNavigation?.sceneId || currentSceneId;
    const idx = scenes.findIndex((s) => s.id === requestedSceneId);
    if (idx > 0) { void updateScene(scenes[idx - 1].id); closeMenu(); }
  });
  nextSceneBtn?.addEventListener('click', () => {
    const scenes = getNavigableScenes();
    const requestedSceneId = pendingNavigation?.sceneId || activeNavigation?.sceneId || currentSceneId;
    const idx = scenes.findIndex((s) => s.id === requestedSceneId);
    if (idx >= 0 && idx < scenes.length - 1) { void updateScene(scenes[idx + 1].id); closeMenu(); }
  });
  document.addEventListener('fullscreenchange', () => {
    window.setTimeout(() => {
      applyControlLabels();
      if (!stereoPlugin?.isEnabled?.() && !navigationInProgress) {
        replaceSceneMarkers(getSceneById(currentSceneId));
        setNavigationControlsEnabled(true);
      }
    }, 0);
  });

  const disableControl = (btn: HTMLButtonElement | null) => {
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '0.45';
  };

  if (!project.floorPlanImage) disableControl(openFloorplanBtn);
  if (!autorotatePlugin) disableControl(autorotateBtn);

  if (galleryPlugin) {
    try {
      // The second argument keeps navigation flowing through updateScene —
      // letting the plugin swap the panorama itself would desync currentSceneId
      // and leave the previous scene's markers on screen.
      galleryPlugin.setItems(
        (project.scenes || []).filter((s) => !!s.image).map((s) => ({
          id: s.id,
          name: s.name,
          panorama: s.image,
          thumbnail: s.thumbnail || s.image,
        })),
        (id: string) => { void updateScene(String(id)); },
      );
      galleryPlugin.hide();
      galleryPlugin.addEventListener?.('show-gallery', () => { galleryVisible = true; applyControlLabels(); });
      galleryPlugin.addEventListener?.('hide-gallery', () => { galleryVisible = false; applyControlLabels(); });
    } catch {
      disableControl(galleryBtn);
    }
  } else {
    disableControl(galleryBtn);
  }

  applyControlLabels();
  renderSceneList();
  renderFloorPlan();
  if (!first?.id || !first.image) {
    throw new Error('This tour does not contain a loadable scene.');
  }
  await updateScene(first.id, {
    skipTransition: true,
    initialLoad: true,
    forceReload: true,
  });
}

// Any failure before the tail of boot() used to leave the loading overlay up
// forever — a missing tour.json, a scene-less project, or a file:// origin that
// blocks fetch all produced an endless spinner with no explanation.
boot().catch((err) => {
  console.error('[PanoraDesk 360] Tour failed to load:', err);
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'box';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:8px';
  title.textContent = 'This tour could not be loaded';
  const description = document.createElement('div');
  description.style.cssText = 'font-size:12px;opacity:.75;max-width:420px;line-height:1.5;margin-bottom:14px';
  description.textContent = err instanceof Error && err.message
    ? err.message
    : 'The tour data is missing or unreadable.';
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;opacity:.6;max-width:420px;line-height:1.5;margin-bottom:14px';
  hint.textContent = 'If index.html was opened directly from disk, serve the exported folder over HTTP instead.';
  const retryButton = document.createElement('button');
  retryButton.type = 'button';
  retryButton.textContent = 'Retry';
  retryButton.style.cssText = 'border:0;border-radius:8px;padding:8px 14px;cursor:pointer;background:var(--accent);color:#111;font-weight:700';
  retryButton.addEventListener('click', () => window.location.reload(), { once: true });
  box.append(title, description, hint, retryButton);
  overlay.appendChild(box);
});
