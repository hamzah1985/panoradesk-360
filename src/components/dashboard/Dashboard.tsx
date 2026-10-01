import React from 'react';
import { Plus, FolderOpen, Clock, X, Trash2, ChevronRight, Search, Pencil, Check } from 'lucide-react';
import { useProjectStore, listProjects, openProjectFromDialog, deleteProject, openPathInFileManager, renameProjectInList } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { resolveAssetSrc } from '../../lib/media';
import appLogo from '../../assets/app-logo.svg';
import { getDesktopApi } from '../../lib/desktop';
import { BUILD_NUMBER } from '../../lib/buildInfo';

const LAST_PROJECT_PARENT_DIR_KEY = 'panoradesk_parent_project_dir';

function sanitizeFolderName(name: string) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'New Project';
}

function joinPath(parent: string, child: string) {
  const p = String(parent || '').trim();
  if (!p) return child;
  const sep = p.includes('\\') ? '\\' : '/';
  const trimmed = p.replace(/[\\/]+$/g, '');
  return `${trimmed}${sep}${child}`;
}

function makeUniqueProjectName(baseName: string, existingNames: string[]) {
  const base = String(baseName || '').trim() || 'New Project';
  const existing = new Set(
    (existingNames || [])
      .map((name) => String(name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const existingFolders = new Set(
    (existingNames || []).map((name) => sanitizeFolderName(String(name || '')).toLowerCase()),
  );
  if (!existing.has(base.toLowerCase()) && !existingFolders.has(sanitizeFolderName(base).toLowerCase())) return base;
  let idx = 2;
  while (
    existing.has(`${base} (${idx})`.toLowerCase())
    || existingFolders.has(sanitizeFolderName(`${base} (${idx})`).toLowerCase())
  ) idx += 1;
  return `${base} (${idx})`;
}

function relativeTime(date: string | undefined) {
  if (!date) return 'Unknown';
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function projectOpenFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const safeFailure = 'This project cannot be opened safely';
  const safeFailureIndex = message.indexOf(safeFailure);
  return safeFailureIndex >= 0
    ? message.slice(safeFailureIndex)
    : 'Failed to open project file';
}

const SphereBg = () => (
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden select-none" style={{ opacity: 0.12 }}>
    <svg width="820" height="820" viewBox="0 0 820 820" fill="none">
      {[0.08, 0.22, 0.38, 0.5, 0.62, 0.78, 0.92].map((t, i) => {
        const cy = 410 + (t - 0.5) * 820;
        const factor = Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.5) * 2, 2)));
        const rx = factor * 410;
        const ry = rx * 0.28;
        return <ellipse key={i} cx="410" cy={cy} rx={rx} ry={ry} stroke="white" strokeWidth="1" />;
      })}
      {[0, 36, 72, 108, 144].map((angle, i) => (
        <ellipse key={i} cx="410" cy="410" rx={410 * Math.abs(Math.cos(angle * Math.PI / 180)) || 2} ry="410" stroke="white" strokeWidth="1" transform={`rotate(${angle} 410 410)`} />
      ))}
      <circle cx="410" cy="410" r="409" stroke="white" strokeWidth="1.5" />
    </svg>
  </div>
);

