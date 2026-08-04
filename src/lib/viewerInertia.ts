type InertiaOptions = {
  alphaDragging?: number;
  alphaIdle?: number;
  minFovDeg?: number;
  maxFovDeg?: number;
  maxPitch?: number;
};

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

  let enabled = true;
  let dragging = false;
  let pointerId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let targetYaw: number | null = null;
  let targetPitch: number | null = null;
  let rafId: number | null = null;

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

  function tick() {
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

    const alpha = dragging ? alphaDragging : alphaIdle;
    const dyaw = shortestYawDelta(targetYaw, yaw);
    const dpitch = targetPitch - pitch;

    if (!dragging && Math.abs(dyaw) < stopThreshold && Math.abs(dpitch) < stopThreshold) {
      targetYaw = null;
      targetPitch = null;
      rafId = null;
      return;
    }

    try {
      viewer.rotate({
        yaw: normalizeYaw(yaw + dyaw * alpha),
        pitch: clampPitch(pitch + dpitch * alpha, maxPitch),
      });
    } catch {
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId === null) {
      rafId = requestAnimationFrame(tick);
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!enabled) return;
    if (event.button !== undefined && event.button !== 0) return;
    // Handle mouse and touch here so exported/mobile tours remain interactive.
    if (event.pointerType !== 'mouse' && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    stopLoop();
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    const pos = viewer?.getPosition?.();
    targetYaw = Number.isFinite(Number(pos?.yaw)) ? Number(pos.yaw) : 0;
    targetPitch = clampPitch(Number.isFinite(Number(pos?.pitch)) ? Number(pos.pitch) : 0, maxPitch);
    startLoop();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging || pointerId !== event.pointerId || !enabled) return;
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
    targetYaw = normalizeYaw(targetYaw - dx * yawPerPixel * speedMul);
    targetPitch = clampPitch(targetPitch + dy * pitchPerPixel * speedMul, maxPitch);
  };

  const onPointerUp = (event?: PointerEvent) => {
    if (!dragging) return;
    if (event && pointerId !== event.pointerId) return;
    dragging = false;
    pointerId = null;
    // RAF continues with alphaIdle — camera glides to final target position.
  };

  container.addEventListener('pointerdown', onPointerDown, { passive: true });
  container.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp as EventListener, { passive: true });
  window.addEventListener('pointercancel', onPointerUp as EventListener, { passive: true });

  const stop = () => {
    stopLoop();
    dragging = false;
    pointerId = null;
    targetYaw = null;
    targetPitch = null;
  };

  const setEnabled = (value: boolean) => {
    enabled = value;
    if (!value) stop();
  };

  const detach = () => {
    stop();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp as EventListener);
    window.removeEventListener('pointercancel', onPointerUp as EventListener);
  };

  return { detach, stop, setEnabled };
}
