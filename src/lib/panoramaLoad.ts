// Shared panorama loading helpers for the editor viewer, the in-app preview and
// the exported player, so timeouts and cancellation behave identically.

export const PANORAMA_PRELOAD_TIMEOUT_MS = 15_000;
export const PANORAMA_LOAD_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_CONCURRENT_PRELOADS = 2;

/**
 * Runs viewer.setPanorama with a timeout and optional abort signal. Resolves
 * true when the panorama was applied and false on failure, timeout or abort
 * (the in-flight texture request and transition are cancelled in those cases).
 */
export function setPanoramaBounded(
  viewer: any,
  panorama: string,
  options: any,
  signal?: AbortSignal,
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;
    const abortLoad = () => {
      try {
        viewer.textureLoader?.abortLoading?.();
        viewer.state?.transitionAnimation?.cancel?.();
        void viewer.stopAnimation?.();
      } catch {
      }
    };
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      resolve(completed);
    };
    const onAbort = () => {
      abortLoad();
      finish(false);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      abortLoad();
      finish(false);
    }, PANORAMA_LOAD_TIMEOUT_MS);
    try {
      void viewer.setPanorama(panorama, options).then(
        (completed: boolean) => finish(completed !== false),
        () => finish(false),
      );
    } catch {
      finish(false);
    }
  });
}

export type PanoramaPreloadOptions = {
  signal?: AbortSignal;
  /** Skip the concurrency queue (the panorama is about to be shown). */
  priority?: boolean;
};

export type PanoramaPreloader = {
  has: (src: string) => boolean;
  preload: (src: string, options?: PanoramaPreloadOptions) => Promise<boolean>;
  cancelAll: () => void;
};

/**
 * Warms panoramas ahead of navigation. Images are requested with
 * crossOrigin='anonymous' so the cache entry matches the CORS request the
 * viewer's texture loader makes later, and at most `maxConcurrent` background
 * preloads run at once so a scene with many hotspots does not flood the disk.
 */
export function createPanoramaPreloader(maxConcurrent = DEFAULT_MAX_CONCURRENT_PRELOADS): PanoramaPreloader {
  const loaded = new Set<string>();
  type Entry = { promise: Promise<boolean>; cancel: () => void; promote?: () => void };
  const inflight = new Map<string, Entry>();
  const waiting: Array<() => void> = [];
  let active = 0;

  const release = () => {
    active = Math.max(0, active - 1);
    const next = waiting.shift();
    if (next) next();
  };

  const startLoad = (src: string, counted: boolean) => {
    let cancel = () => {};
    const promise = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      let timeoutId: number | null = null;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        img.onload = null;
        img.onerror = null;
        if (ok) loaded.add(src);
        else {
          try { img.src = ''; } catch {
          }
        }
        if (counted) release();
        resolve(ok);
      };
      cancel = () => finish(false);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      timeoutId = window.setTimeout(() => finish(false), PANORAMA_PRELOAD_TIMEOUT_MS);
      img.src = src;
    });
    const entry = { promise, cancel: () => cancel() };
    inflight.set(src, entry);
    void promise.then(() => {
      if (inflight.get(src) === entry) inflight.delete(src);
    });
    return entry;
  };

  const preload = (src: string, options: PanoramaPreloadOptions = {}) => {
    const { signal, priority = false } = options;
    if (!src) return Promise.resolve(false);
    if (loaded.has(src)) return Promise.resolve(true);
    if (signal?.aborted) return Promise.resolve(false);

    let entry = inflight.get(src);
    if (entry) {
      // A navigation is about to need this panorama: do not leave it waiting
      // behind background preloads.
      if (priority) entry.promote?.();
    } else if (priority || active < maxConcurrent) {
      if (!priority) active += 1;
      entry = startLoad(src, !priority);
    } else {
      // Queue until a slot frees up; callers share one promise per src.
      let started: Entry | null = null;
      let resolveQueued: (ok: boolean) => void = () => {};
      const queued = new Promise<boolean>((resolve) => { resolveQueued = resolve; });
      const removeFromQueue = () => {
        const idx = waiting.indexOf(begin);
        if (idx < 0) return false;
        waiting.splice(idx, 1);
        return true;
      };
      function begin() {
        if (started) return;
        active += 1;
        started = startLoad(src, true);
        void started.promise.then(resolveQueued);
      }
      const queuedEntry: Entry = {
        promise: queued,
        cancel: () => {
          if (started) { started.cancel(); return; }
          if (removeFromQueue()) resolveQueued(false);
          if (inflight.get(src) === queuedEntry) inflight.delete(src);
        },
        promote: () => {
          if (started || !removeFromQueue()) return;
          started = startLoad(src, false);
          void started.promise.then(resolveQueued);
        },
      };
      waiting.push(begin);
      inflight.set(src, queuedEntry);
      void queued.then(() => {
        if (inflight.get(src) === queuedEntry) inflight.delete(src);
      });
      entry = queuedEntry;
    }

    const shared = entry.promise;
    if (!signal) return shared;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(ok);
      };
      const onAbort = () => finish(false);
      signal.addEventListener('abort', onAbort, { once: true });
      void shared.then(finish);
    });
  };

  const cancelAll = () => {
    // Cancel through the entries (they remove themselves from the queue), then
    // drop whatever is left.
    Array.from(inflight.values()).forEach((entry) => entry.cancel());
    waiting.length = 0;
    inflight.clear();
  };

  return { has: (src) => loaded.has(src), preload, cancelAll };
}
