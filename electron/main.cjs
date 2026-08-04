const { app, BrowserWindow, dialog, ipcMain, net, nativeImage, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const archiver = require('archiver');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

// Project images live outside the renderer's origin. In a packaged build the
// renderer is a file:// page and can load file:// images directly, but in dev
// it is served from http://localhost:5173 and Chromium blocks file://
// subresources. Serving assets through our own scheme works in both modes.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    },
  },
]);

const isDev = !app.isPackaged;

// Windows' Documents folder is frequently redirected into OneDrive by its
// "Back up your folders" feature. Storing tours there means every panorama is
// synced to the user's cloud quota, and — worse — Files On-Demand can evict
// them to placeholders, so reads turn into network recalls that stall or fail
// offline. Keep tour data on a local, never-synced path in that case.
function isCloudSyncedPath(candidate) {
  const normalized = String(candidate || '').replace(/\\/g, '/').toLowerCase();
  if (!normalized) return false;
  return /(^|\/)onedrive[^/]*\//.test(`${normalized}/`)
    || /(^|\/)(dropbox|google drive|googledrive|icloud ?drive|creative cloud files)\//.test(`${normalized}/`);
}

function resolveDataHome() {
  let documents = '';
  try { documents = app.getPath('documents'); } catch { documents = ''; }
  if (documents && !isCloudSyncedPath(documents)) return path.join(documents, 'PanoraDesk360');
  // Fall back to the profile root: still easy for the user to find and back up,
  // but outside any synced known folder.
  return path.join(app.getPath('home'), 'PanoraDesk360');
}

// Where new tours are written.
const DATA_HOME = resolveDataHome();
const PROJECTS_ROOT = path.join(DATA_HOME, 'projects');

// Tours created before this fallback existed still live under Documents, so
// keep that location readable — it is added to the discovery roots below.
const LEGACY_DATA_HOMES = (() => {
  const homes = [];
  try {
    const documents = app.getPath('documents');
    if (documents) homes.push(path.join(documents, 'PanoraDesk360'));
  } catch {}
  return homes.filter((dir) => path.resolve(dir) !== path.resolve(DATA_HOME));
})();

const RECENTS_FILE = path.join(app.getPath('userData'), 'recent-projects.json');
const SCENE_IMPORT_MAX_EDGE = 4096;
const SCENE_THUMBNAIL_MAX_EDGE = 512;
const SCENE_IMPORT_JPEG_QUALITY = 88;
const SCENE_THUMBNAIL_JPEG_QUALITY = 72;
const APP_ICON_CANDIDATES = [
  path.join(process.cwd(), 'build', 'icon.png'),
  path.join(__dirname, '..', 'build', 'icon.png'),
  path.join(process.resourcesPath || '', 'build', 'icon.png'),
];
const APP_WINDOW_ICON = APP_ICON_CANDIDATES.find((candidate) => candidate && fsSync.existsSync(candidate));

const previewServers = new Map();
let mainWindow = null;
let allowAppClose = false;
let appCloseFallbackTimer = null;
const LOG_DIR = path.join(DATA_HOME, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'startup.log');
async function logLine(message) {
  try {
    await ensureDir(LOG_DIR);
    await fs.appendFile(LOG_FILE, `${new Date().toISOString()} ${String(message)}\n`, 'utf-8');
  } catch {}
}

process.on('uncaughtException', (err) => {
  const msg = String(err?.stack || err);
  logLine('uncaughtException: ' + msg);
  try { dialog.showErrorBox('PanoraDesk 360 Startup Error', msg); } catch {}
});
process.on('unhandledRejection', (err) => {
  const msg = String(err);
  logLine('unhandledRejection: ' + msg);
  try { dialog.showErrorBox('PanoraDesk 360 Runtime Error', msg); } catch {}
});

function slugify(value) {
  return String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'project';
}

function normalizeRel(relPath) {
  return String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function isRelativeAssetPath(value) {
  if (!value) return false;
  const normalized = String(value).trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (lower.startsWith('data:')) return false;
  if (lower.startsWith('app-media://')) return false;
  if (lower.startsWith('file://')) return false;
  if (normalized.startsWith('/') || normalized.startsWith('\\\\') || normalized.startsWith('//')) return false;
  if (/^[A-Za-z]:[\\/]/.test(normalized)) return false;
  return true;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isDataUrl(value) {
  return /^data:/i.test(String(value || '').trim());
}

function isAppMediaLocal(value) {
  return /^app-media:\/\/local\//i.test(String(value || '').trim());
}

function appMediaToLocalPath(value) {
  return String(value || '').trim().replace(/^app-media:\/\/local\//i, '');
}

function isAbsoluteFilePath(value) {
  const normalized = String(value || '').trim();
  return /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\') || normalized.startsWith('//');
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureProjectRoot() {
  await ensureDir(PROJECTS_ROOT);
}

async function readRecentProjectPaths() {
  try {
    const raw = await fs.readFile(RECENTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

async function writeRecentProjectPaths(paths) {
  const normalized = Array.from(new Set(
    (Array.isArray(paths) ? paths : [])
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0),
  ));
  await ensureDir(path.dirname(RECENTS_FILE));
  await fs.writeFile(RECENTS_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
}

async function touchRecentProjectPath(projectDir) {
  const normalizedDir = String(projectDir || '').trim();
  if (!normalizedDir) return;
  const existing = await readRecentProjectPaths();
  const filtered = existing.filter((p) => path.resolve(p) !== path.resolve(normalizedDir));
  filtered.unshift(normalizedDir);
  await writeRecentProjectPaths(filtered.slice(0, 200));
}

// Walking every drive root is expensive (mapped network drives can block for
// seconds), and both projects:list and projects:delete want the same answer.
// Cache the sweep for a short window and collapse concurrent callers onto one run.
const DISCOVERY_CACHE_MS = 60_000;
let discoveryCache = { at: 0, dirs: [] };
let discoveryInFlight = null;

async function discoverProjectDirs() {
  const now = Date.now();
  if (now - discoveryCache.at < DISCOVERY_CACHE_MS) return discoveryCache.dirs;
  if (discoveryInFlight) return discoveryInFlight;
  discoveryInFlight = (async () => {
    try {
      const dirs = await scanForProjectDirs();
      discoveryCache = { at: Date.now(), dirs };
      return dirs;
    } finally {
      discoveryInFlight = null;
    }
  })();
  return discoveryInFlight;
}

async function scanForProjectDirs() {
  const roots = new Set();
  roots.add(path.resolve(PROJECTS_ROOT));
  // Tours created before the cloud-sync fallback still live under the old
  // Documents path — keep them visible in the dashboard.
  for (const legacyHome of LEGACY_DATA_HOMES) {
    roots.add(path.resolve(path.join(legacyHome, 'projects')));
  }
  try { roots.add(path.resolve(app.getPath('documents'))); } catch {}
  try { roots.add(path.resolve(app.getPath('desktop'))); } catch {}

  for (let code = 68; code <= 90; code += 1) { // D:..Z:
    const drive = `${String.fromCharCode(code)}:\\`;
    if (fsSync.existsSync(drive)) roots.add(path.resolve(drive));
  }

  const found = new Set();
  const maxRoots = Array.from(roots).slice(0, 12);

  for (const root of maxRoots) {
    let level1 = [];
    try {
      level1 = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const dirs1 = level1.filter((e) => e.isDirectory()).slice(0, 120);
    for (const d1 of dirs1) {
      const p1 = path.join(root, d1.name);
      const p1Project = path.join(p1, 'project.json');
      if (await pathExists(p1Project)) {
        found.add(path.resolve(p1));
      }
      let level2 = [];
      try {
        level2 = await fs.readdir(p1, { withFileTypes: true });
      } catch {
        continue;
      }
      const dirs2 = level2.filter((e) => e.isDirectory()).slice(0, 120);
      for (const d2 of dirs2) {
        const p2 = path.join(p1, d2.name);
        const p2Project = path.join(p2, 'project.json');
        if (await pathExists(p2Project)) {
          found.add(path.resolve(p2));
        }
      }
    }
  }
  return Array.from(found);
}

function defaultProjectDir(project) {
  return path.join(PROJECTS_ROOT, `${slugify(project.name)}-${project.id}`);
}

function getProjectDir(project) {
  if (project?.path && String(project.path).trim().length > 0) return project.path;
  return defaultProjectDir(project);
}

function isWithinDir(rootDir, targetPath) {
  const rootResolved = path.resolve(rootDir);
  const targetResolved = path.resolve(targetPath);
  if (process.platform === 'win32') {
    const rootLower = rootResolved.toLowerCase();
    const targetLower = targetResolved.toLowerCase();
    return targetLower === rootLower || targetLower.startsWith(`${rootLower}${path.sep}`);
  }
  return targetResolved === rootResolved || targetResolved.startsWith(`${rootResolved}${path.sep}`);
}

function projectAbsolute(projectDir, relPath) {
  const resolved = path.resolve(projectDir, normalizeRel(relPath));
  if (!isWithinDir(projectDir, resolved)) return null;
  return resolved;
}

async function ensureProjectScaffold(project) {
  await ensureProjectRoot();
  const projectDir = getProjectDir(project);
  await ensureDir(projectDir);
  await ensureDir(path.join(projectDir, 'panoramas'));
  await ensureDir(path.join(projectDir, 'thumbnails'));
  await ensureDir(path.join(projectDir, 'exports'));
  await ensureDir(path.join(projectDir, 'assets', 'logo'));
  await ensureDir(path.join(projectDir, 'assets', 'icons'));
  await ensureDir(path.join(projectDir, 'assets', 'floorplans'));
  return projectDir;
}

async function uniqueDestination(dir, baseName) {
  const ext = path.extname(baseName);
  const stem = slugify(path.basename(baseName, ext));
  let candidate = `${stem}${ext.toLowerCase()}`;
  let idx = 2;
  while (await pathExists(path.join(dir, candidate))) {
    candidate = `${stem}-${idx}${ext.toLowerCase()}`;
    idx += 1;
  }
  return candidate;
}

async function copyImageToProject(projectDir, sourcePath, targetSubfolder) {
  const folder = path.join(projectDir, targetSubfolder);
  await ensureDir(folder);
  const fileName = await uniqueDestination(folder, path.basename(sourcePath));
  const dest = path.join(folder, fileName);
  await fs.copyFile(sourcePath, dest);
  return normalizeRel(path.join(targetSubfolder, fileName));
}

async function writeResizedJpeg(sourcePath, outPath, maxEdge, quality) {
  if (sharp) {
    try {
      await sharp(sourcePath, { failOn: 'none' })
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({
          quality,
          mozjpeg: true,
        })
        .toFile(outPath);
      return true;
    } catch (err) {
      await logLine(`sharp resize failed for ${sourcePath}: ${String(err?.message || err)}`);
    }
  }

  try {
    const img = nativeImage.createFromPath(sourcePath);
    const size = img.getSize();
    if (!size.width || !size.height) return false;
    const scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
    const resized = img.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best',
    });
    await fs.writeFile(outPath, resized.toJPEG(quality));
    return true;
  } catch (err) {
    await logLine(`native resize failed for ${sourcePath}: ${String(err?.message || err)}`);
    return false;
  }
}

async function importSceneImageToProject(projectDir, sourcePath, targetSubfolder, { maxEdge, quality }) {
  const folder = path.join(projectDir, targetSubfolder);
  await ensureDir(folder);
  const jpgBaseName = `${path.basename(sourcePath, path.extname(sourcePath))}.jpg`;
  const fileName = await uniqueDestination(folder, jpgBaseName);
  const dest = path.join(folder, fileName);
  const resized = await writeResizedJpeg(sourcePath, dest, maxEdge, quality);
  if (resized) return normalizeRel(path.join(targetSubfolder, fileName));

  try {
    await fs.rm(dest, { force: true });
  } catch {}
  return copyImageToProject(projectDir, sourcePath, targetSubfolder);
}

function decodeDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || '');
  if (!match) return null;
  return { mime: match[1], buffer: Buffer.from(match[2], 'base64') };
}

function extFromMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.jpg';
}

function hotspotSvg(iconType, color, size, opacity = 1, borderWidth) {
  const s = Math.max(18, Math.round(Number(size) || 34));
  const c = color || '#ffffff';
  const o = Number.isFinite(Number(opacity)) ? Math.max(0, Math.min(1, Number(opacity))) : 0.1;
  const strokeWidth = Number.isFinite(Number(borderWidth))
    ? Math.max(1, Math.min(16, Math.round(Number(borderWidth))))
    : Math.max(2, Math.round(s * 0.08));
  const half = s / 2;
  const radius = Math.max(6, half - (strokeWidth / 2) - 1);
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}' viewBox='0 0 ${s} ${s}'><circle cx='${half}' cy='${half}' r='${radius}' fill='${c}' fill-opacity='${o}' stroke='rgba(255,255,255,.96)' stroke-width='${strokeWidth}'/></svg>`;
}

function hotspotIconDataUri(iconType, color, size, opacity, borderWidth) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(hotspotSvg(iconType, color, size, opacity, borderWidth))}`;
}

function optimizeDimensions(level) {
  if (level === 'aggressive') return { max: 2048, quality: 68 };
  if (level === 'balanced') return { max: 4096, quality: 82 };
  return null;
}

async function resolveImageToExport(projectDir, imageValue, destinationDir, baseName, optimizationLevel = 'none') {
  await ensureDir(destinationDir);
  if (typeof imageValue !== 'string' || imageValue.length === 0) return null;
  const rawValue = imageValue.trim();
  const lowerValue = rawValue.toLowerCase();

  const dims = optimizeDimensions(optimizationLevel);

  if (lowerValue.startsWith('data:')) {
    const decoded = decodeDataUrl(rawValue);
    if (!decoded) return null;
    const fileName = `${slugify(baseName)}${extFromMime(decoded.mime)}`;
    await fs.writeFile(path.join(destinationDir, fileName), decoded.buffer);
    return fileName;
  }

  let sourceAbs = null;
  if (isAppMediaLocal(rawValue)) {
    sourceAbs = path.normalize(appMediaToLocalPath(rawValue));
  } else if (isRelativeAssetPath(rawValue)) {
    sourceAbs = projectAbsolute(projectDir, rawValue);
  } else if (isAbsoluteFilePath(rawValue)) {
    sourceAbs = rawValue;
  }

  if (!sourceAbs || !(await pathExists(sourceAbs))) return null;

  const ext = path.extname(sourceAbs).toLowerCase() || '.jpg';
  const fileName = `${slugify(baseName)}${ext}`;
  const outPath = path.join(destinationDir, fileName);

  if (!dims || (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png' && ext !== '.webp')) {
    await fs.copyFile(sourceAbs, outPath);
    return fileName;
  }

  const img = nativeImage.createFromPath(sourceAbs);
  const size = img.getSize();
  if (!size.width || !size.height) {
    await fs.copyFile(sourceAbs, outPath);
    return fileName;
  }

  const scale = Math.min(1, dims.max / Math.max(size.width, size.height));
  const resized = img.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' });

  if (ext === '.png') {
    await fs.writeFile(outPath, resized.toPNG());
  } else {
    await fs.writeFile(outPath, resized.toJPEG(dims.quality));
  }
  return fileName;
}

function safeExportImageValue(copiedRelativePath, originalValue, fallbackValue = '') {
  if (typeof copiedRelativePath === 'string' && copiedRelativePath.length > 0) return copiedRelativePath;
  if (typeof originalValue !== 'string' || originalValue.length === 0) return fallbackValue;
  const lower = originalValue.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')) {
    return originalValue;
  }
  return fallbackValue;
}

function templateCss(theme) {
  if (theme === 'luxury') {
    return `:root{--bg:#0a0a0a;--card:rgba(0,0,0,.55);--text:#f8f5ef;--accent:#c8a96a;}`;
  }
  if (theme === 'construction') {
    return `:root{--bg:#0f172a;--card:rgba(15,23,42,.7);--text:#e2e8f0;--accent:#f59e0b;}`;
  }
  return `:root{--bg:#000;--card:rgba(0,0,0,.45);--text:#fff;--accent:#C8A96A;}`;
}

