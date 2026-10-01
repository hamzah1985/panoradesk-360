import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

const BUILD_INFO_FILE = path.resolve(__dirname, 'electron', 'build-info.json');

// Build number = local date and time of the build, e.g. 2026.10.01-1455. The
// package.json semver is left alone because installers/updaters require it.
function makeBuildNumber(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export default defineConfig(() => {
  // Production builds stamp the moment of the build; dev stamps server start.
  const now = new Date();
  const buildNumber = makeBuildNumber(now);
  // The Electron main process shows the same number in the window title.
  try {
    fs.writeFileSync(BUILD_INFO_FILE, JSON.stringify({buildNumber, builtAt: now.toISOString()}, null, 2) + '\n');
  } catch {
    // Non-fatal: the window title falls back to the package version.
  }
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    define: {
      __BUILD_NUMBER__: JSON.stringify(buildNumber),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

