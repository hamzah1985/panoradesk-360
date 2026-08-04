/**
 * Bundles Photo Sphere Viewer + all plugins + Three.js into a single
 * self-contained IIFE file (electron/vendor/psv.js + psv.css).
 * Exported as window.PhotoSphereViewer — same API the export app.js expects.
 * Run: node scripts/bundle-vendor.mjs
 */
import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'electron', 'vendor');

await fs.mkdir(outDir, { recursive: true });

// Temporary entry point that re-exports everything we need as named exports.
// esbuild's globalName turns these into window.PhotoSphereViewer.Viewer etc.
const entryContent = `
export { Viewer } from '@photo-sphere-viewer/core';
export { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
export { GalleryPlugin } from '@photo-sphere-viewer/gallery-plugin';
export { AutorotatePlugin } from '@photo-sphere-viewer/autorotate-plugin';
export { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin';
export { StereoPlugin } from '@photo-sphere-viewer/stereo-plugin';
`;
const entryFile = path.join(outDir, '_entry.mjs');
await fs.writeFile(entryFile, entryContent, 'utf-8');

console.log('Bundling PSV + Three.js...');

await esbuild.build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'iife',
  globalName: 'PhotoSphereViewer',
  outfile: path.join(outDir, 'psv.js'),
  minify: true,
  sourcemap: false,
  // Three.js is a peer dep; PSV imports it as 'three' — bundle it in
  alias: {},
  logLevel: 'info',
});

// Collect and concatenate all PSV CSS files in dependency order
const cssPackages = [
  '@photo-sphere-viewer/core',
  '@photo-sphere-viewer/markers-plugin',
  '@photo-sphere-viewer/gallery-plugin',
  '@photo-sphere-viewer/gyroscope-plugin',
  '@photo-sphere-viewer/stereo-plugin',
];

const cssParts = [];
for (const pkg of cssPackages) {
  const cssPath = path.join(root, 'node_modules', pkg, 'index.css');
  try {
    const css = await fs.readFile(cssPath, 'utf-8');
    cssParts.push(`/* ${pkg} */\n${css}`);
  } catch {
    console.warn(`  Warning: no CSS for ${pkg}`);
  }
}
await fs.writeFile(path.join(outDir, 'psv.css'), cssParts.join('\n'), 'utf-8');

// Clean up temp entry
await fs.unlink(entryFile).catch(() => {});

console.log('Bundling player.ts...');

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'export', 'player.ts')],
  bundle: true,
  format: 'iife',
  outfile: path.join(outDir, 'player.js'),
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

console.log('Done → electron/vendor/psv.js + psv.css + player.js');
