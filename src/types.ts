/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Hotspot {
  id: string;
  linkedHotspotId?: string;
  type: 'navigation';
  label: string;
  targetSceneId: string;
  yaw: number;
  pitch: number;
  targetYaw?: number;
  targetPitch?: number;
  customTargetView?: boolean;
  transitionType?: 'fade';
  transitionDuration?: number;
  entryYaw?: number;
  entryPitch?: number;
  icon?: string;
  animation?: 'none' | 'static' | 'pulse' | 'ping' | 'breathe' | 'float' | 'glow' | 'arrow-bounce' | 'blink' | 'ring-expand' | 'ring-ping';
  styleType?: 'filled' | 'outline' | 'ring' | 'diamond';
  color?: string;
  size?: number;
  opacity?: number;
  borderWidth?: number;
  floorCurve?: number;
  pulseSpeed?: number;
  ringCount?: number;
  ringWidth?: number;
  navigationMode?: 'original' | 'marzipano' | 'pannellum';
}

export interface Marker {
  id: string;
  type: 'info';
  title: string;
  description: string;
  yaw: number;
  pitch: number;
  icon?: string;
  image?: string;
  link?: string;
}

export interface Scene {
  id: string;
  name: string;
  image: string;
  thumbnail: string;
  initialYaw: number;
  initialPitch: number;
  initialZoom: number;
  introTitle?: string;
  introDescription?: string;
  hotspots: Hotspot[];
  markers: Marker[];
  floorPlan?: {
    x: number;
    y: number;
  };
}

export interface ExportSettings {
  title: string;
  description: string;
  includeBranding: boolean;
  allowFullscreen: boolean;
  showSceneMenu: boolean;
  showGallery: boolean;
  showFloorPlan: boolean;
  showSceneNames?: boolean;
  exportTemplate?: 'minimal' | 'luxury' | 'construction';
  imageOptimization?: 'none' | 'balanced' | 'aggressive';
  showLoadingScreen?: boolean;
}

export interface HotspotStyleSettings {
  iconType: string;
  color: string;
  size: number;
  opacity?: number;
  borderWidth?: number;
  floorCurve?: number;
  pulseSpeed?: number;
  ringCount?: number;
  ringWidth?: number;
  animation?: 'none' | 'static' | 'pulse' | 'ping' | 'breathe' | 'float' | 'glow' | 'arrow-bounce' | 'blink' | 'ring-expand' | 'ring-ping';
  styleType?: 'filled' | 'outline' | 'ring' | 'diamond';
}

export interface BrandingSettings {
  companyName: string;
  websiteUrl: string;
  logoPath?: string;
  primaryColor: string;
  secondaryColor: string;
  showBranding: boolean;
}

export interface Project {
  id: string;
  name: string;
  company: string;
  website: string;
  logo?: string;
  floorPlanImage?: string;
  galleryImages?: string[];
  primaryColor: string;
  scenes: Scene[];
  exportSettings: ExportSettings;
  brandingSettings: BrandingSettings;
  hotspotStyle: HotspotStyleSettings;
  createdDate: string;
  modifiedDate: string;
  path?: string;
}

export enum AppMode {
  DASHBOARD = 'dashboard',
  EDITOR = 'editor',
  PREVIEW = 'preview',
}
