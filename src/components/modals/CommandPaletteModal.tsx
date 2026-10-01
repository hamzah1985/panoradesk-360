import React from 'react';
import { useEscapeClose } from '../../hooks/useEscapeClose';

type Item = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

const CommandPaletteModal = ({ open, onClose, items }: { open: boolean; onClose: () => void; items: Item[] }) => {
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  useEscapeClose(open, onClose);

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
  }, [open]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const matches = items.filter((item) => item.label.toLowerCase().includes(q) || (item.hint || '').toLowerCase().includes(q));
    return matches.sort((a, b) => {
      const aLabel = a.label.toLowerCase();
      const bLabel = b.label.toLowerCase();
      const aStarts = aLabel.startsWith(q) ? 1 : 0;
      const bStarts = bLabel.startsWith(q) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return aLabel.localeCompare(bLabel);
    });
  }, [items, query]);
  const activeItem = filtered[activeIndex];

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex((idx) => {
      if (filtered.length === 0) return 0;
      return Math.min(Math.max(0, idx), filtered.length - 1);
    });
  }, [open, filtered.length]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length === 0) return;
        setActiveIndex((i) => (i + 1) % filtered.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length === 0) return;
        setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
      }
      if (e.key === 'Home') {
        if (filtered.length === 0) return;
        e.preventDefault();
        setActiveIndex(0);
      }
      if (e.key === 'End') {
        if (filtered.length === 0) return;
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
      }
      if (e.key === 'Enter') {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a[href], [role="button"]')) return;
        e.preventDefault();
        const item = filtered[activeIndex];
        if (!item) return;
        item.run();
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'backspace') {
        e.preventDefault();
        setQuery('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, activeIndex, filtered, onClose]);

  React.useEffect(() => {
    if (!open) return;
    const root = listRef.current;
    if (!root) return;
    const activeEl = root.querySelector<HTMLButtonElement>(`[data-cmd-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, filtered.length]);

  if (!open) return null;

  return (
    <div onMouseDown={onClose} className="fixed inset-0 z-[190] bg-black/45 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4">
      <div onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
        <div className="p-3 border-b border-slate-200">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <div className="text-[11px] text-slate-500 mt-2">
            {filtered.length} command{filtered.length === 1 ? '' : 's'} | Arrow keys/Home/End navigate | Enter runs | Ctrl/Cmd+Backspace clears search
          </div>
          {activeItem && (
            <div className="text-[11px] text-primary mt-1">
              Selected: {activeIndex + 1}/{filtered.length} - {activeItem.label}
            </div>
          )}
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 && <div className="px-4 py-6 text-sm text-slate-500">No commands found.</div>}
          {filtered.map((item, idx) => (
            <button
              data-cmd-index={idx}
              key={item.id}
              aria-selected={idx === activeIndex}
              onClick={() => {
                item.run();
                onClose();
              }}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 flex items-center justify-between ${idx === activeIndex ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              <span className="text-sm text-slate-800">{item.label}</span>
              {item.hint && <span className="text-xs text-slate-500">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandPaletteModal;
