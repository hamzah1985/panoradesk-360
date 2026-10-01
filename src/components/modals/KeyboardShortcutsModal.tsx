import React from 'react';
import { Keyboard } from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

const ROWS = [
  ['Ctrl/Cmd + S', 'Save project'],
  ['Ctrl/Cmd + N (dashboard)', 'Create new project'],
  ['Ctrl/Cmd + O (dashboard)', 'Open project dialog'],
  ['Up / Down (dashboard recents)', 'Select previous / next recent project'],
  ['Delete (dashboard recents)', 'Delete selected recent project'],
  ['Ctrl/Cmd + Z', 'Undo last edit'],
  ['Ctrl/Cmd + Shift + Z', 'Redo'],
  ['Ctrl/Cmd + Y', 'Redo (alternate)'],
  ['Ctrl/Cmd + K', 'Open command palette'],
  ['Up / Down (palette)', 'Navigate command list'],
  ['Home / End (palette)', 'Jump to first / last command'],
  ['Enter (palette)', 'Run highlighted command'],
  ['Ctrl/Cmd + Backspace (palette)', 'Clear command search'],
  ['Alt + Left / Right', 'Previous / next scene'],
  ['Up / Down (scene list)', 'Select previous / next scene'],
  ['Ctrl/Cmd + A (scene list)', 'Select all scenes'],
  ['P', 'Enter preview mode'],
  ['Esc (preview mode)', 'Back to editor'],
  ['Left / Right (preview)', 'Previous / next preview scene'],
  ['Home / End (preview)', 'First / last preview scene'],
  ['Delete / Backspace', 'Delete selected hotspot/marker'],
  ['Enter (in marker title)', 'Create marker'],
  ['Ctrl/Cmd + Enter (in marker description)', 'Create marker'],
  ['Up / Down (target scene picker)', 'Move active scene candidate'],
  ['Home / End (target scene picker)', 'Jump to first / last candidate'],
  ['Enter (target scene picker)', 'Pick active scene candidate'],
  ['Enter (confirm dialog)', 'Confirm action'],
  ['Esc', 'Close active modal'],
  ['?', 'Open keyboard shortcuts'],
];

const KeyboardShortcutsModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  useEscapeClose(open, onClose);
  if (!open) return null;

  return (
    <div onMouseDown={onClose} className="fixed inset-0 z-[170] bg-black/55 backdrop-blur-sm flex items-center justify-center p-6">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[calc(100vh-3rem)] rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-slate-800">Keyboard Shortcuts</h3>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-slate-500 hover:text-slate-800">Close</button>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto min-h-0 custom-scrollbar">
          {ROWS.map(([key, action]) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <kbd className="text-xs font-mono bg-white border border-slate-300 rounded px-2 py-1">{key}</kbd>
              <span className="text-sm text-slate-700">{action}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsModal;