function generateExportStyle(theme) {
  return `${templateCss(theme)}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none;background:var(--bg);font-family:Arial,sans-serif;color:var(--text)}#viewer{position:fixed;inset:0;width:100%;height:100%;touch-action:none}
#branding{position:fixed;top:max(14px,env(safe-area-inset-top,0px));left:max(14px,env(safe-area-inset-left,0px));z-index:30;background:var(--card);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);border-radius:12px;padding:10px 14px;max-width:min(220px,calc(100vw - 90px))}
#branding img{max-height:42px;display:block;margin-bottom:8px}#branding .title{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}#branding .sub{font-size:11px;opacity:.85;margin-top:4px}
#sceneIntro{position:fixed;bottom:20px;left:20px;right:20px;max-width:560px;background:var(--card);border:1px solid rgba(255,255,255,.15);padding:14px 16px;border-radius:12px;z-index:24;display:none}
#sceneIntro h3{margin:0 0 6px 0;font-size:18px}#sceneIntro p{margin:0;font-size:13px;line-height:1.4;opacity:.92}
#loadingOverlay{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:100;color:var(--text)}
#loadingOverlay .box{text-align:center}#loadingOverlay .spinner{width:42px;height:42px;border:3px solid rgba(255,255,255,.2);border-top-color:var(--accent);border-radius:50%;margin:0 auto 12px;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.psv-loader-container,.psv-loader{display:none !important}
.pd-hotspot-wrap{position:relative;cursor:pointer}
.pd-floor-hotspot-hit{position:relative;width:var(--pd-floor-hit-size,46px);height:var(--pd-floor-hit-size,46px);border-radius:9999px;background:rgba(255,255,255,.01);transform:translateZ(0)}
.pd-floor-hotspot-hit:before,.pd-floor-hotspot-hit:after{content:"";position:absolute;left:50%;top:50%;border-radius:9999px;transform:translate(-50%,-50%);pointer-events:none}
.pd-floor-hotspot-hit:before{width:max(9px,calc(var(--pd-floor-hit-size,46px)*.18));height:max(9px,calc(var(--pd-floor-hit-size,46px)*.18));background:var(--pd-floor-hit-color,rgba(255,255,255,.96));box-shadow:0 0 0 3px rgba(15,23,42,.28),0 0 14px 4px var(--pd-floor-hit-glow,rgba(255,255,255,.7));animation:pd-floor-hit-core var(--pd-floor-hit-speed,2.4s) ease-in-out infinite}
.pd-floor-hotspot-hit:after{width:calc(var(--pd-floor-hit-size,46px)*.56);height:calc(var(--pd-floor-hit-size,46px)*.56);border:2px solid var(--pd-floor-hit-color,rgba(255,255,255,.86));opacity:0;animation:pd-floor-hit-ping var(--pd-floor-hit-speed,2.4s) ease-out infinite}
.pd-floor-projected-ring{cursor:pointer;vector-effect:non-scaling-stroke;shape-rendering:geometricPrecision}
.pd-floor-projected-ring-core{animation:pd-floor-projected-core 2.4s ease-in-out infinite}
.pd-floor-projected-ring-ping{animation:pd-floor-projected-ping 2.4s ease-out infinite}
.pd-hotspot-core{position:relative;border-radius:9999px;background:var(--pd-hotspot-fill,rgba(255,255,255,.1));border:var(--pd-hotspot-border,clamp(2px,calc(var(--pd-hotspot-size,34px)*.08),5px)) solid rgba(255,255,255,.96);box-shadow:none;display:flex;align-items:center;justify-content:center}
.pd-hotspot-core-ring{background:transparent}
.pd-hotspot-core-floor{background:transparent !important;transform:perspective(180px) rotateX(68deg) scale(1.08,.64);transform-origin:center center;box-shadow:0 3px 10px rgba(0,0,0,.22)}
.pd-hotspot-glyph{font-size:calc(var(--pd-hotspot-size,34px)*.62);line-height:1;color:rgba(255,255,255,.98);text-shadow:0 1px 4px rgba(0,0,0,.45);display:inline-flex;align-items:center;justify-content:center}
.pd-hotspot-core-curved{transform:perspective(var(--pd-hotspot-floor-perspective,180px)) rotateX(var(--pd-hotspot-floor-rotate,0deg)) scale(var(--pd-hotspot-floor-scale-x,1),var(--pd-hotspot-floor-scale-y,1));transform-origin:center center;box-shadow:0 3px 10px rgba(0,0,0,var(--pd-hotspot-floor-shadow,0))}
.pd-hotspot-core-pulse{position:relative;background:transparent !important;border:0 !important;box-shadow:none !important;overflow:visible}
.pd-hotspot-pulse-ring{position:absolute;left:50%;top:50%;width:var(--pd-ring-size,calc(var(--pd-hotspot-size,34px)*.30));height:var(--pd-ring-size,calc(var(--pd-hotspot-size,34px)*.30));border:var(--pd-hotspot-pulse-stroke,2px) solid var(--pd-hotspot-pulse-color,rgba(255,255,255,.95));border-radius:9999px;transform:translate(-50%,-50%) scale(.6);pointer-events:none;animation:pd-hotspot-core-pulse 2.4s ease-out infinite}
.pd-hotspot-pulse-center{position:absolute;left:50%;top:50%;width:calc(var(--pd-hotspot-size,34px)*.22);height:calc(var(--pd-hotspot-size,34px)*.22);min-width:8px;min-height:8px;border-radius:9999px;background:#fff;box-shadow:0 0 0 3px rgba(0,0,0,.45),0 0 14px rgba(255,255,255,.9);transform:translate(-50%,-50%);pointer-events:none}
.pd-hotspot-core-vista{position:relative;background:transparent !important;border:0 !important;box-shadow:none !important;overflow:visible}
.pd-hotspot-vista-ring{position:absolute;left:50%;top:50%;width:var(--pd-ring-size,var(--pd-hotspot-vista-ring-size,calc(var(--pd-hotspot-size,34px)*.95)));height:var(--pd-ring-size,var(--pd-hotspot-vista-ring-size,calc(var(--pd-hotspot-size,34px)*.95)));border:2px solid var(--pd-hotspot-vista-color,rgba(255,255,255,.9));border-radius:9999px;transform:translate(-50%,-50%) scale(.6);opacity:0;pointer-events:none;animation:pd-hotspot-vista-pulse 2.4s ease-out infinite}
.pd-hotspot-vista-center{position:absolute;left:50%;top:50%;width:calc(var(--pd-hotspot-size,34px)*.30);height:calc(var(--pd-hotspot-size,34px)*.30);min-width:9px;min-height:9px;border-radius:9999px;background:var(--pd-hotspot-vista-color,rgba(255,255,255,.9));box-shadow:0 0 0 3px rgba(255,255,255,.25);transform:translate(-50%,-50%);pointer-events:none}
.pd-hotspot-core-floor-pulse{position:relative;background:transparent !important;border:0 !important;box-shadow:none !important;overflow:visible}
.pd-hotspot-floor-shadow{position:absolute;left:50%;top:50%;width:calc(var(--pd-hotspot-floor-ring-width,110px)*1.18);height:calc(var(--pd-hotspot-floor-ring-height,38px)*1.16);border-radius:9999px;background:radial-gradient(ellipse,var(--pd-hotspot-floor-shadow-glow,rgba(255,255,255,.12)) 0%,transparent 70%);transform:translate(-50%,-50%);z-index:1;animation:pd-hotspot-floor-shadow-pulse var(--pd-hotspot-floor-pulse-duration,2.4s) ease-in-out infinite;pointer-events:none}
.pd-hotspot-floor-ping{position:absolute;left:50%;top:50%;width:var(--pd-ring-size,var(--pd-hotspot-floor-ring-width,110px));height:calc(var(--pd-ring-size,var(--pd-hotspot-floor-ring-width,110px))*.345);border-radius:9999px;border:1.5px solid color-mix(in oklab,var(--pd-hotspot-floor-ring-color,rgba(255,255,255,.95)) 88%,transparent 12%);transform:translate(-50%,-50%) scale(1);opacity:0;pointer-events:none;animation:pd-hotspot-floor-ping-out 2.8s ease-out infinite;z-index:2}
.pd-hotspot-floor-ring{position:absolute;left:50%;top:50%;width:var(--pd-hotspot-floor-ring-width,110px);height:var(--pd-hotspot-floor-ring-height,38px);border-radius:9999px;border:3px solid var(--pd-hotspot-floor-ring-color,rgba(255,255,255,.95));box-shadow:0 0 10px 3px var(--pd-hotspot-floor-ring-glow,rgba(255,255,255,.7)),0 0 28px 8px var(--pd-hotspot-floor-ring-glow-soft,rgba(255,255,255,.35));transform:translate(-50%,-50%);z-index:3;animation:pd-hotspot-floor-ring-pulse var(--pd-hotspot-floor-pulse-duration,2.4s) ease-in-out infinite;pointer-events:none}
.pd-hotspot-floor-dot{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:9999px;background:var(--pd-hotspot-floor-dot-color,rgba(255,255,255,.95));box-shadow:0 0 8px 3px var(--pd-hotspot-floor-dot-glow,rgba(255,255,255,.6));transform:translate(-50%,-50%);z-index:4;animation:pd-hotspot-floor-dot-pulse var(--pd-hotspot-floor-pulse-duration,2.4s) ease-in-out infinite;pointer-events:none}
.pd-hotspot-core-floor-circle{position:relative;background:transparent !important;border:0 !important;box-shadow:none !important;overflow:visible}
.pd-hotspot-floor-circle-ping{position:absolute;left:50%;top:50%;width:var(--pd-ring-size,var(--pd-hotspot-floor-circle-width,110px));height:calc(var(--pd-ring-size,var(--pd-hotspot-floor-circle-width,110px))*.31);border-radius:9999px;border:1.5px solid color-mix(in oklab,var(--pd-hotspot-floor-circle-color,rgba(255,255,255,.95)) 88%,transparent 12%);transform:translate(-50%,-50%) scale(1);opacity:0;pointer-events:none;animation:pd-hotspot-floor-circle-ping-out var(--pd-hotspot-floor-circle-duration,2.2s) ease-out infinite;z-index:2}
.pd-hotspot-floor-circle-ring{position:absolute;left:50%;top:50%;width:var(--pd-hotspot-floor-circle-width,110px);height:var(--pd-hotspot-floor-circle-height,34px);border-radius:9999px;border:3px solid var(--pd-hotspot-floor-circle-color,rgba(255,255,255,.95));box-shadow:0 0 10px 3px var(--pd-hotspot-floor-circle-glow,rgba(255,255,255,.7)),0 0 22px 6px var(--pd-hotspot-floor-circle-soft,rgba(255,255,255,.3));transform:translate(-50%,-50%);z-index:3;animation:pd-hotspot-floor-circle-ring-pulse var(--pd-hotspot-floor-circle-duration,2.2s) ease-in-out infinite;pointer-events:none}
.pd-hotspot-floor-circle-inner{position:absolute;left:50%;top:50%;width:calc(var(--pd-hotspot-floor-circle-width,110px)*.58);height:calc(var(--pd-hotspot-floor-circle-height,34px)*.62);border-radius:9999px;border:2px solid color-mix(in oklab,var(--pd-hotspot-floor-circle-core,rgba(255,255,255,.55)) 78%,transparent 22%);transform:translate(-50%,-50%);z-index:4;animation:pd-hotspot-floor-circle-inner-pulse var(--pd-hotspot-floor-circle-duration,2.2s) ease-in-out infinite;pointer-events:none}
.pd-hotspot-floor-circle-dot{position:absolute;left:50%;top:50%;width:7px;height:7px;border-radius:9999px;background:var(--pd-hotspot-floor-circle-color,rgba(255,255,255,.95));box-shadow:0 0 7px 3px var(--pd-hotspot-floor-circle-glow,rgba(255,255,255,.7));transform:translate(-50%,-50%);z-index:5;animation:pd-hotspot-floor-circle-dot-pulse var(--pd-hotspot-floor-circle-duration,2.2s) ease-in-out infinite;pointer-events:none}
@keyframes pd-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
@keyframes pd-ping{0%{box-shadow:0 0 0 0 rgba(255,255,255,.58)}100%{box-shadow:0 0 0 16px rgba(255,255,255,0)}}
@keyframes pd-breathe{0%,100%{opacity:1}50%{opacity:.7}}
@keyframes pd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes pd-glow{0%,100%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}50%{filter:drop-shadow(0 0 8px rgba(255,255,255,.9))}}
@keyframes pd-arrow-bounce{0%,100%{transform:translateX(0)}50%{transform:translateX(4px)}}
@keyframes pd-blink{0%,49%,100%{opacity:1}50%,99%{opacity:.2}}
@keyframes pd-ring-expand{0%{transform:scale(.9);opacity:.7}100%{transform:scale(1.25);opacity:0}}
@keyframes pd-hotspot-core-pulse{0%{transform:translate(-50%,-50%) scale(.6);opacity:.9}100%{transform:translate(-50%,-50%) scale(2.6);opacity:0}}
@keyframes pd-hotspot-vista-pulse{0%{transform:translate(-50%,-50%) scale(.6);opacity:.9}100%{transform:translate(-50%,-50%) scale(2.6);opacity:0}}
@keyframes pd-floor-hit-core{0%,100%{opacity:1;transform:translate(-50%,-50%) scale(1)}50%{opacity:.66;transform:translate(-50%,-50%) scale(.72)}}
@keyframes pd-floor-hit-ping{0%{opacity:.7;transform:translate(-50%,-50%) scale(.58)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.65)}}
@keyframes pd-floor-projected-core{0%,100%{opacity:1}50%{opacity:.58}}
@keyframes pd-floor-projected-ping{0%{opacity:0}12%{opacity:.72}100%{opacity:0}}
@keyframes pd-hotspot-floor-ping-out{0%{transform:translate(-50%,-50%) scale(1);opacity:.85}100%{transform:translate(-50%,-50%) scale(3);opacity:0}}
@keyframes pd-hotspot-floor-ring-pulse{0%,100%{opacity:1}50%{opacity:.6}}
@keyframes pd-hotspot-floor-dot-pulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:1}50%{transform:translate(-50%,-50%) scale(.6);opacity:.5}}
@keyframes pd-hotspot-floor-shadow-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes pd-hotspot-floor-circle-ping-out{0%{transform:translate(-50%,-50%) scale(1);opacity:.8}100%{transform:translate(-50%,-50%) scale(2.45);opacity:0}}
@keyframes pd-hotspot-floor-circle-ring-pulse{0%,100%{opacity:1}50%{opacity:.58}}
@keyframes pd-hotspot-floor-circle-inner-pulse{0%,100%{opacity:.8;transform:translate(-50%,-50%) scale(1)}50%{opacity:.4;transform:translate(-50%,-50%) scale(1.14)}}
@keyframes pd-hotspot-floor-circle-dot-pulse{0%,100%{opacity:1;transform:translate(-50%,-50%) scale(1)}50%{opacity:.65;transform:translate(-50%,-50%) scale(.7)}}
.pd-anim-pulse .pd-hotspot-core{animation:pd-pulse 1.6s ease-in-out infinite}
.pd-anim-ping .pd-hotspot-core{animation:pd-ping 1.4s ease-out infinite}
.pd-anim-breathe .pd-hotspot-core{animation:pd-breathe 2.2s ease-in-out infinite}
.pd-anim-float .pd-hotspot-core{animation:pd-float 1.8s ease-in-out infinite}
.pd-anim-glow .pd-hotspot-core{animation:pd-glow 1.8s ease-in-out infinite}
.pd-anim-arrow-bounce .pd-hotspot-core{animation:pd-arrow-bounce 1s ease-in-out infinite}
.pd-anim-blink .pd-hotspot-core{animation:pd-blink 1.2s linear infinite}
.pd-anim-ring-expand .pd-hotspot-core::after{content:"";position:absolute;inset:-4px;border:2px solid rgba(255,255,255,.65);border-radius:9999px;animation:pd-ring-expand 1.3s ease-out infinite}
.pd-anim-ring-ping .pd-hotspot-core-ring{animation:pd-pulse 1.2s ease-in-out infinite}
.pd-anim-ring-ping .pd-hotspot-core-ring::after{content:"";position:absolute;inset:-5px;border:2px solid rgba(255,255,255,.78);border-radius:9999px;animation:pd-ring-expand 1.05s ease-out infinite}
.pd-whs-wrap{position:relative;display:flex;align-items:center;justify-content:center;width:var(--pd-whs-size,90px);height:var(--pd-whs-size,90px);transform:scale(1);filter:drop-shadow(0 2px 8px rgba(0,0,0,.55));transition:transform 240ms cubic-bezier(.34,1.28,.64,1),filter 240ms ease}
.pd-hotspot-wrap:hover .pd-whs-wrap,.pd-hotspot-wrap:focus-within .pd-whs-wrap{transform:scale(1.11);filter:drop-shadow(0 0 14px rgba(255,255,255,.48))}
.pd-whs-halo{position:absolute;inset:-12%;border-radius:9999px;background:radial-gradient(circle,rgba(var(--pd-whs-r,255),var(--pd-whs-g,255),var(--pd-whs-b,255),.18) 0%,transparent 68%);animation:pd-whs-glow var(--pd-whs-speed,2.6s) ease-in-out infinite;pointer-events:none}
.pd-whs-ring{position:absolute;width:70%;height:70%;top:50%;left:50%;transform:translate(-50%,-50%);overflow:visible;animation:pd-whs-ring-pulse var(--pd-whs-speed,2.6s) ease-in-out infinite;pointer-events:none}
.pd-whs-ping{position:absolute;width:70%;height:70%;border-radius:9999px;border:max(1px,calc(var(--pd-whs-border,2px)*.75)) solid rgba(var(--pd-whs-r,255),var(--pd-whs-g,255),var(--pd-whs-b,255),.65);opacity:0;pointer-events:none;animation:pd-whs-ping var(--pd-whs-speed,2.6s) ease-out infinite}
.pd-whs-icon{position:relative;z-index:10;font-size:calc(var(--pd-whs-size,90px)*.26);line-height:1;color:#fff;text-shadow:0 1px 5px rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;user-select:none;pointer-events:none}
@keyframes pd-whs-glow{0%,100%{opacity:.65}50%{opacity:1}}
@keyframes pd-whs-ring-pulse{0%,100%{opacity:1;filter:drop-shadow(0 0 5px rgba(var(--pd-whs-r,255),var(--pd-whs-g,255),var(--pd-whs-b,255),.45))}50%{opacity:.6;filter:drop-shadow(0 0 11px rgba(var(--pd-whs-r,255),var(--pd-whs-g,255),var(--pd-whs-b,255),.65))}}
@keyframes pd-whs-ping{0%{transform:scale(1);opacity:.75}80%,100%{transform:scale(2.3);opacity:0}}
#pdMenuToggle{position:fixed;top:max(14px,env(safe-area-inset-top,0px));right:max(14px,env(safe-area-inset-right,0px));z-index:52;width:46px;height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;font-size:20px;line-height:1}
#pdMenuToggle:hover{background:rgba(0,0,0,.62)}
#pdFullscreenFab{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:32;width:42px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.45);backdrop-filter:blur(8px);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none}
#pdFullscreenFab:hover{background:rgba(0,0,0,.62)}
#pdFullscreenFab .icon{font-size:18px;line-height:1}
#pdMenuBackdrop{position:fixed;inset:0;z-index:49}
#pdMenuPanel{position:fixed;top:0;right:0;z-index:50;height:100vh;height:100dvh;width:min(320px,86vw);border-left:1px solid rgba(255,255,255,.12);background:rgba(5,10,20,.78);backdrop-filter:blur(18px);display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px)}
#pdMenuHead{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.pdMenuTitle{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.5)}
#pdCloseMenu{width:32px;height:32px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;line-height:1;padding:0}
#pdCloseMenu:hover{background:rgba(255,255,255,.1);color:#fff}
.pdCtrlSection{padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0;display:flex;flex-direction:column;gap:6px}
.pdCtrlGrid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pdCtrl{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:10px;padding:10px 12px;font-size:12px;text-align:left;cursor:pointer;width:100%}
.pdCtrl:hover{background:rgba(255,255,255,.13)}
.pdCtrl.active{border-color:color-mix(in srgb,var(--accent) 55%,white 45%);background:color-mix(in srgb,var(--accent) 24%,transparent 76%);color:var(--accent)}
.pdCtrl:disabled{opacity:.35;cursor:not-allowed}
.pdSceneSection{flex:1;min-height:0;display:flex;flex-direction:column}
.pdSceneSectionHead{display:flex;align-items:center;justify-content:space-between;padding:10px 20px 6px;flex-shrink:0}
.pdSceneSectionHead .lbl{font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.4)}
.pdSceneSectionHead .cnt{font-size:10px;color:rgba(255,255,255,.3)}
#pdSceneList{flex:1;min-height:0;overflow:auto;padding:0 12px 8px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.pdSceneBtn{width:100%;margin:0 0 4px;padding:10px 12px;border-radius:11px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:rgba(255,255,255,.8);text-align:left;font-size:12px;cursor:pointer}
.pdSceneBtn:hover{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.15)}
.pdSceneBtn.current{border-color:color-mix(in srgb,var(--accent) 50%,transparent 50%);background:color-mix(in srgb,var(--accent) 15%,transparent 85%);color:var(--accent)}
#pdSceneNav{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:12px 16px;padding-bottom:max(12px,env(safe-area-inset-bottom,12px));border-top:1px solid rgba(255,255,255,.08);flex-shrink:0}
#pdFloorplanModal{position:fixed;inset:0;z-index:45;background:rgba(0,0,0,.58);backdrop-filter:blur(4px);padding:18px}
#pdFloorplanCard{width:min(1080px,100%);max-height:calc(100vh - 36px);margin:0 auto;background:rgba(8,12,22,.82);border:1px solid rgba(255,255,255,.18);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
#pdFloorplanHead{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.12)}
#pdFloorplanMapWrap{position:relative;padding:14px;overflow:auto;flex:1}
#pdFloorplanMap{position:relative;width:min(920px,100%);margin:0 auto}
#pdFloorplanMap img{width:100%;height:auto;display:block;border-radius:12px;border:1px solid rgba(255,255,255,.12)}
.pdFloorPin{position:absolute;width:14px;height:14px;border-radius:999px;border:2px solid #fff;background:#ef4444;transform:translate(-50%,-50%);box-shadow:0 4px 12px rgba(0,0,0,.4);cursor:pointer}
.pdFloorPin.current{background:var(--accent)}
.pdHidden{display:none !important}
@media(max-width:480px){
  #branding{padding:6px 10px;border-radius:10px}
  #branding img{max-height:26px;margin-bottom:4px}
  #branding .title{font-size:10px}
  #branding .sub{font-size:9px}
  #sceneIntro{left:8px;right:8px;bottom:max(14px,env(safe-area-inset-bottom,14px));padding:10px 12px;border-radius:10px}
  #sceneIntro h3{font-size:15px;margin-bottom:4px}
  #sceneIntro p{font-size:12px}
  #pdMenuToggle{width:50px;height:50px;font-size:22px}
  #pdFullscreenFab{width:48px;height:48px}
  #pdFullscreenFab .icon{font-size:20px}
  #pdMenuPanel{width:100vw;border-left:none}
  .pdCtrl{padding:13px 10px;font-size:13px}
  .pdCtrlGrid{gap:8px}
  .pdSceneBtn{padding:13px 12px;margin-bottom:6px;font-size:13px}
  #pdMenuHead{padding:20px 20px 14px}
  .pdCtrlSection{padding:14px 16px}
}
@media(max-width:375px){
  #branding{display:none}
}
`;
}

