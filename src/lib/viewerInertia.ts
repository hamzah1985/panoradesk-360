import { SHARED_VIEWER_INERTIA } from './viewerMotion';

type InertiaOptions = {
  flingTauMs?: number;
  flingMaxSpeed?: number;
  alphaDragging?: number;
  alphaIdle?: number;
  minFovDeg?: number;
  maxFovDeg?: number;
  maxPitch?: number;
  onInteractionStart?: () => void;
};

// Capture only once a press is a real drag. This matches the viewer's own click
// threshold (4 * devicePixelRatio); capturing earlier retargets the click.
const CAPTURE_DRAG_THRESHOLD_PX = 4;

// Frame time the tuning constants are expressed against (120 Hz).
const REFERENCE_FRAME_MS = 1000 / 120;

// Release velocity is measured over the last FLING_WINDOW_MS of movement; if the
// pointer rested for FLING_IDLE_MS before release the user stopped on purpose.
const FLING_WINDOW_MS = 100;
const FLING_IDLE_MS = 70;
// Slower than this (rad/ms, about 11 deg/s) is treated as a deliberate stop.
const FLING_MIN_SPEED = 0.0002;
const FLING_END_SPEED = 0.00005;

// Critically damped spring step (the "SmoothDamp" formulation): moves `value`
// toward `target` with continuous velocity, so motion eases in and out instead of
// jumping to full speed. `dt` and `smoothTime` are in ms; velocity is per ms.
function smoothDamp(value: number, target: number, velocity: number, smoothTime: number, dt: number) {
  const omega = 2 / Math.max(1, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = value - target;
  const temp = (velocity + omega * change) * dt;
  return {
    value: target + (change + temp) * decay,
    velocity: (velocity - omega * temp) * decay,
  };
}

// Mouse-wheel zoom: each wheel notch moves the zoom target by this many zoom
// levels (0-100) and the zoom eases toward it with a critically damped spring,
// instead of the viewer's stepped zoom.
const WHEEL_ZOOM_PER_NOTCH = 5;
const WHEEL_ZOOM_SMOOTH_MS = 130;

function clampPitch(value: number, maxPitch: number) {
  return Math.max(-maxPitch, Math.min(maxPitch, value));
}

function shortestYawDelta(target: number, current: number) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function normalizeYaw(v: number) {
  let x = v;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export function attachViewerInertia(viewer: any, container: HTMLElement, options?: InertiaOptions) {
  const alphaDragging = Math.max(0.05, Math.min(0.5, Number(options?.alphaDragging) || 0.14));
  const alphaIdle = Math.max(0.02, Math.min(0.4, Number(options?.alphaIdle) || 0.08));
  const minFovDeg = Number(options?.minFovDeg) || 42;
  const maxFovDeg = Number(options?.maxFovDeg) || 90;
  const maxPitch = Math.max(0.1, Math.min(Math.PI / 2 - 0.02, Number(options?.maxPitch) || (Math.PI / 2 - 0.03)));
  const stopThreshold = 1e-4;
  const flingTauMs = Number.isFinite(Number(options?.flingTauMs)) ? Math.max(0, Number(options?.flingTauMs)) : SHARED_VIEWER_INERTIA.flingTauMs;
  const flingMaxSpeed = (Number.isFinite(Number(options?.flingMaxSpeed)) ? Number(options?.flingMaxSpeed) : SHARED_VIEWER_INERTIA.flingMaxSpeed) / 1000;

  let enabled = true;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let targetYaw: number | null = null;
  let targetPitch: number | null = null;
  let rafId: number | null = null;
  let lastFrameTime: number | null = null;
  let captured = false;
  let downX = 0;
  let downY = 0;
  // Recent applied target movement, used to measure the release velocity.
  let samples: Array<{ t: number; dyaw: number; dpitch: number }> = [];
  // Coasting velocity in rad/ms after release (0 when not flinging).
  let flingYaw = 0;
  let flingPitch = 0;
  // Camera velocity (rad/ms) carried between frames by the spring.
  let camVelYaw = 0;
  let camVelPitch = 0;

  let zoomTarget: number | null = null;
  let zoomVelocity = 0;
  let zoomRafId: number | null = null;
  let zoomLastFrame: number | null = null;

  function stopZoom() {
    if (zoomRafId !== null) {
      cancelAnimationFrame(zoomRafId);
      zoomRafId = null;
    }
    zoomTarget = null;
    zoomVelocity = 0;
    zoomLastFrame = null;
  }

  function zoomTick(frameTime: number) {
    if (zoomTarget === null) {
      zoomRafId = null;
      return;
    }
    const current = Number(viewer?.getZoomLevel?.());
    if (!Number.isFinite(current)) {
      stopZoom();
      return;
    }
    const dt = zoomLastFrame === null
      ? REFERENCE_FRAME_MS
      : Math.max(1, Math.min(50, frameTime - zoomLastFrame));
    zoomLastFrame = frameTime;
    const next = smoothDamp(current, zoomTarget, zoomVelocity, WHEEL_ZOOM_SMOOTH_MS, dt);
    zoomVelocity = next.velocity;
    const settled = Math.abs(zoomTarget - next.value) < 0.02 && Math.abs(zoomVelocity) < 1e-4;
    try {
      viewer.zoom(Math.max(0, Math.min(100, settled ? zoomTarget : next.value)));
    } catch {
      stopZoom();
      return;
    }
    if (settled) {
      stopZoom();
      return;
    }
    zoomRafId = requestAnimationFrame(zoomTick);
  }

  const onWheel = (event: WheelEvent) => {
    // When disabled the call sites also turn the viewer's own wheel zoom off.
    if (!enabled || !event.deltaY) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (zoomTarget === null) {
      const current = Number(viewer?.getZoomLevel?.());
      if (!Number.isFinite(current)) return;
      zoomTarget = current;
      zoomLastFrame = null;
    }
    // Notch = 100px; line-mode wheels report ~3 lines per notch. Clamped so a
    // trackpad flick or a stuck wheel cannot slam the zoom.
    const notches = Math.max(-3, Math.min(3, event.deltaMode === 1 ? event.deltaY / 3 : event.deltaY / 100));
    zoomTarget = Math.max(0, Math.min(100, zoomTarget - notches * WHEEL_ZOOM_PER_NOTCH));
    if (zoomRafId === null) zoomRafId = requestAnimationFrame(zoomTick);
  };

  function resetFling() {
    samples = [];
    flingYaw = 0;
    flingPitch = 0;
  }

  function startFling(now: number) {
    const cutoff = now - FLING_WINDOW_MS;
    const recent = samples.filter((sample) => sample.t >= cutoff);
    samples = [];
    if (flingTauMs <= 0 || recent.length === 0) return;
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (now - last.t > FLING_IDLE_MS) return;
    const span = Math.max(24, last.t - first.t + 16);
    let vYaw = recent.reduce((sum, sample) => sum + sample.dyaw, 0) / span;
    let vPitch = recent.reduce((sum, sample) => sum + sample.dpitch, 0) / span;
    const speed = Math.hypot(vYaw, vPitch);
    if (speed < FLING_MIN_SPEED) return;
    if (speed > flingMaxSpeed) {
      vYaw *= flingMaxSpeed / speed;
      vPitch *= flingMaxSpeed / speed;
    }
    flingYaw = vYaw;
    flingPitch = vPitch;
    startLoop();
  }

  const touchPointers = new Map<number, { x: number; y: number }>();
  let pinching = false;
  let pinchDistance: number | null = null;
  const previousTouchAction = container.style.touchAction;
  container.style.touchAction = 'none';

  function getFovRad() {
    const zoomLvl = Math.max(0, Math.min(100, Number(viewer?.getZoomLevel?.()) || 0));
    const fovDeg = maxFovDeg - (zoomLvl / 100) * (maxFovDeg - minFovDeg);
    return Math.max(0.3, fovDeg) * Math.PI / 180;
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function tick(frameTime: number) {
    if (targetYaw === null || targetPitch === null) {
      rafId = null;
      return;
    }
    const pos = viewer?.getPosition?.();
    const yaw = Number(pos?.yaw);
    const pitch = Number(pos?.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
      rafId = null;
      return;
    }

    // alphaDragging/alphaIdle are the fraction of the gap closed per
    // REFERENCE_FRAME_MS. Scaling by the real frame time keeps the response
    // consistent when frames are slow (GPU busy, other apps rendering) and on
    // high-refresh displays. The delta is clamped so a stall cannot snap the camera.
    const baseAlpha = dragging ? alphaDragging : alphaIdle;
    // Convert the per-frame fraction into a spring smooth time (about 1.8x the
    // equivalent first-order time constant) so the existing tuning still applies.
    const smoothTime = 1.8 * REFERENCE_FRAME_MS / -Math.log(1 - baseAlpha);
    const frameDelta = lastFrameTime === null
      ? REFERENCE_FRAME_MS
      : Math.max(1, Math.min(50, frameTime - lastFrameTime));
    lastFrameTime = frameTime;

    // Coast: after release keep advancing the target with the release velocity,
    // decaying exponentially; the camera then chases it as usual.
    const flinging = !dragging && (flingYaw !== 0 || flingPitch !== 0);
    if (flinging) {
      targetYaw = normalizeYaw(targetYaw + flingYaw * frameDelta);
      const nextPitch = targetPitch + flingPitch * frameDelta;
      targetPitch = clampPitch(nextPitch, maxPitch);
      if (targetPitch !== nextPitch) flingPitch = 0;
      const decay = Math.exp(-frameDelta / flingTauMs);
      flingYaw *= decay;
      flingPitch *= decay;
      if (Math.hypot(flingYaw, flingPitch) < FLING_END_SPEED) {
        flingYaw = 0;
        flingPitch = 0;
      }
    }
    const dyaw = shortestYawDelta(targetYaw, yaw);
    const dpitch = targetPitch - pitch;

    if (
      !dragging && !flinging
      && Math.abs(dyaw) < stopThreshold && Math.abs(dpitch) < stopThreshold
      && Math.hypot(camVelYaw, camVelPitch) < 1e-6
    ) {
      targetYaw = null;
      targetPitch = null;
      rafId = null;
      return;
    }

    // dyaw is the shortest signed distance to the target, so work relative to it.
    const nextYaw = smoothDamp(0, dyaw, camVelYaw, smoothTime, frameDelta);
    const nextPitch = smoothDamp(0, dpitch, camVelPitch, smoothTime, frameDelta);
    camVelYaw = nextYaw.velocity;
    camVelPitch = nextPitch.velocity;
    try {
      viewer.rotate({
        yaw: normalizeYaw(yaw + nextYaw.value),
        pitch: clampPitch(pitch + nextPitch.value, maxPitch),
      });
    } catch {
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId === null) {
      lastFrameTime = null;
      rafId = requestAnimationFrame(tick);
    }
  }

  function rebaseOrbit(activePointerId: number, point: { x: number; y: number }) {
    dragging = true;
    pointerId = activePointerId;
    captured = false;
    camVelYaw = 0;
    camVelPitch = 0;
    resetFling();
    downX = point.x;
    downY = point.y;
    lastX = point.x;
    lastY = point.y;
    const pos = viewer?.getPosition?.();
    targetYaw = Number.isFinite(Number(pos?.yaw)) ? Number(pos.yaw) : 0;
    targetPitch = clampPitch(Number.isFinite(Number(pos?.pitch)) ? Number(pos.pitch) : 0, maxPitch);
    // The loop starts on the first move; a held, motionless pointer needs no frames.
  }

  function getPinchDistance() {
    if (touchPointers.size !== 2) return null;
    const points = Array.from(touchPointers.values());
    return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  function beginPinch() {
    stopLoop();
    stopZoom();
    dragging = false;
    pointerId = null;
    targetYaw = null;
    targetPitch = null;
    pinching = true;
    pinchDistance = getPinchDistance();
  }

  function updatePinchZoom() {
    const nextDistance = getPinchDistance();
    if (nextDistance === null) return;

    if (pinchDistance !== null) {
      const currentZoom = Number(viewer?.getZoomLevel?.());
      if (Number.isFinite(currentZoom)) {
        const rect = container.getBoundingClientRect();
        const referenceSize = Math.max(1, Math.min(rect.width, rect.height));
        const deltaZoom = ((nextDistance - pinchDistance) / referenceSize) * 100;
        const nextZoom = Math.max(0, Math.min(100, currentZoom + deltaZoom));
        try {
          viewer?.zoom?.(nextZoom);
        } catch {
        }
      }
    }

    pinchDistance = nextDistance;
  }

  function stop() {
    const capturedPointerIds = new Set<number>(touchPointers.keys());
    if (pointerId !== null) capturedPointerIds.add(pointerId);
    capturedPointerIds.forEach((id) => {
      try {
        if (container.hasPointerCapture?.(id)) container.releasePointerCapture(id);
      } catch {
      }
    });
    stopLoop();
    stopZoom();
    resetFling();
    camVelYaw = 0;
    camVelPitch = 0;
    dragging = false;
    pointerId = null;
    lastX = 0;
    lastY = 0;
    targetYaw = null;
    targetPitch = null;
    touchPointers.clear();
    pinching = false;
    pinchDistance = null;
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!enabled) return;
    if (event.button !== undefined && event.button !== 0) return;
    // Handle mouse and touch here so exported/mobile tours remain interactive.
    if (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;

    // A second tracked touch temporarily owns zoom. Orbit is stopped instead of
    // rebased, so adding a finger cannot pull the camera toward a stale target.
    if (
      event.pointerType === 'touch'
      && touchPointers.size === 1
      && !touchPointers.has(event.pointerId)
      && !pinching
      && dragging
    ) {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      beginPinch();
      return;
    }

    // Ignore non-primary and third pointers. They must not overwrite either the
    // active orbit pointer or the two touches currently driving pinch zoom.
    if (
      event.isPrimary === false
      || pinching
      || dragging
      || pointerId !== null
      || touchPointers.size > 0
    ) return;
    stopLoop();
    try {
      options?.onInteractionStart?.();
    } catch {
    }
    const point = { x: event.clientX, y: event.clientY };
    if (event.pointerType === 'touch') {
      touchPointers.set(event.pointerId, point);
    }
    // Capture is deferred until the pointer actually drags (see onPointerMove).
    // Capturing on press retargets the click to the container and breaks
    // marker/hotspot clicks.
    downX = point.x;
    downY = point.y;
    rebaseOrbit(event.pointerId, point);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!enabled) return;

    if (touchPointers.has(event.pointerId)) {
      touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinching) {
        if (event.cancelable) event.preventDefault();
        updatePinchZoom();
        return;
      }
    }

    if (!dragging || pointerId !== event.pointerId) return;
    // Chromium may not deliver pointerup when the mouse/pen is released outside
    // the window. Treat a move with no primary button as the missing release.
    if (
      (event.pointerType === 'mouse' || event.pointerType === 'pen')
      && (event.buttons & 1) === 0
    ) {
      dragging = false;
      pointerId = null;
      return;
    }
    if (!captured && Math.hypot(event.clientX - downX, event.clientY - downY) > CAPTURE_DRAG_THRESHOLD_PX * (window.devicePixelRatio || 1)) {
      captured = true;
      try { container.setPointerCapture?.(event.pointerId); } catch {
      }
    }
    if (event.cancelable) event.preventDefault();
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (dx === 0 && dy === 0) return;

    const rect = container.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const fovRad = getFovRad();
    const aspect = w / h;
    const yawPerPixel = (fovRad * aspect) / w;
    const pitchPerPixel = fovRad / h;

    if (targetYaw === null || targetPitch === null) {
      const pos = viewer?.getPosition?.();
      targetYaw = Number.isFinite(Number(pos?.yaw)) ? Number(pos.yaw) : 0;
      targetPitch = clampPitch(Number.isFinite(Number(pos?.pitch)) ? Number(pos.pitch) : 0, maxPitch);
    }

    // Mobile/touch gets a slightly faster orbit response; desktop stays unchanged.
    const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
    const speedMul = isTouchLike ? 1.35 : 1;
    const dyaw = -dx * yawPerPixel * speedMul;
    const dpitch = dy * pitchPerPixel * speedMul;
    targetYaw = normalizeYaw(targetYaw + dyaw);
    targetPitch = clampPitch(targetPitch + dpitch, maxPitch);
    samples.push({ t: event.timeStamp, dyaw, dpitch });
    if (samples.length > 40) samples.shift();
    startLoop();
  };

  const onPointerUp = (event: PointerEvent) => {
    try {
      if (container.hasPointerCapture?.(event.pointerId)) container.releasePointerCapture(event.pointerId);
    } catch {
    }
    const wasTrackedTouch = touchPointers.delete(event.pointerId);
    if (pinching && wasTrackedTouch) {
      pinching = false;
      pinchDistance = null;

      const remaining = touchPointers.entries().next();
      if (!remaining.done) {
        const [remainingPointerId, point] = remaining.value;
        rebaseOrbit(remainingPointerId, point);
      } else {
        stop();
      }
      return;
    }

    if (!dragging) return;
    if (pointerId !== event.pointerId) return;
    dragging = false;
    pointerId = null;
    startFling(event.timeStamp);
    // RAF continues with alphaIdle — camera glides to final target position.
  };

  const onPointerCancel = (event: PointerEvent) => {
    // A third touch is deliberately ignored on pointerdown. Its cancellation
    // must be ignored too, otherwise it can interrupt the two tracked fingers.
    if (pointerId !== event.pointerId && !touchPointers.has(event.pointerId)) return;
    stop();
  };

  const onWindowBlur = () => {
    stop();
  };

  container.addEventListener('wheel', onWheel, { passive: false, capture: true });
  container.addEventListener('pointerdown', onPointerDown, { passive: true });
  container.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp as EventListener, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel as EventListener, { passive: true });
  window.addEventListener('blur', onWindowBlur);

  const setEnabled = (value: boolean) => {
    enabled = value;
    if (!value) stop();
  };

  const detach = () => {
    stop();
    container.style.touchAction = previousTouchAction;
    container.removeEventListener('wheel', onWheel, true);
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp as EventListener);
    window.removeEventListener('pointercancel', onPointerCancel as EventListener);
    window.removeEventListener('blur', onWindowBlur);
  };

  return { detach, stop, setEnabled };
}
