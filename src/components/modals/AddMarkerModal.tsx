import React from 'react';
import { useProjectStore } from '../../store/projectStore';
import { v4 as uuidv4 } from 'uuid';
import { Info, X } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

interface AddMarkerModalProps {
  sceneId: string;
  coords: { yaw: number; pitch: number };
  onClose: () => void;
}

const AddMarkerModal: React.FC<AddMarkerModalProps> = ({ sceneId, coords, onClose }) => {
  const { addMarker } = useProjectStore();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  useEscapeClose(true, onClose);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    if (!Number.isFinite(coords?.yaw) || !Number.isFinite(coords?.pitch)) return;
    
    addMarker(sceneId, {
      id: uuidv4(),
      type: 'info',
      title: trimmedTitle,
      description: description.trim(),
      yaw: coords.yaw,
      pitch: coords.pitch,
    });
    onClose();
  };

  return (
    <div onMouseDown={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div onMouseDown={(e) => e.stopPropagation()} className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 text-blue-500">
            <div className="p-2 bg-blue-50 rounded-xl">
              <Info className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Add Info Marker</h2>
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
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Title</label>
            <input
              type="text"
              placeholder="e.g. Italian Marble"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Description</label>
            <textarea
              placeholder="Describe this item..."
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave();
              }}
            />
            <div className="mt-1 text-[11px] text-slate-500">{description.length} characters</div>
          </div>
          
          <div className="pt-4 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              disabled={!title.trim()}
              onClick={handleSave}
              className="flex-1 px-4 py-3 bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-blue-500/20 hover:brightness-110 transition-all"
            >
              Create Marker
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddMarkerModal;