function generateExportHtml() {
  return `<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'/><meta name='viewport' content='width=device-width,initial-scale=1.0,viewport-fit=cover'/><meta name='theme-color' content='#000000'/><meta name='apple-mobile-web-app-capable' content='yes'/><meta name='apple-mobile-web-app-status-bar-style' content='black-translucent'/><title>PanoraDesk 360 Tour</title>
<link rel='stylesheet' href='./vendor/psv.css'/>
<link rel='stylesheet' href='./assets/style.css'/></head><body>
<div id='loadingOverlay'><div class='box'><div class='spinner'></div><div id='loadingText'>Loading tour...</div></div></div>
<div id='viewer'></div>
<div id='branding' hidden><img id='brandLogo' alt='logo' hidden/><div class='title' id='brandTitle'></div><div class='sub' id='brandSub'></div></div>
<div id='sceneIntro'><h3 id='sceneIntroTitle'></h3><p id='sceneIntroDescription'></p></div>
<button id='pdMenuToggle' type='button' aria-label='Menu' title='Menu'>&#9776;</button>
<button id='pdFullscreenFab' type='button' aria-label='Fullscreen' title='Fullscreen'><span class='icon' id='pdFullscreenFabIcon'>⛶</span></button>
<div id='pdMenuBackdrop' class='pdHidden'></div>
<div id='pdMenuPanel' class='pdHidden'>
  <div id='pdMenuHead'>
    <div class='pdMenuTitle'>Menu</div>
    <button id='pdCloseMenu' type='button' aria-label='Close menu'>&#10005;</button>
  </div>
  <div class='pdCtrlSection'>
    <div class='pdCtrlGrid'>
      <button id='pdOpenFloorplan' type='button' class='pdCtrl'>Floor Plan</button>
      <button id='pdToggleFullscreen' type='button' class='pdCtrl'>Fullscreen</button>
    </div>
    <div class='pdCtrlGrid'>
      <button id='pdToggleAutorotate' type='button' class='pdCtrl'>Auto Rotate</button>
      <button id='pdToggleGallery' type='button' class='pdCtrl'>Gallery</button>
    </div>
    <button id='pdToggleHotspots' type='button' class='pdCtrl'>Hide Hotspots</button>
    <button id='pdToggleVr' type='button' class='pdCtrl'>Enter VR Mode</button>
  </div>
  <div class='pdSceneSection'>
    <div class='pdSceneSectionHead'><span class='lbl'>Scenes</span><span class='cnt' id='pdSceneCount'></span></div>
    <div id='pdSceneList'></div>
  </div>
  <div id='pdSceneNav'>
    <button id='pdPrevScene' type='button' class='pdCtrl'>&#8592; Previous</button>
    <button id='pdNextScene' type='button' class='pdCtrl'>Next &#8594;</button>
  </div>
</div>
<div id='pdFloorplanModal' class='pdHidden'>
  <div id='pdFloorplanCard'>
    <div id='pdFloorplanHead'>
      <div>Floor Plan</div>
      <button id='pdCloseFloorplan' type='button'>Close</button>
    </div>
    <div id='pdFloorplanMapWrap'>
      <div id='pdFloorplanMap'></div>
    </div>
  </div>
</div>
<script src='./vendor/psv.js'></script><script src='./assets/app.js'></script></body></html>`;
}