const Dashboard = () => {
  const { createNewProject, setProject } = useProjectStore();
  const { openConfirm, pushToast } = useUiStore();
  const [recentProjects, setRecentProjects] = React.useState<any[]>([]);
  const [isNewModalOpen, setIsNewModalOpen] = React.useState(false);
  const [projectName, setProjectName] = React.useState('New 360 Tour');
  const [projectFolder, setProjectFolder] = React.useState('');
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renamingPath, setRenamingPath] = React.useState<string | undefined>(undefined);
  const [renamingValue, setRenamingValue] = React.useState('');
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const [recentQuery, setRecentQuery] = React.useState('');
  const [isRecentLoading, setIsRecentLoading] = React.useState(false);
  const [recentLoadError, setRecentLoadError] = React.useState('');
  const [activeRecentId, setActiveRecentId] = React.useState('');
  const [isDragOver, setIsDragOver] = React.useState(false);
  const mountedRef = React.useRef(true);
  const projectOpenSequenceRef = React.useRef(0);

  React.useEffect(() => {
    // React StrictMode intentionally runs an effect setup/cleanup/setup cycle
    // in development. Re-arm the guard during setup so the real mount can
    // still accept the async project-list result.
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadRecentProjects = React.useCallback(async () => {
    setIsRecentLoading(true);
    setRecentLoadError('');
    try {
      const data = await listProjects();
      if (!mountedRef.current) return;
      setRecentProjects(data);
    } catch {
      if (!mountedRef.current) return;
      setRecentLoadError('Unable to load recent projects.');
    } finally {
      if (!mountedRef.current) return;
      setIsRecentLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadRecentProjects(); }, [loadRecentProjects]);
  useEscapeClose(isNewModalOpen, () => setIsNewModalOpen(false));

  const handleNewProject = React.useCallback(() => {
    projectOpenSequenceRef.current += 1;
    setProjectName('New 360 Tour');
    setProjectFolder(localStorage.getItem(LAST_PROJECT_PARENT_DIR_KEY) || '');
    setIsNewModalOpen(true);
  }, []);

  const browseProjectFolder = React.useCallback(async () => {
    const desktop = getDesktopApi();
    if (!desktop?.pickProjectDirectory) return;
    try {
      const selected = await desktop.pickProjectDirectory();
      if (selected) {
        setProjectFolder(selected);
        localStorage.setItem(LAST_PROJECT_PARENT_DIR_KEY, selected);
      }
    } catch {
      pushToast('error', 'Unable to choose project folder');
    }
  }, [pushToast]);

  const confirmCreateProject = () => {
    const cleanName = projectName.trim();
    if (!cleanName) return;
    const uniqueName = makeUniqueProjectName(cleanName, recentProjects.map((p) => p?.name));
    const parentDir = projectFolder.trim();
    if (parentDir) localStorage.setItem(LAST_PROJECT_PARENT_DIR_KEY, parentDir);
    const projectDir = parentDir ? joinPath(parentDir, sanitizeFolderName(uniqueName)) : undefined;
    projectOpenSequenceRef.current += 1;
    createNewProject(uniqueName, projectDir);
    if (uniqueName !== cleanName) {
      pushToast('info', `Project name already exists. Created as "${uniqueName}"`);
    }
    setIsNewModalOpen(false);
  };

  const filteredRecent = React.useMemo(() => {
    const q = recentQuery.trim().toLowerCase();
    const base = [...recentProjects].sort((a, b) =>
      new Date(b?.modifiedDate || 0).getTime() - new Date(a?.modifiedDate || 0).getTime()
    );
    if (!q) return base;
    return base.filter((proj) => String(proj?.name || '').toLowerCase().includes(q));
  }, [recentProjects, recentQuery]);

  const handleOpenProject = React.useCallback(async () => {
    const sequence = ++projectOpenSequenceRef.current;
    try {
      const project = await openProjectFromDialog();
      if (project && mountedRef.current && projectOpenSequenceRef.current === sequence) setProject(project);
    } catch (error) {
      if (mountedRef.current && projectOpenSequenceRef.current === sequence) {
        pushToast('error', projectOpenFailureMessage(error));
      }
    }
  }, [setProject, pushToast]);

  const openRecentProject = React.useCallback((nextProject: any) => {
    projectOpenSequenceRef.current += 1;
    try {
      setProject(nextProject);
    } catch (error) {
      pushToast('error', projectOpenFailureMessage(error));
    }
  }, [setProject, pushToast]);

  React.useEffect(() => {
    if (!filteredRecent.length) { setActiveRecentId(''); return; }
    if (!activeRecentId || !filteredRecent.some((p) => p.id === activeRecentId)) {
      setActiveRecentId(filteredRecent[0].id);
    }
  }, [filteredRecent, activeRecentId]);

  const handleDeleteProject = React.useCallback(async (projectId: string, projectNameToDelete: string, projectPath?: string) => {
    openConfirm({
      title: 'Delete Project',
      message: `Delete "${projectNameToDelete}"${projectPath ? `\n${projectPath}` : ''} from disk? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        if (mountedRef.current) setDeletingId(projectId);
        try {
          const deleted = await deleteProject(projectId, projectPath);
          if (!deleted) { pushToast('error', 'Failed to delete project from disk'); return; }
          if (useProjectStore.getState().project?.id === projectId) setProject(null);
          await loadRecentProjects();
          pushToast('success', 'Project deleted');
        } catch {
          pushToast('error', 'Failed to delete project from disk');
        } finally {
          if (mountedRef.current) setDeletingId(null);
        }
      },
    });
  }, [openConfirm, loadRecentProjects, pushToast, setProject]);

  const startRename = React.useCallback((proj: any) => {
    setRenamingId(proj.id);
    setRenamingPath(proj.path);
    setRenamingValue(proj.name);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, []);

  const commitRename = React.useCallback(async () => {
    if (!renamingId || !renamingValue.trim()) { setRenamingId(null); setRenamingPath(undefined); return; }
    const ok = await renameProjectInList(renamingId, renamingValue.trim(), renamingPath);
    if (!ok) pushToast('error', 'Failed to rename project');
    else {
      setRecentProjects((prev) => prev.map((p) => p.id === renamingId ? { ...p, name: renamingValue.trim() } : p));
    }
    setRenamingId(null);
    setRenamingPath(undefined);
  }, [renamingId, renamingPath, renamingValue, pushToast]);

  const handleDrop = React.useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files) as File[];
    const jsonFile = files.find((file) => file.name.toLowerCase() === 'project.json')
      || files.find((file) => file.name.toLowerCase().endsWith('.json'));
    if (!jsonFile) return;
    const sequence = ++projectOpenSequenceRef.current;
    const desktop = getDesktopApi();
    try {
      if (!desktop?.openProjectFile) throw new Error('Desktop project opening is unavailable.');
      const filePath = desktop.getPathForFile?.(jsonFile)
        || ((jsonFile as any).path as string | undefined);
      if (!filePath) throw new Error('Unable to resolve the dropped project file.');
      const project = await desktop.openProjectFile(filePath);
      if (project && mountedRef.current && projectOpenSequenceRef.current === sequence) setProject(project);
    } catch (error) {
      if (mountedRef.current && projectOpenSequenceRef.current === sequence) {
        const message = projectOpenFailureMessage(error);
        pushToast(
          'error',
          message === 'Failed to open project file'
            ? 'Failed to open project file — drop the project.json from a PanoraDesk project folder'
            : message,
        );
      }
    }
  }, [setProject, pushToast]);

  React.useEffect(() => {
    if (isNewModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().confirm.open) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (active?.closest('button, a[href], [role="button"]')) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); handleNewProject(); return; }
      if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); void handleOpenProject(); return; }
      if (typing || filteredRecent.length === 0) return;
      const idx = Math.max(0, filteredRecent.findIndex((p) => p.id === activeRecentId));
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveRecentId(filteredRecent[Math.min(filteredRecent.length - 1, idx + 1)].id); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveRecentId(filteredRecent[Math.max(0, idx - 1)].id); return; }
      if (e.key === 'Enter') { const p = filteredRecent.find((p) => p.id === activeRecentId) || filteredRecent[0]; if (p) { e.preventDefault(); openRecentProject(p); } return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { const p = filteredRecent.find((p) => p.id === activeRecentId) || filteredRecent[0]; if (p) { e.preventDefault(); void handleDeleteProject(p.id, p.name, p.path); } }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNewModalOpen, filteredRecent, activeRecentId, handleDeleteProject, handleNewProject, handleOpenProject, openRecentProject]);

  return (
    <div
      className="h-full w-full flex flex-col relative overflow-hidden text-white"
      style={{ background: 'radial-gradient(ellipse at 55% 35%, #0d1b2e 0%, #060c18 65%, #02060f 100%)' }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={handleDrop}
    >
      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.12) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
          opacity: 0.18,
        }}
      />
      <SphereBg />

      {/* Drag-over overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center" style={{ background: 'rgba(200,169,106,0.08)', border: '2px dashed rgba(200,169,106,0.5)' }}>
          <div className="text-center">
            <div className="text-2xl font-bold mb-2" style={{ color: '#C8A96A' }}>Drop project file</div>
            <div className="text-sm text-slate-400">Release to open .json project</div>
          </div>
        </div>
      )}

      {/* Top accent line */}
      <div className="relative z-10 h-px flex-shrink-0" style={{ background: 'linear-gradient(90deg, transparent, rgba(200,169,106,0.4) 40%, rgba(200,169,106,0.4) 60%, transparent)' }} />

      {/* Main content */}
      <div className="flex-1 flex flex-col relative z-10 overflow-hidden">

        {/* Header */}
        <div className="flex-shrink-0 px-10 pt-7 pb-5">
          <div className="flex items-center justify-between">
            {/* Branding */}
            <div className="flex items-center gap-3.5">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 rounded-xl blur-xl" style={{ background: 'rgba(200,169,106,0.4)', transform: 'scale(1.5)' }} />
                <div className="relative rounded-xl overflow-hidden shadow-xl" style={{ border: '1px solid rgba(200,169,106,0.25)' }}>
                  <img src={appLogo} alt="PanoraDesk 360" className="w-10 h-10 object-cover" />
                </div>
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight leading-none">
                  PanoraDesk <span style={{ color: '#C8A96A' }}>360</span>
                </h1>
                <p className="text-slate-500 text-[11px] mt-0.5 tracking-wide">Professional 360° virtual tour editor</p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewProject}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200"
                style={{ background: 'rgba(200,169,106,0.12)', border: '1px solid rgba(200,169,106,0.3)', color: '#C8A96A' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(200,169,106,0.22)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(200,169,106,0.12)'; }}
              >
                <Plus className="w-4 h-4" />
                New Project
                <span className="ml-1 text-[10px] font-normal opacity-60">Ctrl+N</span>
              </button>
              <button
                onClick={() => void handleOpenProject()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm text-slate-300 transition-all duration-200"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.11)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
              >
                <FolderOpen className="w-4 h-4" />
                Open Project
                <span className="ml-1 text-[10px] font-normal opacity-60">Ctrl+O</span>
              </button>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-10 h-px flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />

        {/* Recent projects section */}
        <div className="flex-1 min-h-0 flex flex-col px-10 pt-5 pb-4">
          {/* Section header */}
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <div className="flex items-center gap-2 text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold uppercase tracking-widest">Recent Projects</span>
              {recentProjects.length > 0 && (
                <span className="text-[10px] text-slate-600">{filteredRecent.length} of {recentProjects.length}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" />
                <input
                  value={recentQuery}
                  onChange={(e) => setRecentQuery(e.target.value)}
                  placeholder="Search projects..."
                  className="w-48 pl-8 pr-3 py-1.5 rounded-lg text-[11px] text-slate-300 placeholder:text-slate-600 outline-none"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              </div>
              {filteredRecent.length > 0 && (
                <button
                  type="button"
                  onClick={() => { const p = filteredRecent[0]; if (p) openRecentProject(p); }}
                  className="flex items-center gap-1 text-[10px] font-semibold transition-colors"
                  style={{ color: '#C8A96A' }}
                >
                  Open Latest <ChevronRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Project grid */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar-dark">
            {isRecentLoading && (
              <div className="grid grid-cols-4 gap-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="aspect-video bg-slate-800 animate-pulse" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 rounded bg-slate-800 animate-pulse w-3/4" />
                      <div className="h-2 rounded bg-slate-800 animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!isRecentLoading && !!recentLoadError && (
              <div className="py-16 text-center text-xs text-red-400">
                {recentLoadError}
                <button type="button" onClick={() => void loadRecentProjects()} className="block mx-auto mt-2 text-[10px] underline">Retry</button>
              </div>
            )}
            {!isRecentLoading && !recentLoadError && recentProjects.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center py-24">
                <div className="w-16 h-16 rounded-2xl mb-5 flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <FolderOpen className="w-7 h-7 text-slate-700" />
                </div>
                <div className="text-slate-500 text-sm font-medium mb-1">No projects yet</div>
                <div className="text-slate-700 text-[11px]">Create a new project to get started</div>
                <button
                  onClick={handleNewProject}
                  className="mt-5 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                  style={{ background: 'rgba(200,169,106,0.12)', border: '1px solid rgba(200,169,106,0.25)', color: '#C8A96A' }}
                >
                  <Plus className="w-4 h-4" /> Create First Project
                </button>
              </div>
            )}
            {!isRecentLoading && !recentLoadError && recentProjects.length > 0 && filteredRecent.length === 0 && (
              <div className="py-16 text-center text-xs text-slate-600">No projects match your search</div>
            )}
            {!isRecentLoading && !recentLoadError && filteredRecent.length > 0 && (
              <div className="grid grid-cols-4 gap-4 pb-2">
                {filteredRecent.map((proj) => {
                  const isActive = activeRecentId === proj.id;
                  const sceneCount = proj.scenes?.length ?? null;
                  const thumbSrc = proj.scenes?.[0]?.thumbnail || proj.scenes?.[0]?.image;
                  return (
                    <div
                      key={proj.id}
                      onMouseEnter={() => setActiveRecentId(proj.id)}
                      className="group relative rounded-xl overflow-hidden flex flex-col transition-all duration-200 cursor-pointer"
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: isActive ? '1px solid rgba(200,169,106,0.35)' : '1px solid rgba(255,255,255,0.07)',
                        boxShadow: isActive ? '0 0 24px rgba(200,169,106,0.08)' : 'none',
                      }}
                    >
                      {/* Thumbnail */}
                      <div className="aspect-video bg-slate-900 overflow-hidden flex-shrink-0 relative">
                        {thumbSrc ? (
                          <img
                            src={resolveAssetSrc(proj, thumbSrc)}
                            alt=""
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.03)' }}>
                            <svg className="w-8 h-8 text-slate-800" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="1" /><path d="M12 2a10 10 0 0 1 0 20" strokeWidth="1" /><path d="M2 12h20" strokeWidth="1" /></svg>
                          </div>
                        )}
                        {/* Hover overlay with open button */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.45)' }}>
                          <button
                            type="button"
                            onClick={() => openRecentProject(proj)}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                            style={{ background: 'rgba(200,169,106,0.9)' }}
                          >
                            Open
                          </button>
                        </div>
                        {/* Scene count badge */}
                        {sceneCount !== null && (
                          <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: 'rgba(0,0,0,0.7)', color: '#94a3b8' }}>
                            {sceneCount} scene{sceneCount !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="px-3 py-2.5 flex items-start justify-between gap-1 flex-1">
                        <div className="min-w-0 flex-1">
                          {renamingId === proj.id ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <input
                                ref={renameInputRef}
                                className="flex-1 bg-transparent border-b border-amber-400 text-[12px] font-semibold text-amber-200 outline-none px-0 py-0 min-w-0"
                                value={renamingValue}
                                onChange={(e) => setRenamingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void commitRename();
                                  if (e.key === 'Escape') { setRenamingId(null); setRenamingPath(undefined); }
                                }}
                                onBlur={() => { void commitRename(); }}
                                autoFocus
                              />
                              <button type="button" onClick={() => { void commitRename(); }} className="p-0.5 text-emerald-400 hover:text-emerald-300 flex-shrink-0"><Check className="w-3 h-3" /></button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openRecentProject(proj)}
                              onDoubleClick={(e) => { e.preventDefault(); startRename(proj); }}
                              className="text-left w-full"
                            >
                              <div className="font-semibold text-[12px] truncate leading-tight" style={{ color: isActive ? '#e2d4b8' : '#cbd5e1' }}>
                                {proj.name}
                              </div>
                              <div className="text-[10px] text-slate-600 mt-0.5">{relativeTime(proj.modifiedDate)}</div>
                            </button>
                          )}
                        </div>
                        {/* Action icons */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            type="button"
                            title="Rename"
                            onClick={(e) => { e.stopPropagation(); startRename(proj); }}
                            className="p-1 rounded transition-colors text-slate-600 hover:text-slate-300"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {!!proj?.path && (
                            <button
                              type="button"
                              title="Open folder"
                              onClick={(e) => { e.stopPropagation(); void openPathInFileManager(proj.path).then((ok) => { if (!ok) pushToast('error', 'Unable to open folder'); }); }}
                              className="p-1 rounded transition-colors text-slate-600 hover:text-slate-300"
                            >
                              <FolderOpen className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Delete project"
                            disabled={deletingId === proj.id}
                            onClick={(e) => { e.stopPropagation(); void handleDeleteProject(proj.id, proj.name, proj.path); }}
                            className="p-1 rounded transition-colors text-slate-600 hover:text-red-400 disabled:opacity-40"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="relative z-10 py-3 text-center border-t flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.18)' }}>
          Build {BUILD_NUMBER} · Professional Virtual Tour Editor
        </span>
      </div>

      {/* New Project Modal */}
      {isNewModalOpen && (
        <div
          onMouseDown={() => setIsNewModalOpen(false)}
          className="fixed inset-0 flex items-center justify-center z-[120]"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: 'linear-gradient(160deg,#0f172a 0%,#1a2540 100%)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: 'rgba(200,169,106,0.12)', border: '1px solid rgba(200,169,106,0.2)' }}>
                  <Plus className="w-4 h-4" style={{ color: '#C8A96A' }} />
                </div>
                <h3 className="font-bold text-white text-base">Create New Project</h3>
              </div>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-500 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal body */}
            <div className="p-6 space-y-5">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">Project Name</label>
                <input
                  autoFocus
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') confirmCreateProject(); }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm text-white outline-none transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                  }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(200,169,106,0.5)'; }}
                  onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-2">Save Location</label>
                <div className="flex gap-2">
                  <input
                    value={projectFolder}
                    onChange={(e) => setProjectFolder(e.target.value)}
                    placeholder="Choose where to save this project"
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm text-slate-300 placeholder:text-slate-600 outline-none"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
                    onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(200,169,106,0.5)'; }}
                    onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
                  />
                  <button
                    type="button"
                    onClick={() => { void browseProjectFolder(); }}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-colors"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                Cancel
              </button>
              <button
                disabled={!projectName.trim()}
                onClick={confirmCreateProject}
                className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #C8A96A, #a8883e)', boxShadow: '0 4px 16px rgba(200,169,106,0.3)' }}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
