# Third-Party Notices

PanoraDesk 360 is distributed under the MIT License (see [LICENSE](LICENSE)) and
bundles third-party components under their own terms. Nothing shipped in the
installer is under the GPL or AGPL.

## Bundled into the application

| Component | License | Notes |
|---|---|---|
| [Electron](https://github.com/electron/electron) (Chromium, Node.js, V8) | MIT, plus BSD-style terms for Chromium and V8 | Full Chromium notices ship in the installed app as `LICENSES.chromium.html`. |
| [Photo Sphere Viewer](https://photo-sphere-viewer.js.org/) and its plugins | MIT | Bundled into `vendor/psv.js` for both the editor and exported tours. |
| [Three.js](https://threejs.org/) | MIT | Bundled with Photo Sphere Viewer. |
| [React](https://react.dev/) / React DOM | MIT | |
| [sharp](https://sharp.pixelplumbing.com/) | Apache-2.0 | Panorama resizing in the main process. |
| [libvips](https://www.libvips.org/) (via `@img/sharp-win32-x64`) | LGPL-3.0-or-later | Redistributed unmodified as a shared library. Under the LGPL you may replace it; the binary lives at `resources/app.asar.unpacked/node_modules/@img/`. |
| [archiver](https://github.com/archiverjs/node-archiver) | MIT | ZIP export. |
| [Lucide](https://lucide.dev/) icons | ISC | UI icons. |
| [Motion](https://motion.dev/) | MIT | UI animation. |
| [Zustand](https://github.com/pmndrs/zustand) | MIT | State management. |
| [Tailwind CSS](https://tailwindcss.com/) | MIT | Styling, compiled at build time. |

## Build-time only (not shipped in the installer)

Vite, esbuild, Rollup, TypeScript, electron-builder, and their dependencies are
development tooling and are excluded from the packaged application. This
includes [lightningcss](https://lightningcss.dev/) (MPL-2.0), which is used by
Tailwind during the build and is not redistributed.

## Regenerating this list

Licenses of the packages that actually ship can be re-derived from the
`dependencies` block of `package.json` — the packaged app contains only those
plus their transitive dependencies. Everything else in `devDependencies` is
build-time only.