function iframeSnippet(folderName, iframe) {
  const width = iframe?.width || '100%';
  const height = iframe?.height || '720';
  const allowFullscreen = iframe?.allowFullscreen === false ? '' : ' allowfullscreen';
  return `<iframe src="/tours/${folderName}/index.html" width="${width}" height="${height}" style="border:0;"${allowFullscreen}></iframe>`;
}

async function writeZipFromFolder(sourceDir, outputZip) {
  await ensureDir(path.dirname(outputZip));
  await new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    let settled = false;
    const succeed = () => { if (settled) return; settled = true; resolve(); };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { archive.abort(); } catch {}
      try { output.destroy(); } catch {}
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    output.on('close', succeed);
    // Without this the promise never settles when the destination is full,
    // locked, or not writable — the export just hangs with no feedback.
    output.on('error', fail);
    archive.on('error', fail);
    archive.on('warning', (err) => { if (err?.code !== 'ENOENT') fail(err); });
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize().catch(fail);
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

async function startStaticServer(rootDir) {
  const rootResolved = path.resolve(rootDir);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : normalizeRel(urlPath);
      const filePath = path.resolve(path.join(rootDir, rel));
      if (!isWithinDir(rootResolved, filePath)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      // Resolve directories to their index.html. Streaming a directory raises
      // an unhandled EISDIR on the read stream, which would take down the app.
      let targetPath = filePath;
      let stat = null;
      try {
        stat = await fs.stat(targetPath);
        if (stat.isDirectory()) {
          targetPath = path.join(targetPath, 'index.html');
          stat = await fs.stat(targetPath);
        }
      } catch {
        stat = null;
      }
      if (!stat || !stat.isFile()) {
        res.writeHead(404); res.end('Not found'); return;
      }

      res.writeHead(200, { 'Content-Type': contentTypeFor(targetPath) });
      const stream = fsSync.createReadStream(targetPath);
      stream.on('error', () => { res.destroy(); });
      stream.pipe(res);
    } catch {
      res.writeHead(500); res.end('Server error');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}/` };
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function cleanupPreviewInstance(instance) {
  if (!instance) return;
  await closeHttpServer(instance.server);
  const tempRoot = instance.tempRoot || instance.root;
  if (!tempRoot) return;
  try {
    await fs.rm(tempRoot, { recursive: true, force: true });
  } catch {
  }
}

async function runProjectHealthCheck(project, exportOptions) {
  const issues = [];
  const warnings = [];
  if (!project?.name) issues.push('Project name is empty.');
  if (!project?.scenes?.length) issues.push('No scenes found in this project.');

  const sceneIds = new Set((project.scenes || []).map((s) => s.id));
  const projectDir = getProjectDir(project);
  const validateAssetPath = async (assetLabel, assetValue, { allowRemote = true, missingAsIssue = true } = {}) => {
    const raw = String(assetValue || '').trim();
    if (!raw) return;
    if (isHttpUrl(raw)) {
      if (!allowRemote) {
        issues.push(`${assetLabel} uses remote URL which cannot be exported: ${raw}`);
      } else {
        warnings.push(`${assetLabel} uses remote URL: ${raw}`);
      }
      return;
    }
    if (isDataUrl(raw)) return;
    if (isAppMediaLocal(raw)) {
      const abs = path.normalize(appMediaToLocalPath(raw));
      if (!(await pathExists(abs))) {
        const msg = `${assetLabel} file missing: ${raw}`;
        if (missingAsIssue) issues.push(msg);
        else warnings.push(msg);
      }
      return;
    }
    if (isRelativeAssetPath(raw)) {
      const abs = projectAbsolute(projectDir, raw);
      if (!abs) {
        issues.push(`${assetLabel} path escapes project directory: ${raw}`);
        return;
      }
      if (!(await pathExists(abs))) {
        const msg = `${assetLabel} file missing: ${raw}`;
        if (missingAsIssue) issues.push(msg);
        else warnings.push(msg);
      }
      return;
    }
    if (isAbsoluteFilePath(raw) && !(await pathExists(raw))) {
      const msg = `${assetLabel} file missing: ${raw}`;
      if (missingAsIssue) issues.push(msg);
      else warnings.push(msg);
    }
  };

  for (const scene of (project.scenes || [])) {
    if (!scene.image) issues.push(`Scene '${scene.name}' has no panorama image.`);
    await validateAssetPath(`Scene '${scene.name}' image`, scene.image, { allowRemote: false, missingAsIssue: true });
    if (scene.thumbnail) {
      await validateAssetPath(`Scene '${scene.name}' thumbnail`, scene.thumbnail, { allowRemote: true, missingAsIssue: false });
    }
    for (const hotspot of (scene.hotspots || [])) {
      if (!sceneIds.has(hotspot.targetSceneId)) {
        issues.push(`Hotspot '${hotspot.label}' in '${scene.name}' points to missing target scene.`);
      }
    }
    if ((scene.hotspots || []).length === 0) {
      warnings.push(`Scene '${scene.name}' has no navigation hotspots.`);
    }
  }

  const includeBranding = exportOptions?.includeBranding ?? project.exportSettings?.includeBranding;
  const includeFloorPlan = exportOptions?.includeFloorPlan ?? project.exportSettings?.showFloorPlan;
  if (includeBranding && !project.logo) {
    warnings.push('Branding enabled but no logo uploaded.');
  } else if (includeBranding && project.logo) {
    await validateAssetPath('Project logo', project.logo, { allowRemote: true, missingAsIssue: false });
  }

  if (includeFloorPlan && !project.floorPlanImage) {
    issues.push('Floor plan export enabled but no floor plan image is set.');
  } else if (includeFloorPlan && project.floorPlanImage) {
    await validateAssetPath('Project floor plan image', project.floorPlanImage, { allowRemote: true, missingAsIssue: false });
  }

  return { ok: issues.length === 0, issues, warnings };
}

function generateReadme(project, exportFolderName, effectiveOptions) {
  const sceneCount = (project.scenes || []).length;
  const sceneList = (project.scenes || [])
    .map((s, i) => `  ${i + 1}. ${s.name || 'Unnamed scene'} (id: ${s.id})`)
    .join('\n');
  const hotspotCount = (project.scenes || []).reduce((n, s) => n + (s.hotspots || []).length, 0);
  const template = effectiveOptions.template || 'minimal';
  const imageOpt = { none: 'Original (no downscaling)', balanced: 'Max 4K (4096px cap)', aggressive: 'Max 2K (2048px cap)' }[effectiveOptions.imageOptimization] || 'Max 4K';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return `# PanoraDesk 360 — Virtual Tour Export
> This README is written for an AI assistant (Claude, GPT, Gemini, etc.) to understand the
> structure of this export and help a human deploy or integrate the tour.

## Tour info
- **Name:** ${project.name || 'Untitled Tour'}
- **Exported:** ${now}
- **Scenes:** ${sceneCount}
- **Hotspot links:** ${hotspotCount}
- **Template:** ${template}
- **Image quality:** ${imageOpt}
- **Branding included:** ${effectiveOptions.includeBranding ? 'Yes' : 'No'}
- **Floor plan included:** ${effectiveOptions.includeFloorPlan ? 'Yes' : 'No'}
- **Gallery included:** ${effectiveOptions.includeGallery ? 'Yes' : 'No'}
- **Loading screen:** ${effectiveOptions.showLoadingScreen ? 'Yes' : 'No'}

## Scenes in this tour
${sceneList || '  (none)'}

---

## File structure
\`\`\`
${exportFolderName}/
├── index.html          ← Entry point. Open this in a browser to view the tour.
├── README.md           ← This file.
├── vendor/
│   ├── psv.js          ← Self-contained Photo Sphere Viewer + plugins (Three.js bundled in).
│   └── psv.css         ← Viewer styles.
└── assets/
    ├── app.js          ← Tour boot logic. Fetches tour.json, initialises PSV, wires hotspots.
    ├── style.css       ← Theme CSS (template: ${template}).
    ├── tour.json       ← All tour data: scenes, hotspots, markers, settings. Human-readable JSON.
    ├── panoramas/      ← Equirectangular panorama images (JPEG/WEBP).
    ├── thumbnails/     ← Thumbnail images used in the gallery panel.
    ├── logo/           ← Branding logo (if included).
    └── floorplan/      ← Floor plan image (if included).
\`\`\`

---

## How to deploy (choose one)

### Option A — Static web server (simplest)
Upload the entire \`${exportFolderName}/\` folder to any static host that can serve files:
- **Nginx / Apache**: copy folder into the web root, e.g. \`/var/www/html/tours/${exportFolderName}/\`
- **GitHub Pages / Netlify / Vercel**: drop the folder, the root \`index.html\` is served automatically.
- **cPanel File Manager**: upload and extract the ZIP into \`public_html/tours/\`.

The tour will be accessible at: \`https://yourdomain.com/tours/${exportFolderName}/\`

### Option B — Embed in an existing page (iframe)
\`\`\`html
<iframe
  src="/tours/${exportFolderName}/index.html"
  width="100%" height="720"
  style="border:0;"
  allowfullscreen>
</iframe>
\`\`\`

### Option C — Open locally (no server)
Some browsers block \`fetch()\` on \`file://\` URLs (CORS). To run locally without uploading:
\`\`\`bash
# Python 3
cd ${exportFolderName}
python -m http.server 8080
# then open http://localhost:8080
\`\`\`

---

## Technical notes for AI assistants

- **No CDN dependency.** All viewer code (\`vendor/psv.js\`, \`vendor/psv.css\`) is bundled locally.
  The tour works fully offline once hosted — no internet required at runtime.
- **tour.json is the source of truth.** To change scene names, hotspot positions, labels, or
  colours without re-exporting, edit \`assets/tour.json\` directly. The structure mirrors the
  PanoraDesk 360 project format.
- **Hotspot navigation.** Each hotspot in \`tour.json\` has a \`targetSceneId\` that matches a
  scene \`id\`. Clicking the hotspot calls PSV's \`setPanorama()\` with that scene's image path.
- **Viewer API.** \`window.PhotoSphereViewer\` is the IIFE global exposed by \`vendor/psv.js\`.
  It exposes: \`Viewer\`, \`MarkersPlugin\`, \`GalleryPlugin\`, \`AutorotatePlugin\`,
  \`GyroscopePlugin\`, \`StereoPlugin\`.
- **Customisation entry points:**
  - Colours/fonts → \`assets/style.css\` (CSS variables: \`--accent\`, \`--bg\`, \`--text\`)
  - Layout/UI → \`assets/app.js\` (single-file, unminified, easy to read)
  - Scene data → \`assets/tour.json\`
- **Image paths** in \`tour.json\` are relative to the \`${exportFolderName}/\` root
  (e.g. \`"assets/panoramas/01-living-room.jpg"\`).
- **Minimum server requirements:** any HTTP server capable of serving static files with correct
  MIME types. No PHP, Node, or database needed.
`;
}

async function performExport(project, options, targetBaseDir) {
  const effectiveOptions = {
    includeBranding: options?.includeBranding ?? project?.exportSettings?.includeBranding ?? true,
    includeFloorPlan: options?.includeFloorPlan ?? project?.exportSettings?.showFloorPlan ?? false,
    includeGallery: options?.includeGallery ?? project?.exportSettings?.showGallery ?? true,
    template: options?.template || project?.exportSettings?.exportTemplate || 'minimal',
    imageOptimization: options?.imageOptimization || project?.exportSettings?.imageOptimization || 'balanced',
    showLoadingScreen: options?.showLoadingScreen ?? project?.exportSettings?.showLoadingScreen ?? true,
    zipOutput: options?.zipOutput ?? false,
    iframe: options?.iframe || {},
  };

  const projectDir = await ensureProjectScaffold(project);
  const exportFolderName = `panoradesk360-${slugify(project.name)}`;
  const exportDir = path.join(targetBaseDir, exportFolderName);

  const assetsDir = path.join(exportDir, 'assets');
  const panoramasDir = path.join(assetsDir, 'panoramas');
  const thumbnailsDir = path.join(assetsDir, 'thumbnails');
  const logoDir = path.join(assetsDir, 'logo');
  const floorplanDir = path.join(assetsDir, 'floorplan');

  await ensureDir(panoramasDir);
  await ensureDir(thumbnailsDir);
  await ensureDir(logoDir);
  await ensureDir(floorplanDir);

  const sceneImageMap = new Map();
  const sceneThumbMap = new Map();

  for (let i = 0; i < (project.scenes || []).length; i += 1) {
    const scene = project.scenes[i];
    const base = `${String(i + 1).padStart(2, '0')}-${scene.name || 'scene'}`;
    const panoFile = await resolveImageToExport(projectDir, scene.image, panoramasDir, base, effectiveOptions.imageOptimization || 'none');
    const thumbFile = await resolveImageToExport(projectDir, scene.thumbnail || scene.image, thumbnailsDir, `${base}-thumb`, effectiveOptions.imageOptimization || 'none');
    const exportedPano = safeExportImageValue(
      panoFile ? `assets/panoramas/${panoFile}` : '',
      scene.image,
      '',
    );
    const exportedThumb = safeExportImageValue(
      thumbFile ? `assets/thumbnails/${thumbFile}` : '',
      scene.thumbnail || scene.image,
      exportedPano,
    );
    sceneImageMap.set(scene.id, exportedPano);
    sceneThumbMap.set(scene.id, exportedThumb);
  }

  let exportLogo = null;
  if (project.logo && effectiveOptions.includeBranding) {
    const logoFile = await resolveImageToExport(projectDir, project.logo, logoDir, 'logo', 'none');
    if (logoFile) exportLogo = `assets/logo/${logoFile}`;
  }

  let exportFloorplan = null;
  if (project.floorPlanImage && effectiveOptions.includeFloorPlan) {
    const floorFile = await resolveImageToExport(projectDir, project.floorPlanImage, floorplanDir, 'floorplan', effectiveOptions.imageOptimization || 'none');
    if (floorFile) exportFloorplan = `assets/floorplan/${floorFile}`;
  }

  const exportProject = {
    ...project,
    // Don't ship the author's local project directory in the public tour.json.
    path: undefined,
    logo: exportLogo,
    floorPlanImage: exportFloorplan,
    exportSettings: {
      ...project.exportSettings,
      includeBranding: !!effectiveOptions.includeBranding,
      showFloorPlan: !!effectiveOptions.includeFloorPlan,
      showGallery: !!effectiveOptions.includeGallery,
      exportTemplate: effectiveOptions.template,
      imageOptimization: effectiveOptions.imageOptimization,
      showLoadingScreen: effectiveOptions.showLoadingScreen,
    },
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      image: sceneImageMap.get(scene.id),
      thumbnail: sceneThumbMap.get(scene.id),
      hotspots: (scene.hotspots || []).map((h) => ({
        ...h,
        iconData: hotspotIconDataUri(
          'circle',
          h.color || project.hotspotStyle?.color || '#ffffff',
          h.size || project.hotspotStyle?.size || 34,
          h.opacity ?? project.hotspotStyle?.opacity ?? 0.1,
          h.borderWidth ?? project.hotspotStyle?.borderWidth ?? 4,
        ),
      })),
      markers: (scene.markers || []).map((m) => ({
        ...m,
        iconData: hotspotIconDataUri('info', '#3b82f6', 30, 0.95),
      })),
    })),
  };

  await fs.writeFile(path.join(exportDir, 'index.html'), generateExportHtml(), 'utf-8');
  await fs.writeFile(path.join(exportDir, 'README.md'), generateReadme(project, exportFolderName, effectiveOptions), 'utf-8');
  await fs.writeFile(path.join(assetsDir, 'style.css'), generateExportStyle(effectiveOptions.template), 'utf-8');
  await fs.writeFile(path.join(assetsDir, 'tour.json'), JSON.stringify(exportProject, null, 2), 'utf-8');

  // Copy self-contained vendor bundle (PSV + Three.js + compiled player) so the tour works offline
  const vendorSrc = path.join(__dirname, 'vendor');
  const vendorDst = path.join(exportDir, 'vendor');
  await ensureDir(vendorDst);
  for (const file of ['psv.js', 'psv.css']) {
    try {
      await fs.copyFile(path.join(vendorSrc, file), path.join(vendorDst, file));
    } catch {
      // vendor files missing — export still works via CDN fallback
    }
  }
  // player.js is compiled from src/export/player.ts by bundle-vendor.mjs
  try {
    await fs.copyFile(path.join(vendorSrc, 'player.js'), path.join(assetsDir, 'app.js'));
  } catch {
    throw new Error('Missing shared runtime: electron/vendor/player.js. Run vendor bundle before exporting.');
  }

  let zipPath = null;
  if (effectiveOptions.zipOutput) {
    zipPath = path.join(targetBaseDir, `${exportFolderName}.zip`);
    await writeZipFromFolder(exportDir, zipPath);
  }

  return {
    exportDir,
    zipPath,
    folderName: exportFolderName,
  };
}

