// Compiled by esbuild to electron/vendor/player.js — deployed as assets/app.js in exported tours.
// PSV is a browser global loaded from vendor/psv.js before this script runs.
// All hotspot HTML generation delegates to hotspotRenderer.ts (single source of truth).

import { SHARED_VIEWER_INERTIA, SHARED_VIEWER_MOTION, SHARED_VIEWER_TRANSITION } from '../lib/viewerMotion';
import { attachViewerInertia } from '../lib/viewerInertia';
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
  navigationMode?: 'original' | 'marzipano' | 'pannellum';
}

interface SceneMarker {
  id: string;
  yaw: number;
  pitch: number;
  title?: string;
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

async function boot() {
  // Defensive cache busting for hosted embeds/pages with legacy service workers.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // Ignore cache/SW cleanup failures.
  }

  const response = await fetch('./assets/tour.json');
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

  const first = project.scenes?.[0];
  const plugins: any[] = [
    [MarkersPlugin, { markers: [], clickEventOnMarker: true }],
  ];
  if (GalleryPlugin && galleryEnabled) plugins.push([GalleryPlugin, { visibleOnLoad: false, hideOnClick: false }]);
  if (AutorotatePlugin) plugins.push([AutorotatePlugin, { autostartOnIdle: false, autostartDelay: null, autorotateSpeed: '1rpm' }]);
  if (GyroscopePlugin) plugins.push(GyroscopePlugin);
  if (StereoPlugin) plugins.push(StereoPlugin);

  const viewer = new Viewer({
    container: 'viewer',
    panorama: first?.image,
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
      })
    : null;
  const stopInertia = () => inertia?.stop?.();

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

  let currentSceneId = first?.id || '';
  let hotspotsVisible = true;
  let vrEnabled = !!stereoPlugin?.isEnabled?.();
  let autorotateEnabled = false;
  let galleryVisible = false;
  let navigationInProgress = false;
  let introTimer: ReturnType<typeof setTimeout> | null = null;
  const preloadCache = new Set<string>();
  const preloadInflight = new Set<string>();

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

