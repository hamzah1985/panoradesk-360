import React from 'react';
import { X, Download, ShieldCheck, PlayCircle, FolderOpen, Loader2, RefreshCw, Monitor } from 'lucide-react';
import { useProjectStore, checkProjectHealth, exportProjectWebsite, previewExport, openPathInFileManager, getInlinePreviewUrl } from '../../store/projectStore';
import { ExportOptions } from '../../lib/desktop';
import { useUiStore } from '../../store/uiStore';
import { useEscapeClose } from '../../hooks/useEscapeClose';

function buildExportOptionsFromProject(project: any): ExportOptions {
  return {
    includeBranding: project?.exportSettings?.includeBranding ?? false,
    includeFloorPlan: project?.exportSettings?.showFloorPlan ?? false,
    includeGallery: project?.exportSettings?.showGallery ?? true,
    template: project?.exportSettings?.exportTemplate ?? 'minimal',
    imageOptimization: project?.exportSettings?.imageOptimization ?? 'balanced',
    showLoadingScreen: project?.exportSettings?.showLoadingScreen ?? false,
    zipOutput: true,
    iframe: { width: '100%', height: '720', allowFullscreen: true },
  };
}

function toErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

const ExportWebsiteModal = ({ onClose }: { onClose: () => void }) => {
  const { project, updateProject } = useProjectStore();
  const { pushToast } = useUiStore();
  const [isBusy, setIsBusy] = React.useState(false);
  const [healthText, setHealthText] = React.useState('');
  const [lastExportDir, setLastExportDir] = React.useState('');
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState('');
  const mountedRef = React.useRef(true);
  const sceneCount = project?.scenes?.length || 0;
  const hasScenes = sceneCount > 0;
  const hasFloorPlan = !!project?.floorPlanImage;

  React.useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const tryClose = React.useCallback(() => {
    if (isBusy) return;
    onClose();
  }, [isBusy, onClose]);

  useEscapeClose(!isBusy, tryClose);
  const [options, setOptions] = React.useState<ExportOptions>(buildExportOptionsFromProject(project));

  const setOpt = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));
  const ensureHasScenes = (actionName: string) => {
    if (hasScenes) return true;
    pushToast('info', `Add at least one scene before ${actionName}.`);
    return false;
  };

  const runHealth = async () => {
    if (!project) return;
    setIsBusy(true);
    try {
      const normalizedOptions: ExportOptions = { ...options, includeFloorPlan: hasFloorPlan ? options.includeFloorPlan : false };
      const result = await checkProjectHealth(project, normalizedOptions);
      if (mountedRef.current) {
        setHealthText([result.ok ? 'Health check passed.' : 'Health check failed.', ...result.issues.map((x) => `Issue: ${x}`), ...result.warnings.map((x) => `Warning: ${x}`)].join('\n'));
      }
    } catch (error) {
      const message = toErrorMessage(error, 'Health check failed.');
      if (mountedRef.current) setHealthText(`Health check failed.\nIssue: ${message}`);
      pushToast('error', message);
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  };

  const runExport = async () => {
    if (!project) return;
    if (!ensureHasScenes('exporting')) return;
    setIsBusy(true);
    try {
      const normalizedOptions: ExportOptions = { ...options, includeFloorPlan: hasFloorPlan ? options.includeFloorPlan : false, zipOutput: true };
      updateProject({ exportSettings: { ...project.exportSettings, includeBranding: normalizedOptions.includeBranding, showFloorPlan: normalizedOptions.includeFloorPlan, showGallery: normalizedOptions.includeGallery, exportTemplate: normalizedOptions.template, imageOptimization: normalizedOptions.imageOptimization, showLoadingScreen: normalizedOptions.showLoadingScreen } });
      const result = await exportProjectWebsite(project, normalizedOptions);
      if (result?.canceled) return;
      if (result?.zipPath && mountedRef.current) {
        setLastExportDir(result.zipPath);
        pushToast('success', 'ZIP saved. Ready to upload anywhere.');
      }
      onClose();
    } catch (error) {
      pushToast('error', toErrorMessage(error, 'Export failed'));
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  };

  const runExternalPreview = async () => {
    if (!project) return;
    if (!ensureHasScenes('previewing export')) return;
    setIsBusy(true);
    try {
      await previewExport(project, { ...options, includeFloorPlan: hasFloorPlan ? options.includeFloorPlan : false });
    } catch (error) {
      pushToast('error', toErrorMessage(error, 'Preview export failed'));
    } finally {
      if (mountedRef.current) setIsBusy(false);
    }
  };

  const loadInlinePreview = async () => {
    if (!project) return;
    if (!ensureHasScenes('previewing export')) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewUrl(null);
    try {
      const url = await getInlinePreviewUrl(project, { ...options, includeFloorPlan: hasFloorPlan ? options.includeFloorPlan : false });
      if (mountedRef.current) {
        if (url) setPreviewUrl(url);
        else setPreviewError('Preview server did not return a URL.');
      }
    } catch (error) {
      if (mountedRef.current) setPreviewError(toErrorMessage(error, 'Preview failed'));
    } finally {
      if (mountedRef.current) setPreviewLoading(false);
    }
  };

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      if (e.key === 'Enter') { e.preventDefault(); if (!isBusy && hasScenes) void runExport(); return; }
      if (e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); if (!isBusy && hasScenes) void runExternalPreview(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isBusy, hasScenes, options, project, hasFloorPlan]);

  if (!project) return null;

  return (
    <div onMouseDown={tryClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-6xl bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ height: 'min(90vh, 820px)' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-800">Export Website ZIP</h2>
            {isBusy && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
          </div>
          <button disabled={isBusy} onClick={tryClose} className="p-1.5 text-slate-400 hover:text-slate-700 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>
        {isBusy && (
          <div className="h-0.5 bg-slate-100 overflow-hidden flex-shrink-0">
            <div className="h-full bg-primary animate-[progress_1.5s_ease-in-out_infinite]" style={{ width: '60%' }} />
          </div>
        )}

        {/* Body: two columns */}
        <div className="flex flex-1 min-h-0">
          {/* LEFT — settings */}
          <div className="w-80 flex-shrink-0 border-r border-slate-200 overflow-y-auto p-4 space-y-4 text-sm">
            {!hasScenes && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                No scenes yet. Import at least one panorama before export.
              </div>
            )}
            {hasScenes && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Ready to export {sceneCount} scene{sceneCount === 1 ? '' : 's'}.
              </div>
            )}

            <div>
              <label className="text-xs uppercase tracking-widest text-slate-400 font-bold">Export Name</label>
              <input type="text" className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" value={project.name} onChange={(e) => updateProject({ name: e.target.value })} />
            </div>

            <div>
              <label className="text-xs uppercase tracking-widest text-slate-400 font-bold">Image Size</label>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {([
                  { value: 'none', label: 'Original', desc: 'Full resolution' },
                  { value: 'balanced', label: 'Max 4K', desc: 'Recommended' },
                  { value: 'aggressive', label: 'Max 2K', desc: 'Smallest files' },
                ] as const).map(({ value, label, desc }) => {
                  const active = options.imageOptimization === value;
                  return (
                    <button key={value} type="button" onClick={() => setOpt('imageOptimization', value)}
                      className={`rounded-lg border p-2 text-left transition-all ${active ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}>
                      <div className={`text-xs font-semibold ${active ? 'text-primary' : 'text-slate-700'}`}>{label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-sm">Include Branding</span>
                <input type="checkbox" checked={options.includeBranding} onChange={() => setOpt('includeBranding', !options.includeBranding)} />
              </label>
              <label className={`flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 ${!hasFloorPlan ? 'opacity-60' : ''}`}>
                <span className="text-sm">Include Floor Plan</span>
                <input type="checkbox" disabled={!hasFloorPlan} checked={options.includeFloorPlan} onChange={() => setOpt('includeFloorPlan', !options.includeFloorPlan)} />
              </label>
              {!hasFloorPlan && <div className="text-[11px] text-slate-500 -mt-1">Upload a floor plan first to enable.</div>}
              <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-sm">Include Gallery</span>
                <input type="checkbox" checked={options.includeGallery} onChange={() => setOpt('includeGallery', !options.includeGallery)} />
              </label>
              <label className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-sm">Show Loading Screen</span>
                <input type="checkbox" checked={options.showLoadingScreen} onChange={() => setOpt('showLoadingScreen', !options.showLoadingScreen)} />
              </label>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button onClick={runHealth} disabled={isBusy} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-60">
                <ShieldCheck className="w-3.5 h-3.5" /> Health Check
              </button>
              <button onClick={runExternalPreview} disabled={isBusy || !hasScenes} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-60">
                <PlayCircle className="w-3.5 h-3.5" /> Open in Window
              </button>
              {project.path && (
                <button onClick={() => { void (async () => { const ok = await openPathInFileManager(project.path!); if (!ok) pushToast('error', 'Unable to open project folder'); })(); }} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg">
                  <FolderOpen className="w-3.5 h-3.5" /> Project Folder
                </button>
              )}
              {lastExportDir && (
                <button onClick={() => { void (async () => { const ok = await openPathInFileManager(lastExportDir); if (!ok) pushToast('error', 'Unable to open ZIP location'); })(); }} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg">
                  <FolderOpen className="w-3.5 h-3.5" /> Show ZIP
                </button>
              )}
            </div>

            {healthText && (
              <div className="rounded-lg overflow-hidden border border-slate-200">
                <div className="flex items-center justify-between bg-slate-100 px-3 py-2 border-b border-slate-200">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Health Check</span>
                  <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(healthText); pushToast('success', 'Copied'); } catch { pushToast('error', 'Clipboard copy failed'); } }} className="text-[10px] text-slate-500 hover:text-slate-800 px-2 py-0.5 rounded hover:bg-slate-200 transition-colors">Copy</button>
                </div>
                <div className="bg-slate-900 p-3 space-y-1">
                  {healthText.split('\n').filter(Boolean).map((line, i) => {
                    const isIssue = line.startsWith('Issue:');
                    const isWarning = line.startsWith('Warning:');
                    const isOk = /passed/i.test(line) && !isIssue && !isWarning;
                    return (
                      <div key={i} className={`flex items-start gap-2 text-xs select-text ${isIssue ? 'text-red-400' : isWarning ? 'text-amber-400' : isOk ? 'text-emerald-400' : 'text-slate-300'}`}>
                        <span className="flex-shrink-0 w-3 text-center">{isIssue ? '✗' : isWarning ? '⚠' : isOk ? '✓' : '·'}</span>
                        <span>{isIssue ? line.slice(7).trim() : isWarning ? line.slice(9).trim() : line}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-400">Ctrl+Enter to export · Ctrl+Shift+P to open in window</div>
          </div>

          {/* RIGHT — live preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-slate-900">
            {/* Preview toolbar */}
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-700 flex-shrink-0 bg-slate-800">
              <Monitor className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span className="text-xs text-slate-400 font-medium">Export Preview</span>
              <span className="text-[10px] text-slate-600 hidden sm:block">— builds a local copy with current settings</span>
              <div className="ml-auto flex items-center gap-2">
                {previewUrl && (
                  <button
                    onClick={loadInlinePreview}
                    disabled={previewLoading || isBusy || !hasScenes}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md disabled:opacity-50 transition"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                )}
                <button
                  onClick={loadInlinePreview}
                  disabled={previewLoading || isBusy || !hasScenes}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-white rounded-md disabled:opacity-50 transition"
                >
                  {previewLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
                  {previewLoading ? 'Building...' : previewUrl ? 'Load Preview' : 'Load Preview'}
                </button>
              </div>
            </div>

            {/* Preview area */}
            <div className="flex-1 min-h-0 relative">
              {!previewUrl && !previewLoading && !previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-slate-500">
                  <Monitor className="w-12 h-12 text-slate-700" />
                  <div className="text-center">
                    <div className="text-sm font-medium text-slate-400">No preview loaded</div>
                    <div className="text-xs text-slate-600 mt-1">Click "Load Preview" to build and preview the export with current settings</div>
                  </div>
                  <button
                    onClick={loadInlinePreview}
                    disabled={previewLoading || isBusy || !hasScenes}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary hover:bg-primary/90 text-white rounded-lg disabled:opacity-50 transition"
                  >
                    <PlayCircle className="w-4 h-4" /> Load Preview
                  </button>
                </div>
              )}

              {previewLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <div className="text-sm">Building export preview...</div>
                  <div className="text-xs text-slate-600">Copying assets and starting local server</div>
                </div>
              )}

              {previewError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                  <div className="text-red-400 text-sm font-medium">Preview failed</div>
                  <div className="text-xs text-slate-500 max-w-sm">{previewError}</div>
                  <button onClick={loadInlinePreview} disabled={isBusy || !hasScenes} className="inline-flex items-center gap-2 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-md disabled:opacity-50">
                    <RefreshCw className="w-3 h-3" /> Try Again
                  </button>
                </div>
              )}

              {previewUrl && !previewLoading && (
                <iframe
                  key={previewUrl}
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Export Preview"
                  allow="fullscreen"
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2 flex-shrink-0 bg-white">
          <button disabled={isBusy} onClick={tryClose} className="px-4 py-2 text-sm rounded-lg hover:bg-slate-100 disabled:opacity-50">Cancel</button>
          <button disabled={isBusy || !hasScenes} onClick={runExport} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg disabled:opacity-60">
            <Download className="w-4 h-4" /> {isBusy ? 'Working...' : 'Export ZIP'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportWebsiteModal;