const DEPLOY_SETTINGS_FILE = path.join(app.getPath('userData'), 'deploy-settings.json');

async function getDeploySettings() {
  try {
    const raw = await fs.readFile(DEPLOY_SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveDeploySettings(settings) {
  await fs.writeFile(DEPLOY_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe for embedding inside a double-quoted JS string in an inline <script>.
function escapeJsString(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1).replace(/</g, '\\u003C');
}

function buildTourPageHtml(tourId, title) {
  const safeTitle = escapeHtml(title || 'Virtual Tour');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>${safeTitle} | Virtual Tour</title>
  <link rel="icon" href="favicon.png" type="image/png" sizes="32x32">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #05070d; color: #e5e7eb; font-family: Arial, sans-serif; }
    #topbar {
      position: fixed; top: 10px; left: 10px; right: 10px; z-index: 20;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 8px 10px; border-radius: 10px;
      background: rgba(10, 15, 28, 0.72); border: 1px solid rgba(148, 163, 184, 0.35);
    }
    #tour-title { font-size: 13px; font-weight: 700; }
    .actions { display: flex; align-items: center; gap: 8px; }
    .actions a {
      color: #fff; text-decoration: none; font-size: 12px;
      padding: 6px 10px; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.35); background: rgba(15, 23, 42, 0.85);
    }
    #tour-loader {
      position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at center, rgba(30,41,59,0.5), rgba(2,6,23,0.98));
      z-index: 15; font-size: 13px; letter-spacing: 0.02em;
    }
    #tour-iframe { width: 100%; height: 100%; border: 0; display: block; opacity: 0; transition: opacity 220ms ease; background: #000; }
    #tour-iframe.ready { opacity: 1; }
  </style>
</head>
<body>
  <div id="topbar">
    <div id="tour-title">${safeTitle}</div>
    <div class="actions">
      <a id="tour-open-link" href="#" target="_blank" rel="noopener">Open Direct</a>
      <a id="tour-back" href="/tours.html">Back</a>
    </div>
  </div>
  <div id="tour-loader">Loading tour...</div>
  <iframe id="tour-iframe" allow="xr-spatial-tracking;gyroscope;accelerometer;fullscreen" scrolling="no"></iframe>
  <script src="assets/js/tour-pages.js"></script>
  <script>
    window.TourPages.mountPage({ tourId: "${escapeJsString(tourId)}" });
  </script>
</body>
</html>`;
}

async function updateTourPagesJs(websiteDir, tourId, title, slug, tourPath) {
  const jsFile = path.join(websiteDir, 'assets', 'js', 'tour-pages.js');
  let content = await fs.readFile(jsFile, 'utf-8');

  // Every field is a user-controlled project name — quote them all properly
  // instead of only escaping apostrophes.
  const entry = `    "${escapeJsString(tourId)}": {\n      title: "${escapeJsString(title)}",\n      slug: "${escapeJsString(slug)}",\n      liveSrc: "${escapeJsString(tourPath)}",\n      localSrc: "${escapeJsString(tourPath)}"\n    }`;

  // Replace existing entry if present (older builds wrote single-quoted keys).
  const existing = new RegExp(`\\s*['"]?${tourId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?:\\s*\\{[^}]+\\},?`, 'g');
  existing.lastIndex = 0;
  if (existing.test(content)) {
    existing.lastIndex = 0;
    content = content.replace(existing, `\n${entry}`);
  } else {
    // Insert before the closing }; of TOUR_MAP
    content = content.replace(/(\s*};[\s\n]*function\s+isLocalHost)/, `,\n${entry}\n  $1`);
  }

  await fs.writeFile(jsFile, content, 'utf-8');
}

