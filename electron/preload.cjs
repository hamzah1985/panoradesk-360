const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  deleteProject: (projectId, projectPath) => ipcRenderer.invoke('projects:delete', projectId, projectPath),
  saveProject: (project) => ipcRenderer.invoke('projects:save', project),
  openProjectDialog: () => ipcRenderer.invoke('projects:open-dialog'),
  openProjectFile: (filePath) => ipcRenderer.invoke('projects:open-file', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickProjectDirectory: () => ipcRenderer.invoke('projects:pick-directory'),
  importSceneImages: (project) => ipcRenderer.invoke('media:import-scenes', project),
  replaceSceneImage: (project) => ipcRenderer.invoke('media:replace-scene-image', project),
  uploadLogo: (project) => ipcRenderer.invoke('media:upload-logo', project),
  uploadFloorPlan: (project) => ipcRenderer.invoke('media:upload-floorplan', project),
  checkProjectHealth: (project, options) => ipcRenderer.invoke('projects:health-check', project, options),
  exportWebProject: (project, options) => ipcRenderer.invoke('projects:export-web', project, options),
  previewWebExport: (project, options) => ipcRenderer.invoke('projects:preview-export', project, options),
  getInlinePreviewUrl: (project, options) => ipcRenderer.invoke('projects:inline-preview', project, options),
  releaseInlinePreview: () => ipcRenderer.invoke('projects:release-inline-preview'),
  openPathInFileManager: (targetPath) => ipcRenderer.invoke('system:open-path', targetPath),
  getMenuBarVisible: () => ipcRenderer.invoke('window:get-menu-visible'),
  setMenuBarVisible: (visible) => ipcRenderer.invoke('window:set-menu-visible', visible),
  toggleMenuBarVisible: () => ipcRenderer.invoke('window:toggle-menu-visible'),
  getDeployPath: () => ipcRenderer.invoke('projects:get-deploy-path'),
  deployToWebsite: (project, options) => ipcRenderer.invoke('projects:deploy-to-website', project, options),
  deleteFile: (projectPath, relPath) => ipcRenderer.invoke('system:delete-file', projectPath, relPath),
  confirmClose: (requestId) => ipcRenderer.invoke('app:confirm-close', requestId),
  cancelClose: (requestId) => ipcRenderer.invoke('app:cancel-close', requestId),
  onSceneImportProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('media:import-scenes-progress', listener);
    return () => ipcRenderer.removeListener('media:import-scenes-progress', listener);
  },
  onFlushBeforeClose: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => {
      const requestId = String(payload?.requestId || '');
      if (requestId) void callback(requestId);
    };
    ipcRenderer.on('app:flush-before-close', listener);
    return () => ipcRenderer.removeListener('app:flush-before-close', listener);
  },
});
