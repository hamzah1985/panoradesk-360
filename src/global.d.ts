import type { DesktopApi } from './lib/desktop';

declare global {
  interface Window {
    electronAPI?: DesktopApi;
  }
  // Injected by vite.config.ts (define): local build date/time, e.g. 2026.10.01-1455.
  const __BUILD_NUMBER__: string;
}

export {};