async function deployToWebsite(project, options, websiteDir) {
  // Validate that this looks like the website root, not a subfolder
  const tourPagesFile = path.join(websiteDir, 'assets', 'js', 'tour-pages.js');
  const hasIndexHtml = await fs.access(path.join(websiteDir, 'index.html')).then(() => true).catch(() => false);
  const hasTourPages = await fs.access(tourPagesFile).then(() => true).catch(() => false);
  if (!hasIndexHtml && !hasTourPages) {
    throw new Error(
      `The selected folder doesn't look like the website root.\n\nPlease select the root of your website (the folder that contains index.html and the assets/ folder).\n\nSelected: ${websiteDir}`
    );
  }

  const toursDir = path.join(websiteDir, 'assets', 'tours');
  await ensureDir(toursDir);

  const exported = await performExport(project, { ...options, zipOutput: false }, toursDir);

  const tourSlug = slugify(project.name);
  const tourId = `pd-${tourSlug}`;
  const pageSlug = `tour-${tourSlug}`;
  const tourPath = `/assets/tours/${exported.folderName}/index.html`;

  if (hasTourPages) {
    await updateTourPagesJs(websiteDir, tourId, project.name, pageSlug, tourPath);
  }

  const pageFile = path.join(websiteDir, `${pageSlug}.html`);
  await fs.writeFile(pageFile, buildTourPageHtml(tourId, project.name), 'utf-8');

  return { exportDir: exported.exportDir, tourId, tourPath, pageFile: `${pageSlug}.html` };
}

