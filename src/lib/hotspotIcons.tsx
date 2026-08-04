import React from 'react';
// A bare `export ... from` creates no local binding, so getHotspotIconLabel
// below was calling an undefined name at runtime. Import, then re-export.
import { normalizeHotspotIconId, hotspotHtmlIconGlyph } from './hotspotGlyphs';
export { normalizeHotspotIconId, hotspotHtmlIconGlyph };

export type HotspotAnimation = 'none' | 'pulse' | 'ping' | 'breathe' | 'float' | 'glow' | 'arrow-bounce' | 'blink' | 'ring-expand' | 'ring-ping';

export type HotspotIconItem = {
  id: string;
  label: string;
  category: string;
  Component: React.ComponentType<{ size?: number; stroke?: number }>;
};

const TextIcon = (glyph: string): React.FC<{ size?: number; stroke?: number }> =>
  ({ size = 16 }) => (
    <span style={{ fontSize: Math.max(12, size - 2), lineHeight: 1 }}>{glyph}</span>
  );

const EmptyIcon: React.FC<{ size?: number; stroke?: number }> = () => null;

const PulseCoreIcon: React.FC<{ size?: number; stroke?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" />
  </svg>
);

const FloorPulseRingIcon: React.FC<{ size?: number; stroke?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <ellipse cx="12" cy="12.4" rx="9.4" ry="4.2" stroke="currentColor" strokeWidth="1.8" />
    <ellipse cx="12" cy="12.4" rx="6.7" ry="2.8" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.3" />
    <circle cx="12" cy="12.4" r="1.4" fill="currentColor" />
  </svg>
);

const CircleFloorIcon: React.FC<{ size?: number; stroke?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <ellipse cx="12" cy="12.3" rx="9.2" ry="3.7" stroke="currentColor" strokeWidth="1.8" />
    <ellipse cx="12" cy="12.3" rx="6.2" ry="2.35" stroke="currentColor" strokeOpacity="0.62" strokeWidth="1.4" />
    <circle cx="12" cy="12.3" r="1.2" fill="currentColor" />
  </svg>
);

export const HOTSPOT_ICONS: HotspotIconItem[] = [
  { id: 'nav-next',       label: 'Next room',      category: 'Navigation',   Component: TextIcon('\u279C') },
  { id: 'nav-prev',       label: 'Go back',        category: 'Navigation',   Component: TextIcon('\u2B05') },
  { id: 'nav-door',       label: 'Enter room',     category: 'Navigation',   Component: TextIcon('\u{1F6AA}') },
  { id: 'nav-stairs',     label: 'Upstairs',       category: 'Navigation',   Component: TextIcon('\u{1F53C}') },
  { id: 'nav-floor',      label: 'Floor marker',   category: 'Navigation',   Component: TextIcon('\u2B07') },
  { id: 'nav-default',    label: 'Classic ring',   category: 'Navigation',   Component: EmptyIcon },

  { id: 'pulse-core',     label: 'Pulse dot',      category: 'Pulse Styles', Component: PulseCoreIcon },
  { id: 'vista-pulse',    label: '3DVista pulse',  category: 'Pulse Styles', Component: PulseCoreIcon },
  { id: 'floor-pulse-ring', label: 'Floor pulse ring', category: 'Pulse Styles', Component: FloorPulseRingIcon },
  { id: 'floor-circle',   label: 'Circle floor',   category: 'Pulse Styles', Component: CircleFloorIcon },
  { id: 'floor-ring',     label: 'Floor ring (legacy)', category: 'Pulse Styles', Component: FloorPulseRingIcon },

  { id: 'info-general',   label: 'Room info',      category: 'Information',  Component: TextIcon('\u2139') },
  { id: 'info-bed',       label: 'Bedroom',        category: 'Information',  Component: TextIcon('\u{1F6CF}') },
  { id: 'info-pool',      label: 'Pool',           category: 'Information',  Component: TextIcon('\u{1F30A}') },
  { id: 'info-wifi',      label: 'WiFi',           category: 'Information',  Component: TextIcon('\u{1F4F6}') },
  { id: 'info-ac',        label: 'A/C',            category: 'Information',  Component: TextIcon('\u2744') },
  { id: 'info-kitchen',   label: 'Kitchen',        category: 'Information',  Component: TextIcon('\u{1F373}') },

  { id: 'media-gallery',  label: 'Photo gallery',  category: 'Media',        Component: TextIcon('\u{1F4F7}') },
  { id: 'media-video',    label: 'Video clip',     category: 'Media',        Component: TextIcon('\u25B6') },
  { id: 'media-music',    label: 'Ambient audio',  category: 'Media',        Component: TextIcon('\u{1F3B5}') },
  { id: 'media-360',      label: 'Jump to pano',   category: 'Media',        Component: TextIcon('360') },

  { id: 'conv-book',      label: 'Book now',       category: 'Conversion',   Component: TextIcon('\u{1F4C5}') },
  { id: 'conv-wa',        label: 'WhatsApp host',  category: 'Conversion',   Component: TextIcon('\u{1F4AC}') },
  { id: 'conv-qr',        label: 'QR / listing',   category: 'Conversion',   Component: TextIcon('\u25A3') },
  { id: 'conv-review',    label: 'Leave review',   category: 'Conversion',   Component: TextIcon('\u2605') },

  { id: 'guest-rules',    label: 'House rules',    category: 'Guest Info',   Component: TextIcon('\u{1F4CB}') },
  { id: 'guest-wifi',     label: 'WiFi password',  category: 'Guest Info',   Component: TextIcon('\u{1F511}') },
  { id: 'guest-emergency',label: 'Emergency',      category: 'Guest Info',   Component: TextIcon('\u{1F6A8}') },
  { id: 'guest-checkin',  label: 'Check-in guide', category: 'Guest Info',   Component: TextIcon('\u{1F3E0}') },
];

export const LUCIDE_ICON_NAMES: string[] = [];

export function getHotspotIconLabel(iconId?: string) {
  return HOTSPOT_ICONS.find((item) => item.id === normalizeHotspotIconId(iconId))?.label || 'Floor marker';
}
