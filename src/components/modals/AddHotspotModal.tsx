import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { MapPin, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { HOTSPOT_ICONS, normalizeHotspotIconId } from '../../lib/hotspotIcons';

interface AddHotspotModalProps {
  sceneId: string;
  coords: { yaw: number; pitch: number };
  onCreate: (draft: { label: string; targetSceneId: string; icon: string; navigationMode: 'original' | 'marzipano' | 'pannellum' }) => void;
  onClose: () => void;
}

const AddHotspotModal: React.FC<AddHotspotModalProps> = ({ sceneId, coords, onCreate, onClose }) => {
  const { project } = useProjectStore();
  const { pushToast } = useUiStore();
  const [label, setLabel] = React.useState('');
  const [labelTouched, setLabelTouched] = React.useState(false);
  const [targetId, setTargetId] = React.useState('');
  const [icon, setIcon] = React.useState<string>('nav-default');
  const [navigationMode, setNavigationMode] = React.useState<'original' | 'marzipano' | 'pannellum'>('marzipano');
  const targetScenes = React.useMemo(() => (project?.scenes || []).filter((s) => s.id !== sceneId), [project?.scenes, sceneId]);
  useEscapeClose(true, onClose);

  React.useEffect(() => {
    if (!project) return;
    setLabelTouched(false);
    setIcon(normalizeHotspotIconId(project.hotspotStyle?.iconType));
  }, [project?.id]);

  React.useEffect(() => {
    if (!targetId) {
      const fallback = targetScenes[0]?.id || '';
      if (fallback) setTargetId(fallback);
    }
  }, [targetScenes, targetId]);

  React.useEffect(() => {
    if (labelTouched) return;
    const targetSceneName = targetScenes.find((s) => s.id === targetId)?.name;
    if (targetSceneName) setLabel(`Go to ${targetSceneName}`);
  }, [targetId, targetScenes, labelTouched]);

  const handleSave = () => {
    if (!project) return;
    const resolvedTarget = targetId || targetScenes[0]?.id || '';
    if (!resolvedTarget || resolvedTarget === sceneId) {
      pushToast('error', 'Select a different target scene for this hotspot');
      return;
    }
    const yaw = Number(coords?.yaw);
    const pitch = Number(coords?.pitch);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return;

    onCreate({
      label: label || `Go to ${targetScenes.find((scene) => scene.id === resolvedTarget)?.name || '...'}`,
      targetSceneId: resolvedTarget,
      icon,
      navigationMode,
    });
    onClose();
  };
  const canCreate = !!project && targetScenes.length > 0;

  return (
    <div onMouseDown={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div onMouseDown={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 text-red-500">
            <div className="p-2 bg-red-50 rounded-xl">
              <MapPin className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Add Hotspot</h2>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Placement</div>
            <div className="text-xs text-slate-600 mt-1">Yaw {Number(coords.yaw).toFixed(3)} | Pitch {Number(coords.pitch).toFixed(3)}</div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Display Label</label>
            <input
              type="text"
              placeholder="e.g. Master Bedroom"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500/20"
              value={label}
              onChange={(e) => {
                setLabelTouched(true);
                setLabel(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Target Scene</label>
            <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500/20" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Select a scene...</option>
              {targetScenes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {targetScenes.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-2">Add at least one more scene before creating a navigation hotspot.</p>
            )}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Icon</label>
            <select
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500/20"
              value={icon}
              onChange={(e) => setIcon(normalizeHotspotIconId(e.target.value))}
            >
              {HOTSPOT_ICONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Navigation Style</label>
            <select
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-red-500/20"
              value={navigationMode}
              onChange={(e) => {
                if (e.target.value === 'marzipano') setNavigationMode('marzipano');
                else if (e.target.value === 'pannellum') setNavigationMode('pannellum');
                else if (e.target.value === 'original') setNavigationMode('original');
              }}
            >
              <option value="original">Original (manual target view)</option>
              <option value="marzipano">Marzipano Style (auto entry)</option>
              <option value="pannellum">Pannellum Style (carry heading)</option>
            </select>
          </div>

          <div className="pt-4 flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-all">Cancel</button>
            <button disabled={!canCreate} onClick={handleSave} className="flex-1 px-4 py-3 bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-red-500/20 hover:brightness-110 transition-all">Create Hotspot</button>
          </div>
          <div className="text-[11px] text-slate-500">Press Enter to create hotspot.</div>
        </div>
      </div>
    </div>
  );
};

export default AddHotspotModal;