async function createWindow() {
  await logLine('createWindow:start');
  const appVersion = app.getVersion();
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    ...(APP_WINDOW_ICON ? { icon: APP_WINDOW_ICON } : {}),
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setTitle(`PanoraDesk 360 v${appVersion}`);
  mainWindow = win;
  allowAppClose = false;

  // Open external links in the system browser instead of navigating the app
  // window away or spawning an in-app Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://localhost:5173') || url.startsWith('file://');
    if (allowed) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
  });

  // Give the renderer a chance to flush a pending autosave before the window
  // actually closes. The renderer answers via the 'app:confirm-close' IPC.
  win.on('close', (event) => {
    if (allowAppClose) return;
    event.preventDefault();
    try { win.webContents.send('app:flush-before-close'); } catch {}
    if (!appCloseFallbackTimer) {
      appCloseFallbackTimer = setTimeout(() => {
        // Clear the handle, otherwise a later close attempt sees a stale
        // truthy timer and never schedules its own fallback.
        appCloseFallbackTimer = null;
        allowAppClose = true;
        if (win && !win.isDestroyed()) win.close();
      }, 3000);
    }
  });

  if (isDev) {
    await logLine('createWindow:mode=dev');
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const candidatePaths = [path.join(__dirname, '..', 'dist', 'index.html')];
    const indexPath = candidatePaths.find((candidate) => fsSync.existsSync(candidate));
    await logLine(`createWindow:mode=prod candidates=${candidatePaths.join(' | ')} chosen=${indexPath || 'none'}`);
    if (!indexPath) {
      throw new Error(`Unable to locate renderer index.html. Tried: ${candidatePaths.join(', ')}`);
    }
    await win.loadFile(indexPath);
  }

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logLine('did-fail-load code=' + code + ' desc=' + desc + ' url=' + url);
    try { dialog.showErrorBox('Load Failed', 'code=' + code + '\n' + desc + '\n' + url); } catch {}
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logLine('render-process-gone: ' + JSON.stringify(details));
    try { dialog.showErrorBox('Renderer Crashed', JSON.stringify(details)); } catch {}
  });
  win.webContents.on('did-finish-load', () => {
    logLine('did-finish-load');
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await ensureProjectRoot();

  // app-media://local/<absolute path> — the renderer resolves every project
  // asset through this so images work identically in dev (http origin) and in
  // a packaged build (file origin).
  protocol.handle('app-media', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname && url.hostname !== 'local') {
        return new Response('Not found', { status: 404 });
      }
      const decoded = decodeURIComponent(url.pathname);
      // Windows absolute paths arrive as /C:/... — drop the leading slash.
      const raw = /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded;
      const filePath = path.normalize(raw);
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        return new Response('Not found', { status: 404 });
      }
      const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(fileResponse.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(fileResponse.body, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers,
      });
    } catch (err) {
      await logLine(`app-media request failed for ${request.url}: ${String(err?.message || err)}`);
      return new Response('Bad request', { status: 400 });
    }
  });

  ipcMain.handle('projects:list', async () => {
    await ensureProjectRoot();
    const projects = [];
    const seen = new Set();
    const projectDirs = [];

    const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      projectDirs.push(path.join(PROJECTS_ROOT, entry.name));
    }

    const recentDirs = await readRecentProjectPaths();
    for (const recentDir of recentDirs) {
      if (!recentDir) continue;
      projectDirs.push(recentDir);
    }

    const discoveredDirs = await discoverProjectDirs();
    for (const discoveredDir of discoveredDirs) {
      projectDirs.push(discoveredDir);
    }

    for (const projectDir of projectDirs) {
      const resolvedDir = path.resolve(String(projectDir || ''));
      if (!resolvedDir || seen.has(resolvedDir)) continue;
      seen.add(resolvedDir);
      const projectFile = path.join(resolvedDir, 'project.json');
      if (!(await pathExists(projectFile))) continue;
      try {
        const raw = await fs.readFile(projectFile, 'utf-8');
        const parsed = JSON.parse(raw);
        parsed.path = resolvedDir;
        projects.push(parsed);
      } catch {
      }
    }

    const sorted = projects
      .sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''))
      .slice(0, 200);
    await writeRecentProjectPaths(sorted.map((p) => p.path).filter(Boolean));
    return sorted;
  });

  ipcMain.handle('window:get-menu-visible', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return !!mainWindow.menuBarVisible;
  });

  ipcMain.handle('window:set-menu-visible', async (_evt, visible) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !!visible;
    mainWindow.setMenuBarVisibility(next);
    mainWindow.autoHideMenuBar = true;
    return !!mainWindow.menuBarVisible;
  });

  ipcMain.handle('window:toggle-menu-visible', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !mainWindow.menuBarVisible;
    mainWindow.setMenuBarVisibility(next);
    mainWindow.autoHideMenuBar = true;
    return !!mainWindow.menuBarVisible;
  });

  ipcMain.handle('projects:delete', async (_evt, projectId, projectPath) => {
    if (!projectId || typeof projectId !== 'string') return false;
    await ensureProjectRoot();
    const rootResolved = path.resolve(PROJECTS_ROOT);

    const deleteVerifiedProjectDir = async (projectDir, requireWithinRoot) => {
      const resolvedTarget = path.resolve(projectDir);
      if (requireWithinRoot && !isWithinDir(rootResolved, resolvedTarget)) return false;

      const projectFile = path.join(resolvedTarget, 'project.json');
      if (!(await pathExists(projectFile))) return false;

      try {
        const raw = await fs.readFile(projectFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed?.id !== projectId) return false;
      } catch {
        return false;
      }

      await fs.rm(resolvedTarget, { recursive: true, force: true });
      return true;
    };

    const requestedProjectPath = typeof projectPath === 'string' ? projectPath.trim() : '';
    if (requestedProjectPath) {
      const requestedResolved = path.resolve(requestedProjectPath);
      if (await pathExists(requestedResolved)) {
        const deletedRequested = await deleteVerifiedProjectDir(
          requestedResolved,
          isWithinDir(rootResolved, requestedResolved),
        );
        if (deletedRequested) {
          const recents = await readRecentProjectPaths();
          await writeRecentProjectPaths(recents.filter((p) => path.resolve(p) !== requestedResolved));
          return true;
        }
      }
    }

    const candidateDirs = [];
    const seen = new Set();
    const pushCandidate = (dirPath) => {
      const resolved = path.resolve(String(dirPath || ''));
      if (!resolved || seen.has(resolved)) return;
      seen.add(resolved);
      candidateDirs.push(resolved);
    };

    try {
      const entries = await fs.readdir(PROJECTS_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        pushCandidate(path.join(PROJECTS_ROOT, entry.name));
      }
    } catch {}

    const recentDirs = await readRecentProjectPaths();
    for (const dir of recentDirs) pushCandidate(dir);

    const discoveredDirs = await discoverProjectDirs();
    for (const dir of discoveredDirs) pushCandidate(dir);

    for (const dir of candidateDirs) {
      const deleted = await deleteVerifiedProjectDir(dir, isWithinDir(rootResolved, dir));
      if (!deleted) continue;
      const recents = await readRecentProjectPaths();
      await writeRecentProjectPaths(recents.filter((p) => path.resolve(p) !== dir));
      return true;
    }

    return false;
  });

  ipcMain.handle('projects:save', async (_evt, project) => {
    const projectDir = await ensureProjectScaffold(project);
    const payload = { ...project, path: projectDir, modifiedDate: new Date().toISOString() };
    // Write atomically: a plain writeFile that is interrupted (e.g. app quit
    // mid-save) can leave project.json truncated and corrupt the whole project.
    const targetFile = path.join(projectDir, 'project.json');
    const tmpFile = path.join(projectDir, `.project.json.tmp-${process.pid}-${Date.now()}`);
    try {
      await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), 'utf-8');
      await fs.rename(tmpFile, targetFile);
    } catch (err) {
      try { await fs.rm(tmpFile, { force: true }); } catch {}
      throw err;
    }
    await touchRecentProjectPath(projectDir);
    return payload;
  });

  ipcMain.handle('projects:open-dialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PanoraDesk Project', extensions: ['json'] }],
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const selected = result.filePaths[0];
      const raw = await fs.readFile(selected, 'utf-8');
      const project = JSON.parse(raw);
      project.path = path.dirname(selected);
      await touchRecentProjectPath(project.path);
      return project;
    } catch {
      throw new Error('Invalid or unreadable project file.');
    }
  });

  ipcMain.handle('projects:pick-directory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('media:import-scenes', async (_evt, project) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { projectPath: getProjectDir(project), scenes: [] };
    }

    const projectDir = await ensureProjectScaffold(project);
    const items = [];
    const total = result.filePaths.length;

    _evt.sender.send('media:import-scenes-progress', {
      stage: 'start',
      total,
      current: 0,
      currentFile: null,
    });

    for (let index = 0; index < result.filePaths.length; index += 1) {
      const sourcePath = result.filePaths[index];
      _evt.sender.send('media:import-scenes-progress', {
        stage: 'processing',
        total,
        current: index + 1,
        currentFile: path.basename(sourcePath),
      });
      const imageRel = await importSceneImageToProject(projectDir, sourcePath, 'panoramas', {
        maxEdge: SCENE_IMPORT_MAX_EDGE,
        quality: SCENE_IMPORT_JPEG_QUALITY,
      });
      const thumbRel = await importSceneImageToProject(projectDir, sourcePath, 'thumbnails', {
        maxEdge: SCENE_THUMBNAIL_MAX_EDGE,
        quality: SCENE_THUMBNAIL_JPEG_QUALITY,
      });
      items.push({
        name: path.basename(sourcePath, path.extname(sourcePath)),
        image: imageRel,
        thumbnail: thumbRel,
      });
    }

    _evt.sender.send('media:import-scenes-progress', {
      stage: 'done',
      total,
      current: total,
      currentFile: null,
    });

    return { projectPath: projectDir, scenes: items };
  });

  ipcMain.handle('media:upload-logo', async (_evt, project) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'svg'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const projectDir = await ensureProjectScaffold(project);
    const rel = await copyImageToProject(projectDir, result.filePaths[0], path.join('assets', 'logo'));
    return { projectPath: projectDir, path: rel };
  });

  ipcMain.handle('media:upload-floorplan', async (_evt, project) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const projectDir = await ensureProjectScaffold(project);
    const rel = await copyImageToProject(projectDir, result.filePaths[0], path.join('assets', 'floorplans'));
    return { projectPath: projectDir, path: rel };
  });

  ipcMain.handle('projects:health-check', async (_evt, project, options) => {
    return runProjectHealthCheck(project, options);
  });

  ipcMain.handle('projects:export-web', async (_evt, project, options) => {
    const defaultName = `panoradesk360-${slugify(project.name || 'tour')}.zip`;
    const result = await dialog.showSaveDialog({
      title: 'Save Tour ZIP',
      defaultPath: path.join(app.getPath('desktop'), defaultName),
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const health = await runProjectHealthCheck(project, options);
    if (!health.ok) {
      return { canceled: true, notes: `Health check failed:\n${health.issues.join('\n')}` };
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panoradesk-export-'));
    try {
      const exported = await performExport(project, { ...(options || {}), zipOutput: false }, tmpDir);
      await writeZipFromFolder(exported.exportDir, result.filePath);
    } finally {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }

    return {
      canceled: false,
      zipPath: result.filePath,
      iframeCode: iframeSnippet(`panoradesk360-${slugify(project.name || 'tour')}`, options?.iframe),
    };
  });

  ipcMain.handle('system:open-path', async (_evt, targetPath) => {
    if (!targetPath) return false;
    const err = await shell.openPath(targetPath);
    return err === '';
  });

  ipcMain.handle('app:confirm-close', () => {
    allowAppClose = true;
    if (appCloseFallbackTimer) { clearTimeout(appCloseFallbackTimer); appCloseFallbackTimer = null; }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    return true;
  });

  ipcMain.handle('system:delete-file', async (_evt, projectPath, relPath) => {
    if (!relPath || typeof relPath !== 'string') return false;
    if (!projectPath || typeof projectPath !== 'string') return false;
    // Two checks, not one: the directory has to actually be a project (either
    // under our projects root or holding a project.json), and the asset has to
    // resolve inside it. Validating only the second lets the renderer pass
    // projectPath='C:\\' and delete anything on the drive.
    const projectDir = path.resolve(projectPath);
    const isKnownProjectDir = isWithinDir(path.resolve(PROJECTS_ROOT), projectDir)
      || (await pathExists(path.join(projectDir, 'project.json')));
    if (!isKnownProjectDir) return false;

    const target = projectAbsolute(projectDir, relPath);
    if (!target || isWithinDir(target, projectDir)) return false;
    try {
      await fs.unlink(target);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('projects:get-deploy-path', async () => {
    const settings = await getDeploySettings();
    return settings.websitePath || null;
  });

  ipcMain.handle('projects:deploy-to-website', async (_evt, project, options) => {
    const settings = await getDeploySettings();
    const defaultPath = settings.websitePath || undefined;

    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Website Root Folder',
      defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };

    const websiteDir = result.filePaths[0];
    await saveDeploySettings({ ...settings, websitePath: websiteDir });

    const health = await runProjectHealthCheck(project, options);
    if (!health.ok) {
      return { canceled: true, notes: `Health check failed:\n${health.issues.join('\n')}` };
    }

    let deployed;
    try {
      deployed = await deployToWebsite(project, options || {}, websiteDir);
    } catch (err) {
      // Clear saved path if it was wrong so user gets prompted again
      await saveDeploySettings({ ...settings, websitePath: undefined });
      return { canceled: true, notes: err.message || String(err) };
    }
    return {
      canceled: false,
      exportDir: deployed.exportDir,
      tourId: deployed.tourId,
      tourPath: deployed.tourPath,
      pageFile: deployed.pageFile,
    };
  });
  ipcMain.handle('projects:preview-export', async (_evt, project, options) => {
    const health = await runProjectHealthCheck(project, options);
    if (!health.ok) {
      throw new Error(`Health check failed:\n${health.issues.join('\n')}`);
    }

    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panoradesk-preview-'));
    const exported = await performExport(project, { ...(options || {}), zipOutput: false }, baseDir);

    const existing = previewServers.get('active');
    if (existing) {
      previewServers.delete('active');
      await cleanupPreviewInstance(existing);
    }

    const { server, url } = await startStaticServer(exported.exportDir);
    const previewInstance = { server, root: exported.exportDir, tempRoot: baseDir };
    previewServers.set('active', previewInstance);

    const previewWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      autoHideMenuBar: true,
      ...(APP_WINDOW_ICON ? { icon: APP_WINDOW_ICON } : {}),
    });
    await previewWindow.loadURL(url);

    previewWindow.on('closed', () => {
      const active = previewServers.get('active');
      if (active === previewInstance) {
        previewServers.delete('active');
      }
      void cleanupPreviewInstance(previewInstance);
    });

    return { url, exportDir: exported.exportDir };
  });

  ipcMain.handle('projects:inline-preview', async (_evt, project, options) => {
    const health = await runProjectHealthCheck(project, options);
    if (!health.ok) {
      throw new Error(`Health check failed:\n${health.issues.join('\n')}`);
    }
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'panoradesk-inline-'));
    const exported = await performExport(project, { ...(options || {}), zipOutput: false }, baseDir);
    const existing = previewServers.get('inline');
    if (existing) {
      previewServers.delete('inline');
      await cleanupPreviewInstance(existing);
    }
    const { server, url } = await startStaticServer(exported.exportDir);
    previewServers.set('inline', { server, root: exported.exportDir, tempRoot: baseDir });
    return { url };
  });

  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Every live preview, not just the windowed one — the inline preview used to
  // be skipped here and left a full copy of the exported tour in %TEMP%.
  for (const [key, instance] of Array.from(previewServers.entries())) {
    previewServers.delete(key);
    try { instance?.server?.close(); } catch {}
    const tempRoot = instance?.tempRoot || instance?.root;
    if (!tempRoot) continue;
    // Synchronous on purpose: an awaited rm would not finish before exit.
    try { fsSync.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  }
});
