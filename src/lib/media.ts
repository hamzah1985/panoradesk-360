import { Project } from '../types';

export function isRelativeAssetPath(value?: string): boolean {
  if (!value) return false;
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return false;
  if (lower.startsWith('data:')) return false;
  if (lower.startsWith('app-media://')) return false;
  if (lower.startsWith('file://')) return false;
  if (normalized.startsWith('/') || normalized.startsWith('\\\\') || normalized.startsWith('//')) return false;
  if (/^[A-Za-z]:[\\/]/.test(normalized)) return false;
  return true;
}

// Assets are served through the app-media:// scheme registered in the main
// process rather than file://. A packaged build could load file:// directly,
// but in dev the renderer is an http://localhost origin and Chromium blocks
// file:// subresources — this one path works in both.
function toAppMediaUrl(absPath: string): string {
  // Carry the exact absolute path in a query parameter. Encoding path segments
  // after stripping leading slashes loses UNC (//server/share) and POSIX roots.
  return `app-media://local/file?path=${encodeURIComponent(String(absPath || ''))}`;
}

export function resolveAssetSrc(project: Project | null, value?: string): string {
  if (!value) return '';
  const normalized = value.trim();
  const lower = normalized.toLowerCase();

  // Already addressed through our scheme — the main process serves it as-is.
  if (lower.startsWith('app-media://')) return normalized;

  if (!project?.path) return normalized;
  if (!isRelativeAssetPath(normalized)) return normalized;

  const relParts = normalized.replace(/^\/+/, '').replace(/\\/g, '/').split('/');
  // Project assets are allowed to resolve only inside the project folder.
  // Reject traversal instead of handing an arbitrary local file to app-media.
  if (relParts.some((segment) => segment === '..')) return '';
  const rel = relParts.filter((segment) => segment && segment !== '.').join('/');
  if (!rel) return '';
  const base = project.path.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return toAppMediaUrl(`${base}/${rel}`);
}
