import { Project } from '../types';

type SceneImport = {
  name: string;
  image: string;
  thumbnail: string;
};

type SceneImportResult = {
  projectPath: string;
  scenes: SceneImport[];
};

type AssetUploadResult = {
  projectPath: string;
  path: string;
};

export type SceneImportProgress = {
  stage: 'start' | 'processing' | 'done';
  total: number;
  current: number;
  currentFile: string | null;
};

export type ExportOptions = {
  includeBranding: boolean;
  includeFloorPlan: boolean;
  includeGallery: boolean;
  template: 'minimal' | 'luxury' | 'construction';
  imageOptimization: 'none' | 'balanced' | 'aggressive';
  showLoadingScreen: boolean;
  zipOutput: boolean;
  iframe: {
    width: string;
    height: string;
    allowFullscreen: boolean;
  };
};

export type ExportResult = {
  canceled: boolean;
  exportDir?: string;
  zipPath?: string;
  iframeCode?: string;
  notes?: string;
};

export type ProjectHealthResult = {
  ok: boolean;
  issues: string[];
  warnings: string[];
};

export interface DesktopApi {
  listProjects: () => Promise<Project[]>;
  deleteProject: (projectId: string, projectPath?: string) => Promise<boolean>;
  saveProject: (project: Project) => Promise<Project>;
  openProjectDialog: () => Promise<Project | null>;
  openProjectFile: (filePath: string) => Promise<Project | null>;
  getPathForFile?: (file: File) => string;
  pickProjectDirectory: () => Promise<string | null>;
  importSceneImages: (project: Project) => Promise<SceneImportResult>;
  onSceneImportProgress: (callback: (progress: SceneImportProgress) => void) => () => void;
  replaceSceneImage: (project: Project) => Promise<{ projectPath: string; image: string; thumbnail: string } | null>;
  uploadLogo: (project: Project) => Promise<AssetUploadResult | null>;
  uploadFloorPlan: (project: Project) => Promise<AssetUploadResult | null>;
  checkProjectHealth: (project: Project, options?: Partial<ExportOptions>) => Promise<ProjectHealthResult>;
  exportWebProject: (project: Project, options: ExportOptions) => Promise<ExportResult>;
  previewWebExport: (project: Project, options: ExportOptions) => Promise<{ url: string; exportDir: string }>;
  getInlinePreviewUrl: (project: Project, options: ExportOptions) => Promise<{ url: string }>;
  releaseInlinePreview?: () => Promise<boolean>;
  openPathInFileManager: (targetPath: string) => Promise<boolean>;
  deleteFile: (projectPath: string, relPath: string) => Promise<boolean>;
  onFlushBeforeClose?: (callback: (requestId: string) => void | Promise<void>) => () => void;
  confirmClose?: (requestId: string) => Promise<boolean>;
  cancelClose?: (requestId: string) => Promise<boolean>;
  getDeployPath: () => Promise<string | null>;
  deployToWebsite: (project: Project, options: ExportOptions) => Promise<{ canceled: boolean; exportDir?: string; tourId?: string; tourPath?: string; pageFile?: string; notes?: string }>;
  getMenuBarVisible: () => Promise<boolean>;
  setMenuBarVisible: (visible: boolean) => Promise<boolean>;
  toggleMenuBarVisible: () => Promise<boolean>;
}

export function getDesktopApi(): DesktopApi | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
}
