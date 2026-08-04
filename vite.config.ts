import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';

const BUILD_NUMBER_FILE = path.resolve(__dirname, 'build-number.json');

// Returns the build number to embed in this run. Starts at 25 and advances by
// one on every production build (`vite build`); dev/serve just reads the
// current value without bumping it.
function resolveBuildNumber(isBuild: boolean): number {
  let current = 25;
  try {
    const parsed = JSON.parse(fs.readFileSync(BUILD_NUMBER_FILE, 'utf-8'));
    if (Number.isFinite(parsed?.build)) current = parsed.build;
  } catch {
    current = 25;
  }
  if (isBuild) {
    fs.writeFileSync(BUILD_NUMBER_FILE, JSON.stringify({build: current + 1}, null, 2) + '\n');
  }
  return current;
}

export default defineConfig(({command}) => {
  const buildNumber = resolveBuildNumber(command === 'build');
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