  async function preloadScenePanorama(sceneId: string) {
    const scene = getSceneById(sceneId);
    if (!scene || !scene.image) return;
    const src = String(scene.image || '');
    if (!src || preloadCache.has(src) || preloadInflight.has(src)) return;
    preloadInflight.add(src);
    await new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { preloadCache.add(src); preloadInflight.delete(src); resolve(); };
      img.onerror = () => { preloadInflight.delete(src); resolve(); };
      img.src = src;
    });
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
    const navMarkers = hotspotsVisible ? (scene.hotspots || []).flatMap((h) => {
      const icon = normalizeHotspotIconId(h?.icon || project.hotspotStyle?.iconType || 'nav-default');
      const color = h?.color || project.hotspotStyle?.color || '#ffffff';
      const size = Math.max(32, Math.round(Number(h?.size || project.hotspotStyle?.size || 70)));
      const markerData = {
        targetSceneId: h.targetSceneId,
        targetYaw: h.targetYaw,
        targetPitch: h.targetPitch,
        customTargetView: h.customTargetView === true,
        navigationMode: h.navigationMode || 'marzipano',
        sourceSceneId: scene.id,
        sourceHotspotId: h.id,
      };

      if (isProjectedFloorIcon(icon)) {
        return buildProjectedFloorMarkers(
          h.yaw, h.pitch, h.id, icon, color, size,
          h?.pulseSpeed ?? project.hotspotStyle?.pulseSpeed,
          h?.ringCount ?? project.hotspotStyle?.ringCount,
          markerData,
          h.label,
        ) as any[];
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
        html: wrapHotspotHtml(innerHtml, animation || ''),
        position: { yaw: h.yaw, pitch: h.pitch },
        anchor: 'center center',
        data: markerData,
      }];
    }) : [];

    const infoMarkers = (scene.markers || []).map((m) => ({
      id: m.id, type: 'image',
      image: m.iconData || FALLBACK_INFO_ICON,
      width: 30, height: 30,
      position: { yaw: m.yaw, pitch: m.pitch },
    }));

    return [...navMarkers, ...infoMarkers];
  }

  // Match the preview: set markers on panorama-loaded + single RAF
  viewer.addEventListener('panorama-loaded', () => {
    if (navigationInProgress) return;
    const scene = getSceneById(currentSceneId);
    if (!scene) return;
    requestAnimationFrame(() => {
      try { markersPlugin.setMarkers(buildSceneMarkers(scene)); } catch { }
    });
  });

  function renderSceneList() {
    if (!sceneList) return;
    sceneList.innerHTML = '';
    const scenes = project.scenes || [];
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
    (project.scenes || []).forEach((scene) => {
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
    autorotateEnabled = !!enabled && !!autorotatePlugin;
    try {
      if (autorotateEnabled) autorotatePlugin?.start?.();
      else autorotatePlugin?.stop?.();
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
    const active = getSceneById(currentSceneId);
    if (active) {
      try { markersPlugin.setMarkers(buildSceneMarkers(active)); } catch { }
    }
  }

  async function toggleVr() {
    if (stereoPlugin?.toggle) {
      try { await stereoPlugin.toggle(); } catch { }
      vrEnabled = !!stereoPlugin?.isEnabled?.();
      applyControlLabels();
      return;
    }
    await toggleFullscreen();
  }

  async function updateScene(sceneId: string, options?: {
    skipTransition?: boolean;
    skipIntro?: boolean;
    entryYaw?: number;
    entryPitch?: number;
  }) {
    if (navigationInProgress && sceneId !== currentSceneId) return;
    const scene = getSceneById(sceneId);
    if (!scene) return;
    navigationInProgress = true;
    stopInertia();
    try { markersPlugin.setMarkers([]); } catch { }
    const prevSceneId = currentSceneId;
    currentSceneId = scene.id; // Set before setPanorama — matches preview pattern
    try {
      const skipTransition = !!options?.skipTransition;
      const skipIntro = !!options?.skipIntro;
      const entryYaw = Number(options?.entryYaw);
      const entryPitch = Number(options?.entryPitch);
      const hasEntry = Number.isFinite(entryYaw) && Number.isFinite(entryPitch);
      const targetYaw = hasEntry ? entryYaw : (scene.initialYaw || 0);
      const targetPitch = hasEntry ? entryPitch : (scene.initialPitch || 0);
      const sceneZoom = Number.isFinite(Number(scene.initialZoom)) ? Number(scene.initialZoom) : 20;

      if (isMobileLike) {
        void preloadScenePanorama(sceneId);
      } else {
        await preloadScenePanorama(sceneId);
      }

      // Always use SHARED_VIEWER_TRANSITION — matches preview exactly
      const transitionOption = skipTransition
        ? false
        : { speed: SHARED_VIEWER_TRANSITION.duration, effect: SHARED_VIEWER_TRANSITION.effect, rotation: false };

      let loadOk = true;
      try {
        await viewer.setPanorama(scene.image, {
          caption: scene.name,
          position: { yaw: targetYaw, pitch: targetPitch },
          defaultYaw: targetYaw,
          defaultPitch: targetPitch,
          transition: transitionOption,
          zoom: sceneZoom,
        });
      } catch {
        currentSceneId = prevSceneId; // Restore on error
        loadOk = false;
      }
      // The panorama didn't switch — don't paint the failed scene's markers,
      // intro, or camera over the scene that's actually still showing.
      if (!loadOk) return;

      try { viewer.rotate({ yaw: targetYaw, pitch: targetPitch }); } catch { }
      viewer.zoom(sceneZoom);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { markersPlugin.setMarkers(buildSceneMarkers(scene)); } catch { }
        });
      });
      if (!skipIntro) showIntro(scene);
      renderSceneList();
      renderFloorPlan();
    } finally {
      navigationInProgress = false;
    }
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
    void updateScene(targetSceneId, { entryYaw: entry.yaw, entryPitch: entry.pitch });
  });

  stereoPlugin?.addEventListener?.('stereo-updated', (event: any) => {
    vrEnabled = !!event?.stereoEnabled;
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
    const scenes = project.scenes || [];
    const idx = scenes.findIndex((s) => s.id === currentSceneId);
    if (idx > 0) { void updateScene(scenes[idx - 1].id); closeMenu(); }
  });
  nextSceneBtn?.addEventListener('click', () => {
    const scenes = project.scenes || [];
    const idx = scenes.findIndex((s) => s.id === currentSceneId);
    if (idx >= 0 && idx < scenes.length - 1) { void updateScene(scenes[idx + 1].id); closeMenu(); }
  });
  document.addEventListener('fullscreenchange', applyControlLabels);

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
  // panorama-loaded listener handles initial markers — no updateScene call needed for first scene
  setTimeout(() => { loadingOverlay.style.display = 'none'; }, project.exportSettings?.showLoadingScreen ? 900 : 0);
}

// Any failure before the tail of boot() used to leave the loading overlay up
// forever — a missing tour.json, a scene-less project, or a file:// origin that
// blocks fetch all produced an endless spinner with no explanation.
boot().catch((err) => {
  console.error('[PanoraDesk 360] Tour failed to load:', err);
  const overlay = document.getElementById('loadingOverlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.innerHTML = '<div class="box">'
    + '<div style="font-size:15px;font-weight:600;margin-bottom:8px">This tour could not be loaded</div>'
    + '<div style="font-size:12px;opacity:.75;max-width:420px;line-height:1.5">'
    + 'The tour data is missing or unreadable. If you opened index.html directly from disk, '
    + 'serve the folder over HTTP instead — browsers block local file access.'
    + '</div></div>';
});
