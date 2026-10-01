import React from 'react';
import {
  captureProjectSession,
  deleteProject,
  openPathInFileManager,
  ownsProjectSession,
  runProjectOperation,
  useProjectStore,
  type ProjectSessionToken,
} from '../../store/projectStore';
import { Settings, X, Building2, Palette, Image as ImageIcon, FolderOpen, ExternalLink, Trash2, Copy, CalendarDays, Map as MapIcon, Eye, GalleryHorizontal, Plus } from 'lucide-react';
import { getDesktopApi } from '../../lib/desktop';
import { resolveAssetSrc } from '../../lib/media';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useUiStore } from '../../store/uiStore';
import { AppMode, type Project } from '../../types';

interface ProjectSettingsModalProps {
  onClose: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error(`Failed to read ${file.name}`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was canceled`));
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });
}

const ProjectSettingsModal: React.FC<ProjectSettingsModalProps> = ({ onClose }) => {
  const { project, updateProject, setProject, setMode } = useProjectStore();
  const { pushToast, openConfirm } = useUiStore();
  const [copiedPath, setCopiedPath] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const copiedTimerRef = React.useRef<number | null>(null);
  const floorPlanInputRef = React.useRef<HTMLInputElement>(null);
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const mountedRef = React.useRef(true);
  useEscapeClose(true, onClose);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const captureProjectOwner = React.useCallback(
    (projectId: string): ProjectSessionToken => captureProjectSession(projectId),
    [],
  );

  // Persistent upload completions belong to the editor session, not to this
  // modal's mounted lifetime. Closing Settings must not discard a file that
  // was already copied/read successfully.
  const ownsProject = React.useCallback((owner: ProjectSessionToken) => ownsProjectSession(owner), []);
  const ownsMountedProject = React.useCallback((owner: ProjectSessionToken) => (
    mountedRef.current && ownsProjectSession(owner)
  ), []);

  const updateOwnedProject = React.useCallback((owner: ProjectSessionToken, updates: Partial<Project>) => {
    if (!ownsProject(owner)) return false;
    useProjectStore.getState().updateProject(updates);
    return true;
  }, [ownsProject]);

  const handleDeleteProject = React.useCallback(() => {
    if (!project?.id) return;
    const owner = captureProjectOwner(project.id);
    openConfirm({
      title: 'Delete Project',
      message: `Permanently delete "${project.name}" from disk? This cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      tone: 'danger',
      onConfirm: async () => {
        if (!ownsMountedProject(owner)) return;
        setIsDeleting(true);
        try {
          const deleted = await deleteProject(project.id, project.path);
          if (!ownsProject(owner)) return;
          if (!deleted) {
            pushToast('error', 'Failed to delete project from disk');
            if (mountedRef.current) setIsDeleting(false);
            return;
          }
          pushToast('success', 'Project deleted');
          if (mountedRef.current) onClose();
          setProject(null);
          setMode(AppMode.DASHBOARD);
        } catch {
          if (ownsProject(owner)) {
            pushToast('error', 'Failed to delete project from disk');
            if (mountedRef.current) setIsDeleting(false);
          }
        }
      },
    });
  }, [project, openConfirm, pushToast, setProject, setMode, onClose, captureProjectOwner, ownsProject, ownsMountedProject]);

  const handleFloorPlanUpload = async () => {
    const desktop = getDesktopApi();
    if (desktop && project) {
      const ownerProject = project;
      const owner = captureProjectOwner(ownerProject.id);
      await runProjectOperation(ownerProject.id, async () => {
        try {
          const result = await desktop.uploadFloorPlan(ownerProject);
          if (!result) return;
          updateOwnedProject(owner, { floorPlanImage: result.path, path: result.projectPath });
        } catch {
          if (ownsProject(owner)) pushToast('error', 'Failed to upload floor plan');
        }
      });
    } else {
      floorPlanInputRef.current?.click();
    }
  };

  const handleFloorPlanFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ownerProjectId = project?.id;
    e.target.value = '';
    if (!file || !ownerProjectId) return;
    const owner = captureProjectOwner(ownerProjectId);
    void runProjectOperation(ownerProjectId, async () => {
      try {
        const src = await readFileAsDataUrl(file);
        if (updateOwnedProject(owner, { floorPlanImage: src })) {
          pushToast('success', `Floor plan "${file.name}" uploaded`);
        }
      } catch {
        if (ownsProject(owner)) pushToast('error', 'Failed to read floor plan image');
      }
    });
  };

  const handleLogoUpload = async () => {
    const desktop = getDesktopApi();
    if (desktop && project) {
      const ownerProject = project;
      const owner = captureProjectOwner(ownerProject.id);
      await runProjectOperation(ownerProject.id, async () => {
        try {
          const result = await desktop.uploadLogo(ownerProject);
          if (!result) return;
          updateOwnedProject(owner, { logo: result.path, path: result.projectPath });
        } catch {
          if (ownsProject(owner)) pushToast('error', 'Failed to upload logo');
        }
      });
    } else {
      logoInputRef.current?.click();
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const ownerProjectId = project?.id;
    e.target.value = '';
    if (!file || !ownerProjectId) return;
    const owner = captureProjectOwner(ownerProjectId);
    void runProjectOperation(ownerProjectId, async () => {
      try {
        const src = await readFileAsDataUrl(file);
        if (updateOwnedProject(owner, { logo: src })) {
          pushToast('success', `Logo "${file.name}" uploaded`);
        }
      } catch {
        if (ownsProject(owner)) pushToast('error', 'Failed to read logo image');
      }
    });
  };

  const normalizedWebsite = React.useMemo(() => {
    const raw = String(project?.website || '').trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }, [project?.website]);

  const createdLabel = React.useMemo(() => {
    if (!project?.createdDate) return 'Unknown';
    return new Date(project.createdDate).toLocaleString();
  }, [project?.createdDate]);

  const modifiedLabel = React.useMemo(() => {
    if (!project?.modifiedDate) return 'Unknown';
    return new Date(project.modifiedDate).toLocaleString();
  }, [project?.modifiedDate]);

  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    };
  }, []);

  const handleGalleryFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []) as File[];
    const ownerProjectId = project?.id;
    e.target.value = '';
    if (files.length === 0 || !ownerProjectId) return;
    const owner = captureProjectOwner(ownerProjectId);

    await runProjectOperation(ownerProjectId, async () => {
      const results = await Promise.all(files.map(async (file) => {
        try {
          return await readFileAsDataUrl(file);
        } catch {
          if (ownsProject(owner)) pushToast('error', `Failed to read "${file.name}"`);
          return null;
        }
      }));
      const added = results.filter((src): src is string => !!src);
      if (added.length === 0) return;

      // Read every selected file first, then append once against the latest
      // gallery state. Per-reader writes all captured the same old array and the
      // last callback used to overwrite the other selected images.
      const state = useProjectStore.getState();
      if (!ownsProject(owner) || state.project?.id !== ownerProjectId) return;
      updateOwnedProject(owner, { galleryImages: [...(state.project.galleryImages ?? []), ...added] });
    });
  };

  const removeGalleryImage = (index: number) => {
    const current = project?.galleryImages ?? [];
    updateProject({ galleryImages: current.filter((_, i) => i !== index) });
  };

  if (!project) return null;

  return (
    <div onMouseDown={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div onMouseDown={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 text-primary">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Settings className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Project Settings</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <div className="p-8 grid grid-cols-2 gap-8 text-sm">
          <div className="space-y-6">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <Settings className="w-3 h-3" /> Project Details
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Project Name"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20"
                  value={project.name}
                  onChange={(e) => updateProject({ name: e.target.value })}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                    <span>Created: {createdLabel}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-slate-400" />
                    <span>Modified: {modifiedLabel}</span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <Building2 className="w-3 h-3" /> Company Information
              </label>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Company Name"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20"
                  value={project.company}
                  onChange={(e) => updateProject({ company: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Website URL"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20"
                  value={project.website}
                  onChange={(e) => updateProject({ website: e.target.value })}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!normalizedWebsite}
                    onClick={() => window.open(normalizedWebsite, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Website
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <Eye className="w-3 h-3" /> Preview Display
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors">
                <div>
                  <div className="text-sm font-medium text-slate-700">Show scene names</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Show scene names on hotspot labels in preview</div>
                </div>
                <input
                  type="checkbox"
                  checked={project.exportSettings?.showSceneNames ?? false}
                  onChange={(e) => updateProject({ exportSettings: { ...project.exportSettings, showSceneNames: e.target.checked } })}
                  className="w-4 h-4 rounded accent-primary cursor-pointer flex-shrink-0"
                />
              </label>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <Palette className="w-3 h-3" /> Branding Colors
              </label>
              <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <input
                  type="color"
                  className="w-10 h-10 rounded cursor-pointer"
                  value={project.primaryColor}
                  onChange={(e) => updateProject({ primaryColor: e.target.value })}
                />
                <div>
                  <div className="font-bold text-slate-800">Primary Color</div>
                  <div className="text-[10px] text-slate-500 font-mono uppercase">{project.primaryColor}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <ImageIcon className="w-3 h-3" /> Logo & Identity
              </label>
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFileChange} />
              <div className="aspect-square bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center relative overflow-hidden group">
                {project.logo ? (
                  <>
                    <img src={resolveAssetSrc(project, project.logo)} alt="Logo Preview" className="w-full h-full object-contain p-4" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={handleLogoUpload}
                        className="px-2.5 py-1.5 rounded-md border border-white/50 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/10"
                      >
                        Change Logo
                      </button>
                      <button
                        onClick={() => updateProject({ logo: undefined })}
                        className="px-2.5 py-1.5 rounded-md border border-red-300/60 text-red-100 text-xs font-bold uppercase tracking-wider hover:bg-red-500/20"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={handleLogoUpload} className="flex flex-col items-center cursor-pointer group-hover:text-primary transition-colors">
                    <ImageIcon className="w-8 h-8 text-slate-300 mb-2" />
                    <span className="text-xs font-medium text-slate-400">Upload Project Logo</span>
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <MapIcon className="w-3 h-3" /> Floor Plan
              </label>
              <input ref={floorPlanInputRef} type="file" accept="image/*" className="hidden" onChange={handleFloorPlanFileChange} />
              <div className="aspect-video bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center relative overflow-hidden group">
                {project.floorPlanImage ? (
                  <>
                    <img src={resolveAssetSrc(project, project.floorPlanImage)} alt="Floor Plan Preview" className="w-full h-full object-contain p-2" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={handleFloorPlanUpload}
                        className="px-2.5 py-1.5 rounded-md border border-white/50 text-white text-xs font-bold uppercase tracking-wider hover:bg-white/10"
                      >
                        Change
                      </button>
                      <button
                        onClick={() => openConfirm({
                          title: 'Remove Floor Plan',
                          message: 'Remove the floor plan image and all scene pins from this project?',
                          confirmLabel: 'Remove',
                          cancelLabel: 'Cancel',
                          tone: 'danger',
                          onConfirm: () => {
                            const latest = useProjectStore.getState().project;
                            if (!latest || latest.id !== project.id) return;
                            // Pins are coordinates in this specific image; keeping
                            // them would resurrect stale positions on a new plan.
                            useProjectStore.getState().updateProject({
                              floorPlanImage: undefined,
                              scenes: latest.scenes.map((scene) => ({ ...scene, floorPlan: undefined })),
                            });
                          },
                        })}
                        className="px-2.5 py-1.5 rounded-md border border-red-300/60 text-red-100 text-xs font-bold uppercase tracking-wider hover:bg-red-500/20"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" />
                          Remove
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button onClick={handleFloorPlanUpload} className="flex flex-col items-center cursor-pointer group-hover:text-primary transition-colors">
                    <MapIcon className="w-8 h-8 text-slate-300 mb-2" />
                    <span className="text-xs font-medium text-slate-400">Upload Floor Plan</span>
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2 flex items-center gap-2">
                <FolderOpen className="w-3 h-3" /> Project Folder
              </label>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] text-slate-500 break-all">{project.path || 'No project path available yet.'}</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!project.path}
                    onClick={() => {
                      void (async () => {
                        if (!project.path) return;
                        const ok = await openPathInFileManager(project.path);
                        if (!ok) pushToast('error', 'Unable to open project folder');
                      })();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Open Folder
                  </button>
                  <button
                    type="button"
                    disabled={!project.path}
                    onClick={() => {
                      void (async () => {
                        if (!project.path) return;
                        try {
                          await navigator.clipboard.writeText(project.path);
                          setCopiedPath(true);
                          if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
                          copiedTimerRef.current = window.setTimeout(() => setCopiedPath(false), 1200);
                        } catch {
                          pushToast('error', 'Unable to copy project path');
                        }
                      })();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedPath ? 'Copied' : 'Copy Path'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Gallery images — full width section */}
        <div className="px-8 pb-6 border-t border-slate-100 pt-6">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-3 flex items-center gap-2">
            <GalleryHorizontal className="w-3 h-3" /> Gallery Images
          </label>
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleGalleryFileChange}
          />
          <div className="grid grid-cols-4 gap-2">
            {(project.galleryImages ?? []).map((src, index) => (
              <div key={index} className="group relative aspect-video rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <img src={resolveAssetSrc(project, src)} alt={`Gallery ${index + 1}`} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => removeGalleryImage(index)}
                    className="p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-600 transition"
                    title="Remove image"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="aspect-video rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-1 hover:border-primary/40 hover:bg-primary/5 transition text-slate-400 hover:text-primary"
            >
              <Plus className="w-5 h-5" />
              <span className="text-[10px] font-medium">Add Photo</span>
            </button>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">These images appear in the Gallery panel of the preview tour.</p>
        </div>

        <div className="px-8 pb-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
            <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-2">Danger Zone</div>
            <p className="text-[11px] text-red-700 mb-3">Permanently delete this project and all its assets from disk. This cannot be undone.</p>
            <button
              type="button"
              onClick={handleDeleteProject}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-300 bg-white text-red-600 text-xs font-semibold hover:bg-red-100 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeleting ? 'Deleting…' : 'Delete Project'}
            </button>
          </div>
        </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">Changes are saved automatically.</div>
          <button onClick={onClose} className="px-8 py-3 bg-primary text-white font-bold rounded-xl shadow-lg shadow-primary/20 hover:brightness-110 transition-all">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectSettingsModal;
