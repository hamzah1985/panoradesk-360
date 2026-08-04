import type { DesktopApi } from './lib/desktop';

declare global {
  interface Window {
    electronAPI?: DesktopApi;
  }
  // Injected at build time by vite.config.ts (define). Increments on each build.
  const __BUILD_NUMBER__: number;
}

export {};
