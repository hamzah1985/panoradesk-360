// Pure icon-ID list and glyph helpers — no React, safe to import anywhere including the export player.

export const HOTSPOT_ICON_IDS = [
  'nav-next', 'nav-prev', 'nav-door', 'nav-stairs', 'nav-floor', 'nav-default',
  'pulse-core', 'vista-pulse', 'floor-pulse-ring', 'floor-circle', 'floor-ring',
  'info-general', 'info-bed', 'info-pool', 'info-wifi', 'info-ac', 'info-kitchen',
  'media-gallery', 'media-video', 'media-music', 'media-360',
  'conv-book', 'conv-wa', 'conv-qr', 'conv-review',
  'guest-rules', 'guest-wifi', 'guest-emergency', 'guest-checkin',
] as const;

export type HotspotIconId = typeof HOTSPOT_ICON_IDS[number];

export function normalizeHotspotIconId(iconId?: string): string {
  const raw = String(iconId || '').trim().toLowerCase();
  const aliased = raw === 'circle-floor' ? 'floor-circle' : raw;
  if ((HOTSPOT_ICON_IDS as readonly string[]).includes(aliased)) return aliased;
  return 'nav-default';
}

export function hotspotHtmlIconGlyph(id?: string): string {
  const key = normalizeHotspotIconId(id);
  if (key === 'nav-next') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  if (key === 'nav-prev') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
  if (key === 'nav-door') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="10" height="18" rx="1"/><path d="M14 8h4M14 16h4M18 3v18"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>';
  if (key === 'nav-stairs') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4v-4h4v-4h4v-4h4"/><path d="M4 20V8"/></svg>';
  if (key === 'nav-floor') return '⬇';
  if (key === 'nav-default') return '';
  if (key === 'pulse-core') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.7" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.7"/><circle cx="12" cy="12" r="5.3" stroke="currentColor" stroke-opacity="0.85" stroke-width="1.7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/></svg>';
  if (key === 'vista-pulse') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.42" stroke-width="1.4"/><circle cx="12" cy="12" r="6.1" stroke="currentColor" stroke-opacity="0.72" stroke-width="1.4"/><circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-opacity="0.9" stroke-width="1.4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>';
  if (key === 'floor-pulse-ring') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12.3" rx="8.9" ry="3.9" stroke="currentColor" stroke-width="1.8"/><ellipse cx="12" cy="12.3" rx="5.8" ry="2.45" stroke="currentColor" stroke-opacity="0.62" stroke-width="1.2"/><circle cx="12" cy="12.3" r="1.1" fill="currentColor"/></svg>';
  if (key === 'floor-circle') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12.2" rx="9" ry="3.5" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12.2" rx="6.2" ry="2.4" stroke="currentColor" stroke-opacity="0.52" stroke-width="1.4"/><circle cx="12" cy="12.2" r="1.1" fill="currentColor"/></svg>';
  if (key === 'floor-ring') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="12.2" rx="8.6" ry="3.2" stroke="currentColor" stroke-width="1.8"/></svg>';
  if (key === 'info-general') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 10v6"/><circle cx="12" cy="7.5" r="1" fill="currentColor"/></svg>';
  if (key === 'info-bed') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10M21 7v10M3 12h18M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2M3 17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2M8 5v7M8 5a2 2 0 0 1 4 0v7"/></svg>';
  if (key === 'info-pool') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0M2 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/><path d="M7 7a3 3 0 1 0 6 0c0-1.5-1-2-2-3.5C10 2 9 2 8.5 2 7.5 2 7 3 7 4"/></svg>';
  if (key === 'info-wifi') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/></svg>';
  if (key === 'info-ac') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="8" rx="2"/><path d="M7 14v2M12 14v2M17 14v2M3 10h18M7 18l-1 2M12 18v2M17 18l1 2"/></svg>';
  if (key === 'info-kitchen') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5H3zM3 11V7a5 5 0 0 1 5-5c2 0 3.5 1 4 2.5M10 11V7"/><circle cx="17" cy="6" r="3"/><path d="M17 3v3l2 1"/></svg>';
  if (key === 'media-gallery') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M8 5l1.5-2h5L16 5"/></svg>';
  if (key === 'media-video') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg>';
  if (key === 'media-music') return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  if (key === 'media-360') return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9"/><path d="M17 3c0 2.8-2.2 5-5 5"/><path d="M22 3l-5 5M22 3h-5M22 3v5"/></svg>';
  if (key === 'conv-book') return '\u{1F4C5}';
  if (key === 'conv-wa') return '\u{1F4AC}';
  if (key === 'conv-qr') return '▣';
  if (key === 'conv-review') return '★';
  if (key === 'guest-rules') return '\u{1F4CB}';
  if (key === 'guest-wifi') return '\u{1F511}';
  if (key === 'guest-emergency') return '\u{1F6A8}';
  if (key === 'guest-checkin') return '\u{1F3E0}';
  return '';
}
