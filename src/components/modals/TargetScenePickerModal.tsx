import React from 'react';
import { Scene, Project } from '../../types';
import { resolveAssetSrc } from '../../lib/media';
import { useEscapeClose } from '../../hooks/useEscapeClose';

type Props = {
  open: boolean;
  project: Project;
  currentSceneId: string;
  selectedTargetId: string;
  onClose: () => void;
  onPick: (sceneId: string) => void;
};

const TargetScenePickerModal: React.FC<Props> = ({ open, project, currentSceneId, selectedTargetId, onClose, onPick }) => {
  useEscapeClose(open, onClose);
  const [query, setQuery] = React.useState('');
  const [activeSceneId, setActiveSceneId] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveSceneId(selectedTargetId || '');
  }, [open, selectedTargetId]);

  const candidates = React.useMemo(
    () => project.scenes.filter((s) => s.id !== currentSceneId),
    [project.scenes, currentSceneId],
  );
  const filtered = React.useMemo(
    () => candidates.filter((scene) => (scene.name || '').toLowerCase().includes(query.trim().toLowerCase())),
    [candidates, query],
  );
  const selectedTargetName = project.scenes.find((scene) => scene.id === selectedTargetId)?.name || '';
  const activeIndex = Math.max(0, filtered.findIndex((scene) => scene.id === activeSceneId));

  React.useEffect(() => {
    if (!open) return;
    if (!filtered.length) {
      setActiveSceneId('');
      return;
    }
    if (!activeSceneId || !filtered.some((scene) => scene.id === activeSceneId)) {
      setActiveSceneId(filtered[0].id);
    }
  }, [open, filtered, activeSceneId]);

  React.useEffect(() => {
    if (!open || !activeSceneId) return;
    const node = document.querySelector(`[data-scene-pick-id="${activeSceneId}"]`) as HTMLElement | null;
    node?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, activeSceneId]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const tag = (active?.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!active?.isContentEditable;
      if (typing) return;

      if (e.key === 'ArrowDown') {
        if (!filtered.length) return;
        e.preventDefault();
        const nextIndex = Math.min(filtered.length - 1, activeIndex + 1);
        setActiveSceneId(filtered[nextIndex].id);
        return;
      }
      if (e.key === 'ArrowUp') {
        if (!filtered.length) return;
        e.preventDefault();
        const nextIndex = Math.max(0, activeIndex - 1);
        setActiveSceneId(filtered[nextIndex].id);
        return;
      }
      if (e.key === 'Home') {
        if (!filtered.length) return;
        e.preventDefault();
        setActiveSceneId(filtered[0].id);
        return;
      }
      if (e.key === 'End') {
        if (!filtered.length) return;
        e.preventDefault();
        setActiveSceneId(filtered[filtered.length - 1].id);
        return;
      }
      if (e.key === 'Enter') {
        if (!filtered.length) return;
        e.preventDefault();
        onPick(activeSceneId || filtered[0].id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, onPick, activeSceneId, activeIndex]);

  if (!open) return null;

  return (
    <div onMouseDown={onClose} className="fixed inset-0 z-[150] bg-black/55 backdrop-blur-sm flex items-center justify-center p-6">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Choose Target Scene</h3>
            <div className="text-xs text-slate-500 mt-0.5">
              Current target: <span className="font-semibold text-slate-700">{selectedTargetName || 'None'}</span>
            </div>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-slate-500 hover:text-slate-800">Close</button>
        </div>
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search scenes..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            {!!query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="px-2.5 py-2 text-xs rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            {filtered.length} candidate scene{filtered.length === 1 ? '' : 's'} | Arrow keys navigate, Enter picks selected
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[480px] overflow-auto">
          {filtered.map((scene: Scene) => {
            const active = scene.id === selectedTargetId;
            const focused = scene.id === activeSceneId;
            return (
              <button
                key={scene.id}
                data-scene-pick-id={scene.id}
                onMouseEnter={() => setActiveSceneId(scene.id)}
                onClick={() => onPick(scene.id)}
                className={`rounded-xl overflow-hidden border text-left ${active ? 'border-slate-900' : focused ? 'border-primary/70' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="aspect-[2/1] bg-slate-100">
                  <img src={resolveAssetSrc(project, scene.thumbnail || scene.image)} className="w-full h-full object-cover" alt={scene.name || ''} loading="lazy" />
                </div>
                <div className="p-2">
                  <div className="text-sm font-semibold text-slate-700 truncate">{scene.name}</div>
                  {active && <div className="text-[10px] text-primary font-semibold mt-0.5 uppercase tracking-wide">Selected</div>}
                </div>
              </button>
            );
          })}
          {candidates.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No other scenes available.
            </div>
          )}
          {candidates.length > 0 && filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              No scenes match your search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TargetScenePickerModal;
